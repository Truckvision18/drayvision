import type { IsoDateTime, LngLat, Provenance } from './geo.js';

export type FacilityKind = 'port-terminal' | 'rail-ramp' | 'warehouse' | 'container-yard' | 'truck-parking' | 'scale' | 'fuel';

export interface TruckEntrance {
  id: string;
  location: LngLat;
  label: string;
  /** Hours as free text until a structured format is agreed (Phase 9). */
  hours?: string;
  notes?: string;
  provenance: Provenance;
}

export interface Facility {
  id: string;
  name: string;
  kind: FacilityKind;
  location: LngLat;
  address?: string;
  /** Port-terminal identifiers, e.g. firm code. */
  externalIds?: Record<string, string>;
  truckEntrances: TruckEntrance[];
  requiresTwic: boolean;
  provenance: Provenance;
}

export interface WaitTimeObservation {
  facilityId: string;
  observedAt: IsoDateTime;
  waitMinutes: number;
  source: 'driver-report' | 'geofence-dwell' | 'terminal-feed';
}

export interface SponsoredListing {
  id: string;
  facilityId?: string;
  title: string;
  location: LngLat;
  /** Sponsored content must always be labelled as such in the UI. */
  label: 'Sponsored';
  activeFrom: IsoDateTime;
  activeTo: IsoDateTime;
}
