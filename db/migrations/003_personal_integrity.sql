ALTER TABLE body_growth.profiles
  ADD COLUMN birth_date_source text NOT NULL DEFAULT 'SELF_REPORTED'
  CHECK(birth_date_source IN('SELF_REPORTED'));

CREATE UNIQUE INDEX accounts_username_lower_unique_idx
  ON body_growth.accounts (lower(username));

CREATE OR REPLACE FUNCTION body_growth.validate_account_profile_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  checked_account_id uuid;
  account_role text;
  profile_count integer;
BEGIN
  checked_account_id := CASE
    WHEN TG_TABLE_NAME = 'profiles' THEN COALESCE(NEW.account_id, OLD.account_id)
    ELSE COALESCE(NEW.id, OLD.id)
  END;
  SELECT role INTO account_role FROM body_growth.accounts WHERE id=checked_account_id;
  IF account_role IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT count(*)::integer INTO profile_count
    FROM body_growth.profiles WHERE account_id=checked_account_id;
  IF account_role = 'ADMIN' AND profile_count <> 0 THEN
    RAISE EXCEPTION 'ADMIN accounts cannot have a profile';
  END IF;
  IF account_role = 'USER' AND profile_count <> 1 THEN
    RAISE EXCEPTION 'USER accounts require exactly one profile';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER account_profile_consistency_accounts
AFTER INSERT OR UPDATE OF role ON body_growth.accounts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION body_growth.validate_account_profile_consistency();
CREATE CONSTRAINT TRIGGER account_profile_consistency_profiles
AFTER INSERT OR UPDATE OF account_id OR DELETE ON body_growth.profiles
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION body_growth.validate_account_profile_consistency();

CREATE OR REPLACE FUNCTION body_growth.reject_measurement_restore() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='VOIDED' AND NEW.status='ACTIVE' THEN
    RAISE EXCEPTION 'voided measurements cannot be restored';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER measurement_restore_rejected
BEFORE UPDATE OF status ON body_growth.measurements
FOR EACH ROW EXECUTE FUNCTION body_growth.reject_measurement_restore();