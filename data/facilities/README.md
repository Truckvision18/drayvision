# Facilities (Phase 9/10)

Seed records for port terminals, rail ramps, warehouses and their **truck entrances** (which are
often not the street address). Format: `{ "records": Facility[] }` (`FacilitySchema` in
`packages/shared`). Routing to a facility goes to its primary truck entrance; a facility with no
entrance on file cannot be routed to at all (no street-address guess).

- Each truck entrance has its own `coords`, `street`, `is_primary` (exactly one per facility) and
  `source`: `OFFICIAL`, `DRIVER_VERIFIED` or `UNVERIFIED`. Verified entrances must record
  `verified_by` and `verified_at`.
- When `DATABASE_URL` is set the API reads facilities from Postgres; otherwise it serves these
  seed files from memory.
- The scaffold ships empty on purpose — no unverified locations.
