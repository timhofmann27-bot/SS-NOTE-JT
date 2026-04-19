import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator, Modal, ScrollView, Alert, PanResponder, Image
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '../../src/context/AuthContext';
import { messagesAPI, chatsAPI, typingAPI, contactsAPI, keysAPI, encryptedMessagesAPI } from '../../src/utils/api';
import api from '../../src/utils/api';
import { COLORS, FONTS, SPACING, SECURITY_LEVELS } from '../../src/utils/theme';
import {
  ensureKeyPair,
  getKeyFingerprint,
  getCombinedFingerprint,
  initializeSession,
  initializeGroupSession,
  groupEncrypt,
  groupDecrypt,
  ratchetEncrypt,
  ratchetDecrypt,
  sharedSecret,
} from '../../src/utils/crypto';
import VoiceRecorder from '../../src/components/VoiceRecorder';
import VoiceMessagePlayer from '../../src/components/VoiceMessagePlayer';
import nacl from 'tweetnacl';

export default function ChatDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [chat, setChat] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<any[]>([]);
  const [securityLevel, setSecurityLevel] = useState('UNCLASSIFIED');
  const [showSecMenu, setShowSecMenu] = useState(false);
  const [selfDestruct, setSelfDestruct] = useState<number | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [isE2EESessionActive, setIsE2EESessionActive] = useState(false);
  const [e2eeFingerprint, setE2eeFingerprint] = useState<string | null>(null);
  const [showFingerprint, setShowFingerprint] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ uri: string; base64: string; type: string; fileName?: string } | null>(null);
  const [replyTo, setReplyTo] = useState<any>(null);
  const [messageActions, setMessageActions] = useState<{ msg: any; x: number; y: number } | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const typingTimer = useRef<any>(null);
  const lastMsgId = useRef<string | null>(null);
  const e2eeSessionRef = useRef<boolean>(false);

  const loadChat = useCallback(async () => {
    if (!id) return;
    try {
      const [chatRes, msgsRes] = await Promise.all([
        chatsAPI.get(id), messagesAPI.list(id, 50),
      ]);
      setChat(chatRes.data.chat);
      
      const decryptedMessages = [];
      for (const msg of (msgsRes.data.messages || [])) {
        if (msg.e2ee && msg.content && msg.nonce) {
          if (chatRes.data.chat?.is_group) {
            const result = await groupDecrypt(
              msg.content, msg.nonce, id,
              msg.sender_id,
              msg.sender_key_id || '',
              msg.sender_key_iteration || 0,
              msg.media_ciphertext || null,
              msg.media_nonce || null
            );
            decryptedMessages.push({
              ...msg,
              content: result.text || '[Entschlüsselung fehlgeschlagen]',
              media_base64: result.mediaBase64 || msg.media_base64,
              _decrypted: true,
            });
          } else {
            const result = await ratchetDecrypt(
              msg.content, msg.nonce, id,
              msg.dh_public || null,
              msg.media_ciphertext || null,
              msg.media_nonce || null
            );
            decryptedMessages.push({
              ...msg,
              content: result.text || '[Entschlüsselung fehlgeschlagen]',
              media_base64: result.mediaBase64 || msg.media_base64,
              _decrypted: true,
            });
          }
        } else {
          decryptedMessages.push(msg);
        }
      }
      setMessages(decryptedMessages);
      
      if (msgsRes.data.messages?.length > 0) {
        lastMsgId.current = msgsRes.data.messages[msgsRes.data.messages.length - 1].id;
        const unread = msgsRes.data.messages
          .filter((m: any) => m.sender_id !== user?.id && !m.read_by?.includes(user?.id))
          .map((m: any) => m.id);
        if (unread.length > 0) messagesAPI.markRead(unread);
      }
      if (chatRes.data.chat?.is_group) {
        setGroupMembers(chatRes.data.chat.participants || []);
        await initGroupE2EESession(chatRes.data.chat);
      } else {
        await initE2EESession(chatRes.data.chat);
      }
    } catch (e) {
      console.log('Error loading chat', e);
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => { loadChat(); }, [loadChat]);

  const initE2EESession = async (chatData: any) => {
    try {
      const otherParticipant = chatData?.participants?.find((p: any) => p.id !== user?.id);
      if (!otherParticipant) return;
      
      const keyRes = await keysAPI.get(otherParticipant.id);
      const theirPublicKey = nacl.decodeBase64(keyRes.data.public_key);
      const ourKeyPair = await ensureKeyPair();
      
      await initializeSession(ourKeyPair, theirPublicKey, id!);
      e2eeSessionRef.current = true;
      setIsE2EESessionActive(true);
      
      const fingerprint = getCombinedFingerprint(ourKeyPair.publicKey, theirPublicKey);
      setE2eeFingerprint(fingerprint);
    } catch (e) {
      console.log('E2EE session init failed, falling back to plaintext', e);
      e2eeSessionRef.current = false;
      setIsE2EESessionActive(false);
    }
  };

  const initGroupE2EESession = async (chatData: any) => {
    try {
      const members = (chatData?.participants || [])
        .filter((p: any) => p.id !== user?.id);
      
      const memberKeys: { userId: string; publicKey: Uint8Array }[] = [];
      for (const member of members) {
        try {
          const keyRes = await keysAPI.get(member.id);
          memberKeys.push({
            userId: member.id,
            publicKey: nacl.decodeBase64(keyRes.data.public_key),
          });
        } catch (e) {
          console.log(`No public key for group member ${member.id}`);
        }
      }
      
      await initializeGroupSession(id!, memberKeys);
      e2eeSessionRef.current = true;
      setIsE2EESessionActive(true);
    } catch (e) {
      console.log('Group E2EE session init failed', e);
      e2eeSessionRef.current = false;
      setIsE2EESessionActive(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    const interval = setInterval(async () => {
      try {
        const res = await messagesAPI.poll(id, lastMsgId.current || undefined);
        if (res.data.messages?.length > 0) {
          const newMsgs = [];
          for (const msg of res.data.messages) {
            if (msg.e2ee && msg.content && msg.nonce) {
              if (chat?.is_group) {
                const result = await groupDecrypt(
                  msg.content, msg.nonce, id,
                  msg.sender_id,
                  msg.sender_key_id || '',
                  msg.sender_key_iteration || 0,
                  msg.media_ciphertext || null,
                  msg.media_nonce || null
                );
                newMsgs.push({
                  ...msg,
                  content: result.text || '[Entschlüsselung fehlgeschlagen]',
                  media_base64: result.mediaBase64 || msg.media_base64,
                  _decrypted: true,
                });
              } else {
                const result = await ratchetDecrypt(
                  msg.content, msg.nonce, id,
                  msg.dh_public || null,
                  msg.media_ciphertext || null,
                  msg.media_nonce || null
                );
                newMsgs.push({
                  ...msg,
                  content: result.text || '[Entschlüsselung fehlgeschlagen]',
                  media_base64: result.mediaBase64 || msg.media_base64,
                  _decrypted: true,
                });
              }
            } else {
              newMsgs.push(msg);
            }
          }
          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const filteredNew = newMsgs.filter((m: any) => !existingIds.has(m.id));
            if (filteredNew.length === 0) return prev;
            return [...prev, ...filteredNew];
          });
          const lastNew = res.data.messages[res.data.messages.length - 1];
          lastMsgId.current = lastNew.id;
          const unread = res.data.messages
            .filter((m: any) => m.sender_id !== user?.id)
            .map((m: any) => m.id);
          if (unread.length > 0) messagesAPI.markRead(unread);
        }
        const typRes = await typingAPI.get(id);
        setTypingUsers(typRes.data.typing || []);
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [id, user, chat?.is_group]);

  const handleSend = async () => {
    if (!text.trim() || !id) return;
    setSending(true);
    try {
      if (e2eeSessionRef.current) {
        if (chat?.is_group) {
          const encrypted = await groupEncrypt(text.trim(), id);
          if (encrypted) {
            const res = await encryptedMessagesAPI.send({
              chat_id: id,
              ciphertext: encrypted.ciphertext,
              nonce: encrypted.nonce,
              sender_key_id: encrypted.senderKeyId,
              sender_key_iteration: encrypted.iteration,
              security_level: securityLevel,
              self_destruct_seconds: selfDestruct,
              reply_to: replyTo?.id,
            });
            const msg = res.data.message;
            msg.content = text.trim();
            msg._e2ee_sent = true;
            setMessages(prev => [...prev, msg]);
            lastMsgId.current = msg.id;
          } else {
            throw new Error('Group encryption failed');
          }
        } else {
          const encrypted = await ratchetEncrypt(text.trim(), id);
          if (encrypted) {
            const res = await encryptedMessagesAPI.send({
              chat_id: id,
              ciphertext: encrypted.ciphertext,
              nonce: encrypted.nonce,
              dh_public: encrypted.dhPublic,
              msg_num: encrypted.msgNum,
              media_ciphertext: encrypted.mediaCiphertext,
              media_nonce: encrypted.mediaNonce,
              security_level: securityLevel,
              self_destruct_seconds: selfDestruct,
            });
            const msg = res.data.message;
            msg.content = text.trim();
            msg._e2ee_sent = true;
            setMessages(prev => [...prev, msg]);
            lastMsgId.current = msg.id;
          } else {
            throw new Error('Encryption failed');
          }
        }
      } else {
        const res = await messagesAPI.send({
          chat_id: id,
          content: text.trim(),
          security_level: securityLevel,
          self_destruct_seconds: selfDestruct,
        });
        setMessages(prev => [...prev, res.data.message]);
        lastMsgId.current = res.data.message.id;
      }
      setText('');
      setSelfDestruct(null);
      setReplyTo(null);
    } catch (e) {
      console.log('Error sending message', e);
    } finally {
      setSending(false);
    }
  };

  const handleVoiceSend = async (audioBase64: string, durationMs: number) => {
    if (!id) return;
    setSending(true);
    setIsRecordingVoice(false);
    try {
      if (e2eeSessionRef.current) {
        if (chat?.is_group) {
          const encrypted = await groupEncrypt(`🎤 Sprachnachricht (${Math.floor(durationMs / 1000)}s)`, id, 'voice', audioBase64);
          if (encrypted) {
            const res = await encryptedMessagesAPI.send({
              chat_id: id,
              ciphertext: encrypted.ciphertext,
              nonce: encrypted.nonce,
              sender_key_id: encrypted.senderKeyId,
              sender_key_iteration: encrypted.iteration,
              message_type: 'voice',
              media_ciphertext: encrypted.mediaCiphertext,
              media_nonce: encrypted.mediaNonce,
              security_level: securityLevel,
              self_destruct_seconds: selfDestruct,
            });
            const msg = res.data.message;
            msg.content = `🎤 Sprachnachricht (${Math.floor(durationMs / 1000)}s)`;
            msg.media_base64 = audioBase64;
            msg._e2ee_sent = true;
            setMessages(prev => [...prev, msg]);
            lastMsgId.current = msg.id;
          }
        } else {
          const encrypted = await ratchetEncrypt(`🎤 Sprachnachricht (${Math.floor(durationMs / 1000)}s)`, id, 'voice', audioBase64);
          if (encrypted) {
            const res = await encryptedMessagesAPI.send({
              chat_id: id,
              ciphertext: encrypted.ciphertext,
              nonce: encrypted.nonce,
              dh_public: encrypted.dhPublic,
              msg_num: encrypted.msgNum,
              message_type: 'voice',
              media_ciphertext: encrypted.mediaCiphertext,
              media_nonce: encrypted.mediaNonce,
              security_level: securityLevel,
              self_destruct_seconds: selfDestruct,
            });
            const msg = res.data.message;
            msg.content = `🎤 Sprachnachricht (${Math.floor(durationMs / 1000)}s)`;
            msg.media_base64 = audioBase64;
            msg._e2ee_sent = true;
            setMessages(prev => [...prev, msg]);
            lastMsgId.current = msg.id;
          }
        }
      } else {
        const res = await messagesAPI.send({
          chat_id: id,
          content: `🎤 Sprachnachricht (${Math.floor(durationMs / 1000)}s)`,
          message_type: 'voice',
          media_base64: audioBase64,
          security_level: securityLevel,
          self_destruct_seconds: selfDestruct,
        });
        setMessages(prev => [...prev, res.data.message]);
        lastMsgId.current = res.data.message.id;
      }
    } catch (e) {
      console.log('Error sending voice message', e);
    } finally {
      setSending(false);
    }
  };

  const pickImage = async () => {
    setShowMediaMenu(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setPendingMedia({
        uri: result.assets[0].uri,
        base64: result.assets[0].base64 || '',
        type: 'image',
      });
    }
  };

  const pickVideo = async () => {
    setShowMediaMenu(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setPendingMedia({
        uri: result.assets[0].uri,
        base64: result.assets[0].base64 || '',
        type: 'video',
      });
    }
  };

  const pickFile = async () => {
    setShowMediaMenu(false);
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets[0]) {
      const file = result.assets[0];
      const response = await fetch(file.uri);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        setPendingMedia({
          uri: file.uri,
          base64,
          type: 'file',
          fileName: file.name,
        });
      };
    }
  };

  const sendPendingMedia = async () => {
    if (!pendingMedia || !id) return;
    setSending(true);
    try {
      const mediaLabel = pendingMedia.type === 'image' ? '📷 Foto' :
                         pendingMedia.type === 'video' ? '🎥 Video' :
                         `📎 ${pendingMedia.fileName || 'Datei'}`;

      if (e2eeSessionRef.current) {
        if (chat?.is_group) {
          const encrypted = await groupEncrypt(mediaLabel, id, pendingMedia.type, pendingMedia.base64);
          if (encrypted) {
            const res = await encryptedMessagesAPI.send({
              chat_id: id,
              ciphertext: encrypted.ciphertext,
              nonce: encrypted.nonce,
              sender_key_id: encrypted.senderKeyId,
              sender_key_iteration: encrypted.iteration,
              message_type: pendingMedia.type,
              media_ciphertext: encrypted.mediaCiphertext,
              media_nonce: encrypted.mediaNonce,
              security_level: securityLevel,
              self_destruct_seconds: selfDestruct,
            });
            const msg = res.data.message;
            msg.content = mediaLabel;
            msg.media_base64 = pendingMedia.base64;
            msg._e2ee_sent = true;
            setMessages(prev => [...prev, msg]);
            lastMsgId.current = msg.id;
          }
        } else {
          const encrypted = await ratchetEncrypt(mediaLabel, id, pendingMedia.type, pendingMedia.base64);
          if (encrypted) {
            const res = await encryptedMessagesAPI.send({
              chat_id: id,
              ciphertext: encrypted.ciphertext,
              nonce: encrypted.nonce,
              dh_public: encrypted.dhPublic,
              msg_num: encrypted.msgNum,
              message_type: pendingMedia.type,
              media_ciphertext: encrypted.mediaCiphertext,
              media_nonce: encrypted.mediaNonce,
              security_level: securityLevel,
              self_destruct_seconds: selfDestruct,
            });
            const msg = res.data.message;
            msg.content = mediaLabel;
            msg.media_base64 = pendingMedia.base64;
            msg._e2ee_sent = true;
            setMessages(prev => [...prev, msg]);
            lastMsgId.current = msg.id;
          }
        }
      } else {
        const res = await messagesAPI.send({
          chat_id: id,
          content: mediaLabel,
          message_type: pendingMedia.type,
          media_base64: pendingMedia.base64,
          security_level: securityLevel,
          self_destruct_seconds: selfDestruct,
        });
        setMessages(prev => [...prev, res.data.message]);
        lastMsgId.current = res.data.message.id;
      }
      setPendingMedia(null);
    } catch (e) {
      console.log('Error sending media', e);
    } finally {
      setSending(false);
    }
  };

  const cancelPendingMedia = () => {
    setPendingMedia(null);
  };

  const handleTyping = () => {
    if (!id) return;
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingAPI.set(id).catch(() => {});
    typingTimer.current = setTimeout(() => {}, 3000);
  };

  const getOtherParticipant = () => {
    if (!chat?.participants) return null;
    return chat.participants.find((p: any) => p.id !== user?.id) || chat.participants[0];
  };

  const getChatTitle = () => {
    if (chat?.is_group) return chat.name || 'Gruppe';
    return getOtherParticipant()?.name || 'Chat';
  };

  const getChatSubtitle = () => {
    if (chat?.is_group) return `${chat.participants?.length || 0} Teilnehmer`;
    const other = getOtherParticipant();
    return other?.status === 'online' ? 'Online' : 'Offline';
  };

  const getSecColor = (level: string) => {
    const found = SECURITY_LEVELS.find(s => s.key === level);
    return found?.color || COLORS.unclassified;
  };

  const getStatusIcon = (msg: any) => {
    if (msg.sender_id !== user?.id) return null;
    const participantCount = (chat?.participants?.length || 2) - 1;
    const readCount = (msg.read_by?.length || 0) - 1;
    const deliveredCount = (msg.delivered_to?.length || 0);
    if (readCount >= participantCount) return { name: 'checkmark-done', color: COLORS.primaryLight };
    if (deliveredCount >= participantCount) return { name: 'checkmark-done', color: COLORS.textMuted };
    return { name: 'checkmark', color: COLORS.textMuted };
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  };

  const getSenderName = (msg: any) => {
    if (!chat?.is_group || msg.sender_id === user?.id) return '';
    const sender = chat.participants?.find((p: any) => p.id === msg.sender_id);
    return sender?.name || msg.sender_name || 'Unbekannt';
  };

  const getSenderColor = (senderId: string) => {
    const colors = [COLORS.primary, '#4A90D9', '#7B68EE', '#20B2AA', '#FF6B6B', '#FFD93D', '#6BCB77'];
    let hash = 0;
    for (let i = 0; i < senderId.length; i++) hash = senderId.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const getInitial = (name: string) => name?.charAt(0).toUpperCase() || '?';

  const getAvatarColor = (id: string) => {
    const colors = [COLORS.primary, '#4A90D9', '#7B68EE', '#20B2AA', '#FF6B6B', '#FFD93D', '#6BCB77'];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const loadContacts = async () => {
    try {
      const res = await contactsAPI.list();
      setContacts(res.data.contacts || []);
    } catch (e) { console.log(e); }
  };

  const addMember = async (contactId: string) => {
    Alert.alert(
      'Teilnehmer hinzufügen',
      'Möchtest du diesen Kontakt zur Gruppe hinzufügen?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Hinzufügen',
          onPress: async () => {
            try {
              await chatsAPI.create({
                participant_ids: [contactId],
                is_group: false,
              });
              Alert.alert('Erfolg', 'Kontakt wurde eingeladen');
              setShowGroupInfo(false);
            } catch (e: any) {
              Alert.alert('Fehler', e?.response?.data?.detail || 'Konnte nicht hinzufügen');
            }
          },
        },
      ]
    );
  };

  const renderMessage = ({ item, index }: { item: any; index: number }) => {
    const isMine = item.sender_id === user?.id;
    const statusIcon = getStatusIcon(item);
    const isEmergency = item.is_emergency;
    const showSenderName = chat?.is_group && !isMine;
    const senderName = getSenderName(item);
    const senderColor = getSenderColor(item.sender_id);
    const hasMedia = item.media_base64 || (item.e2ee && item.media_ciphertext);

    const showDate = index === 0 || (
      new Date(item.created_at).toDateString() !== new Date(messages[index - 1]?.created_at).toDateString()
    );

    const showNameSeparator = chat?.is_group && !isMine && index > 0 &&
      messages[index - 1]?.sender_id !== item.sender_id &&
      new Date(item.created_at).toDateString() === new Date(messages[index - 1]?.created_at).toDateString();

    const getMediaIcon = (msg: any) => {
      if (msg.message_type === 'image') return 'image';
      if (msg.message_type === 'voice') return 'mic';
      if (msg.message_type === 'file') return 'document';
      return 'attach';
    };

    const getMediaLabel = (msg: any) => {
      if (msg.message_type === 'image') return 'Verschlüsseltes Bild';
      if (msg.message_type === 'voice') return 'Sprachnachricht';
      if (msg.message_type === 'file') return 'Verschlüsselte Datei';
      return 'Verschlüsseltes Medium';
    };

    const isVoiceMessage = item.message_type === 'voice';

    return (
      <View>
        {showDate && (
          <View style={styles.dateSeparator}>
            <View style={styles.dateLine} />
            <Text style={styles.dateText}>
              {new Date(item.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}
            </Text>
            <View style={styles.dateLine} />
          </View>
        )}
        {showNameSeparator && (
          <View style={styles.nameSeparator}>
            <Text style={[styles.nameSeparatorText, { color: senderColor }]}>{senderName}</Text>
          </View>
        )}
        <TouchableOpacity
          style={[styles.msgRow, isMine ? styles.msgRowRight : styles.msgRowLeft]}
          activeOpacity={0.7}
          onLongPress={() => setMessageActions({ msg: item, x: 0, y: 0 })}
          delayLongPress={300}
        >
          {!isMine && chat?.is_group && (
            <View style={[styles.msgAvatar, { backgroundColor: `${senderColor}33` }]}>
              <Text style={[styles.msgAvatarText, { color: senderColor }]}>{getInitial(senderName)}</Text>
            </View>
          )}
          <View style={[
            styles.msgBubble,
            isMine ? styles.sentBubble : styles.receivedBubble,
            isEmergency && styles.emergencyBubble,
          ]}>
            {isEmergency && (
              <View style={styles.emergencyBanner}>
                <Ionicons name="alert-circle" size={12} color={COLORS.danger} />
                <Text style={styles.emergencyText}>NOTFALL</Text>
              </View>
            )}
            {showSenderName && !showNameSeparator && (
              <Text style={[styles.senderName, { color: senderColor }]}>{senderName}</Text>
            )}
            {item.security_level !== 'UNCLASSIFIED' && (
              <View style={[styles.msgSecBadge, { borderColor: getSecColor(item.security_level) }]}>
                <Text style={[styles.msgSecText, { color: getSecColor(item.security_level) }]}>{item.security_level}</Text>
              </View>
            )}
            {item.reply_to && (
              <View style={styles.replyPreview}>
                <View style={styles.replyPreviewIndicator} />
                <Text style={styles.replyPreviewText} numberOfLines={1}>Antwort auf {item.reply_to_sender_name || 'Nachricht'}</Text>
              </View>
            )}
            {isVoiceMessage && item.media_base64 ? (
              <VoiceMessagePlayer
                audioBase64={item.media_base64}
                durationMs={parseInt(item.content?.match(/\((\d+)s\)/)?.[1] || '0') * 1000 || 0}
                isMine={isMine}
              />
            ) : hasMedia ? (
              <View style={styles.mediaContainer}>
                {item.message_type === 'image' && item.media_base64 ? (
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${item.media_base64}` }}
                    style={styles.msgImage}
                    resizeMode="contain"
                  />
                ) : (
                  <>
                    <Ionicons name={getMediaIcon(item)} size={24} color={COLORS.primaryLight} />
                    <Text style={styles.mediaLabel}>{getMediaLabel(item)}</Text>
                  </>
                )}
              </View>
            ) : null}
            {!isVoiceMessage && <Text style={styles.msgContent}>{item.content}</Text>}
            <View style={styles.msgFooter}>
              {item.e2ee && <Ionicons name="lock-closed" size={9} color="#4CAF50" />}
              {item.encrypted && !item.e2ee && <Ionicons name="lock-closed" size={9} color={COLORS.textMuted} />}
              {item.self_destruct_seconds && (
                <View style={styles.destructBadge}>
                  <Ionicons name="timer" size={9} color={COLORS.restricted} />
                  <Text style={styles.destructText}>{item.self_destruct_seconds}s</Text>
                </View>
              )}
              <Text style={styles.msgTime}>{formatTime(item.created_at)}</Text>
              {item.edited && <Text style={styles.msgEdited}>(bearbeitet)</Text>}
              {statusIcon && <Ionicons name={statusIcon.name as any} size={14} color={statusIcon.color} />}
            </View>
          </View>
          {item.reactions && Object.keys(item.reactions).length > 0 && (
            <View style={[styles.msgReactions, isMine ? styles.msgReactionsRight : styles.msgReactionsLeft]}>
              {Object.entries(item.reactions).map(([emoji, users]: [string, any]) => (
                <View key={emoji} style={styles.msgReaction}>
                  <Text style={styles.msgReactionEmoji}>{emoji}</Text>
                  <Text style={styles.msgReactionCount}>{users.length}</Text>
                </View>
              ))}
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={COLORS.primaryLight} /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity testID="chat-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerInfo} onPress={() => { if (chat?.is_group) { setShowGroupInfo(true); loadContacts(); } else if (isE2EESessionActive) { setShowFingerprint(!showFingerprint); } }}>
          <View style={styles.headerTitleRow}>
            <View style={[styles.headerAvatar, { backgroundColor: chat?.is_group ? `${getAvatarColor(id || '')}33` : COLORS.surfaceLight }]}>
              <Ionicons name={chat?.is_group ? 'people' : 'person'} size={16} color={chat?.is_group ? getAvatarColor(id || '') : COLORS.textSecondary} />
            </View>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>{getChatTitle()}</Text>
              <Text style={styles.headerSubtitle}>{getChatSubtitle()}</Text>
            </View>
          </View>
        </TouchableOpacity>
        {isE2EESessionActive && (
          <View style={[styles.secIndicator, { backgroundColor: '#1B5E20', borderColor: '#4CAF50' }]}>
            <Ionicons name="lock-closed" size={12} color="#4CAF50" />
          </View>
        )}
        {!isE2EESessionActive && (
          <View style={[styles.secIndicator, { backgroundColor: `${COLORS.warning}22`, borderColor: COLORS.warning }]}>
            <Ionicons name="lock-open" size={12} color={COLORS.warning} />
          </View>
        )}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex} keyboardVerticalOffset={0}>
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyMessages}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name={isE2EESessionActive ? 'lock-closed' : 'lock-open'} size={32} color={isE2EESessionActive ? '#4CAF50' : COLORS.primaryLight} />
              </View>
              <Text style={styles.emptyText}>
                {isE2EESessionActive ? 'Verschlüsselter Kanal bereit' : 'Kanal bereit'}
              </Text>
              <Text style={styles.emptySubtext}>
                {isE2EESessionActive
                  ? 'Nachrichten sind Ende-zu-Ende verschlüsselt (Double Ratchet)'
                  : 'Tippe auf das Schloss oben rechts für E2EE-Info'}
              </Text>
            </View>
          }
        />

        {/* Typing indicator */}
        {typingUsers.length > 0 && (
          <View style={styles.typingBar}>
            <View style={styles.typingDots}>
              <View style={[styles.typingDot, styles.typingDot1]} />
              <View style={[styles.typingDot, styles.typingDot2]} />
              <View style={[styles.typingDot, styles.typingDot3]} />
            </View>
            <Text style={styles.typingText}>{typingUsers.map(t => t.name).join(', ')} tippt...</Text>
          </View>
        )}

        {/* Security level selector */}
        {showSecMenu && (
          <View style={styles.secMenu}>
            {SECURITY_LEVELS.map(level => (
              <TouchableOpacity
                key={level.key}
                testID={`sec-level-${level.key}`}
                style={[styles.secMenuItem, securityLevel === level.key && { backgroundColor: `${level.color}22` }]}
                onPress={() => { setSecurityLevel(level.key); setShowSecMenu(false); }}
              >
                <View style={[styles.secDot, { backgroundColor: level.color }]} />
                <Text style={[styles.secMenuText, { color: level.color }]}>{level.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              testID="self-destruct-toggle"
              style={[styles.secMenuItem, selfDestruct && { backgroundColor: `${COLORS.restricted}22` }]}
              onPress={() => setSelfDestruct(selfDestruct ? null : 30)}
            >
              <Ionicons name="timer" size={14} color={COLORS.restricted} />
              <Text style={[styles.secMenuText, { color: COLORS.restricted }]}>
                {selfDestruct ? `Selbstzerstörung: ${selfDestruct}s` : 'Selbstzerstörung'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Pending media preview */}
        {pendingMedia && (
          <View style={styles.mediaPreviewBar}>
            {pendingMedia.type === 'image' ? (
              <Image source={{ uri: pendingMedia.uri }} style={styles.mediaPreviewImage} />
            ) : pendingMedia.type === 'video' ? (
              <View style={styles.mediaPreviewFile}>
                <Ionicons name="videocam" size={24} color={COLORS.primaryLight} />
                <Text style={styles.mediaPreviewFileName}>Video</Text>
              </View>
            ) : (
              <View style={styles.mediaPreviewFile}>
                <Ionicons name="document" size={24} color={COLORS.primaryLight} />
                <Text style={styles.mediaPreviewFileName}>{pendingMedia.fileName || 'Datei'}</Text>
              </View>
            )}
            <View style={styles.mediaPreviewActions}>
              <TouchableOpacity style={styles.mediaPreviewCancel} onPress={cancelPendingMedia}>
                <Ionicons name="close" size={20} color={COLORS.danger} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.mediaPreviewSend} onPress={sendPendingMedia} disabled={sending}>
                {sending ? <ActivityIndicator size="small" color={COLORS.white} /> : <Ionicons name="send" size={18} color={COLORS.white} />}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Media picker menu */}
        {showMediaMenu && (
          <View style={styles.mediaMenu}>
            <TouchableOpacity style={styles.mediaMenuItem} onPress={pickImage}>
              <Ionicons name="image" size={24} color={COLORS.primaryLight} />
              <Text style={styles.mediaMenuText}>Foto</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.mediaMenuItem} onPress={pickVideo}>
              <Ionicons name="videocam" size={24} color={COLORS.primaryLight} />
              <Text style={styles.mediaMenuText}>Video</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.mediaMenuItem} onPress={pickFile}>
              <Ionicons name="document" size={24} color={COLORS.primaryLight} />
              <Text style={styles.mediaMenuText}>Datei</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.mediaMenuItem} onPress={() => setShowMediaMenu(false)}>
              <Ionicons name="close" size={24} color={COLORS.textMuted} />
              <Text style={styles.mediaMenuText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Reply bar */}
        {replyTo && (
          <View style={styles.replyBar}>
            <View style={styles.replyIndicator} />
            <View style={styles.replyContent}>
              <Text style={styles.replyAuthor}>{replyTo.sender_id === user?.id ? 'Du' : (replyTo.sender_name || 'Unbekannt')}</Text>
              <Text style={styles.replyText} numberOfLines={1}>{replyTo.content}</Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)}>
              <Ionicons name="close" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Message context menu */}
        {messageActions && (
          <TouchableOpacity style={styles.msgContextMenu} activeOpacity={1} onPress={() => setMessageActions(null)}>
            <View style={styles.msgContextMenuContent}>
              <TouchableOpacity style={styles.msgContextMenuItem} onPress={() => { setReplyTo(messageActions.msg); setMessageActions(null); }}>
                <Ionicons name="return-up-back" size={18} color={COLORS.primaryLight} />
                <Text style={styles.msgContextMenuItemText}>Antworten</Text>
              </TouchableOpacity>
              {messageActions.msg.sender_id === user?.id && (
                <>
                  <TouchableOpacity style={styles.msgContextMenuItem} onPress={() => { setMessageActions(null); }}>
                    <Ionicons name="create" size={18} color={COLORS.primaryLight} />
                    <Text style={styles.msgContextMenuItemText}>Bearbeiten</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.msgContextMenuItem} onPress={async () => {
                    try {
                      await api.delete(`/messages/${messageActions.msg.id}`);
                      setMessages(prev => prev.filter(m => m.id !== messageActions.msg.id));
                    } catch (e) { console.log(e); }
                    setMessageActions(null);
                  }}>
                    <Ionicons name="trash" size={18} color={COLORS.danger} />
                    <Text style={[styles.msgContextMenuItemText, { color: COLORS.danger }]}>Löschen</Text>
                  </TouchableOpacity>
                </>
              )}
              <View style={styles.msgContextReactions}>
                {['👍', '❤️', '😂', '😮', '😢', '🔥'].map(emoji => (
                  <TouchableOpacity key={emoji} style={styles.msgContextReactionBtn} onPress={async () => {
                    try {
                      await api.post(`/messages/${messageActions.msg.id}/react`, { emoji });
                      setMessages(prev => prev.map(m => m.id === messageActions.msg.id ? { ...m, reactions: { ...(m.reactions || {}), [emoji]: [...(m.reactions?.[emoji] || []), user?.id] } } : m));
                    } catch (e) { console.log(e); }
                    setMessageActions(null);
                  }}>
                    <Text style={styles.msgContextReactionEmoji}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* Input */}
        {isRecordingVoice ? (
          <VoiceRecorder
            onSend={handleVoiceSend}
            onCancel={() => setIsRecordingVoice(false)}
          />
        ) : (
          <View style={styles.inputBar}>
            <TouchableOpacity testID="security-menu-btn" onPress={() => setShowSecMenu(!showSecMenu)} style={styles.secBtn}>
              <Ionicons name="shield" size={20} color={getSecColor(securityLevel)} />
            </TouchableOpacity>
            <TouchableOpacity testID="attach-media-btn" onPress={() => setShowMediaMenu(!showMediaMenu)} style={styles.attachBtn}>
              <Ionicons name="add" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
            <View style={styles.inputContainer}>
              <TextInput
                testID="message-input"
                style={styles.input}
                value={text}
                onChangeText={(t) => { setText(t); handleTyping(); }}
                placeholder="Nachricht schreiben..."
                placeholderTextColor={COLORS.textMuted}
                multiline
                maxLength={4000}
              />
            </View>
            {text.trim() ? (
              <TouchableOpacity
                testID="send-message-btn"
                style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={sending}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Ionicons name="send" size={18} color={COLORS.white} />
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                testID="voice-record-btn"
                style={styles.micBtn}
                onPress={() => setIsRecordingVoice(true)}
              >
                <Ionicons name="mic" size={20} color={COLORS.white} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Group Info Modal */}
      <Modal visible={showGroupInfo} animationType="slide" transparent>
        <SafeAreaView style={styles.modalOverlay} edges={['top', 'bottom']}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Gruppeninfo</Text>
              <TouchableOpacity onPress={() => setShowGroupInfo(false)}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalGroupInfo}>
              <View style={[styles.modalAvatar, { backgroundColor: `${getAvatarColor(id || '')}33` }]}>
                <Ionicons name="people" size={32} color={getAvatarColor(id || '')} />
              </View>
              <Text style={styles.modalGroupName}>{chat?.name || 'Gruppe'}</Text>
              <Text style={styles.modalGroupCount}>{groupMembers.length} Teilnehmer</Text>
            </View>

            <Text style={styles.modalSectionTitle}>TEILNEHMER</Text>
            <ScrollView style={styles.modalMembersList}>
              {groupMembers.map((member: any) => (
                <View key={member.id} style={styles.modalMember}>
                  <View style={[styles.modalMemberAvatar, { backgroundColor: `${getAvatarColor(member.id)}33` }]}>
                    <Text style={[styles.modalMemberAvatarText, { color: getAvatarColor(member.id) }]}>{getInitial(member.name)}</Text>
                  </View>
                  <View style={styles.modalMemberInfo}>
                    <Text style={styles.modalMemberName}>{member.name}</Text>
                    <Text style={styles.modalMemberCallsign}>{member.callsign}</Text>
                  </View>
                  {member.id === user?.id && (
                    <Text style={styles.modalMemberBadge}>Du</Text>
                  )}
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.modalAddMember}
              onPress={() => {
                if (contacts.length === 0) loadContacts();
              }}
            >
              <Ionicons name="add-circle-outline" size={20} color={COLORS.primaryLight} />
              <Text style={styles.modalAddMemberText}>Teilnehmer einladen</Text>
            </TouchableOpacity>

            {contacts.length > 0 && (
              <ScrollView style={styles.modalContactsList}>
                <Text style={styles.modalSectionTitle}>KONTAKTE ZUM EINLADEN</Text>
                {contacts
                  .filter((c: any) => !groupMembers.find((m: any) => m.id === c.id))
                  .map((contact: any) => (
                    <TouchableOpacity
                      key={contact.id}
                      style={styles.modalContactItem}
                      onPress={() => addMember(contact.id)}
                    >
                      <View style={[styles.modalContactAvatar, { backgroundColor: `${getAvatarColor(contact.id)}33` }]}>
                        <Text style={[styles.modalContactAvatarText, { color: getAvatarColor(contact.id) }]}>{getInitial(contact.name)}</Text>
                      </View>
                      <View style={styles.modalContactInfo}>
                        <Text style={styles.modalContactName}>{contact.name}</Text>
                        <Text style={styles.modalContactCallsign}>{contact.callsign}</Text>
                      </View>
                      <Ionicons name="add" size={20} color={COLORS.primaryLight} />
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            )}
          </View>
        </SafeAreaView>
      </Modal>

      {/* E2EE Fingerprint Modal */}
      <Modal visible={showFingerprint} animationType="slide" transparent>
        <SafeAreaView style={styles.modalOverlay} edges={['top', 'bottom']}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Verschlüsselung</Text>
              <TouchableOpacity onPress={() => setShowFingerprint(false)}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.e2eeInfo}>
              <View style={styles.e2eeLockIcon}>
                <Ionicons name="lock-closed" size={48} color="#4CAF50" />
              </View>
              <Text style={styles.e2eeTitle}>Ende-zu-Ende verschlüsselt</Text>
              <Text style={styles.e2eeDesc}>
                Nachrichten in diesem Chat sind mit dem Double Ratchet Protocol verschlüsselt.
                Niemand außerhalb dieses Chats kann sie lesen.
              </Text>
            </View>

            {e2eeFingerprint && (
              <View style={styles.fingerprintSection}>
                <Text style={styles.fingerprintLabel}>SAFETY NUMBER</Text>
                <Text style={styles.fingerprintValue}>{e2eeFingerprint}</Text>
                <Text style={styles.fingerprintHint}>
                  Vergleiche diesen Code mit {getOtherParticipant()?.name || 'deinem Kontakt'} um Man-in-the-Middle-Angriffe zu erkennen.
                </Text>
              </View>
            )}

            <View style={styles.e2eeAlgo}>
              <Text style={styles.e2eeAlgoLabel}>ALGORITHMEN</Text>
              <View style={styles.algoItem}>
                <Ionicons name="key" size={14} color={COLORS.primaryLight} />
                <Text style={styles.algoText}>X25519 (Key Exchange)</Text>
              </View>
              <View style={styles.algoItem}>
                <Ionicons name="lock-closed" size={14} color={COLORS.primaryLight} />
                <Text style={styles.algoText}>XSalsa20-Poly1305 (Encryption)</Text>
              </View>
              <View style={styles.algoItem}>
                <Ionicons name="refresh" size={14} color={COLORS.primaryLight} />
                <Text style={styles.algoText}>Double Ratchet (Forward Secrecy)</Text>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  
  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10,
    backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { padding: 8 },
  headerInfo: { flex: 1, marginLeft: 4 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTextContainer: { flex: 1 },
  headerTitle: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  headerSubtitle: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 1 },
  secIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, marginRight: 8 },
  secIndicatorText: { fontSize: 10, fontWeight: FONTS.weights.bold, letterSpacing: 1 },

  // Messages
  messagesList: { padding: 12, paddingBottom: 4 },
  msgRow: { flexDirection: 'row', marginBottom: 4, maxWidth: '85%', alignItems: 'flex-end' },
  msgRowRight: { alignSelf: 'flex-end' },
  msgRowLeft: { alignSelf: 'flex-start' },
  msgAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 6, marginBottom: 4 },
  msgAvatarText: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold },
  msgBubble: { borderRadius: 18, padding: 10, paddingBottom: 6, minWidth: 60 },
  sentBubble: { backgroundColor: COLORS.sentBubble, borderBottomRightRadius: 4 },
  receivedBubble: { backgroundColor: COLORS.receivedBubble, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: COLORS.border },
  emergencyBubble: { backgroundColor: COLORS.emergency, borderColor: COLORS.danger, borderWidth: 1 },
  emergencyBanner: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  emergencyText: { fontSize: 10, fontWeight: FONTS.weights.bold, color: COLORS.danger, letterSpacing: 1 },
  senderName: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, marginBottom: 2 },
  msgSecBadge: { alignSelf: 'flex-start', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, borderWidth: 1, marginBottom: 4 },
  msgSecText: { fontSize: 8, fontWeight: FONTS.weights.bold, letterSpacing: 0.5 },
  msgContent: { fontSize: FONTS.sizes.md, color: COLORS.textPrimary, lineHeight: 20 },
  msgFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
  msgTime: { fontSize: 10, color: COLORS.textMuted },
  destructBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  destructText: { fontSize: 9, color: COLORS.restricted },

  // Date separator
  dateSeparator: { flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 8 },
  dateLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dateText: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, paddingHorizontal: 12 },
  nameSeparator: { marginLeft: 40, marginBottom: 4 },
  nameSeparatorText: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold },

  // Empty
  emptyMessages: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyIconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.primary },
  emptyText: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginTop: 12 },
  emptySubtext: { fontSize: FONTS.sizes.sm, color: COLORS.textMuted, marginTop: 4 },

  // Typing
  typingBar: { paddingHorizontal: 16, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  typingDots: { flexDirection: 'row', gap: 3 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.textMuted },
  typingDot1: { opacity: 0.4 },
  typingDot2: { opacity: 0.7 },
  typingDot3: { opacity: 1 },
  typingText: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, fontStyle: 'italic' },

  // Security menu
  secMenu: {
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
    paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6,
  },
  secMenuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
  },
  secDot: { width: 8, height: 8, borderRadius: 4 },
  secMenuText: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, letterSpacing: 0.5 },

  // Input
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 8, paddingVertical: 8,
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  secBtn: { padding: 10 },
  inputContainer: {
    flex: 1, backgroundColor: COLORS.surfaceLight, borderRadius: 20,
    borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 16,
    maxHeight: 100, minHeight: 40, justifyContent: 'center',
  },
  input: { color: COLORS.textPrimary, fontSize: FONTS.sizes.md, paddingVertical: 8 },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginLeft: 6,
  },
  sendBtnDisabled: { opacity: 0.4 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: COLORS.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', paddingBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  modalTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  modalGroupInfo: { alignItems: 'center', padding: 24 },
  modalAvatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  modalGroupName: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  modalGroupCount: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 4 },
  modalSectionTitle: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.textMuted, letterSpacing: 2, paddingHorizontal: 16, paddingVertical: 12 },
  modalMembersList: { maxHeight: 200 },
  modalMember: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  modalMemberAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  modalMemberAvatarText: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.bold },
  modalMemberInfo: { flex: 1 },
  modalMemberName: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  modalMemberCallsign: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },
  modalMemberBadge: { fontSize: FONTS.sizes.xs, color: COLORS.primaryLight, fontWeight: FONTS.weights.medium },
  modalAddMember: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: COLORS.border },
  modalAddMemberText: { fontSize: FONTS.sizes.base, color: COLORS.primaryLight, fontWeight: FONTS.weights.semibold },
  modalContactsList: { maxHeight: 200 },
  modalContactItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  modalContactAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  modalContactAvatarText: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.bold },
  modalContactInfo: { flex: 1 },
  modalContactName: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  modalContactCallsign: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },

  // E2EE Fingerprint
  e2eeInfo: { alignItems: 'center', padding: 24 },
  e2eeLockIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#1B5E20', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  e2eeTitle: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: '#4CAF50', marginBottom: 8 },
  e2eeDesc: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
  fingerprintSection: { paddingHorizontal: 24, paddingVertical: 16, borderTopWidth: 1, borderTopColor: COLORS.border },
  fingerprintLabel: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.textMuted, letterSpacing: 2, marginBottom: 8 },
  fingerprintValue: { fontSize: FONTS.sizes.sm, color: COLORS.primaryLight, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', backgroundColor: COLORS.surface, padding: 12, borderRadius: 8, textAlign: 'center', letterSpacing: 1 },
  fingerprintHint: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: 12, textAlign: 'center', lineHeight: 18 },
  e2eeAlgo: { paddingHorizontal: 24, paddingVertical: 16, borderTopWidth: 1, borderTopColor: COLORS.border },
  e2eeAlgoLabel: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.textMuted, letterSpacing: 2, marginBottom: 12 },
  algoItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  algoText: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary },

  // Media
  msgImage: { width: 200, height: 200, borderRadius: 12, marginBottom: 4 },
  mediaContainer: { alignItems: 'center', justifyContent: 'center', padding: 8, marginBottom: 6, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  mediaLabel: { fontSize: FONTS.sizes.xs, color: COLORS.primaryLight, marginTop: 6, fontWeight: FONTS.weights.medium },
  mediaPreview: { marginTop: 8, padding: 8, backgroundColor: COLORS.surfaceLight, borderRadius: 8 },
  mediaPreviewText: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted },

  // Voice
  micBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginLeft: 6,
  },
  attachBtn: { padding: 10 },

  // Media picker
  mediaMenu: {
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
    flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12,
  },
  mediaMenuItem: { alignItems: 'center', gap: 4, padding: 8 },
  mediaMenuText: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },

  // Pending media preview
  mediaPreviewBar: {
    flexDirection: 'row', alignItems: 'center', padding: 8, gap: 8,
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  mediaPreviewImage: { width: 60, height: 60, borderRadius: 8, backgroundColor: COLORS.surfaceLight },
  mediaPreviewFile: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: COLORS.surfaceLight, borderRadius: 8 },
  mediaPreviewFileName: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary },
  mediaPreviewActions: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
  mediaPreviewCancel: { padding: 8 },
  mediaPreviewSend: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },

  // Reply bar
  replyBar: {
    flexDirection: 'row', alignItems: 'center', padding: 8, gap: 8,
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  replyIndicator: { width: 3, height: 32, backgroundColor: COLORS.primary, borderRadius: 2 },
  replyContent: { flex: 1 },
  replyAuthor: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.primaryLight },
  replyText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },

  // Message context menu
  msgContextMenu: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 100,
  },
  msgContextMenuContent: {
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 8, minWidth: 200,
    borderWidth: 1, borderColor: COLORS.border,
  },
  msgContextMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  msgContextMenuItemText: { fontSize: FONTS.sizes.base, color: COLORS.textPrimary },
  msgContextReactions: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 4 },
  msgContextReactionBtn: { padding: 8 },
  msgContextReactionEmoji: { fontSize: 20 },

  // Reply preview in message
  replyPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4,
    paddingLeft: 4, borderLeftWidth: 2, borderLeftColor: COLORS.primary,
  },
  replyPreviewIndicator: { width: 2, height: 16, backgroundColor: COLORS.primary, borderRadius: 1 },
  replyPreviewText: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, flex: 1 },

  // Message reactions
  msgReactions: { flexDirection: 'row', gap: 4, marginTop: 2, position: 'absolute', bottom: -12 },
  msgReactionsLeft: { left: 0 },
  msgReactionsRight: { right: 0 },
  msgReaction: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: COLORS.border },
  msgReactionEmoji: { fontSize: 12 },
  msgReactionCount: { fontSize: 10, color: COLORS.textMuted, marginLeft: 2 },
  msgEdited: { fontSize: 9, color: COLORS.textMuted, fontStyle: 'italic' },
});
