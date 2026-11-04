/**
 * All internal measurements are SI (metres, kilograms). Convert at the edges only.
 * Conversion factors are exact definitions, not tunable config.
 */
export const METRES_PER_FOOT = 0.3048;
export const KG_PER_POUND = 0.45359237;
export const METRES_PER_MILE = 1609.344;

export const feetToMetres = (ft: number): number => ft * METRES_PER_FOOT;
export const metresToFeet = (m: number): number => m / METRES_PER_FOOT;
export const poundsToKg = (lb: number): number => lb * KG_PER_POUND;
export const kgToPounds = (kg: number): number => kg / KG_PER_POUND;
export const metresToMiles = (m: number): number => m / METRES_PER_MILE;

/** Parse a feet-inches value like 13'6" or 13-6 into metres. Returns null if unparseable. */
export function parseFeetInches(input: string): number | null {
  const m = /^\s*(\d+)\s*(?:'|ft|-)\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?\s*$/.exec(input);
  if (!m || m[1] === undefined) return null;
  const feet = Number(m[1]);
  const inches = m[2] === undefined ? 0 : Number(m[2]);
  if (inches >= 12) return null;
  return feetToMetres(feet + inches / 12);
}
