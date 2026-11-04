/** Hazmat classes per 49 CFR 172.101 (1–9). */
export type HazmatClass = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type ChassisType = '20ft' | '40ft' | '45ft' | '53ft' | 'tri-axle' | 'flatbed' | 'other';

/** Physical + regulatory description of a rig. All dimensions SI. */
export interface TruckProfile {
  id: string;
  name: string;
  heightM: number;
  widthM: number;
  lengthM: number;
  grossWeightKg: number;
  axleCount: number;
  /** Heaviest single-axle load, if known. */
  axleLoadKg?: number | undefined;
  chassis: ChassisType;
  hazmat: HazmatClass[];
  /** e.g. TWIC holder for port terminals. */
  twic: boolean;
}

export function validateTruckProfile(p: TruckProfile): string[] {
  const errors: string[] = [];
  const positive: Array<[keyof TruckProfile, number]> = [
    ['heightM', p.heightM],
    ['widthM', p.widthM],
    ['lengthM', p.lengthM],
    ['grossWeightKg', p.grossWeightKg],
  ];
  for (const [k, v] of positive) {
    if (!Number.isFinite(v) || v <= 0) errors.push(`${String(k)} must be a positive number`);
  }
  if (!Number.isInteger(p.axleCount) || p.axleCount < 2) errors.push('axleCount must be an integer >= 2');
  if (p.id.trim() === '') errors.push('id is required');
  return errors;
}
