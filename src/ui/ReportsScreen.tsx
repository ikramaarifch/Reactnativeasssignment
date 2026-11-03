import React from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { describeReport } from '../core/statusView';
import { Report } from '../core/types';
import { UploadEngine } from '../core/UploadEngine';
import { useNow } from './hooks';
import { useEngineState } from './useExternalStore';
import { colors, HIT, toneColors } from './theme';

interface Props {
  engine: UploadEngine;
  isOnline: boolean | undefined;
  onCreate: () => void;
}

/** Local queue: every report with exactly one clear status. Observes the engine only. */
export function ReportsScreen({ engine, isOnline, onCreate }: Props) {
  const { reports, progress } = useEngineState(engine);
  const now = useNow(reports.some(r => r.status === 'failed_retrying'));
  const newestFirst = [...reports].reverse();

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      <FlatList
        data={newestFirst}
        keyExtractor={r => r.id}
        contentContainerStyle={newestFirst.length === 0 ? styles.emptyWrap : styles.list}
        ListEmptyComponent={<EmptyState onCreate={onCreate} />}
        renderItem={({ item }) => (
          <ReportCard
            report={item}
            now={now}
            isOnline={isOnline}
            progress={progress}
            onRetry={() => engine.retry(item.id)}
          />
        )}
      />
    </SafeAreaView>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No reports yet</Text>
      <Text style={styles.emptyBody}>
        Reports you save appear here, each with its status, until they are on the server.
      </Text>
      <Pressable accessibilityRole="button" onPress={onCreate} style={styles.cta}>
        <Text style={styles.ctaText}>Create a report</Text>
      </Pressable>
    </View>
  );
}

function ReportCard(props: {
  report: Report;
  now: number;
  isOnline: boolean | undefined;
  progress: ReturnType<UploadEngine['getState']>['progress'];
  onRetry: () => void;
}) {
  const { report } = props;
  const view = describeReport(report, {
    now: props.now,
    isOnline: props.isOnline,
    progress: props.progress,
  });
  const c = toneColors[view.tone];
  const thumb = report.images[0]?.sourceUri;

  return (
    <View style={styles.card} accessible accessibilityLabel={`${report.description}. ${view.title}`}>
      <View style={styles.row}>
        {thumb ? <Image source={{ uri: thumb }} style={styles.thumb} /> : <View style={styles.thumb} />}
        <View style={styles.flex}>
          <Text style={styles.desc} numberOfLines={2}>
            {report.description}
          </Text>
          <Text style={styles.meta}>
            {report.images.length} {report.images.length === 1 ? 'photo' : 'photos'} ·{' '}
            {new Date(report.createdAt).toLocaleString()}
          </Text>
        </View>
      </View>

      <View style={[styles.status, { backgroundColor: c.bg }]}>
        <Text style={[styles.statusTitle, { color: c.fg }]}>{view.title}</Text>
        {view.progress !== undefined ? (
          <View style={styles.track}>
            <View
              style={[styles.fill, { backgroundColor: c.bar, width: `${Math.round(view.progress * 100)}%` }]}
            />
          </View>
        ) : null}
        {view.detail ? <Text style={[styles.statusDetail, { color: c.fg }]}>{view.detail}</Text> : null}
        {view.canRetry ? (
          <Pressable accessibilityRole="button" onPress={props.onRetry} style={[styles.retry, { borderColor: c.fg }]}>
            <Text style={[styles.retryText, { color: c.fg }]}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  list: { padding: 16, gap: 12 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  empty: { padding: 32, alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  emptyBody: { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 21 },
  cta: {
    minHeight: HIT,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  ctaText: { color: colors.primaryText, fontSize: 16, fontWeight: '700' },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 10 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.surface },
  desc: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  status: { borderRadius: 8, padding: 10, gap: 6 },
  statusTitle: { fontSize: 16, fontWeight: '700' },
  statusDetail: { fontSize: 14 },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.12)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  retry: {
    minHeight: HIT,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  retryText: { fontSize: 16, fontWeight: '700' },
});
