-- This migration is intentionally valid only while the original model is empty.
-- It replaces the unused organization/role model with the personal-use model.
DO $$
DECLARE
  has_data boolean;
BEGIN
  SELECT
    EXISTS (SELECT 1 FROM body_growth.organizations) OR
    EXISTS (SELECT 1 FROM body_growth.accounts) OR
    EXISTS (SELECT 1 FROM body_growth.memberships) OR
    EXISTS (SELECT 1 FROM body_growth.athletes) OR
    EXISTS (SELECT 1 FROM body_growth.athlete_accounts) OR
    EXISTS (SELECT 1 FROM body_growth.guardian_relations) OR
    EXISTS (SELECT 1 FROM body_growth.coach_assignments) OR
    EXISTS (SELECT 1 FROM body_growth.sessions) OR
    EXISTS (SELECT 1 FROM body_growth.invitations) OR
    EXISTS (SELECT 1 FROM body_growth.password_resets) OR
    EXISTS (SELECT 1 FROM body_growth.measurements) OR
    EXISTS (SELECT 1 FROM body_growth.measurement_revisions) OR
    EXISTS (SELECT 1 FROM body_growth.audit_events) OR
    EXISTS (SELECT 1 FROM body_growth.idempotency_keys) OR
    EXISTS (SELECT 1 FROM body_growth.rate_limits)
  INTO has_data;
  IF has_data THEN
    RAISE EXCEPTION 'body_growth personal-account migration requires an empty database';
  END IF;
END $$;

DROP TABLE IF EXISTS body_growth.idempotency_keys CASCADE;
DROP TABLE IF EXISTS body_growth.audit_events CASCADE;
DROP TABLE IF EXISTS body_growth.measurement_revisions CASCADE;
DROP TABLE IF EXISTS body_growth.measurements CASCADE;
DROP TABLE IF EXISTS body_growth.rate_limits CASCADE;
DROP TABLE IF EXISTS body_growth.password_resets CASCADE;
DROP TABLE IF EXISTS body_growth.invitations CASCADE;
DROP TABLE IF EXISTS body_growth.sessions CASCADE;
DROP TABLE IF EXISTS body_growth.coach_assignments CASCADE;
DROP TABLE IF EXISTS body_growth.guardian_relations CASCADE;
DROP TABLE IF EXISTS body_growth.athlete_accounts CASCADE;
DROP TABLE IF EXISTS body_growth.athletes CASCADE;
DROP TABLE IF EXISTS body_growth.memberships CASCADE;
DROP TABLE IF EXISTS body_growth.accounts CASCADE;
DROP TABLE IF EXISTS body_growth.organizations CASCADE;
DROP FUNCTION IF EXISTS body_growth.reject_append_only_change() CASCADE;

CREATE TABLE body_growth.accounts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'USER' CHECK(role IN('USER','ADMIN')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','SUSPENDED')),
  password_change_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX body_growth_one_admin_idx ON body_growth.accounts(role) WHERE role='ADMIN';

CREATE TABLE body_growth.profiles(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES body_growth.accounts(id),
  display_name text NOT NULL,
  birth_date date NOT NULL,
  formula_sex text NOT NULL CHECK(formula_sex IN('female','male')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE body_growth.sessions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES body_growth.accounts(id),
  token_digest text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE body_growth.measurements(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES body_growth.profiles(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','VOIDED')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by_account_id uuid NOT NULL REFERENCES body_growth.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by_account_id uuid REFERENCES body_growth.accounts(id),
  restored_at timestamptz,
  restored_by_account_id uuid REFERENCES body_growth.accounts(id)
);
CREATE TABLE body_growth.measurement_revisions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id uuid NOT NULL REFERENCES body_growth.measurements(id),
  version integer NOT NULL CHECK(version>0),
  measured_on date NOT NULL,
  standing_height_mm integer NOT NULL CHECK(standing_height_mm BETWEEN 500 AND 2500),
  sitting_height_mm integer CHECK(sitting_height_mm BETWEEN 300 AND 2000),
  weight_g integer CHECK(weight_g BETWEEN 1000 AND 300000),
  formula_id text NOT NULL,
  implementation_hash text NOT NULL,
  parameter_hash text NOT NULL,
  correction_reason text,
  created_by_account_id uuid NOT NULL REFERENCES body_growth.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(measurement_id,version)
);

CREATE TABLE body_growth.audit_events(
  id bigserial PRIMARY KEY,
  actor_account_id uuid REFERENCES body_growth.accounts(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE body_growth.idempotency_keys(
  account_id uuid NOT NULL REFERENCES body_growth.accounts(id),
  operation text NOT NULL,
  key_digest text NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,operation,key_digest)
);
CREATE TABLE body_growth.rate_limits(
  action text NOT NULL,
  subject_digest text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL,
  PRIMARY KEY(action,subject_digest)
);

CREATE FUNCTION body_growth.reject_append_only_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER measurement_revisions_append_only BEFORE UPDATE OR DELETE ON body_growth.measurement_revisions
FOR EACH ROW EXECUTE FUNCTION body_growth.reject_append_only_change();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON body_growth.audit_events
FOR EACH ROW EXECUTE FUNCTION body_growth.reject_append_only_change();

CREATE INDEX sessions_active_token_idx ON body_growth.sessions(token_digest,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX measurements_profile_idx ON body_growth.measurements(profile_id,status);
CREATE INDEX revisions_measurement_version_idx ON body_growth.measurement_revisions(measurement_id,version DESC);