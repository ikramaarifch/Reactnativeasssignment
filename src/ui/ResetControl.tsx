import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { planReset } from '../core/resetPlan';
import { Report } from '../core/types';
import { colors, HIT } from './theme';

type Phase = 'idle' | 'confirming' | 'working';

interface Props {
  reports: readonly Report[];
  /** Resolves when everything is wiped; rejects with a readable message if not. */
  onReset: () => Promise<void>;
  onDone: (message: string) => void;
}

/**
 * "Start over": a quiet button, a confirmation that states the exact cost, and
 * a blocking "working" state so nothing can be saved mid-reset.
 */
export function ResetControl({ reports, onReset, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const plan = planReset(reports);

  const confirm = async () => {
    setPhase('working');
    setError(null);
    try {
      await onReset();
      setPhase('idle');
      onDone('Everything on this phone was cleared. Reports already on the server were not touched.');
    } catch (e) {
      setPhase('idle');
      setError(e instanceof Error ? e.message : 'Could not clear everything. Try again.');
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>
        Clears the reports and photos stored on this phone. Nothing is deleted from the server.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => setPhase('confirming')}
        style={styles.button}>
        <Text style={styles.buttonText}>Start over</Text>
      </Pressable>

      <Modal
        visible={phase !== 'idle'}
        transparent
        animationType="fade"
        onRequestClose={() => {
          // Back button cancels a confirmation, but cannot interrupt the actual clearing.
          if (phase === 'confirming') {
            setPhase('idle');
          }
        }}>
        <View style={styles.backdrop}>
          <View style={styles.dialog} accessibilityViewIsModal>
            {phase === 'working' ? (
              <>
                <Text style={styles.title}>Clearing this phone…</Text>
                <Text style={styles.body}>
                  Stopping uploads and deleting local reports and photos. This takes a moment.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.title} accessibilityRole="header">
                  {plan.title}
                </Text>
                <Text style={styles.body}>{plan.body}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={confirm}
                  style={[styles.confirm, plan.destructive ? styles.confirmDanger : null]}>
                  <Text style={styles.confirmText}>{plan.confirmLabel}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPhase('idle')}
                  style={styles.cancel}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 24, gap: 8, alignItems: 'stretch' },
  hint: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  error: { color: colors.danger, textAlign: 'center' },
  button: {
    minHeight: HIT,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: colors.danger, fontSize: 16, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: colors.bg, borderRadius: 16, padding: 20, gap: 12 },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  confirm: {
    minHeight: 52,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginTop: 4,
  },
  confirmDanger: { backgroundColor: colors.danger },
  confirmText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  cancel: { minHeight: HIT, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: colors.primary, fontSize: 16, fontWeight: '700' },
});
