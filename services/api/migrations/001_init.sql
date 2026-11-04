-- DrayVision initial schema. Applied automatically by the local Postgres container
-- (docker-entrypoint-initdb.d) and by `npm run migrate` elsewhere. Idempotent.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- Provenance is mandatory on every safety-relevant record.
CREATE TABLE IF NOT EXISTS facilities (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  kind            text NOT NULL,
  geom            geography(Point, 4326) NOT NULL,
  address         text,
  external_ids    jsonb NOT NULL DEFAULT '{}'::jsonb,
  requires_twic   boolean NOT NULL DEFAULT false,
  provenance      jsonb NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_geom_idx ON facilities USING gist (geom);
CREATE INDEX IF NOT EXISTS facilities_kind_idx ON facilities (kind);

CREATE TABLE IF NOT EXISTS truck_entrances (
  id           text PRIMARY KEY,
  facility_id  text NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  geom         geography(Point, 4326) NOT NULL,
  label        text NOT NULL,
  hours        text,
  notes        text,
  provenance   jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS restrictions (
  id              text PRIMARY KEY,
  kind            text NOT NULL,
  severity        text NOT NULL,
  geom            geography(Point, 4326) NOT NULL,
  limit_value     double precision,
  description     text NOT NULL,
  dataset_version text NOT NULL,
  provenance      jsonb NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restrictions_geom_idx ON restrictions USING gist (geom);

CREATE TABLE IF NOT EXISTS contributions (
  id            bigserial PRIMARY KEY,
  device_id     text NOT NULL,
  facility_id   text REFERENCES facilities(id) ON DELETE SET NULL,
  kind          text NOT NULL,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sponsored_listings (
  id           text PRIMARY KEY,
  facility_id  text REFERENCES facilities(id) ON DELETE SET NULL,
  title        text NOT NULL,
  geom         geography(Point, 4326) NOT NULL,
  active_from  timestamptz NOT NULL,
  active_to    timestamptz NOT NULL,
  CHECK (active_to > active_from)
);
CREATE INDEX IF NOT EXISTS sponsored_geom_idx ON sponsored_listings USING gist (geom);

CREATE TABLE IF NOT EXISTS wait_time_observations (
  id            bigserial PRIMARY KEY,
  facility_id   text NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  observed_at   timestamptz NOT NULL,
  wait_minutes  integer NOT NULL CHECK (wait_minutes >= 0),
  source        text NOT NULL
);
CREATE INDEX IF NOT EXISTS wait_time_facility_time_idx ON wait_time_observations (facility_id, observed_at DESC);

-- Phase 13: persisted metering so cost actuals survive restarts.
CREATE TABLE IF NOT EXISTS metered_calls (
  month       text NOT NULL,
  provider    text NOT NULL,
  calls       bigint NOT NULL DEFAULT 0,
  cache_hits  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (month, provider)
);

INSERT INTO schema_migrations (version) VALUES ('001_init') ON CONFLICT DO NOTHING;
