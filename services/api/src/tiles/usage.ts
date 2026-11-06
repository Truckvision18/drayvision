import type { MapUsageDay, TileSource } from '@drayvision/shared';
import type pg from 'pg';
import type { ResourceKind } from './upstream.js';

/**
 * Map usage analytics — "sessions / requests per user per day, from day one".
 *
 *  - proxy_requests:    what each device asked our tile proxy for
 *  - upstream_requests: what we asked the provider for (= what the provider counts; MapTiler
 *                       content is never served from a server-side cache)
 *  - billable_requests: upstream requests weighted like the provider's billing table
 *  - sessions:          map sessions the app reported (our analytics; MapTiler bills this
 *                       MapLibre-Native/proxy integration per request, not per session)
 *
 * Days are UTC dates.
 */
export interface RequestEvent {
  day: string;
  source: TileSource;
  kind: ResourceKind;
  deviceId: string;
  accountId: string | null;
  /** True when we called the provider (false = served from our own cache, self-hosted only). */
  upstream: boolean;
  /** Provider answered 304 Not Modified (device revalidating a cached tile). */
  revalidation: boolean;
  billable: number;
}

export interface SessionEvent {
  day: string;
  source: TileSource;
  sessionId: string;
  deviceId: string;
  accountId: string | null;
  view: string;
  startedAt: string;
}

export interface DeviceDay {
  day: string;
  device_id: string;
  account_id: string | null;
  source: TileSource;
  sessions: number;
  proxy_requests: number;
  billable_requests: number;
}

export interface MapUsageStore {
  recordRequest(e: RequestEvent): void;
  /** Returns false if the session id was already recorded (idempotent reporting). */
  recordSession(e: SessionEvent): Promise<boolean>;
  /** Totals for a day across all devices, per source. */
  day(day: string, unitCostUsdPerBillable: number | null): Promise<MapUsageDay[]>;
  /** Totals for one device on a day, per source. */
  deviceDay(day: string, deviceId: string): Promise<DeviceDay[]>;
  perDevice(day: string): Promise<DeviceDay[]>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

interface KindAgg {
  upstream: number;
  revalidations: number;
  proxy: number;
  billable: number;
}

/** Aggregates in memory. Used directly in tests / no-DB dev, and as the write buffer for Postgres. */
export class MemoryMapUsage implements MapUsageStore {
  // `${day}|${source}|${kind}`
  protected kinds = new Map<string, KindAgg>();
  // `${day}|${device}|${source}`
  protected devices = new Map<string, DeviceDay>();
  protected sessionIds = new Set<string>();
  protected sessions: SessionEvent[] = [];

  recordRequest(e: RequestEvent): void {
    const k = `${e.day}|${e.source}|${e.kind}`;
    const agg = this.kinds.get(k) ?? { upstream: 0, revalidations: 0, proxy: 0, billable: 0 };
    agg.proxy += 1;
    if (e.upstream) agg.upstream += 1;
    if (e.revalidation) agg.revalidations += 1;
    agg.billable += e.billable;
    this.kinds.set(k, agg);
    const d = this.device(e.day, e.deviceId, e.accountId, e.source);
    d.proxy_requests += 1;
    d.billable_requests += e.billable;
  }

  protected device(day: string, deviceId: string, accountId: string | null, source: TileSource): DeviceDay {
    const k = `${day}|${deviceId}|${source}`;
    let d = this.devices.get(k);
    if (!d) {
      d = { day, device_id: deviceId, account_id: accountId, source, sessions: 0, proxy_requests: 0, billable_requests: 0 };
      this.devices.set(k, d);
    }
    if (accountId && !d.account_id) d.account_id = accountId;
    return d;
  }

  async recordSession(e: SessionEvent): Promise<boolean> {
    if (this.sessionIds.has(e.sessionId)) return false;
    this.sessionIds.add(e.sessionId);
    this.sessions.push(e);
    this.device(e.day, e.deviceId, e.accountId, e.source).sessions += 1;
    return true;
  }

  async day(day: string, unitCost: number | null): Promise<MapUsageDay[]> {
    const bySource = new Map<TileSource, MapUsageDay>();
    for (const [key, agg] of this.kinds) {
      const [d, source, kind] = key.split('|') as [string, TileSource, string];
      if (d !== day) continue;
      const u = bySource.get(source) ?? emptyDay(day, source);
      u.proxy_requests += agg.proxy;
      u.upstream_requests += agg.upstream;
      u.billable_requests += agg.billable;
      u.by_kind[kind] = (u.by_kind[kind] ?? 0) + agg.upstream;
      bySource.set(source, u);
    }
    for (const d of this.devices.values()) {
      if (d.day !== day) continue;
      const u = bySource.get(d.source) ?? emptyDay(day, d.source);
      u.sessions += d.sessions;
      bySource.set(d.source, u);
    }
    return [...bySource.values()].map((u) => withCost(u, unitCost));
  }

  async deviceDay(day: string, deviceId: string): Promise<DeviceDay[]> {
    return [...this.devices.values()].filter((d) => d.day === day && d.device_id === deviceId);
  }

  async perDevice(day: string): Promise<DeviceDay[]> {
    return [...this.devices.values()].filter((d) => d.day === day);
  }

  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}

const emptyDay = (day: string, source: TileSource): MapUsageDay => ({
  day,
  source,
  sessions: 0,
  proxy_requests: 0,
  upstream_requests: 0,
  billable_requests: 0,
  by_kind: {},
  estimated_cost_usd: null,
});

const withCost = (u: MapUsageDay, unitCost: number | null): MapUsageDay => ({
  ...u,
  billable_requests: Math.round(u.billable_requests * 1000) / 1000,
  estimated_cost_usd: unitCost === null || u.source !== 'maptiler' ? null : Math.round(u.billable_requests * unitCost * 1_000_000) / 1_000_000,
});

/**
 * Postgres-backed usage: requests are buffered in memory and upserted every flush interval
 * (hot tile path never waits on the DB); sessions are written immediately (idempotent).
 * Reads flush first so they are exact.
 */
export class PgMapUsage extends MemoryMapUsage {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pool: pg.Pool,
    flushIntervalSeconds: number,
  ) {
    super();
    this.timer = setInterval(() => void this.flush().catch(() => undefined), flushIntervalSeconds * 1000);
    this.timer.unref();
  }

  override async recordSession(e: SessionEvent): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO map_sessions (session_id, device_id, account_id, source, view, started_at, day) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (session_id) DO NOTHING`,
      [e.sessionId, e.deviceId, e.accountId, e.source, e.view, e.startedAt, e.day],
    );
    if (r.rowCount === 0) return false;
    await this.pool.query(
      `INSERT INTO map_usage_device_daily (day, device_id, source, account_id, sessions) VALUES ($1,$2,$3,$4,1)
       ON CONFLICT (day, device_id, source) DO UPDATE SET sessions = map_usage_device_daily.sessions + 1,
         account_id = COALESCE(map_usage_device_daily.account_id, EXCLUDED.account_id)`,
      [e.day, e.deviceId, e.source, e.accountId],
    );
    return true;
  }

  override async flush(): Promise<void> {
    const kinds = this.kinds;
    const devices = [...this.devices.values()].filter((d) => d.proxy_requests > 0 || d.billable_requests > 0);
    this.kinds = new Map();
    this.devices = new Map();
    for (const [key, a] of kinds) {
      const [day, source, kind] = key.split('|');
      await this.pool.query(
        `INSERT INTO map_usage_daily (day, source, kind, proxy_requests, upstream_requests, revalidations, billable_requests)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (day, source, kind) DO UPDATE SET
           proxy_requests = map_usage_daily.proxy_requests + EXCLUDED.proxy_requests,
           upstream_requests = map_usage_daily.upstream_requests + EXCLUDED.upstream_requests,
           revalidations = map_usage_daily.revalidations + EXCLUDED.revalidations,
           billable_requests = map_usage_daily.billable_requests + EXCLUDED.billable_requests`,
        [day, source, kind, a.proxy, a.upstream, a.revalidations, a.billable],
      );
    }
    for (const d of devices) {
      await this.pool.query(
        `INSERT INTO map_usage_device_daily (day, device_id, source, account_id, proxy_requests, billable_requests) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (day, device_id, source) DO UPDATE SET
           proxy_requests = map_usage_device_daily.proxy_requests + EXCLUDED.proxy_requests,
           billable_requests = map_usage_device_daily.billable_requests + EXCLUDED.billable_requests,
           account_id = COALESCE(map_usage_device_daily.account_id, EXCLUDED.account_id)`,
        [d.day, d.device_id, d.source, d.account_id, d.proxy_requests, d.billable_requests],
      );
    }
  }

  override async day(day: string, unitCost: number | null): Promise<MapUsageDay[]> {
    await this.flush();
    const bySource = new Map<TileSource, MapUsageDay>();
    const { rows } = await this.pool.query(
      'SELECT source, kind, proxy_requests, upstream_requests, billable_requests FROM map_usage_daily WHERE day = $1',
      [day],
    );
    for (const r of rows) {
      const u = bySource.get(r.source) ?? emptyDay(day, r.source);
      u.proxy_requests += Number(r.proxy_requests);
      u.upstream_requests += Number(r.upstream_requests);
      u.billable_requests += Number(r.billable_requests);
      u.by_kind[r.kind] = (u.by_kind[r.kind] ?? 0) + Number(r.upstream_requests);
      bySource.set(r.source, u);
    }
    const { rows: s } = await this.pool.query('SELECT source, SUM(sessions)::bigint AS sessions FROM map_usage_device_daily WHERE day = $1 GROUP BY source', [day]);
    for (const r of s) {
      const u = bySource.get(r.source) ?? emptyDay(day, r.source);
      u.sessions = Number(r.sessions);
      bySource.set(r.source, u);
    }
    return [...bySource.values()].map((u) => withCost(u, unitCost));
  }

  private async deviceRows(where: string, params: unknown[]): Promise<DeviceDay[]> {
    await this.flush();
    const { rows } = await this.pool.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, device_id, account_id, source, sessions, proxy_requests, billable_requests
         FROM map_usage_device_daily WHERE ${where} ORDER BY device_id, source`,
      params,
    );
    return rows.map((r) => ({ ...r, sessions: Number(r.sessions), proxy_requests: Number(r.proxy_requests), billable_requests: Number(r.billable_requests) }));
  }

  override deviceDay(day: string, deviceId: string): Promise<DeviceDay[]> {
    return this.deviceRows('day = $1 AND device_id = $2', [day, deviceId]);
  }

  override perDevice(day: string): Promise<DeviceDay[]> {
    return this.deviceRows('day = $1', [day]);
  }

  override async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush().catch(() => undefined);
  }
}
