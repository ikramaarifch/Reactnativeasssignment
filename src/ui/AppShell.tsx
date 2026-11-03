import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Services } from '../app/services';
import { ComposeScreen } from './ComposeScreen';
import { DevSettingsScreen } from './DevSettingsScreen';
import { colors, HIT } from './theme';

const DEV_TAPS = 5;
const DEV_TAP_WINDOW_MS = 2_000;

/**
 * Top-level frame. The dev/test screen is hidden from normal users: tap the
 * title 5 times quickly to toggle it (testers are told in the README).
 */
export function AppShell({ services }: { services: Services }) {
  const [devOpen, setDevOpen] = useState(false);
  const taps = useRef<number[]>([]);

  const onTitlePress = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter(t => now - t < DEV_TAP_WINDOW_MS), now];
    if (taps.current.length >= DEV_TAPS) {
      taps.current = [];
      setDevOpen(open => !open);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Pressable onPress={onTitlePress} accessibilityRole="header" style={styles.header}>
        <Text style={styles.title}>{devOpen ? 'Dev settings' : 'New report'}</Text>
      </Pressable>
      <View style={styles.body}>
        {devOpen ? (
          <DevSettingsScreen {...services} />
        ) : (
          <ComposeScreen save={services.save} newReportId={services.newReportId} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    minHeight: HIT,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  body: { flex: 1 },
});
