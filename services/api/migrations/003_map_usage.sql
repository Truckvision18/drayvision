-- 003: map usage analytics — sessions / requests per user (device) per day, from day one.

-- Per day / tile source / resource kind (what the provider counts and bills).
CREATE TABLE IF NOT EXISTS map_usage_daily (
  day               date NOT NULL,
  source            text NOT NULL,
  kind              text NOT NULL,
  proxy_requests    bigint NOT NULL DEFAULT 0,
  upstream_requests bigint NOT NULL DEFAULT 0,
  revalidations     bigint NOT NULL DEFAULT 0,
  billable_requests double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source, kind)
);

-- Per day / device (and account when known) / tile source.
CREATE TABLE IF NOT EXISTS map_usage_device_daily (
  day               date NOT NULL,
  device_id         text NOT NULL,
  source            text NOT NULL,
  account_id        text,
  sessions          bigint NOT NULL DEFAULT 0,
  proxy_requests    bigint NOT NULL DEFAULT 0,
  billable_requests double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (day, device_id, source)
);
CREATE INDEX IF NOT EXISTS map_usage_device_daily_account_idx ON map_usage_device_daily (account_id, day);

-- Every reported map session, so re-sent reports are counted once.
CREATE TABLE IF NOT EXISTS map_sessions (
  session_id  text PRIMARY KEY,
  device_id   text NOT NULL,
  account_id  text,
  source      text NOT NULL,
  view        text NOT NULL,
  started_at  timestamptz NOT NULL,
  day         date NOT NULL
);
CREATE INDEX IF NOT EXISTS map_sessions_day_idx ON map_sessions (day);

INSERT INTO schema_migrations (version) VALUES ('003_map_usage') ON CONFLICT DO NOTHING;
