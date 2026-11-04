import type { AppConfig, MeteredProvider } from '../../config/index.js';

export interface MeterSnapshot {
  month: string;
  calls: Record<string, number>;
  cacheHits: Record<string, number>;
  /** USD; null where unit cost is unverified. */
  spendUsd: Record<string, number | null>;
  totalSpendUsd: number | null;
}

export type BudgetState = 'ok' | 'alert' | 'hard-stop';

/**
 * Counts metered provider calls and cache hits, prices them with configured unit costs, and
 * enforces monthly budgets. In-memory for the scaffold; Phase 13 persists to Postgres so
 * actuals survive restarts and can replace the planning figures in docs/COSTS.md.
 */
export class Meter {
  private month: string;
  private calls: Record<string, number> = {};
  private hits: Record<string, number> = {};

  constructor(
    private readonly budgets: AppConfig['budgets'],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.month = this.currentMonth();
  }

  private currentMonth(): string {
    return this.now().toISOString().slice(0, 7);
  }

  private rollover(): void {
    const m = this.currentMonth();
    if (m !== this.month) {
      this.month = m;
      this.calls = {};
      this.hits = {};
    }
  }

  recordCall(provider: MeteredProvider): void {
    this.rollover();
    this.calls[provider] = (this.calls[provider] ?? 0) + 1;
  }

  recordCacheHit(provider: MeteredProvider): void {
    this.rollover();
    this.hits[provider] = (this.hits[provider] ?? 0) + 1;
  }

  private spend(provider: MeteredProvider): number | null {
    const unit = this.budgets.unitCostUsd[provider];
    return unit === null ? null : unit * (this.calls[provider] ?? 0);
  }

  /** Budget state for a provider, considering both its own ceiling and the total ceiling. */
  budgetState(provider: MeteredProvider): BudgetState {
    this.rollover();
    const states: BudgetState[] = [
      this.compare(this.spend(provider), this.budgets.monthlyUsd[provider]),
      this.compare(this.snapshot().totalSpendUsd, this.budgets.monthlyUsd.total),
    ];
    if (states.includes('hard-stop')) return 'hard-stop';
    if (states.includes('alert')) return 'alert';
    return 'ok';
  }

  private compare(spend: number | null, budget: number | null): BudgetState {
    if (spend === null || budget === null || budget === 0) return 'ok';
    const frac = spend / budget;
    if (frac >= this.budgets.hardStopAtFraction) return 'hard-stop';
    if (frac >= this.budgets.alertAtFraction) return 'alert';
    return 'ok';
  }

  snapshot(): MeterSnapshot {
    const providers = Object.keys(this.budgets.unitCostUsd) as MeteredProvider[];
    const spendUsd: Record<string, number | null> = {};
    let total: number | null = 0;
    let anyPriced = false;
    for (const p of providers) {
      const s = this.spend(p);
      spendUsd[p] = s;
      if (s !== null) {
        anyPriced = true;
        total = (total ?? 0) + s;
      }
    }
    return { month: this.month, calls: { ...this.calls }, cacheHits: { ...this.hits }, spendUsd, totalSpendUsd: anyPriced ? total : null };
  }
}
