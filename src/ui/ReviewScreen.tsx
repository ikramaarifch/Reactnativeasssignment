import React from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ReviewController } from '../review/ReviewController';
import { ReviewRepository, ServerReport } from '../review/types';
import { ServerImage } from './ServerImage';
import { colors, HIT, toneColors } from './theme';
import { useReviewState } from './useExternalStore';

interface Props {
  controller: ReviewController;
  repo: ReviewRepository;
  /** Reports still on this phone, mentioned in the empty state. */
  waitingLocally: number;
}

const THUMB = 96;

/**
 * Everything here comes from the SERVER, not from local state: a report
 * appears only once its commit-marker document exists.
 */
export function ReviewScreen({ controller, repo, waitingLocally }: Props) {
  const state = useReviewState(controller);

  if (state.status === 'idle' || state.status === 'loading') {
    return <Skeleton />;
  }
  if (state.status === 'error' && state.error) {
    return (
      <Centered
        title={state.error.kind === 'offline' ? 'You seem to be offline' : 'Could not load reports'}
        body={state.error.message}
        action="Try again"
        onAction={() => controller.refresh()}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      <FlatList
        data={state.reports}
        keyExtractor={r => r.id}
        contentContainerStyle={state.reports.length === 0 ? styles.emptyWrap : styles.list}
        refreshControl={
          <RefreshControl refreshing={state.refreshing} onRefresh={() => controller.refresh()} />
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => controller.loadMore()}
        ListHeaderComponent={
          state.error ? (
            <View style={[styles.notice, { backgroundColor: toneColors.warning.bg }]}>
              <Text style={[styles.noticeText, { color: toneColors.warning.fg }]}>
                Could not refresh. Showing what was loaded earlier. {state.error.message}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => controller.refresh()} style={styles.noticeBtn}>
                <Text style={[styles.noticeBtnText, { color: toneColors.warning.fg }]}>Try again</Text>
              </Pressable>
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          <Centered
            title="No reports on the server yet"
            body={
              waitingLocally > 0
                ? `${waitingLocally} ${waitingLocally === 1 ? 'report is' : 'reports are'} still waiting on this phone. They appear here once they are uploaded.`
                : 'Reports appear here after they have been uploaded.'
            }
            action="Refresh"
            onAction={() => controller.refresh()}
          />
        }
        ListFooterComponent={
          state.reports.length === 0 ? undefined : (
            <Footer
              loadingMore={state.loadingMore}
              failed={state.loadMoreFailed}
              hasMore={state.hasMore}
              onLoad={() => controller.loadMore()}
            />
          )
        }
        renderItem={({ item }) => <ReviewCard report={item} repo={repo} />}
      />
    </SafeAreaView>
  );
}

function ReviewCard({ report, repo }: { report: ServerReport; repo: ReviewRepository }) {
  const count = report.imagePaths.length;
  return (
    <View style={styles.card} accessible={false}>
      <Text style={styles.desc}>{report.description}</Text>
      <Text style={styles.meta}>
        {count} {count === 1 ? 'photo' : 'photos'} · {new Date(report.createdAt).toLocaleString()}
      </Text>
      <View style={styles.photos}>
        {report.imagePaths.map((path, i) => (
          <ServerImage
            key={path}
            repo={repo}
            path={path}
            position={i + 1}
            auto
            size={THUMB}
          />
        ))}
      </View>
    </View>
  );
}

function Footer(props: { loadingMore: boolean; failed: boolean; hasMore: boolean; onLoad: () => void }) {
  if (props.loadingMore) {
    return <Text style={styles.footerText}>Loading more reports…</Text>;
  }
  if (props.failed) {
    return (
      <View style={styles.footer}>
        <Text style={styles.footerText}>Could not load more reports.</Text>
        <Pressable accessibilityRole="button" onPress={props.onLoad} style={styles.footerBtn}>
          <Text style={styles.footerBtnText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (props.hasMore) {
    return (
      <Pressable accessibilityRole="button" onPress={props.onLoad} style={styles.footerBtn}>
        <Text style={styles.footerBtnText}>Load more</Text>
      </Pressable>
    );
  }
  return <Text style={styles.footerText}>That is every report on the server.</Text>;
}

function Centered(props: { title: string; body: string; action: string; onAction: () => void }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.centeredTitle}>{props.title}</Text>
      <Text style={styles.centeredBody}>{props.body}</Text>
      <Pressable accessibilityRole="button" onPress={props.onAction} style={styles.cta}>
        <Text style={styles.ctaText}>{props.action}</Text>
      </Pressable>
    </View>
  );
}

/** Grey placeholder cards while the first page loads: no spinner, no blank screen. */
function Skeleton() {
  return (
    <View style={styles.list} accessibilityLabel="Loading reports">
      {[0, 1, 2].map(i => (
        <View key={i} style={styles.card}>
          <View style={styles.boneTitle} />
          <View style={styles.boneMeta} />
          <View style={styles.bonePhoto} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { padding: 16, gap: 12 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 8 },
  desc: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  boneTitle: { width: '70%', height: 18, borderRadius: 6, backgroundColor: colors.surface },
  boneMeta: { width: '40%', height: 12, borderRadius: 6, backgroundColor: colors.surface },
  bonePhoto: { width: THUMB, height: THUMB, borderRadius: 8, backgroundColor: colors.surface },
  notice: { borderRadius: 10, padding: 12, gap: 8, marginBottom: 12 },
  noticeText: { fontSize: 14 },
  noticeBtn: { minHeight: HIT, justifyContent: 'center' },
  noticeBtnText: { fontSize: 16, fontWeight: '700' },
  footer: { alignItems: 'center', gap: 4 },
  footerText: { textAlign: 'center', color: colors.muted, paddingVertical: 12 },
  footerBtn: { minHeight: HIT, alignItems: 'center', justifyContent: 'center' },
  footerBtnText: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  centered: { flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center', gap: 12 },
  centeredTitle: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  centeredBody: { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 21 },
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
});
