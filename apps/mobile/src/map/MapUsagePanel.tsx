import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MapUsageResponse } from '@drayvision/shared';
import type { MapApi } from '../api/client';
import { Button } from '../components/ui';
import { colors, space } from '../theme';
import { useTileConfig } from './TileConfigContext';
import { localSessionCounter } from './useMapSession';

/**
 * Debug panel for the map cost controls (dev / pilot test day). Shows today's (UTC) sessions
 * and requests for THIS device as counted by our tile proxy, next to the tile source and how
 * the provider bills it. Ops compare the all-device totals (GET /usage/maps) against the
 * MapTiler dashboard — see docs/COSTS.md "Test day".
 */
export function MapUsagePanel({ api }: { api: Pick<MapApi, 'myMapUsage'> }) {
  const { tileConfig, deviceId } = useTileConfig();
  const [usage, setUsage] = useState<MapUsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.myMapUsage().then(
      (u) => {
        setUsage(u);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'unavailable'),
    );
  }, [api]);
  useEffect(load, [load]);

  const rows = usage?.days ?? [];
  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content} testID="map-usage-panel">
      <Text style={styles.title}>Map usage (today, UTC)</Text>
      <Row k="Tile source" v={`${tileConfig.source} · ${tileConfig.delivery}`} />
      <Row k="Provider bills per" v={tileConfig.billing_unit} />
      <Row k="Config version" v={tileConfig.config_version} />
      <Row k="Device id" v={deviceId ?? '…'} />
      <Row k="Sessions started (this app run)" v={String(localSessionCounter.started)} testID="usage-local-sessions" />
      {rows.length === 0 ? <Text style={styles.muted}>{error ?? 'No map usage recorded for this device today.'}</Text> : null}
      {rows.map((d) => (
        <View key={d.source} style={styles.card}>
          <Text style={styles.sub}>{d.source}</Text>
          <Row k="Map sessions" v={String(d.sessions)} testID={`usage-sessions-${d.source}`} />
          <Row k="Tile proxy requests" v={String(d.proxy_requests)} testID={`usage-requests-${d.source}`} />
          <Row k="Billable requests (provider weighting)" v={String(d.billable_requests)} testID={`usage-billable-${d.source}`} />
          <Row k="Est. cost (overage rate, upper bound)" v={d.estimated_cost_usd === null ? '—' : `$${d.estimated_cost_usd.toFixed(4)}`} />
        </View>
      ))}
      {tileConfig.delivery === 'direct' ? (
        <Text style={styles.warn}>Direct delivery: the device talks to MapTiler itself, so only the MapTiler dashboard has request counts.</Text>
      ) : null}
      <View style={styles.row}>
        <Button label="Refresh" kind="secondary" onPress={load} testID="usage-refresh" />
      </View>
    </ScrollView>
  );
}

function Row({ k, v, testID }: { k: string; v: string; testID?: string }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v} testID={testID}>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  sub: { color: colors.accent, fontWeight: '700', marginBottom: space.xs },
  card: { backgroundColor: colors.surface, borderRadius: 10, padding: space.md },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, paddingVertical: 2 },
  k: { color: colors.muted, flexShrink: 1 },
  v: { color: colors.text, fontWeight: '600' },
  muted: { color: colors.muted },
  warn: { color: colors.warn },
  row: { flexDirection: 'row' },
});
