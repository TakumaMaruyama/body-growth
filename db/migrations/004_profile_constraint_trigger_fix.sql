DROP TRIGGER account_profile_consistency_accounts ON body_growth.accounts;
DROP TRIGGER account_profile_consistency_profiles ON body_growth.profiles;
DROP FUNCTION body_growth.validate_account_profile_consistency();

CREATE FUNCTION body_growth.validate_account_profile_consistency_for(checked_account_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  account_role text;
  profile_count integer;
BEGIN
  SELECT role INTO account_role FROM body_growth.accounts WHERE id=checked_account_id;
  IF account_role IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*)::integer INTO profile_count
    FROM body_growth.profiles WHERE account_id=checked_account_id;
  IF account_role = 'ADMIN' AND profile_count <> 0 THEN
    RAISE EXCEPTION 'ADMIN accounts cannot have a profile';
  END IF;
  IF account_role = 'USER' AND profile_count <> 1 THEN
    RAISE EXCEPTION 'USER accounts require exactly one profile';
  END IF;
END $$;

CREATE FUNCTION body_growth.validate_account_profile_consistency_from_account() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM body_growth.validate_account_profile_consistency_for(NEW.id);
  RETURN NULL;
END $$;

CREATE FUNCTION body_growth.validate_account_profile_consistency_from_profile() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM body_growth.validate_account_profile_consistency_for(
    CASE WHEN TG_OP='DELETE' THEN OLD.account_id ELSE NEW.account_id END
  );
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER account_profile_consistency_accounts
AFTER INSERT OR UPDATE OF role ON body_growth.accounts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION body_growth.validate_account_profile_consistency_from_account();
CREATE CONSTRAINT TRIGGER account_profile_consistency_profiles
AFTER INSERT OR UPDATE OF account_id OR DELETE ON body_growth.profiles
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION body_growth.validate_account_profile_consistency_from_profile();