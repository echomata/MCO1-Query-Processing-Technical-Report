-- Optional dashboard-only covering index for MySQL 8.0+.
-- Run once on the populated warehouse. The opt-in npm installer is idempotent.
-- INVISIBLE keeps it out of ordinary/OLAP optimizer choices; dashboard SELECTs
-- enable it only for their own statement using SET_VAR, never globally.
-- Build needs additional disk space and can take minutes on the full dataset.
USE nyc_yellow_taxi_2025;
SET SESSION lock_wait_timeout = 10;
ALTER TABLE fact_trip
  ADD INDEX idx_dashboard_cover_v1 (
    pickup_datetime, pu_location_sk, payment_sk,
    total_amount, fare_amount, trip_distance, duration_min
  ) INVISIBLE,
  ALGORITHM=INPLACE, LOCK=NONE;
