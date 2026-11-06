import {
  feetToMetres,
  KG_PER_POUND,
  METRES_PER_FOOT,
  PROFILE_BOUNDS,
  type HazmatClass,
  type LngLat,
  type TransponderNetwork,
  type TruckProfile,
  type TruckProfileCreate,
  type TruckProfileUpdate,
} from '@drayvision/shared';

/**
 * Truck profile form: drivers think in feet/inches and pounds; the server stores metres and kg.
 * All conversion lives here, as pure functions.
 *
 * Blank = "not provided" (null), never zero or a default. A field whose displayed text the
 * driver did not change keeps its stored SI value exactly, so a save without real edits doesn't
 * create a new profile version (and doesn't invalidate cached routes).
 */
export interface ProfileForm {
  name: string;
  heightFt: string;
  heightIn: string;
  weightLb: string;
  lengthFt: string;
  widthFt: string;
  widthIn: string;
  axles: string;
  hazmat: 'unanswered' | 'no' | 'yes';
  hazmatClasses: HazmatClass[];
  transponders: TransponderNetwork[];
  homeLabel: string;
  homeCoords: LngLat | null;
}

export type FormField = 'name' | 'height' | 'weight' | 'length' | 'width' | 'axles' | 'hazmat' | 'home';
export type FormErrors = Partial<Record<FormField, string>>;

/** Editable fields, SI, as the shared schema wants them. */
export interface ProfileValues {
  name: string;
  height_m: number | null;
  weight_kg: number | null;
  length_m: number | null;
  width_m: number | null;
  axle_count: number | null;
  hazmat: { carrying: boolean | null; classes: HazmatClass[] };
  transponders: Array<{ network: TransponderNetwork; label: null }>;
  home_terminal: { label: string; facility_id: null; coords: LngLat } | null;
}

const INCH_M = METRES_PER_FOOT / 12;

function feetInches(m: number | null): [string, string] {
  if (m === null) return ['', ''];
  const totalIn = Math.round(m / INCH_M);
  return [String(Math.floor(totalIn / 12)), String(totalIn % 12)];
}

export function toForm(p: TruckProfile | null): ProfileForm {
  const [hFt, hIn] = feetInches(p?.height_m ?? null);
  const [wFt, wIn] = feetInches(p?.width_m ?? null);
  return {
    name: p?.name ?? '',
    heightFt: hFt,
    heightIn: hIn,
    weightLb: p?.weight_kg == null ? '' : String(Math.round(p.weight_kg / KG_PER_POUND)),
    lengthFt: p?.length_m == null ? '' : String(Math.round((p.length_m / METRES_PER_FOOT) * 10) / 10),
    widthFt: wFt,
    widthIn: wIn,
    axles: p?.axle_count == null ? '' : String(p.axle_count),
    hazmat: p?.hazmat.carrying == null ? 'unanswered' : p.hazmat.carrying ? 'yes' : 'no',
    hazmatClasses: p?.hazmat.classes ?? [],
    transponders: p?.transponders.map((t) => t.network) ?? [],
    homeLabel: p?.home_terminal?.label ?? '',
    homeCoords: p?.home_terminal?.coords ?? null,
  };
}

const num = (s: string): number | null | 'invalid' => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
};

const ftIn = (m: number): string => {
  const [f, i] = feetInches(m);
  return `${f}' ${i}"`;
};
const lb = (kg: number): string => `${Math.round(kg / KG_PER_POUND).toLocaleString('en-US')} lb`;

/** Parse the form into SI values, or field errors. `original` lets untouched fields keep exact values. */
export function fromForm(form: ProfileForm, original: TruckProfile | null): { values: ProfileValues; errors: FormErrors } {
  const errors: FormErrors = {};
  const before = toForm(original);

  const length = (key: 'height' | 'width', ftS: string, inS: string, bounds: { min: number; max: number }, orig: number | null): number | null => {
    const unchanged = original !== null && ftS === (key === 'height' ? before.heightFt : before.widthFt) && inS === (key === 'height' ? before.heightIn : before.widthIn);
    if (unchanged) return orig;
    const f = num(ftS);
    const i = num(inS);
    if (f === null && i === null) return null;
    if (f === 'invalid' || i === 'invalid' || (i ?? 0) >= 12) {
      errors[key] = 'Enter feet and inches (0–11)';
      return null;
    }
    const m = feetToMetres((f ?? 0) + (i ?? 0) / 12);
    if (m < bounds.min || m > bounds.max) errors[key] = `Must be between ${ftIn(bounds.min)} and ${ftIn(bounds.max)}`;
    return m;
  };

  const height_m = length('height', form.heightFt, form.heightIn, PROFILE_BOUNDS.height_m, original?.height_m ?? null);
  const width_m = length('width', form.widthFt, form.widthIn, PROFILE_BOUNDS.width_m, original?.width_m ?? null);

  let weight_kg: number | null = null;
  if (original !== null && form.weightLb === before.weightLb) weight_kg = original.weight_kg;
  else {
    const w = num(form.weightLb);
    if (w === 'invalid') errors.weight = 'Enter a weight in pounds';
    else if (w !== null) {
      weight_kg = w * KG_PER_POUND;
      const b = PROFILE_BOUNDS.weight_kg;
      if (weight_kg < b.min || weight_kg > b.max) errors.weight = `Must be between ${lb(b.min)} and ${lb(b.max)}`;
    }
  }

  let length_m: number | null = null;
  if (original !== null && form.lengthFt === before.lengthFt) length_m = original.length_m;
  else {
    const l = num(form.lengthFt);
    if (l === 'invalid') errors.length = 'Enter a length in feet';
    else if (l !== null) {
      length_m = l * METRES_PER_FOOT;
      const b = PROFILE_BOUNDS.length_m;
      if (length_m < b.min || length_m > b.max) errors.length = `Must be between ${Math.ceil(b.min / METRES_PER_FOOT)} and ${Math.floor(b.max / METRES_PER_FOOT)} ft`;
    }
  }

  const a = num(form.axles);
  let axle_count: number | null = null;
  if (a === 'invalid' || (a !== null && !Number.isInteger(a))) errors.axles = 'Enter a whole number of axles';
  else if (a !== null) {
    axle_count = a;
    if (a < PROFILE_BOUNDS.axle_count.min || a > PROFILE_BOUNDS.axle_count.max) errors.axles = `Between ${PROFILE_BOUNDS.axle_count.min} and ${PROFILE_BOUNDS.axle_count.max} axles`;
  }

  if (form.hazmat === 'yes' && form.hazmatClasses.length === 0) errors.hazmat = 'Pick at least one hazmat class';
  const name = form.name.trim();
  if (name === '') errors.name = 'Give this truck a name';
  if (form.homeLabel.trim() !== '' && form.homeCoords === null) errors.home = 'Set the home terminal location (use current location)';

  return {
    errors,
    values: {
      name,
      height_m,
      weight_kg,
      length_m,
      width_m,
      axle_count,
      hazmat: { carrying: form.hazmat === 'unanswered' ? null : form.hazmat === 'yes', classes: form.hazmat === 'yes' ? [...form.hazmatClasses].sort() : [] },
      transponders: form.transponders.map((network) => ({ network, label: null })),
      home_terminal: form.homeLabel.trim() !== '' && form.homeCoords ? { label: form.homeLabel.trim(), facility_id: null, coords: form.homeCoords } : null,
    },
  };
}

export const toCreate = (v: ProfileValues): TruckProfileCreate => ({ ...v });

/** PATCH body containing only fields that actually changed (plus expected_version). */
export function toPatch(original: TruckProfile, v: ProfileValues): TruckProfileUpdate | null {
  const patch: Record<string, unknown> = {};
  const keys = Object.keys(v) as Array<keyof ProfileValues>;
  for (const k of keys) {
    const before = k === 'transponders' ? original.transponders.map((t) => ({ network: t.network, label: null })) : original[k];
    if (JSON.stringify(v[k]) !== JSON.stringify(before)) patch[k] = v[k];
  }
  return Object.keys(patch).length === 0 ? null : ({ expected_version: original.version, ...patch } as TruckProfileUpdate);
}

/** One-line summary for lists: 13' 6" · 80,000 lb · 5 axles. */
export function summary(p: TruckProfile): string {
  const parts = [
    p.height_m === null ? 'height ?' : ftIn(p.height_m),
    p.weight_kg === null ? 'weight ?' : lb(p.weight_kg),
    p.axle_count === null ? 'axles ?' : `${p.axle_count} axles`,
  ];
  if (p.hazmat.carrying) parts.push(`hazmat ${p.hazmat.classes.join(', ')}`);
  return parts.join(' · ');
}
