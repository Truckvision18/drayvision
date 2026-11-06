-- 002: truck profiles (per account, versioned) and the shared-schema shapes for facilities,
-- truck entrances and restrictions. Written to be safe to re-run.

-- ---- Truck profiles ------------------------------------------------------------------------
-- `data` holds the editable fields (dimensions, hazmat, transponders, home terminal) as jsonb;
-- the API validates every read against @drayvision/shared's TruckProfileSchema.
CREATE TABLE IF NOT EXISTS truck_profiles (
  id          text PRIMARY KEY,
  account_id  text NOT NULL,
  version     integer NOT NULL CHECK (version >= 1),
  is_default  boolean NOT NULL DEFAULT false,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS truck_profiles_account_idx ON truck_profiles (account_id) WHERE deleted_at IS NULL;
-- At most one default per account (among live profiles).
CREATE UNIQUE INDEX IF NOT EXISTS truck_profiles_one_default ON truck_profiles (account_id) WHERE is_default AND deleted_at IS NULL;

-- Immutable snapshot of every version, so a route can always show the exact profile it used.
CREATE TABLE IF NOT EXISTS truck_profile_versions (
  profile_id  text NOT NULL REFERENCES truck_profiles(id),
  account_id  text NOT NULL,
  version     integer NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (profile_id, version)
);

-- ---- Facilities → shared FacilitySchema ----------------------------------------------------
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS street_address text;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS verification_state text NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS receiving_office jsonb;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS staging_area jsonb;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS docks jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS notes jsonb NOT NULL DEFAULT '[]'::jsonb;
-- A facility's map position comes from its truck entrances; the old point column is optional.
ALTER TABLE facilities ALTER COLUMN geom DROP NOT NULL;
ALTER TABLE facilities DROP COLUMN IF EXISTS address;
ALTER TABLE facilities DROP COLUMN IF EXISTS provenance;
-- Pre-pilot: no rows exist yet, so the column can be made mandatory directly.
UPDATE facilities SET street_address = '' WHERE street_address IS NULL;
ALTER TABLE facilities ALTER COLUMN street_address SET NOT NULL;

ALTER TABLE truck_entrances ADD COLUMN IF NOT EXISTS street text;
ALTER TABLE truck_entrances ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;
ALTER TABLE truck_entrances ADD COLUMN IF NOT EXISTS verified_by text;
ALTER TABLE truck_entrances ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE truck_entrances ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE truck_entrances DROP COLUMN IF EXISTS label;
ALTER TABLE truck_entrances DROP COLUMN IF EXISTS hours;
ALTER TABLE truck_entrances DROP COLUMN IF EXISTS provenance;
UPDATE truck_entrances SET street = '' WHERE street IS NULL;
ALTER TABLE truck_entrances ALTER COLUMN street SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS truck_entrances_one_primary ON truck_entrances (facility_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS truck_entrances_geom_idx ON truck_entrances USING gist (geom);

-- ---- Restrictions → shared HazardSchema ----------------------------------------------------
ALTER TABLE restrictions ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE restrictions ADD COLUMN IF NOT EXISTS value double precision;
ALTER TABLE restrictions ADD COLUMN IF NOT EXISTS restriction text;
ALTER TABLE restrictions ADD COLUMN IF NOT EXISTS hazmat_classes integer[] NOT NULL DEFAULT '{}';
ALTER TABLE restrictions ADD COLUMN IF NOT EXISTS source jsonb;
ALTER TABLE restrictions ADD COLUMN IF NOT EXISTS confidence double precision;
ALTER TABLE restrictions ADD COLUMN IF NOT EXISTS resolved boolean NOT NULL DEFAULT false;
ALTER TABLE restrictions DROP COLUMN IF EXISTS kind;
ALTER TABLE restrictions DROP COLUMN IF EXISTS severity;
ALTER TABLE restrictions DROP COLUMN IF EXISTS limit_value;
ALTER TABLE restrictions DROP COLUMN IF EXISTS provenance;

INSERT INTO schema_migrations (version) VALUES ('002_truck_profiles') ON CONFLICT DO NOTHING;
