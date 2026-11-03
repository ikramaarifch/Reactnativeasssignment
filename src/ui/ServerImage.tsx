import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ReviewRepository } from '../review/types';
import { colors } from './theme';

type ImageState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; url: string }
  | { kind: 'error' };

interface Props {
  repo: ReviewRepository;
  path: string;
  /** 1-based position, for labels. */
  position: number;
  /** Load as soon as it is shown. Off = the user taps to download (saves data on 2G). */
  auto: boolean;
  size: number;
}

/**
 * One server photo. Never an endless spinner: it is always either a grey
 * placeholder with a label, the photo, or an error with a Retry button.
 * Only the full-size file exists on the server (<= 4.5 MB), so photos beyond
 * the first are tap-to-load instead of silently downloading several MB each.
 */
export function ServerImage({ repo, path, position, auto, size }: Props) {
  const [state, setState] = useState<ImageState>({ kind: auto ? 'loading' : 'idle' });
  // Changing the key forces <Image> to try the download again.
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(() => {
    setState({ kind: 'loading' });
    repo.getImageUrl(path).then(
      url => setState({ kind: 'ready', url }),
      () => setState({ kind: 'error' }),
    );
  }, [repo, path]);

  useEffect(() => {
    if (auto) {
      load();
    }
  }, [auto, load]);

  const box = { width: size, height: size };

  if (state.kind === 'ready') {
    return (
      <Image
        key={attempt}
        source={{ uri: state.url }}
        style={[styles.box, box]}
        resizeMode="cover"
        resizeMethod="resize" // decode at display size, not full resolution
        accessibilityLabel={`Photo ${position}`}
        onError={() => setState({ kind: 'error' })}
      />
    );
  }

  if (state.kind === 'error') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Photo ${position} failed to load. Retry`}
        onPress={() => {
          setAttempt(a => a + 1);
          load();
        }}
        style={[styles.box, styles.center, box]}>
        <Text style={styles.errorText}>Could not load</Text>
        <Text style={styles.action}>Retry</Text>
      </Pressable>
    );
  }

  if (state.kind === 'idle') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Load photo ${position}`}
        onPress={load}
        style={[styles.box, styles.center, box]}>
        <Text style={styles.label}>Photo {position}</Text>
        <Text style={styles.action}>Tap to load</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.box, styles.center, box]} accessibilityLabel={`Loading photo ${position}`}>
      <Text style={styles.label}>Loading…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 8, backgroundColor: colors.surface },
  center: { alignItems: 'center', justifyContent: 'center', padding: 4 },
  label: { fontSize: 12, color: colors.muted },
  action: { fontSize: 13, fontWeight: '700', color: colors.primary, marginTop: 2 },
  errorText: { fontSize: 12, color: colors.danger },
});
