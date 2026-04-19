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
import * as Location from 'expo-location';
import { useAuth } from '../../src/context/AuthContext';
import { useChat } from '../../src/context/ChatContext';
import api, { messagesAPI, chatsAPI, typingAPI, contactsAPI, keysAPI, encryptedMessagesAPI, getSocket, emitTyping, emitStopTyping } from '../../src/utils/api';
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
  const { typingUsers: wsTypingUsers } = useChat();
  const router = useRouter();
  const [chat, setChat] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [securityLevel, setSecurityLevel] = useState('UNCLASSIFIED');
  const [showSecMenu, setShowSecMenu] = useState(false);
  const [selfDestruct, setSelfDestruct] = useState<number | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [contacts, setContacts] = useState<any[]>([]);
  const [isE2EESessionActive, setIsE2EESessionActive] = useState(false);
  const [e2eeFingerprint, setE2eeFingerprint] = useState<string | null>(null);
  const [showFingerprint, setShowFingerprint] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ uri: string; base64: string; type: string; fileName?: string } | null>(null);
  const [replyTo, setReplyTo] = useState<any>(null);
  const [messageActions, setMessageActions] = useState<{ msg: any; x: number; y: number } | null>(null);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardTargetChats, setForwardTargetChats] = useState<any[]>([]);
  const [forwardingMsg, setForwardingMsg] = useState<string | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<any>(null);
  const [showStarredModal, setShowStarredModal] = useState(false);
  const [starredMessages, setStarredMessages] = useState<any[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [contactVerified, setContactVerified] = useState(false);
  const [sendingLocation, setSendingLocation] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const typingTimer = useRef<any>(null);
  const lastMsgId = useRef<string | null>(null);
  const e2eeSessionRef = useRef<boolean>(false);
  const processedMsgIds = useRef<Set<string>>(new Set());

  const loadChat = useCallback(async () => {
    if (!id) return;
    try {
      const [chatRes, msgsRes] = await Promise.all([
        chatsAPI.get(id), messagesAPI.list(id, 50),
      ]);
      setChat(chatRes.data.chat);
      if (chatRes.data.chat?.pinned_message_id) {
        const pinnedMsg = msgsRes.data.messages?.find((m: any) => m.id === chatRes.data.chat.pinned_message_id);
        if (pinnedMsg) setPinnedMessage(pinnedMsg);
      }
      
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
        msgsRes.data.messages.forEach((m: any) => processedMsgIds.current.add(m.id));
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

  useEffect(() => {
    if (!id) return;

    const socket = getSocket();
    if (!socket) return;

    const handleNewMessage = (data: { chat_id: string; message: any }) => {
      if (data.chat_id !== id) return;
      if (processedMsgIds.current.has(data.message.id)) return;
      processedMsgIds.current.add(data.message.id);

      const processIncomingMessage = async (msg: any) => {
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
            return {
              ...msg,
              content: result.text || '[Entschlüsselung fehlgeschlagen]',
              media_base64: result.mediaBase64 || msg.media_base64,
              _decrypted: true,
            };
          } else {
            const result = await ratchetDecrypt(
              msg.content, msg.nonce, id,
              msg.dh_public || null,
              msg.media_ciphertext || null,
              msg.media_nonce || null
            );
            return {
              ...msg,
              content: result.text || '[Entschlüsselung fehlgeschlagen]',
              media_base64: result.mediaBase64 || msg.media_base64,
              _decrypted: true,
            };
          }
        }
        return msg;
      };

      processIncomingMessage(data.message).then((processedMsg) => {
        setMessages(prev => [...prev, processedMsg]);
        lastMsgId.current = processedMsg.id;
        if (processedMsg.sender_id !== user?.id) {
          messagesAPI.markRead([processedMsg.id]).catch(() => {});
        }
      });
    };

    const handleTypingStart = (data: { chat_id: string; user: any }) => {
      if (data.chat_id !== id) return;
      setTypingUsers(prev => {
        const exists = prev.some((u: any) => u.id === data.user.id);
        if (exists) return prev;
        return [...prev, data.user];
      });
    };

    const handleTypingStop = (data: { chat_id: string; user_id: string }) => {
      if (data.chat_id !== id) return;
      setTypingUsers(prev => prev.filter((u: any) => u.id !== data.user_id));
    };

    const handleChatUpdated = (data: { chat_id: string; updates: any }) => {
      if (data.chat_id !== id) return;
      setChat((prev: any) => prev ? { ...prev, ...data.updates } : prev);
    };

    const handleConnect = () => setWsConnected(true);
    const handleDisconnect = () => setWsConnected(false);

    socket.on('new_message', handleNewMessage);
    socket.on('typing_start', handleTypingStart);
    socket.on('typing_stop', handleTypingStop);
    socket.on('chat_updated', handleChatUpdated);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    setWsConnected(socket.connected);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('typing_start', handleTypingStart);
      socket.off('typing_stop', handleTypingStop);
      socket.off('chat_updated', handleChatUpdated);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [id, user, chat?.is_group]);

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
            processedMsgIds.current.add(msg.id);
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
            processedMsgIds.current.add(msg.id);
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
        processedMsgIds.current.add(res.data.message.id);
      }
      setText('');
      setSelfDestruct(null);
      setReplyTo(null);
      emitStopTyping(id);
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
            processedMsgIds.current.add(msg.id);
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
            processedMsgIds.current.add(msg.id);
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
        processedMsgIds.current.add(res.data.message.id);
      }
    } catch (e) {
      console.log('Error sending voice message', e);
    } finally {
      setSending(false);
    }
  };

  const handleSendLocation = async () => {
    if (!id) return;
    setSendingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Berechtigung fehlt', 'Standortzugriff ist erforderlich.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const coords = `${loc.coords.latitude.toFixed(6)}, ${loc.coords.longitude.toFixed(6)}`;
      if (e2eeSessionRef.current) {
        if (chat?.is_group) {
          const encrypted = await groupEncrypt(`📍 Standort: ${coords}`, id);
          if (encrypted) {
            const res = await encryptedMessagesAPI.send({
              chat_id: id, ciphertext: encrypted.ciphertext, nonce: encrypted.nonce,
              sender_key_id: encrypted.senderKeyId, sender_key_iteration: encrypted.iteration,
              message_type: 'location', security_level: securityLevel,
            });
            const msg = res.data.message;
            msg.content = `📍 Standort: ${coords}`;
            msg._e2ee_sent = true;
            setMessages(prev => [...prev, msg]);
            lastMsgId.current = msg.id;
            processedMsgIds.current.add(msg.id);
          }
        } else {
          const encrypted = await ratchetEncrypt(`📍 Standort: ${coords}`, id);
          if (encrypted) {
            const res = await encryptedMessagesAPI.send({
              chat_id: id, ciphertext: encrypted.ciphertext, nonce: encrypted.nonce,
              dh_public: encrypted.dhPublic, msg_num: encrypted.msgNum,
              message_type: 'location', security_level: securityLevel,
            });
            const msg = res.data.message;
            msg.content = `📍 Standort: ${coords}`;
            msg._e2ee_sent = true;
            setMessages(prev => [...prev, msg]);
            lastMsgId.current = msg.id;
            processedMsgIds.current.add(msg.id);
          }
        }
      } else {
        const res = await messagesAPI.send({
          chat_id: id, content: `📍 Standort: ${coords}`,
          message_type: 'location', security_level: securityLevel,
        });
        setMessages(prev => [...prev, res.data.message]);
        lastMsgId.current = res.data.message.id;
        processedMsgIds.current.add(res.data.message.id);
      }
    } catch (e) {
      console.log('Error sending location', e);
    } finally {
      setSendingLocation(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setPendingMedia({
        uri: result.assets[0].uri,
        base64: result.assets[0].base64 || '',
        type: 'image',
        fileName: result.assets[0].fileName || undefined,
      });
    }
    setShowMediaMenu(false);
  };

  const pickVideo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      base64: true,
      quality: 0.5,
    });
    if (!result.canceled && result.assets[0]) {
      setPendingMedia({
        uri: result.assets[0].uri,
        base64: result.assets[0].base64 || '',
        type: 'video',
        fileName: result.assets[0].fileName || undefined,
      });
    }
    setShowMediaMenu(false);
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({});
    if (!result.canceled && result.assets[0]) {
      const file = result.assets[0];
      const base64 = await readFileAsBase64(file.uri);
      setPendingMedia({
        uri: file.uri,
        base64,
        type: 'file',
        fileName: file.name,
      });
    }
    setShowMediaMenu(false);
  };

  const readFileAsBase64 = async (uri: string): Promise<string> => {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const sendPendingMedia = async () => {
    if (!pendingMedia || !id) return;
    setSending(true);
    try {
      if (e2eeSessionRef.current) {
        if (chat?.is_group) {
          const encrypted = await groupEncrypt(pendingMedia.fileName || 'Datei', id, pendingMedia.type, pendingMedia.base64);
          if (encrypted) {
            const res = await encryptedMessagesAPI.send({
              chat_id: id, ciphertext: encrypted.ciphertext, nonce: encrypted.nonce,
              sender_key_id: encrypted.senderKeyId, sender_key_iteration: encrypted.iteration,
              message_type: pendingMedia.type, media_ciphertext: encrypted.mediaCiphertext,
              media_nonce: encrypted.mediaNonce, security_level: securityLevel,
            });
            const msg = res.data.message;
            msg.content = pendingMedia.fileName || 'Datei';
            msg.media_base64 = pendingMedia.base64;
            msg._e2ee_sent = true;
            setMessages(prev => [...prev, msg]);
            lastMsgId.current = msg.id;
            processedMsgIds.current.add(msg.id);
          }
        } else {
          const encrypted = await ratchetEncrypt(pendingMedia.fileName || 'Datei', id, pendingMedia.type, pendingMedia.base64);
          if (encrypted) {
            const res = await encryptedMessagesAPI.send({
              chat_id: id, ciphertext: encrypted.ciphertext, nonce: encrypted.nonce,
              dh_public: encrypted.dhPublic, msg_num: encrypted.msgNum,
              message_type: pendingMedia.type, media_ciphertext: encrypted.mediaCiphertext,
              media_nonce: encrypted.mediaNonce, security_level: securityLevel,
            });
            const msg = res.data.message;
            msg.content = pendingMedia.fileName || 'Datei';
            msg.media_base64 = pendingMedia.base64;
            msg._e2ee_sent = true;
            setMessages(prev => [...prev, msg]);
            lastMsgId.current = msg.id;
            processedMsgIds.current.add(msg.id);
          }
        }
      } else {
        const res = await messagesAPI.send({
          chat_id: id, content: pendingMedia.fileName || 'Datei',
          message_type: pendingMedia.type, media_base64: pendingMedia.base64,
          security_level: securityLevel,
        });
        setMessages(prev => [...prev, res.data.message]);
        lastMsgId.current = res.data.message.id;
        processedMsgIds.current.add(res.data.message.id);
      }
      setPendingMedia(null);
    } catch (e) {
      console.log('Error sending media', e);
    } finally {
      setSending(false);
    }
  };

  const loadContacts = async () => {
    try {
      const res = await contactsAPI.list();
      setContacts(res.data.contacts || []);
    } catch (e) {
      console.log('Error loading contacts', e);
    }
  };

  const addMember = async (contactId: string) => {
    try {
      await chatsAPI.addMember(id!, contactId);
      const chatRes = await chatsAPI.get(id!);
      setGroupMembers(chatRes.data.chat.participants || []);
      setContacts(prev => prev.filter(c => c.id !== contactId));
    } catch (e: any) {
      Alert.alert('Fehler', e?.response?.data?.detail || 'Teilnehmer hinzufügen fehlgeschlagen');
    }
  };

  const removeMember = async (memberId: string) => {
    try {
      await chatsAPI.removeMember(id!, memberId);
      const chatRes = await chatsAPI.get(id!);
      setGroupMembers(chatRes.data.chat.participants || []);
    } catch (e: any) {
      Alert.alert('Fehler', e?.response?.data?.detail || 'Teilnehmer entfernen fehlgeschlagen');
    }
  };

  const saveGroupName = async () => {
    try {
      await chatsAPI.update(id!, { name: groupName });
      setChat((prev: any) => prev ? { ...prev, name: groupName } : prev);
      setEditingGroupName(false);
    } catch (e: any) {
      Alert.alert('Fehler', e?.response?.data?.detail || 'Gruppenname ändern fehlgeschlagen');
    }
  };

  const loadChatsForForward = async () => {
    try {
      const res = await chatsAPI.list();
      setForwardTargetChats((res.data.chats || []).filter((c: any) => c.id !== id));
    } catch (e) {
      console.log('Error loading chats for forward', e);
    }
  };

  const handleForward = async (targetChatId: string) => {
    if (!messageActions?.msg) return;
    setForwardingMsg(messageActions.msg.id);
    try {
      await messagesAPI.forward(messageActions.msg.id, targetChatId);
      setShowForwardModal(false);
    } catch (e) {
      console.log('Forward failed', e);
    } finally {
      setForwardingMsg(null);
    }
  };

  const handleTyping = () => {
    if (!id) return;
    if (typingTimer.current) clearTimeout(typingTimer.current);
    emitTyping(id);
    typingTimer.current = setTimeout(() => {
      emitStopTyping(id);
    }, 3000);
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
    const map: any = { UNCLASSIFIED: COLORS.unclassified, RESTRICTED: COLORS.restricted, CONFIDENTIAL: COLORS.confidential, SECRET: COLORS.secret };
    return map[level] || COLORS.unclassified;
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHrs = diffMs / (1000 * 60 * 60);
    if (diffHrs < 24) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: 'digit' });
    if (diffHrs < 48) return 'Gestern';
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  };

  const getInitial = (name: string) => name?.charAt(0).toUpperCase() || '?';

  const getAvatarColor = (chatId: string) => {
    const colors = [COLORS.primary, '#4A90D9', '#7B68EE', '#20B2AA', '#FF6B6B', '#FFD93D', '#6BCB77'];
    let hash = 0;
    for (let i = 0; i < chatId.length; i++) hash = chatId.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const renderMessage = ({ item, index }: { item: any; index: number }) => {
    const isSent = item.sender_id === user?.id;
    const prevMsg = index > 0 ? messages[index - 1] : null;
    const showAvatar = !isSent && (!prevMsg || prevMsg.sender_id !== item.sender_id);
    const showDate = !prevMsg || new Date(item.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString();
    const showName = !isSent && chat?.is_group && (!prevMsg || prevMsg.sender_id !== item.sender_id);
    const reactions = item.reactions || {};
    const reactionEntries = Object.entries(reactions).filter(([_, users]) => (users as string[]).length > 0);

    return (
      <>
        {showDate && (
          <View style={styles.dateSeparator}>
            <View style={styles.dateLine} />
            <Text style={styles.dateText}>{formatDateSeparator(item.created_at)}</Text>
            <View style={styles.dateLine} />
          </View>
        )}
        {showName && (
          <View style={styles.nameSeparator}>
            <Text style={styles.nameSeparatorText}>{item.sender_name || 'Unbekannt'}</Text>
          </View>
        )}
        <View style={[styles.msgRow, isSent ? styles.msgRowRight : styles.msgRowLeft]}>
          {!isSent && showAvatar && (
            <View style={[styles.msgAvatar, { backgroundColor: `${getAvatarColor(item.sender_id || '')}33` }]}>
              <Text style={[styles.msgAvatarText, { color: getAvatarColor(item.sender_id || '') }]}>{getInitial(item.sender_name || '?')}</Text>
            </View>
          )}
          {!isSent && !showAvatar && <View style={{ width: 34, marginRight: 6, marginBottom: 4 }} />}
          <TouchableOpacity
            activeOpacity={0.8}
            onLongPress={(event) => {
              const { pageX, pageY } = event.nativeEvent;
              setMessageActions({ msg: item, x: pageX, y: pageY });
            }}
          >
            <View style={[
              styles.msgBubble,
              isSent ? styles.sentBubble : styles.receivedBubble,
              item.emergency && styles.emergencyBubble,
            ]}>
              {item.emergency && (
                <View style={styles.emergencyBanner}>
                  <Ionicons name="warning" size={12} color={COLORS.danger} />
                  <Text style={styles.emergencyText}>EMERGENCY</Text>
                </View>
              )}
              {item.reply_to && (
                <View style={styles.replyPreview}>
                  <View style={styles.replyPreviewIndicator} />
                  <Text style={styles.replyPreviewText} numberOfLines={1}>
                    {item.reply_to_content || 'Nachricht'}
                  </Text>
                </View>
              )}
              {item.message_type === 'voice' ? (
                <VoiceMessagePlayer audioBase64={item.media_base64} />
              ) : item.message_type === 'image' && item.media_base64 ? (
                <Image source={{ uri: `data:image/jpeg;base64,${item.media_base64}` }} style={styles.msgImage} />
              ) : item.message_type === 'location' ? (
                <TouchableOpacity style={styles.mediaContainer} onPress={() => {}}>
                  <Ionicons name="location" size={32} color={COLORS.primaryLight} />
                  <Text style={styles.mediaLabel}>{item.content}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.msgContent}>{item.content}</Text>
              )}
              <View style={styles.msgFooter}>
                <Text style={styles.msgTime}>{formatTime(item.created_at)}</Text>
                {item.self_destruct_seconds && (
                  <View style={styles.destructBadge}>
                    <Ionicons name="timer" size={10} color={COLORS.restricted} />
                    <Text style={styles.destructText}>{item.self_destruct_seconds}s</Text>
                  </View>
                )}
                {isSent && (
                  <Ionicons
                    name={item.read_by?.includes(user?.id) ? 'checkmark-done' : 'checkmark'}
                    size={12}
                    color={item.read_by?.includes(user?.id) ? COLORS.primaryLight : COLORS.textMuted}
                  />
                )}
                {item.edited && <Text style={styles.msgEdited}>(bearbeitet)</Text>}
              </View>
            </View>
            {reactionEntries.length > 0 && (
              <View style={[styles.msgReactions, isSent ? styles.msgReactionsRight : styles.msgReactionsLeft]}>
                {reactionEntries.slice(0, 3).map(([emoji, users]) => (
                  <View key={emoji} style={styles.msgReaction}>
                    <Text style={styles.msgReactionEmoji}>{emoji}</Text>
                    <Text style={styles.msgReactionCount}>{(users as string[]).length}</Text>
                  </View>
                ))}
              </View>
            )}
          </TouchableOpacity>
        </View>
      </>
    );
  };

  const formatDateSeparator = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Heute';
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Gestern';
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primaryLight} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.flex}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity testID="back-btn" style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <View style={styles.headerTitleRow}>
              <View style={[styles.headerAvatar, { backgroundColor: `${getAvatarColor(id || '')}33` }]}>
                <Ionicons name={chat?.is_group ? 'people' : 'person'} size={18} color={chat?.is_group ? getAvatarColor(id || '') : COLORS.textSecondary} />
              </View>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle} numberOfLines={1}>{getChatTitle()}</Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>{getChatSubtitle()}</Text>
              </View>
            </View>
          </View>
          <TouchableOpacity
            testID="security-menu-btn"
            style={[styles.secIndicator, { borderColor: getSecColor(securityLevel) }]}
            onPress={() => setShowSecMenu(!showSecMenu)}
          >
            <Ionicons name="shield-checkmark" size={12} color={getSecColor(securityLevel)} />
            <Text style={[styles.secIndicatorText, { color: getSecColor(securityLevel) }]}>{securityLevel}</Text>
          </TouchableOpacity>
          {chat?.is_group ? (
            <TouchableOpacity testID="group-info-btn" onPress={() => setShowGroupInfo(true)}>
              <Ionicons name="information-circle" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity testID="e2ee-info-btn" onPress={() => setShowFingerprint(true)}>
              <Ionicons name="lock-closed" size={20} color={isE2EESessionActive ? COLORS.success : COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Pinned message bar */}
        {pinnedMessage && (
          <View style={styles.pinnedBar}>
            <Ionicons name="pin" size={14} color={COLORS.primaryLight} />
            <Text style={styles.pinnedBarText} numberOfLines={1}>{pinnedMessage.content}</Text>
            <TouchableOpacity onPress={() => setPinnedMessage(null)}>
              <Ionicons name="close" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Search bar */}
        {showSearch && (
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={COLORS.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Nachrichten suchen..."
              placeholderTextColor={COLORS.textMuted}
              autoFocus
            />
            <TouchableOpacity onPress={() => { setShowSearch(false); setSearchQuery(''); }}>
              <Ionicons name="close" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Messages */}
        <FlatList
          testID="messages-list"
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          inverted
          ListEmptyComponent={
            <View style={styles.emptyMessages}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="chatbubble-ellipses" size={32} color={COLORS.primaryLight} />
              </View>
              <Text style={styles.emptyText}>Noch keine Nachrichten</Text>
              <Text style={styles.emptySubtext}>Sende die erste Nachricht</Text>
            </View>
          }
          onEndReached={() => {
            if (messages.length > 0 && !loading) {
              loadOlderMessages();
            }
          }}
          onEndReachedThreshold={0.3}
        />

        {/* E2EE info when not active */}
        {!isE2EESessionActive && !chat?.is_group && (
          <View style={{ paddingHorizontal: 16, paddingVertical: 6, backgroundColor: `${COLORS.warning}10` }}>
            <Text style={{ fontSize: FONTS.sizes.xs, color: COLORS.warning, textAlign: 'center' }}>
              {e2eeFingerprint
                ? 'E2EE aktiv — Tippe auf das Schloss oben rechts für E2EE-Info'
                : 'Tippe auf das Schloss oben rechts für E2EE-Info'}
            </Text>
          </View>
        )}

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
              <TouchableOpacity style={styles.msgContextMenuItem} onPress={async () => {
                setMessageActions(null);
                await loadChatsForForward();
                setShowForwardModal(true);
              }}>
                <Ionicons name="arrow-forward" size={18} color={COLORS.primaryLight} />
                <Text style={styles.msgContextMenuItemText}>Weiterleiten</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.msgContextMenuItem} onPress={async () => {
                try {
                  if (pinnedMessage?.id === messageActions.msg.id) {
                    await chatsAPI.unpinMessage(id!);
                    setPinnedMessage(null);
                  } else {
                    await chatsAPI.pinMessage(id!, messageActions.msg.id);
                    setPinnedMessage(messageActions.msg);
                  }
                } catch (e: any) {
                  Alert.alert('Fehler', e?.response?.data?.detail || 'Anheften fehlgeschlagen');
                }
                setMessageActions(null);
              }}>
                <Ionicons name={pinnedMessage?.id === messageActions.msg.id ? 'pin' : 'pin-outline'} size={18} color={COLORS.primaryLight} />
                <Text style={styles.msgContextMenuItemText}>{pinnedMessage?.id === messageActions.msg.id ? 'Loslösen' : 'Anheften'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.msgContextMenuItem} onPress={async () => {
                try {
                  await messagesAPI.star(messageActions.msg.id);
                  setMessages(prev => prev.map(m => m.id === messageActions.msg.id ? { ...m, starred_by: [...(m.starred_by || []), user?.id] } : m));
                } catch (e) { console.log(e); }
                setMessageActions(null);
              }}>
                <Ionicons name="star" size={18} color={COLORS.primaryLight} />
                <Text style={styles.msgContextMenuItemText}>Favorit</Text>
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
            <TouchableOpacity testID="send-location-btn" onPress={handleSendLocation} style={styles.secBtn}>
              {sendingLocation ? (
                <ActivityIndicator size="small" color={COLORS.primaryLight} />
              ) : (
                <Ionicons name="location" size={20} color={COLORS.primaryLight} />
              )}
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
      </View>

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
              {editingGroupName ? (
                <View style={styles.groupNameEditRow}>
                  <TextInput
                    style={styles.groupNameInput}
                    value={groupName}
                    onChangeText={setGroupName}
                    placeholder="Gruppenname"
                    placeholderTextColor={COLORS.textMuted}
                    autoFocus
                  />
                  <TouchableOpacity style={styles.groupNameSaveBtn} onPress={saveGroupName}>
                    <Ionicons name="checkmark" size={20} color={COLORS.success} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setEditingGroupName(false); setGroupName(chat?.name || ''); }}>
                    <Ionicons name="close" size={20} color={COLORS.textMuted} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={() => { setEditingGroupName(true); setGroupName(chat?.name || ''); }}>
                  <Text style={styles.modalGroupName}>{chat?.name || 'Gruppe'}</Text>
                  <Text style={styles.editGroupNameHint}>Tippen zum Bearbeiten</Text>
                </TouchableOpacity>
              )}
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
                  {member.id === user?.id ? (
                    <Text style={styles.modalMemberBadge}>Du</Text>
                  ) : chat?.created_by === user?.id ? (
                    <TouchableOpacity style={styles.removeMemberBtn} onPress={() => removeMember(member.id)}>
                      <Ionicons name="person-remove" size={16} color={COLORS.danger} />
                    </TouchableOpacity>
                  ) : null}
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

      {/* Contact Verification Modal */}
      <Modal visible={showVerifyModal} animationType="slide" transparent>
        <SafeAreaView style={styles.modalOverlay} edges={['top', 'bottom']}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Kontakt verifizieren</Text>
              <TouchableOpacity onPress={() => setShowVerifyModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }}>
              <View style={styles.verifyInfo}>
                <Ionicons name="shield-checkmark" size={48} color={contactVerified ? COLORS.success : COLORS.warning} />
                <Text style={styles.verifyTitle}>
                  {contactVerified ? 'Kontakt verifiziert' : 'Kontakt noch nicht verifiziert'}
                </Text>
                <Text style={styles.verifyDesc}>
                  {contactVerified
                    ? 'Du hast die Safety Numbers dieses Kontakts bestätigt. Man-in-the-Middle-Angriffe sind ausgeschlossen.'
                    : 'Vergleiche die Safety Numbers mit deinem Kontakt — persönlich, per Telefon oder Videoanruf.'}
                </Text>
              </View>

              {!chat?.is_group && getOtherParticipant() && (
                <>
                  <Text style={styles.verifySectionTitle}>SAFETY NUMBER</Text>
                  <View style={styles.verifyCodeBox}>
                    <Text style={styles.verifyCodeText}>{e2eeFingerprint || '—'}</Text>
                  </View>
                  <Text style={styles.verifyHint}>
                    Diese Nummer muss mit der auf dem Gerät deines Kontakts identisch sein.
                  </Text>

                  {!contactVerified && (
                    <TouchableOpacity
                      style={styles.verifyBtn}
                      onPress={() => {
                        setContactVerified(true);
                        setShowVerifyModal(false);
                      }}
                    >
                      <Ionicons name="shield-checkmark" size={20} color={COLORS.white} />
                      <Text style={styles.verifyBtnText}>Als verifiziert markieren</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              {chat?.is_group && (
                <Text style={styles.verifyHint}>
                  Gruppenchats nutzen Sender Keys. Verifiziere jeden Teilnehmer einzeln über 1:1 Chat.
                </Text>
              )}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Starred Messages Modal */}
      <Modal visible={showStarredModal} animationType="slide" transparent>
        <SafeAreaView style={styles.modalOverlay} edges={['top', 'bottom']}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Favoriten</Text>
              <TouchableOpacity onPress={() => setShowStarredModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.starredList}>
              {starredMessages.length === 0 ? (
                <View style={styles.forwardEmpty}>
                  <Ionicons name="star-outline" size={32} color={COLORS.textMuted} />
                  <Text style={styles.forwardEmptyText}>Keine Favoriten</Text>
                </View>
              ) : (
                starredMessages.map((m: any) => (
                  <TouchableOpacity
                    key={m.id}
                    style={styles.starredItem}
                    onPress={() => {
                      setShowStarredModal(false);
                      const idx = messages.findIndex(msg => msg.id === m.id);
                      if (idx >= 0) flatListRef.current?.scrollToIndex({ index: idx, animated: true });
                    }}
                  >
                    <View style={styles.starredItemHeader}>
                      <Text style={styles.starredSender}>{m.sender_id === user?.id ? 'Du' : (m.sender_name || 'Unbekannt')}</Text>
                      <Text style={styles.starredTime}>{formatTime(m.created_at)}</Text>
                    </View>
                    <Text style={styles.starredContent} numberOfLines={2}>{m.content}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
      <Modal visible={showForwardModal} animationType="slide" transparent>
        <SafeAreaView style={styles.modalOverlay} edges={['top', 'bottom']}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Weiterleiten an...</Text>
              <TouchableOpacity onPress={() => setShowForwardModal(false)}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.forwardChatList}>
              {forwardTargetChats.length === 0 ? (
                <View style={styles.forwardEmpty}>
                  <Text style={styles.forwardEmptyText}>Keine anderen Chats verfügbar</Text>
                </View>
              ) : (
                forwardTargetChats.map((c: any) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.forwardChatItem, forwardingMsg === messageActions?.msg?.id && styles.forwardChatItemDisabled]}
                    onPress={() => handleForward(c.id)}
                    disabled={forwardingMsg === messageActions?.msg?.id}
                  >
                    <View style={[styles.forwardChatAvatar, { backgroundColor: `${getAvatarColor(c.id)}33` }]}>
                      <Ionicons name={c.is_group ? 'people' : 'person'} size={20} color={c.is_group ? getAvatarColor(c.id) : COLORS.textSecondary} />
                    </View>
                    <View style={styles.forwardChatInfo}>
                      <Text style={styles.forwardChatName} numberOfLines={1}>{c.is_group ? c.name : (c.participants?.find((p: any) => p.id !== user?.id)?.name || 'Chat')}</Text>
                      <Text style={styles.forwardChatMeta} numberOfLines={1}>{c.is_group ? `${(c.participants?.length || 0)} Teilnehmer` : ''}</Text>
                    </View>
                    {forwardingMsg === messageActions?.msg?.id ? (
                      <ActivityIndicator size="small" color={COLORS.primaryLight} />
                    ) : (
                      <Ionicons name="arrow-forward" size={18} color={COLORS.primaryLight} />
                    )}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
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

  // Forward modal
  forwardChatList: { maxHeight: 400 },
  forwardEmpty: { padding: 32, alignItems: 'center' },
  forwardEmptyText: { fontSize: FONTS.sizes.sm, color: COLORS.textMuted },
  forwardChatItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  forwardChatItemDisabled: { opacity: 0.5 },
  forwardChatAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  forwardChatInfo: { flex: 1 },
  forwardChatName: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  forwardChatMeta: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },

  // Pinned message bar
  pinnedBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8,
    backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  pinnedBarText: { flex: 1, fontSize: FONTS.sizes.sm, color: COLORS.primaryLight, fontWeight: FONTS.weights.medium },

  // Star button
  starBtn: { padding: 8, marginRight: 4 },

  // Starred messages modal
  starredList: { maxHeight: 400 },
  starredItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  starredItemHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  starredSender: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.primaryLight },
  starredTime: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted },
  starredContent: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary },

  // Search bar
  searchBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8,
    backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  searchInput: { flex: 1, color: COLORS.textPrimary, fontSize: FONTS.sizes.md, paddingVertical: 6 },

  // Group admin
  groupNameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  groupNameInput: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, borderBottomWidth: 1, borderBottomColor: COLORS.primary, paddingVertical: 4, minWidth: 150 },
  groupNameSaveBtn: { padding: 4 },
  editGroupNameHint: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, textAlign: 'center', marginTop: 2 },
  removeMemberBtn: { padding: 8, borderRadius: 16, backgroundColor: 'rgba(196,75,75,0.1)', alignItems: 'center', justifyContent: 'center' },

  // Contact verification
  verifyInfo: { alignItems: 'center', paddingVertical: 16 },
  verifyTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginTop: 12 },
  verifyDesc: { fontSize: FONTS.sizes.sm, color: COLORS.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  verifySectionTitle: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.textMuted, letterSpacing: 2, marginTop: 16, marginBottom: 8 },
  verifyCodeBox: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  verifyCodeText: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.primaryLight, textAlign: 'center', letterSpacing: 2, fontFamily: FONTS.family.monospace },
  verifyHint: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, textAlign: 'center', marginTop: 12, lineHeight: 18 },
  verifyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.success, borderRadius: 12, padding: 14, marginTop: 20 },
  verifyBtnText: { fontSize: FONTS.sizes.base, fontWeight: FONTS.weights.bold, color: COLORS.white },
});
