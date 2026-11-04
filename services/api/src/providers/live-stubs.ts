import { ProviderNotImplementedError, type CameraProvider, type ImageryProvider, type TollProvider, type TrafficProvider } from './types.js';

/**
 * Live provider shells. Each validates its credentials at construction (so a misconfigured
 * pilot fails at boot, not mid-trip) and throws 501 until its phase implements the call.
 * Endpoint shapes are intentionally NOT guessed here — they come from the vendor docs/contract.
 */
function requireKey(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required for this provider`);
  return value;
}

export class TollSmartTolls implements TollProvider {
  readonly name = 'tollsmart';
  readonly rightsId = 'tollsmart';
  constructor(env: NodeJS.ProcessEnv) {
    requireKey('TOLLSMART_API_KEY', env.TOLLSMART_API_KEY);
    requireKey('TOLLSMART_BASE_URL', env.TOLLSMART_BASE_URL);
  }
  async estimate(): Promise<never> {
    throw new ProviderNotImplementedError('TollSmart', 'Phase 6');
  }
}

export class Ny511Traffic implements TrafficProvider {
  readonly name = 'ny511';
  readonly rightsId = 'ny511';
  constructor(env: NodeJS.ProcessEnv) {
    requireKey('NY511_API_KEY', env.NY511_API_KEY);
  }
  async events(): Promise<never> {
    throw new ProviderNotImplementedError('511NY traffic', 'Phase 7');
  }
}

export class Ny511Cameras implements CameraProvider {
  readonly name = 'ny511';
  readonly rightsId = 'ny511';
  constructor(env: NodeJS.ProcessEnv) {
    requireKey('NY511_API_KEY', env.NY511_API_KEY);
  }
  async list(): Promise<never> {
    throw new ProviderNotImplementedError('511NY cameras', 'Phase 8');
  }
  async image(): Promise<never> {
    throw new ProviderNotImplementedError('511NY cameras', 'Phase 8');
  }
}

export class GoogleImagery implements ImageryProvider {
  readonly name = 'google';
  readonly rightsId = 'google-imagery';
  constructor(env: NodeJS.ProcessEnv) {
    requireKey('GOOGLE_MAPS_API_KEY', env.GOOGLE_MAPS_API_KEY);
  }
  async preview(): Promise<never> {
    throw new ProviderNotImplementedError('Google imagery', 'Phase 9');
  }
}
