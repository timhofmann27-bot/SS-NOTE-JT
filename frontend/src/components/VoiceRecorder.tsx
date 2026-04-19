import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Dimensions, Platform
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '../utils/theme';

const { width } = Dimensions.get('window');

interface VoiceRecorderProps {
  onSend: (audioBase64: string, durationMs: number) => void;
  onCancel: () => void;
}

export default function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [waveform, setWaveform] = useState<number[]>(Array(30).fill(0.1));

  const timerRef = useRef<any>(null);
  const animValue = useRef(new Animated.Value(0)).current;
  const waveformInterval = useRef<any>(null);

  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(newRecording);
      setIsRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1000);
      }, 1000);

      waveformInterval.current = setInterval(() => {
        setWaveform(prev => {
          const next = [...prev.slice(1), Math.random() * 0.8 + 0.2];
          return next;
        });
      }, 100);

      Animated.loop(
        Animated.sequence([
          Animated.timing(animValue, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(animValue, { toValue: 0, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  };

  const stopRecording = async () => {
    try {
      if (timerRef.current) clearInterval(timerRef.current);
      if (waveformInterval.current) clearInterval(waveformInterval.current);
      animValue.stopAnimation();

      if (!recording) return;

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      const durationMs = duration;

      setRecording(null);
      setIsRecording(false);

      if (uri) {
        const response = await fetch(uri);
        const blob = await response.blob();
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          onSend(base64, durationMs);
        };
      }
    } catch (err) {
      console.error('Failed to stop recording', err);
      onCancel();
    }
  };

  const cancelRecording = async () => {
    try {
      if (timerRef.current) clearInterval(timerRef.current);
      if (waveformInterval.current) clearInterval(waveformInterval.current);
      animValue.stopAnimation();

      if (recording) {
        await recording.stopAndUnloadAsync();
        setRecording(null);
      }
      setIsRecording(false);
      onCancel();
    } catch (err) {
      console.error('Failed to cancel recording', err);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (waveformInterval.current) clearInterval(waveformInterval.current);
      if (recording) recording.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.recordingArea}>
        <Animated.View style={[styles.pulseRing, {
          opacity: animValue.interpolate({
            inputRange: [0, 1],
            outputRange: [0.6, 0],
          }),
          transform: [{
            scale: animValue.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.5],
            }),
          }],
        }]} />

        <View style={styles.waveformContainer}>
          {waveform.map((height, i) => (
            <View
              key={i}
              style={[
                styles.waveformBar,
                {
                  height: Math.max(4, height * 24),
                  backgroundColor: i > waveform.length - 5 ? COLORS.danger : COLORS.primaryLight,
                },
              ]}
            />
          ))}
        </View>

        <Text style={styles.duration}>{formatDuration(duration)}</Text>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.cancelBtn} onPress={cancelRecording}>
          <Ionicons name="close" size={24} color={COLORS.danger} />
          <Text style={styles.cancelText}>Abbrechen</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.sendBtn, isRecording && styles.sendBtnActive]}
          onPress={stopRecording}
          disabled={!isRecording}
        >
          <Ionicons name="send" size={24} color={COLORS.white} />
          <Text style={styles.sendText}>{isRecording ? 'Loslassen zum Senden' : 'Senden'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    padding: 16,
  },
  recordingArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    position: 'relative',
  },
  pulseRing: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.danger,
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    height: 30,
    marginBottom: 12,
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: COLORS.primaryLight,
  },
  duration: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 12,
  },
  cancelText: {
    fontSize: FONTS.sizes.base,
    color: COLORS.danger,
    fontWeight: FONTS.weights.medium,
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  sendBtnActive: {
    backgroundColor: COLORS.success,
  },
  sendText: {
    fontSize: FONTS.sizes.base,
    color: COLORS.white,
    fontWeight: FONTS.weights.bold,
  },
});
