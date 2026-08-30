-- Sitting height is no longer part of the personal measurement contract.
-- Do not discard a value that has actually been recorded.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM body_growth.measurement_revisions
    WHERE sitting_height_mm IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'body_growth sitting-height removal stopped: measurement_revisions contains sitting_height_mm values; no changes were made';
  END IF;
END $$;

ALTER TABLE body_growth.measurement_revisions
  DROP COLUMN sitting_height_mm;
