# Restrictions (Phase 5)

Verified restriction records (low clearances, weight limits, truck prohibitions, parkways…) that
the API's route validation layer checks **every** route against, independently of the routing
engine.

- One JSON file per source batch: `{ "records": Hazard[] }` (type `Hazard` in `packages/shared`).
- Units are SI: `limit` is metres for clearance/length/width, kilograms for weight.
- Every record **must** carry `provenance` (source, sourceVersion, retrievedAt, rightsId) and,
  before it is trusted in pilot, `verifiedBy` + `verifiedAt`.
- Bump `datasetVersion` in `manifest.json` on every change — it is reported by `/health` and
  stamped on every validated route.
- Raw downloads go in `data/raw/` (git-ignored); only normalised, verified records live here.

The scaffold ships with **no records**. Do not add unverified data to this folder.
