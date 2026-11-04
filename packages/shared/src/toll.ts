import type { IsoDateTime } from './geo.js';

export interface TollItem {
  facility: string;
  amount: number;
}

export interface TollEstimate {
  currency: 'USD';
  total: number;
  items: TollItem[];
  /** Estimates are never guarantees — UI must say so. */
  isEstimate: true;
  provider: string;
  computedAt: IsoDateTime;
  /** True if served from our cache rather than a fresh metered call. */
  cached: boolean;
}
