import { TruckProfileCreateSchema, TruckProfileUpdateSchema } from '@drayvision/shared';
import { fromForm, summary, toCreate, toForm, toPatch, type ProfileForm } from '../src/profiles/form';
import { profile } from './fixtures';

const blank = toForm(null);
const filled: ProfileForm = {
  ...blank,
  name: 'Mack + 53',
  heightFt: '13',
  heightIn: '6',
  weightLb: '80,000',
  lengthFt: '73.5',
  widthFt: '8',
  widthIn: '6',
  axles: '5',
  hazmat: 'no',
  transponders: ['E_ZPASS'],
};

describe('profile form ⇄ SI', () => {
  it('converts feet/inches and pounds to metres and kilograms', () => {
    const { values, errors } = fromForm(filled, null);
    expect(errors).toEqual({});
    expect(values.height_m).toBeCloseTo(4.1148, 4); // 13' 6"
    expect(values.width_m).toBeCloseTo(2.5908, 4); // 8' 6"
    expect(values.weight_kg).toBeCloseTo(36287.39, 1); // 80,000 lb
    expect(values.length_m).toBeCloseTo(22.4028, 4);
    expect(TruckProfileCreateSchema.parse(toCreate(values))).toMatchObject({ axle_count: 5, hazmat: { carrying: false, classes: [] } });
  });

  it('blank fields are null (a draft), never zero or a default', () => {
    const { values, errors } = fromForm({ ...blank, name: 'New' }, null);
    expect(errors).toEqual({});
    expect(values).toMatchObject({ height_m: null, weight_kg: null, length_m: null, width_m: null, axle_count: null, hazmat: { carrying: null } });
  });

  it('rejects out-of-bounds and malformed input with driver-readable messages', () => {
    const { errors } = fromForm({ ...filled, heightFt: '162', heightIn: '', weightLb: 'heavy', axles: '1', widthIn: '14' }, null);
    expect(errors.height).toMatch(/between/);
    expect(errors.weight).toMatch(/pounds/);
    expect(errors.axles).toMatch(/2 and 13/);
    expect(errors.width).toMatch(/0–11/);
  });

  it('hazmat "yes" needs a class; a name is required', () => {
    expect(fromForm({ ...filled, hazmat: 'yes' }, null).errors.hazmat).toBeDefined();
    expect(fromForm({ ...filled, name: '  ' }, null).errors.name).toBeDefined();
    expect(fromForm({ ...filled, hazmat: 'yes', hazmatClasses: [8, 3] }, null).values.hazmat).toEqual({ carrying: true, classes: [3, 8] });
  });

  it('round-trips a stored profile to the form', () => {
    expect(toForm(profile())).toMatchObject({ heightFt: '13', heightIn: '6', weightLb: '80000', widthFt: '8', widthIn: '6', axles: '5', hazmat: 'no' });
  });

  it('an untouched form produces NO patch — no spurious new version (4.11 m must not become 4.1148 m)', () => {
    const p = profile();
    const { values } = fromForm(toForm(p), p);
    expect(values.height_m).toBe(4.11);
    expect(values.weight_kg).toBe(36_287.39);
    expect(toPatch(p, values)).toBeNull();
  });

  it('a real edit patches only the changed field, with the version it was edited from', () => {
    const p = profile({ version: 4 });
    const { values } = fromForm({ ...toForm(p), heightFt: '14', heightIn: '0' }, p);
    const patch = toPatch(p, values)!;
    expect(TruckProfileUpdateSchema.parse(patch)).toEqual({ expected_version: 4, height_m: expect.closeTo(4.2672, 4) });
  });

  it('summarises a profile for lists, flagging unknowns', () => {
    expect(summary(profile())).toBe(`13' 6" · 80,000 lb · 5 axles`);
    expect(summary(profile({ height_m: null, axle_count: null }))).toBe('height ? · 80,000 lb · axles ?');
  });
});
