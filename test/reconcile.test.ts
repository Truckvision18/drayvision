import { describe, expect, it } from 'vitest';
import { reconcile } from '../scripts/reconcile-map-usage.js';

describe('test-day reconciliation', () => {
  it('passes within tolerance and fails outside it', () => {
    expect(reconcile(10_100, 10_000, 0.02)).toMatchObject({ ok: true, diff: 100 });
    expect(reconcile(9_700, 10_000, 0.02)).toMatchObject({ ok: false, diff: -300 });
    expect(reconcile(0, 0, 0.02).ok).toBe(true);
    expect(reconcile(5, 0, 0.02).ok).toBe(false);
  });
});
