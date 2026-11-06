# Restrictions (Phase 5)

Verified restriction records (low clearances, weight limits, truck prohibitions, parkways…) that
the API's route validation layer checks **every** route against, independently of the routing
engine.

- One JSON file per source batch: `{ "records": Hazard[] }` (`HazardSchema` in `packages/shared`).
  The API validates every record at boot and refuses to start on an invalid one.
- `type` is one of `LOW_CLEARANCE`, `WEIGHT_LIMIT`, `TRUCK_RESTRICTION`, `HAZMAT_RESTRICTION`,
  `UNKNOWN_CLEARANCE`. `value` is SI: metres for clearance / length / width, kilograms for weight.
- Every record carries `source` (kind, name, dataset_version, retrieved_at, rights_id) and a
  `confidence` (0–1). Below `safety.minConfidenceToClear` a record can fail a route but never
  clear one. `resolved: true` retires a record (e.g. bridge replaced).
- Bump `datasetVersion` in `manifest.json` on every change — it is reported by `/health` and
  stamped on every validated route.
- Raw downloads go in `data/raw/` (git-ignored); only normalised, verified records live here.

The scaffold ships with **no records**. Do not add unverified data to this folder.
