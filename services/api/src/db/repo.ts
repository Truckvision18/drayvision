import type { Facility, SponsoredListing, WaitTimeObservation } from '@drayvision/shared';
import type { BBox } from '../providers/types.js';

export interface Repository {
  /** Facilities with at least one truck entrance inside the bbox (all facilities when null). */
  facilities(bbox: BBox | null): Promise<Facility[]>;
  facility(id: string): Promise<Facility | null>;
  sponsored(bbox: BBox | null, at: Date): Promise<SponsoredListing[]>;
  latestWaitTimes(facilityIds: string[]): Promise<WaitTimeObservation[]>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export const inBBox = (lng: number, lat: number, bbox: BBox | null): boolean =>
  bbox === null || (lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]);

/** In-memory repository backed by the seed files in data/facilities. Used in tests and when no DB is configured. */
export class MemoryRepository implements Repository {
  constructor(
    private readonly seedFacilities: Facility[],
    private readonly seedSponsored: SponsoredListing[] = [],
    private readonly seedWaits: WaitTimeObservation[] = [],
  ) {}

  async facilities(bbox: BBox | null): Promise<Facility[]> {
    return this.seedFacilities.filter((f) => bbox === null || f.truck_entrances.some((e) => inBBox(e.coords.lng, e.coords.lat, bbox)));
  }

  async facility(id: string): Promise<Facility | null> {
    return this.seedFacilities.find((f) => f.id === id) ?? null;
  }

  async sponsored(bbox: BBox | null, at: Date): Promise<SponsoredListing[]> {
    const t = at.toISOString();
    return this.seedSponsored.filter((s) => s.active_from <= t && s.active_to > t && inBBox(s.location.lng, s.location.lat, bbox));
  }

  async latestWaitTimes(ids: string[]): Promise<WaitTimeObservation[]> {
    return ids.flatMap((id) =>
      this.seedWaits
        .filter((w) => w.facility_id === id)
        .sort((a, b) => b.observed_at.localeCompare(a.observed_at))
        .slice(0, 1),
    );
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {}
}
