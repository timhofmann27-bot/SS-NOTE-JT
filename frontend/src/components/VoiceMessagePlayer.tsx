import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '../utils/theme';

interface VoiceMessagePlayerProps {
  audioBase64: string;
  durationMs: number;
  isMine: boolean;
}

export default function VoiceMessagePlayer({ audioBase64, durationMs, isMine }: VoiceMessagePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(durationMs || 0);

  // Native ref
  const soundRef = useRef<any>(null);
  // Web ref
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const progressTimer = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync?.().catch(() => {});
      }
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.src = '';
      }
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, []);

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const loadAndPlay = async () => {
    try {
      if (isPlaying) {
        if (Platform.OS === 'web') {
          audioElRef.current?.pause();
        } else {
          await soundRef.current?.pauseAsync();
        }
        setIsPlaying(false);
        return;
      }

      if (Platform.OS === 'web') {
        if (!audioElRef.current) {
          const base64Uri = `data:audio/mp4;base64,${audioBase64}`;
          const audio = new Audio(base64Uri);
          audioElRef.current = audio;

          audio.addEventListener('timeupdate', () => {
            setProgress(audio.currentTime * 1000);
          });
          audio.addEventListener('loadedmetadata', () => {
            setDuration(audio.duration * 1000);
          });
          audio.addEventListener('ended', () => {
            setIsPlaying(false);
            setProgress(0);
          });
          audio.addEventListener('error', (e) => {
            console.error('Audio playback error', e);
            setIsPlaying(false);
          });

          await audio.play();
        } else {
          await audioElRef.current.play();
        }
      } else {
        if (!soundRef.current) {
          const { Audio } = await import('expo-av');
          const base64Uri = `data:audio/mp4;base64,${audioBase64}`;
          const { sound } = await Audio.Sound.createAsync(
            { uri: base64Uri },
            { shouldPlay: true },
            onPlaybackStatusUpdate
          );
          soundRef.current = sound;
        } else {
          await soundRef.current.playAsync();
        }
      }
      setIsPlaying(true);
    } catch (err) {
      console.error('Failed to play audio', err);
    }
  };

  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      setDuration(status.durationMillis || duration);
      setProgress(status.positionMillis || 0);
      if (status.didJustFinish) {
        setIsPlaying(false);
        setProgress(0);
      }
    }
  };

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <View style={[styles.container, isMine ? styles.mineContainer : styles.theirContainer]}>
      <TouchableOpacity
        style={[styles.playBtn, isMine ? styles.minePlayBtn : styles.theirPlayBtn]}
        onPress={loadAndPlay}
        activeOpacity={0.7}
      >
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={20}
          color={isMine ? COLORS.white : COLORS.primaryLight}
        />
      </TouchableOpacity>

      <View style={styles.progressArea}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
        <Text style={[styles.timeText, isMine ? styles.mineTimeText : styles.theirTimeText]}>
          {formatTime(progress)} / {formatTime(duration)}
        </Text>
      </View>

      <View style={styles.waveformIcon}>
        <Ionicons name="musical-notes" size={20} color={isMine ? 'rgba(255,255,255,0.5)' : COLORS.textMuted} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    minWidth: 180,
    maxWidth: 260,
  },
  mineContainer: {
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderRadius: 12,
  },
  theirContainer: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  minePlayBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  theirPlayBtn: {
    backgroundColor: 'rgba(255,140,0,0.15)',
  },
  progressArea: {
    flex: 1,
    gap: 4,
  },
  progressTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primaryLight,
    borderRadius: 2,
  },
  timeText: {
    fontSize: FONTS.sizes.xs,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  mineTimeText: {
    color: 'rgba(255,255,255,0.7)',
  },
  theirTimeText: {
    color: COLORS.textMuted,
  },
  waveformIcon: {
    flexShrink: 0,
  },
});
