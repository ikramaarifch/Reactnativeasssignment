import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { enqueueSmokeReport, SmokeSource } from '../app/devSmoke';
import { Services } from '../app/services';
import { FaultMode } from '../transport/FaultyTransport';
import { useEngineState, useFaultConfig } from './useExternalStore';

const MODES: Array<{ mode: FaultMode; label: string }> = [
  { mode: 'normal', label: 'Normal' },
  { mode: 'slow', label: 'Slow (latency + throttle)' },
  { mode: 'drop_after_bytes', label: 'Drop after N bytes' },
  { mode: 'refuse', label: 'Refuse (permission-denied)' },
  { mode: 'server_error', label: 'Server error (5xx)' },
  { mode: 'hang', label: 'Hang (never responds)' },
];

/**
 * Developer/tester screen: inject network failures and drive the engine.
 * Plain on purpose — the polished status UI comes in a later step.
 */
export function DevSettingsScreen({ engine, faults }: Pick<Services, 'engine' | 'faults'>) {
  const state = useEngineState(engine);
  const config = useFaultConfig(faults);
  const [message, setMessage] = useState<string | null>(null);

  const enqueue = async (source: SmokeSource, count: number) => {
    try {
      setMessage(null);
      await enqueueSmokeReport(engine, source, count);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Failure injection</Text>
        {MODES.map(({ mode, label }) => (
          <Button
            key={mode}
            label={label}
            selected={config.mode === mode}
            onPress={() => faults.set({ mode })}
          />
        ))}

        <Text style={styles.heading}>Create test report</Text>
        <Button label="1 big photo (noise, ~15 MB)" onPress={() => enqueue('big', 1)} />
        <Button label="5 small photos" onPress={() => enqueue('small', 5)} />
        <Button label="Retry now (skip backoff)" onPress={() => engine.kick({ skipBackoff: true })} />
        {message ? <Text style={styles.error}>{message}</Text> : null}

        <Text style={styles.heading}>Queue ({state.reports.length})</Text>
        {state.reports.length === 0 ? <Text style={styles.muted}>Nothing queued.</Text> : null}
        {state.reports.map(r => {
          const done = r.images.filter(i => i.status === 'uploaded').length;
          const p = state.progress?.reportId === r.id ? state.progress : null;
          return (
            <View key={r.id} style={styles.card}>
              <Text style={styles.cardTitle}>{r.description}</Text>
              <Text style={styles.status}>
                {r.status} · images {done}/{r.images.length}
                {r.attempt > 0 ? ` · attempt ${r.attempt}` : ''}
              </Text>
              {p ? (
                <Text style={styles.muted}>
                  image {p.imageIndex + 1}: {Math.round(p.bytesTransferred / 1024)} /{' '}
                  {Math.round(p.totalBytes / 1024)} KB
                </Text>
              ) : null}
              {r.failure ? <Text style={styles.error}>{r.failure.reason}</Text> : null}
              {r.status === 'failed_permanent' ? (
                <Button label="Try again" onPress={() => engine.retry(r.id)} />
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function Button(props: { label: string; onPress: () => void; selected?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={[styles.button, props.selected && styles.buttonSelected]}>
      <Text style={[styles.buttonText, props.selected && styles.buttonTextSelected]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 8 },
  title: { fontSize: 24, fontWeight: '700' },
  heading: { fontSize: 16, fontWeight: '700', marginTop: 16 },
  button: {
    minHeight: 48, // hit target >= 44pt
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#999',
  },
  buttonSelected: { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  buttonText: { fontSize: 15, color: '#111' },
  buttonTextSelected: { color: '#fff', fontWeight: '700' },
  card: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, gap: 4 },
  cardTitle: { fontWeight: '600' },
  status: { fontFamily: 'monospace', fontSize: 13 },
  muted: { color: '#666' },
  error: { color: '#b42318' },
});
