import type { Route } from '@drayvision/shared';

/**
 * L-shaped test route near Null Island: depart north ~1112 m, turn right, east ~1112 m, arrive.
 *   (0,0) ──north──▶ (0,0.01) ──east──▶ (0.01,0.01)
 */
export function lRoute(id = 'r1', status: Route['validation']['status'] = 'pass'): Route {
  return {
    id,
    profileId: 'p',
    origin: { lng: 0, lat: 0 },
    destination: { lng: 0.01, lat: 0.01 },
    geometry: [
      [0, 0],
      [0, 0.01],
      [0.01, 0.01],
    ],
    distanceM: 2224,
    durationS: 200,
    legs: [
      {
        distanceM: 2224,
        durationS: 200,
        maneuvers: [
          { instruction: 'Drive north.', type: 'depart', distanceM: 1112, durationS: 100, location: { lng: 0, lat: 0 }, streetNames: [], beginShapeIndex: 0, endShapeIndex: 1 },
          {
            instruction: 'Turn right onto Port St.',
            verbalInstruction: 'Turn right onto Port Street.',
            type: 'right',
            distanceM: 1112,
            durationS: 100,
            location: { lng: 0, lat: 0.01 },
            streetNames: ['Port St'],
            beginShapeIndex: 1,
            endShapeIndex: 2,
          },
          { instruction: 'Arrive.', type: 'arrive', distanceM: 0, durationS: 0, location: { lng: 0.01, lat: 0.01 }, streetNames: [], beginShapeIndex: 2, endShapeIndex: 2 },
        ],
      },
    ],
    hazards: [],
    validation: { status, violations: [], warnings: [], restrictionsVersion: 'rv1', validatedAt: '2026-01-01T00:00:00Z' },
    graphVersion: '2026-11-05',
  };
}

/** Latitude offset for N metres north (≈ 111.2 km per degree). */
export const north = (m: number): number => m / 111_195;
