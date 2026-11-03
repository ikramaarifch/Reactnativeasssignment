import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Services } from '../app/services';
import { pendingCount } from '../core/statusView';
import { ComposeScreen } from './ComposeScreen';
import { DevSettingsScreen } from './DevSettingsScreen';
import { useOnline } from './hooks';
import { NetworkBanner } from './NetworkBanner';
import { ReportsScreen } from './ReportsScreen';
import { ReviewScreen } from './ReviewScreen';
import { TabBar } from './TabBar';
import { colors, HIT } from './theme';
import { useEngineState } from './useExternalStore';

type Tab = 'compose' | 'reports' | 'review';

const TITLES: Record<Tab, string> = {
  compose: 'New report',
  reports: 'My reports',
  review: 'Review',
};
const DEV_TAPS = 5;
const DEV_TAP_WINDOW_MS = 2_000;

/**
 * Top-level frame: header, global network/queue banner, the active screen, and
 * bottom tabs. Screens stay mounted when inactive so a half-written report
 * survives a peek at the queue. The dev/test screen is hidden: tap the title
 * 5 times quickly to toggle it.
 */
export function AppShell({ services }: { services: Services }) {
  const [tab, setTab] = useState<Tab>('compose');
  const [devOpen, setDevOpen] = useState(false);
  const taps = useRef<number[]>([]);
  const { reports } = useEngineState(services.engine);
  const isOnline = useOnline(services.connectivity);

  // Opening Review always revalidates against the server; old data stays visible meanwhile.
  useEffect(() => {
    if (tab === 'review') {
      services.review.refresh();
    }
  }, [tab, services.review]);

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
        <Text style={styles.title}>{devOpen ? 'Dev settings' : TITLES[tab]}</Text>
      </Pressable>
      <NetworkBanner reports={reports} isOnline={isOnline} />

      <View style={styles.body}>
        {devOpen ? <DevSettingsScreen engine={services.engine} faults={services.faults} /> : null}
        <View style={[styles.body, tab !== 'compose' || devOpen ? styles.hidden : null]}>
          <ComposeScreen
            save={services.save}
            newReportId={services.newReportId}
            onViewReports={() => setTab('reports')}
          />
        </View>
        <View style={[styles.body, tab !== 'reports' || devOpen ? styles.hidden : null]}>
          <ReportsScreen
            engine={services.engine}
            isOnline={isOnline}
            onCreate={() => setTab('compose')}
          />
        </View>
        <View style={[styles.body, tab !== 'review' || devOpen ? styles.hidden : null]}>
          <ReviewScreen
            controller={services.review}
            repo={services.reviewRepo}
            waitingLocally={pendingCount(reports)}
          />
        </View>
      </View>

      <TabBar
        active={tab}
        onChange={key => {
          setDevOpen(false);
          setTab(key);
        }}
        tabs={[
          { key: 'compose', label: 'New report' },
          { key: 'reports', label: 'My reports', badge: pendingCount(reports) },
          { key: 'review', label: 'Review' },
        ]}
      />
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
  hidden: { display: 'none' },
});
