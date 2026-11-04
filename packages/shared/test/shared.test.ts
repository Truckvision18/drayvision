import { describe, expect, it } from 'vitest';
import {
  feetToMetres,
  metresToFeet,
  parseFeetInches,
  validateTruckProfile,
  type TruckProfile,
} from '../src/index.js';

const rig: TruckProfile = {
  id: 'std-40',
  name: '40ft container on chassis',
  heightM: 4.11,
  widthM: 2.59,
  lengthM: 20.7,
  grossWeightKg: 36287,
  axleCount: 5,
  chassis: '40ft',
  hazmat: [],
  twic: true,
};

describe('units', () => {
  it('round-trips feet/metres', () => {
    expect(metresToFeet(feetToMetres(13.5))).toBeCloseTo(13.5, 10);
  });
  it('parses feet-inches clearances', () => {
    expect(parseFeetInches(`13'6"`)).toBeCloseTo(4.1148, 4);
    expect(parseFeetInches('13-6')).toBeCloseTo(4.1148, 4);
    expect(parseFeetInches('12 ft')).toBeCloseTo(3.6576, 4);
    expect(parseFeetInches(`13'14"`)).toBeNull();
    expect(parseFeetInches('tall')).toBeNull();
  });
});

describe('TruckProfile', () => {
  it('accepts a valid rig', () => {
    expect(validateTruckProfile(rig)).toEqual([]);
  });
  it('rejects non-positive dimensions and too few axles', () => {
    const errors = validateTruckProfile({ ...rig, heightM: 0, axleCount: 1 });
    expect(errors).toContain('heightM must be a positive number');
    expect(errors).toContain('axleCount must be an integer >= 2');
  });
});
