import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from './theme';

export interface TabDef<K extends string> {
  key: K;
  label: string;
  /** Small count bubble, e.g. reports still waiting. Hidden when 0 or undefined. */
  badge?: number;
}

/** Plain bottom tab bar: three screens do not justify a navigation library. */
export function TabBar<K extends string>(props: {
  tabs: readonly TabDef<K>[];
  active: K;
  onChange: (key: K) => void;
}) {
  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      <View style={styles.bar} accessibilityRole="tablist">
        {props.tabs.map(tab => {
          const selected = tab.key === props.active;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={
                tab.badge ? `${tab.label}, ${tab.badge} waiting` : tab.label
              }
              onPress={() => props.onChange(tab.key)}
              style={styles.tab}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, selected && styles.labelSelected]}>{tab.label}</Text>
                {tab.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{tab.badge}</Text>
                  </View>
                ) : null}
              </View>
              <View style={[styles.indicator, selected && styles.indicatorSelected]} />
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  bar: { flexDirection: 'row' },
  tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 15, color: colors.muted, fontWeight: '600' },
  labelSelected: { color: colors.primary },
  indicator: { height: 3, width: 32, borderRadius: 2, backgroundColor: 'transparent' },
  indicatorSelected: { backgroundColor: colors.primary },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
