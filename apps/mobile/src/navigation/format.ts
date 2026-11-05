import { METRES_PER_FOOT, METRES_PER_MILE } from '@drayvision/shared';

/** US-style distance for drivers: feet under ~0.1 mi (rounded to 50 ft), otherwise miles. */
export function formatDistance(m: number): string {
  const miles = m / METRES_PER_MILE;
  if (miles < 0.1) {
    const ft = Math.max(0, Math.round(m / METRES_PER_FOOT / 50) * 50);
    return `${ft} ft`;
  }
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

export function formatDuration(s: number): string {
  const mins = Math.max(0, Math.round(s / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min`;
}
