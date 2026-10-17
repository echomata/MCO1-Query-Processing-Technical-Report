SELECT b.src_file,
       b.status,
       b.src_rows,
       b.loaded_rows,
       b.rejected_rows,
       b.duplicate_rows,
       b.suspicious_rows,
       b.loaded_rows + b.rejected_rows + b.duplicate_rows AS accounted_rows,
       (b.src_rows = b.loaded_rows + b.rejected_rows + b.duplicate_rows) AS equation_ok,
       (SELECT COUNT(*) FROM fact_trip f WHERE f.src_file = b.src_file) AS fact_rows,
       (b.loaded_rows = (SELECT COUNT(*) FROM fact_trip f WHERE f.src_file = b.src_file)) AS load_match
FROM etl_batch_log b
ORDER BY b.src_file;

SELECT reject_reason, COUNT(*) AS rows_rejected
FROM fact_trip_reject
GROUP BY reject_reason
ORDER BY rows_rejected DESC;

SELECT DATE(pickup_datetime) AS reject_day, reject_reason, COUNT(*) AS rows_rejected
FROM fact_trip_reject
WHERE pickup_datetime IS NOT NULL
GROUP BY reject_day, reject_reason
ORDER BY reject_day;

SELECT 'pickup_date' AS fk_check, COUNT(*) AS orphans
  FROM fact_trip f LEFT JOIN dim_date d     ON f.pickup_date_sk = d.date_sk     WHERE d.date_sk IS NULL
UNION ALL SELECT 'dropoff_date', COUNT(*)
  FROM fact_trip f LEFT JOIN dim_date d     ON f.dropoff_date_sk = d.date_sk    WHERE d.date_sk IS NULL
UNION ALL SELECT 'pu_location', COUNT(*)
  FROM fact_trip f LEFT JOIN dim_location l ON f.pu_location_sk = l.location_sk WHERE l.location_sk IS NULL
UNION ALL SELECT 'do_location', COUNT(*)
  FROM fact_trip f LEFT JOIN dim_location l ON f.do_location_sk = l.location_sk WHERE l.location_sk IS NULL
UNION ALL SELECT 'vendor', COUNT(*)
  FROM fact_trip f LEFT JOIN dim_vendor v   ON f.vendor_sk = v.vendor_sk        WHERE v.vendor_sk IS NULL
UNION ALL SELECT 'payment', COUNT(*)
  FROM fact_trip f LEFT JOIN dim_payment p  ON f.payment_sk = p.payment_sk      WHERE p.payment_sk IS NULL
UNION ALL SELECT 'ratecode', COUNT(*)
  FROM fact_trip f LEFT JOIN dim_ratecode r ON f.ratecode_sk = r.ratecode_sk    WHERE r.ratecode_sk IS NULL;

SELECT SUM(f.vendor_sk IS NULL)     AS vendor_null,
       SUM(f.ratecode_sk IS NULL)   AS ratecode_null,
       SUM(f.payment_sk IS NULL)    AS payment_null,
       SUM(f.pu_location_sk IS NULL) AS pu_null,
       SUM(f.do_location_sk IS NULL) AS do_null
FROM fact_trip f;

SELECT MIN(full_date) AS dim_min, MAX(full_date) AS dim_max, COUNT(*) AS dim_days
FROM dim_date;

SELECT MIN(pickup_datetime)  AS min_pickup,
       MAX(pickup_datetime)  AS max_pickup,
       MIN(dropoff_datetime) AS min_dropoff,
       MAX(dropoff_datetime) AS max_dropoff
FROM fact_trip;

SELECT COUNT(*) AS cross_midnight_trips
FROM fact_trip
WHERE DATE(dropoff_datetime) <> DATE(pickup_datetime);

SELECT pickup_datetime, dropoff_datetime, pu_location_sk, do_location_sk,
       fare_amount, total_amount, COUNT(*) AS copies,
       GROUP_CONCAT(DISTINCT src_file ORDER BY src_file) AS batches
FROM fact_trip
GROUP BY pickup_datetime, dropoff_datetime, pu_location_sk, do_location_sk,
         fare_amount, total_amount
HAVING copies > 1
LIMIT 50;

SELECT COUNT(*) AS trips_with_component_mismatch
FROM fact_trip
WHERE ABS(total_amount - (fare_amount + extra + mta_tax + tip_amount
          + tolls_amount + improvement_surcharge
          + COALESCE(congestion_surcharge, 0)
          + COALESCE(airport_fee, 0)
          + COALESCE(cbd_congestion_fee, 0))) > 0.01;

SELECT SUM(duration_min < 0)  AS negative_duration,
       SUM(trip_distance < 0) AS negative_distance,
       SUM(dropoff_datetime < pickup_datetime) AS time_reversed,
       SUM(store_and_fwd_flag IS NOT NULL AND store_and_fwd_flag NOT IN ('Y','N')) AS bad_flag
FROM fact_trip;

SELECT COUNT(*) AS suspicious_in_warehouse
FROM fact_trip
WHERE trip_distance > 500 OR duration_min > 720;

SELECT SUM(suspicious_rows) AS suspicious_in_batch_log
FROM etl_batch_log
WHERE status = 'completed';

SELECT
  (SELECT COUNT(*) FROM dim_vendor   WHERE vendor_sk   = 0)  AS vendor_unknown_member,
  (SELECT COUNT(*) FROM dim_payment  WHERE payment_sk  = -1) AS payment_unknown_member,
  (SELECT COUNT(*) FROM dim_ratecode WHERE ratecode_sk = -1) AS ratecode_unknown_member;

SELECT COUNT(DISTINCT pu_location_sk) AS pickup_zones_used,
       COUNT(DISTINCT do_location_sk) AS dropoff_zones_used
FROM fact_trip;

SELECT COUNT(*) AS dim_zones FROM dim_location;

SELECT COUNT(*) AS unknown_zone_rejections
FROM fact_trip_reject
WHERE reject_reason = 'unknown_zone';

SELECT COUNT(*) AS total_trips,
       ROUND(SUM(total_amount), 2)   AS total_revenue,
       ROUND(AVG(trip_distance), 2)  AS avg_distance_mi,
       ROUND(AVG(duration_min), 1)   AS avg_duration_min
FROM fact_trip;

SELECT src_file, started_at, completed_at,
       TIMESTAMPDIFF(SECOND, started_at, completed_at) AS elapsed_seconds,
       ROUND(src_rows / NULLIF(TIMESTAMPDIFF(SECOND, started_at, completed_at), 0)) AS rows_per_second
FROM etl_batch_log
WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL
ORDER BY src_file;
