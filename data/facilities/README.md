# Facilities (Phase 9/10)

Seed records for port terminals, rail ramps, warehouses and their **truck entrances** (which are
often not the street address). Format: `{ "records": Facility[] }` (see `packages/shared`).

- Truck entrances need their own coordinates and provenance; "field-verified" entrances should
  record who verified them and when.
- When `DATABASE_URL` is set the API reads facilities from Postgres; otherwise it serves these
  seed files from memory.
- The scaffold ships empty on purpose — no unverified locations.
