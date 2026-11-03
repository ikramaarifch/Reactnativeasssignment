import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Report } from '../core/types';
import { queueBanner } from '../core/statusView';
import { toneColors } from './theme';

/** Global strip under the header: network state + how many reports are waiting. */
export function NetworkBanner(props: { reports: readonly Report[]; isOnline: boolean | undefined }) {
  const banner = queueBanner(props.reports, props.isOnline);
  if (!banner) {
    return null;
  }
  const c = toneColors[banner.tone];
  return (
    <View
      style={[styles.bar, { backgroundColor: c.bg }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite">
      <Text style={[styles.text, { color: c.fg }]}>{banner.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  text: { fontSize: 14, fontWeight: '600' },
});
