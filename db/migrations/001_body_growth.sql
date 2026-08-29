CREATE SCHEMA IF NOT EXISTS body_growth;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS body_growth.organizations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS body_growth.accounts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
  display_name text NOT NULL, password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS body_growth.memberships(
  organization_id uuid NOT NULL REFERENCES body_growth.organizations(id),
  account_id uuid NOT NULL REFERENCES body_growth.accounts(id),
  role text NOT NULL CHECK(role IN('ATHLETE','GUARDIAN','COACH','ADMIN')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,account_id,role)
);
CREATE TABLE IF NOT EXISTS body_growth.athletes(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES body_growth.organizations(id),
  display_name text NOT NULL, birth_date date, birth_date_verified boolean NOT NULL DEFAULT false,
  formula_sex text CHECK(formula_sex IN('female','male')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS body_growth.athlete_accounts(
  organization_id uuid NOT NULL REFERENCES body_growth.organizations(id),
  athlete_id uuid NOT NULL REFERENCES body_growth.athletes(id),
  account_id uuid NOT NULL REFERENCES body_growth.accounts(id),
  PRIMARY KEY(athlete_id,account_id)
);
CREATE TABLE IF NOT EXISTS body_growth.guardian_relations(
  organization_id uuid NOT NULL REFERENCES body_growth.organizations(id),
  athlete_id uuid NOT NULL REFERENCES body_growth.athletes(id),
  guardian_account_id uuid NOT NULL REFERENCES body_growth.accounts(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE')),
  PRIMARY KEY(athlete_id,guardian_account_id)
);
CREATE TABLE IF NOT EXISTS body_growth.coach_assignments(
  organization_id uuid NOT NULL REFERENCES body_growth.organizations(id),
  athlete_id uuid NOT NULL REFERENCES body_growth.athletes(id),
  coach_account_id uuid NOT NULL REFERENCES body_growth.accounts(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE')),
  PRIMARY KEY(athlete_id,coach_account_id)
);
CREATE TABLE IF NOT EXISTS body_growth.sessions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES body_growth.accounts(id),
  organization_id uuid REFERENCES body_growth.organizations(id),
  token_digest text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE body_growth.sessions ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES body_growth.organizations(id);
UPDATE body_growth.sessions s SET organization_id=(
  SELECT m.organization_id FROM body_growth.memberships m
  WHERE m.account_id=s.account_id AND m.status='ACTIVE' ORDER BY m.created_at LIMIT 1
) WHERE s.organization_id IS NULL;
ALTER TABLE body_growth.sessions ALTER COLUMN organization_id SET NOT NULL;
CREATE TABLE IF NOT EXISTS body_growth.invitations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES body_growth.organizations(id),
  email text NOT NULL, role text NOT NULL CHECK(role IN('ATHLETE','GUARDIAN','COACH','ADMIN')),
  token_digest text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz,
  invited_by_account_id uuid REFERENCES body_growth.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS body_growth.password_resets(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES body_growth.accounts(id),
  token_digest text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS body_growth.measurements(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES body_growth.organizations(id),
  athlete_id uuid NOT NULL REFERENCES body_growth.athletes(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','VOIDED')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by_account_id uuid NOT NULL REFERENCES body_growth.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz, voided_by_account_id uuid REFERENCES body_growth.accounts(id),
  restored_at timestamptz, restored_by_account_id uuid REFERENCES body_growth.accounts(id)
);
CREATE TABLE IF NOT EXISTS body_growth.measurement_revisions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id uuid NOT NULL REFERENCES body_growth.measurements(id),
  version integer NOT NULL CHECK(version>0), measured_on date NOT NULL,
  standing_height_mm integer NOT NULL CHECK(standing_height_mm BETWEEN 500 AND 2500),
  sitting_height_mm integer CHECK(sitting_height_mm BETWEEN 300 AND 2000),
  weight_g integer CHECK(weight_g BETWEEN 1000 AND 300000),
  formula_id text NOT NULL DEFAULT 'MOORE_2015_HEIGHT_ONLY_MATURITY_OFFSET_V1',
  implementation_hash text NOT NULL DEFAULT '4e74c34b2e7ae1ee8ede32a7cce431836f85e771ab21f9939eaa293fe2a32e54',
  parameter_hash text NOT NULL DEFAULT 'd908f01461b90e7a17a794ab648a23d49b89bf7eb9e485bf29c1f80d3f64c6d2',
  correction_reason text, created_by_account_id uuid NOT NULL REFERENCES body_growth.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(measurement_id,version)
);
ALTER TABLE body_growth.measurement_revisions ADD COLUMN IF NOT EXISTS formula_id text;
ALTER TABLE body_growth.measurement_revisions ADD COLUMN IF NOT EXISTS implementation_hash text;
ALTER TABLE body_growth.measurement_revisions ADD COLUMN IF NOT EXISTS parameter_hash text;
UPDATE body_growth.measurement_revisions SET
  formula_id='MOORE_2015_HEIGHT_ONLY_MATURITY_OFFSET_V1',
  implementation_hash='4e74c34b2e7ae1ee8ede32a7cce431836f85e771ab21f9939eaa293fe2a32e54',
  parameter_hash='d908f01461b90e7a17a794ab648a23d49b89bf7eb9e485bf29c1f80d3f64c6d2'
WHERE formula_id IS NULL OR implementation_hash IS NULL OR parameter_hash IS NULL;
ALTER TABLE body_growth.measurement_revisions ALTER COLUMN formula_id SET NOT NULL;
ALTER TABLE body_growth.measurement_revisions ALTER COLUMN implementation_hash SET NOT NULL;
ALTER TABLE body_growth.measurement_revisions ALTER COLUMN parameter_hash SET NOT NULL;
CREATE TABLE IF NOT EXISTS body_growth.audit_events(
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES body_growth.organizations(id),
  actor_account_id uuid REFERENCES body_growth.accounts(id),
  action text NOT NULL, entity_type text NOT NULL, entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS body_growth.idempotency_keys(
  organization_id uuid NOT NULL REFERENCES body_growth.organizations(id),
  account_id uuid NOT NULL REFERENCES body_growth.accounts(id),
  operation text NOT NULL, key_digest text NOT NULL, response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,account_id,operation,key_digest)
);
CREATE TABLE IF NOT EXISTS body_growth.rate_limits(
  action text NOT NULL, subject_digest text NOT NULL,
  window_started_at timestamptz NOT NULL, attempts integer NOT NULL,
  PRIMARY KEY(action,subject_digest)
);

CREATE OR REPLACE FUNCTION body_growth.reject_append_only_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
DROP TRIGGER IF EXISTS measurement_revisions_append_only ON body_growth.measurement_revisions;
CREATE TRIGGER measurement_revisions_append_only BEFORE UPDATE OR DELETE ON body_growth.measurement_revisions
FOR EACH ROW EXECUTE FUNCTION body_growth.reject_append_only_change();
DROP TRIGGER IF EXISTS audit_events_append_only ON body_growth.audit_events;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON body_growth.audit_events
FOR EACH ROW EXECUTE FUNCTION body_growth.reject_append_only_change();

CREATE INDEX IF NOT EXISTS sessions_active_token_idx ON body_growth.sessions(token_digest,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS measurements_athlete_idx ON body_growth.measurements(athlete_id,status);
CREATE INDEX IF NOT EXISTS revisions_measurement_version_idx ON body_growth.measurement_revisions(measurement_id,version DESC);