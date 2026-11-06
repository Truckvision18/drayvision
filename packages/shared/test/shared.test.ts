import { describe, expect, it } from 'vitest';
import {
  CompleteTruckProfileSchema,
  FacilitySchema,
  feetToMetres,
  HazardSchema,
  isCompleteProfile,
  metresToFeet,
  parseFeetInches,
  profileCompleteness,
  RouteRequestSchema,
  TruckEntranceSchema,
  TruckProfileCreateSchema,
  TruckProfileSchema,
  TruckProfileUpdateSchema,
  type TruckProfile,
} from '../src/index.js';

const complete: TruckProfile = {
  id: 'p1',
  account_id: 'a1',
  version: 1,
  name: "40' box",
  height_m: 4.11,
  weight_kg: 36_000,
  length_m: 21,
  width_m: 2.59,
  axle_count: 5,
  hazmat: { carrying: false, classes: [] },
  transponders: [{ network: 'E_ZPASS', label: 'fleet tag' }],
  home_terminal: { label: 'Port Newark', facility_id: null, coords: { lng: -74.15, lat: 40.68 } },
  is_default: true,
  created_at: '2026-11-06T12:00:00Z',
  updated_at: '2026-11-06T12:00:00Z',
};
const source = { kind: 'OFFICIAL', name: 'NYSDOT', dataset_version: '2026-10', retrieved_at: '2026-11-01T00:00:00Z', rights_id: 'osm' };

describe('units', () => {
  it('round-trips feet/metres', () => {
    expect(metresToFeet(feetToMetres(13.5))).toBeCloseTo(13.5, 10);
  });
  it('parses feet-inches clearances', () => {
    expect(parseFeetInches(`13'6"`)).toBeCloseTo(4.1148, 4);
    expect(parseFeetInches('13-6')).toBeCloseTo(4.1148, 4);
    expect(parseFeetInches(`13'14"`)).toBeNull();
  });
});

describe('TruckProfile', () => {
  it('a complete profile validates and is routable', () => {
    expect(TruckProfileSchema.parse(complete)).toEqual(complete);
    expect(isCompleteProfile(complete)).toBe(true);
    expect(CompleteTruckProfileSchema.safeParse(complete).success).toBe(true);
  });

  it('a draft (null dimensions) is a valid PROFILE but not routable', () => {
    const draft = { ...complete, height_m: null, weight_kg: null };
    expect(TruckProfileSchema.safeParse(draft).success).toBe(true);
    expect(CompleteTruckProfileSchema.safeParse(draft).success).toBe(false);
    expect(profileCompleteness(draft)).toEqual({
      complete: false,
      missing_fields: ['height_m', 'weight_kg'],
      message: 'Complete your truck profile: add height and weight before DrayVision can plan a route.',
    });
  });

  it('an unanswered hazmat question makes the profile incomplete', () => {
    const p = { ...complete, hazmat: { carrying: null, classes: [] } };
    expect(profileCompleteness(p).missing_fields).toEqual(['hazmat']);
    expect(CompleteTruckProfileSchema.safeParse(p).success).toBe(false);
  });

  it('hazmat flag and classes must agree', () => {
    expect(TruckProfileSchema.safeParse({ ...complete, hazmat: { carrying: true, classes: [] } }).success).toBe(false);
    expect(TruckProfileSchema.safeParse({ ...complete, hazmat: { carrying: false, classes: [3] } }).success).toBe(false);
    expect(TruckProfileSchema.safeParse({ ...complete, hazmat: { carrying: true, classes: [3, 8] } }).success).toBe(true);
    expect(TruckProfileSchema.safeParse({ ...complete, hazmat: { carrying: true, classes: [10] } }).success).toBe(false);
  });

  it.each([
    ['height in inches typed as metres', { height_m: 162 }],
    ['zero weight', { weight_kg: 0 }],
    ['one axle', { axle_count: 1 }],
    ['fractional axles', { axle_count: 5.5 }],
    ['negative width', { width_m: -2.6 }],
  ])('rejects implausible values: %s', (_l, bad) => {
    expect(TruckProfileSchema.safeParse({ ...complete, ...bad }).success).toBe(false);
  });

  it('create accepts a name-only draft and fills nulls, never defaults', () => {
    expect(TruckProfileCreateSchema.parse({ name: 'New' })).toMatchObject({ height_m: null, weight_kg: null, axle_count: null, hazmat: { carrying: null, classes: [] } });
  });

  it('update requires expected_version and refuses unknown fields', () => {
    expect(TruckProfileUpdateSchema.safeParse({ height_m: 4 }).success).toBe(false);
    expect(TruckProfileUpdateSchema.safeParse({ expected_version: 1, version: 5 }).success).toBe(false);
    expect(TruckProfileUpdateSchema.safeParse({ expected_version: 1, height_m: null }).success).toBe(true);
  });

  it('home terminal needs a facility or a point; transponders are networks, not serials', () => {
    expect(TruckProfileSchema.safeParse({ ...complete, home_terminal: { label: 'x', facility_id: null, coords: null } }).success).toBe(false);
    expect(TruckProfileSchema.safeParse({ ...complete, transponders: [{ network: 'NOT_A_NETWORK', label: null }] }).success).toBe(false);
  });
});

describe('RouteRequest', () => {
  const base = { origin: { lng: -74, lat: 40.7 }, truck_profile_id: 'p1', departure_time: '2026-11-06T13:00:00Z' };
  it('accepts exactly one destination form', () => {
    expect(RouteRequestSchema.safeParse({ ...base, destination_coords: { lng: -74, lat: 40.71 } }).success).toBe(true);
    expect(RouteRequestSchema.safeParse({ ...base, destination_facility_id: 'fac-1' }).success).toBe(true);
    expect(RouteRequestSchema.safeParse(base).success).toBe(false);
    expect(RouteRequestSchema.safeParse({ ...base, destination_facility_id: 'f', destination_coords: { lng: 0, lat: 0 } }).success).toBe(false);
  });
  it('needs a profile id and a real timestamp', () => {
    expect(RouteRequestSchema.safeParse({ ...base, truck_profile_id: undefined, destination_facility_id: 'f' }).success).toBe(false);
    expect(RouteRequestSchema.safeParse({ ...base, departure_time: 'tomorrow', destination_facility_id: 'f' }).success).toBe(false);
  });
});

describe('Hazard', () => {
  const h = { id: 'h1', location: { lng: -74, lat: 40.7 }, description: 'bridge', source, confidence: 1, resolved: false };
  it('enforces value semantics per type', () => {
    expect(HazardSchema.safeParse({ ...h, type: 'LOW_CLEARANCE', value: 3.9 }).success).toBe(true);
    expect(HazardSchema.safeParse({ ...h, type: 'LOW_CLEARANCE', value: null }).success).toBe(false);
    expect(HazardSchema.safeParse({ ...h, type: 'UNKNOWN_CLEARANCE', value: 3.9 }).success).toBe(false);
    expect(HazardSchema.safeParse({ ...h, type: 'TRUCK_RESTRICTION', value: null }).success).toBe(false);
    expect(HazardSchema.safeParse({ ...h, type: 'TRUCK_RESTRICTION', restriction: 'MAX_LENGTH', value: null }).success).toBe(false);
    expect(HazardSchema.safeParse({ ...h, type: 'WEIGHT_LIMIT', value: 18_000, restriction: 'PARKWAY' }).success).toBe(false);
    expect(HazardSchema.safeParse({ ...h, type: 'HAZMAT_RESTRICTION', value: null, confidence: 1.5 }).success).toBe(false);
  });
});

describe('Facility / TruckEntrance', () => {
  const entrance = { id: 'e1', coords: { lng: -74.1, lat: 40.67 }, street: 'Corbin St', is_primary: true, verified_by: 'ops', verified_at: '2026-01-01T00:00:00Z', source: 'OFFICIAL' };
  const fac = { id: 'f1', name: 'T', kind: 'PORT_TERMINAL', street_address: '1 Way', truck_entrances: [entrance], verification_state: 'VERIFIED' };
  it('verified entrances must say who verified them and when', () => {
    expect(TruckEntranceSchema.safeParse(entrance).success).toBe(true);
    expect(TruckEntranceSchema.safeParse({ ...entrance, verified_by: null }).success).toBe(false);
    expect(TruckEntranceSchema.safeParse({ ...entrance, source: 'UNVERIFIED', verified_by: null, verified_at: null }).success).toBe(true);
  });
  it('exactly one primary entrance when any exist', () => {
    expect(FacilitySchema.safeParse(fac).success).toBe(true);
    expect(FacilitySchema.safeParse({ ...fac, truck_entrances: [entrance, { ...entrance, id: 'e2' }] }).success).toBe(false);
    expect(FacilitySchema.safeParse({ ...fac, truck_entrances: [{ ...entrance, is_primary: false }] }).success).toBe(false);
    expect(FacilitySchema.safeParse({ ...fac, truck_entrances: [] }).success).toBe(true);
  });
});
