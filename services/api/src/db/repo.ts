import type { Facility, SponsoredListing, WaitTimeObservation } from '@drayvision/shared';
import type { BBox } from '../providers/types.js';

export interface Repository {
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
    return this.seedFacilities.filter((f) => inBBox(f.location.lng, f.location.lat, bbox));
  }

  async facility(id: string): Promise<Facility | null> {
    return this.seedFacilities.find((f) => f.id === id) ?? null;
  }

  async sponsored(bbox: BBox | null, at: Date): Promise<SponsoredListing[]> {
    const t = at.toISOString();
    return this.seedSponsored.filter((s) => s.activeFrom <= t && s.activeTo > t && inBBox(s.location.lng, s.location.lat, bbox));
  }

  async latestWaitTimes(ids: string[]): Promise<WaitTimeObservation[]> {
    return ids.flatMap((id) =>
      this.seedWaits
        .filter((w) => w.facilityId === id)
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
        .slice(0, 1),
    );
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {}
}
