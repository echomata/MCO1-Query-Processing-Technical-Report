-- OLAP functional validation - MySQL 8.0+
--
-- HOW TO USE IN MYSQL WORKBENCH
-- 1. Connect to the SAME server and schema used by app/server/.env.
-- 2. Run SETUP once in this SQL tab/connection.
-- 3. Set the website controls exactly as described above a test below.
-- 4. Highlight and execute ONLY that test's complete WITH ... SELECT statement.
--    Do not execute the whole file at once: each test scans warehouse data.
-- 5. Compare the website rows/Total with the matching Result Grid rows.
--
-- These are independent reference queries, not copies of the generated API SQL.
-- They use ordinary GROUP BY and separate totals instead of WITH ROLLUP,
-- conditional-aggregation pivots, or analytic window functions. Time/day type
-- come from pickup_datetime to independently check the app's dim_date mapping.
--
-- OLAP01..OLAP05 below are validation IDs, NOT IDs from the assignment specs.
-- This file reads warehouse data. USE/SET only configure this SQL connection.
-- It does not create tables, change indexes, or modify warehouse records.
--
-- COMPARISON RULES
-- * Trips must match exactly. Match rows by their member labels, not position.
-- * Revenue = SUM(total_amount), including refunds/negative amounts.
-- * Average fare = SUM(fare_amount) / COUNT(*), NOT revenue / count and NOT an
--   unweighted average of subgroup averages. No extra cleaning is applied.
-- * SQL averages/shares below are unrounded. Compare currency at 2 decimal places
--   and percentages at 1 decimal place, as displayed on the website. If rounding
--   differs at a half-cent, compare the unrounded API value in the response.
-- * Empty selections have 0 trips/revenue and 0 summary average fare in the app.
-- * A passed query alone is not a passed test: record Pass only AFTER comparison.
-- * This validates the configured cases; repeat with other filters for coverage.

-- SETUP ---------------------------------------------------------------
-- Change USE if your local schema has another name.
USE nyc_yellow_taxi_2025;
-- Match session strings to the warehouse collation for drill-path comparisons.
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Website: From month January, To month January (2025).
-- Exclusive end: January ends at 2025-02-01 00:00:00, which is NOT included.
-- To test Jan-Mar, change @end_date to '2025-04-01' AND To month to March.
-- Keep both bounds at month starts, within the website's fixed 2025 year.
SET @start_date = '2025-01-01';
SET @end_date = '2025-02-01';

-- Drill paths. Run the corresponding SET again when changing a drill level.
SET @time_depth = 2;       -- 0=year, 1=quarter, 2=month, 3=day
SET @drill_year = 2025;
SET @drill_quarter = 1;
SET @drill_month = 1;
SET @location_depth = 0;   -- 0=borough, 1=service zone, 2=taxi zone
SET @drill_borough = 'Queens';
SET @drill_service_zone = 'Boro Zone';

-- Confirm this is the intended MySQL instance/schema before collecting evidence.
SELECT DATABASE() AS database_name, @@hostname AS mysql_host,
       @@port AS mysql_port, VERSION() AS mysql_version;
-- Website mapping: 1=Credit card, 2=Cash, every other payment_sk=Other / unknown.
SELECT payment_sk, payment_desc FROM dim_payment ORDER BY payment_sk;


-- OLAP01 - TIME ROLL-UP / SUBTOTALS -------------------------------------
-- Website: OLAP Explorer > Subtotals > Time.
-- Hierarchy depth: Year > Quarter > Month.
-- Months: match SETUP; Day type: All days; untick ALL borough/payment boxes.
-- Compare every month, quarter subtotal, year subtotal, and Grand total.
-- The year/grand total covers ONLY the selected months, not necessarily all 2025.
-- Start with January; repeat Jan-Mar to check aggregation across multiple months.
-- Also compare Share of parent and Share of total where present.
WITH months AS (
    SELECT YEAR(f.pickup_datetime) AS pickup_year,
           QUARTER(f.pickup_datetime) AS pickup_quarter,
           MONTH(f.pickup_datetime) AS pickup_month,
           COUNT(*) AS trips,
           SUM(f.total_amount) AS revenue,
           SUM(f.fare_amount) AS fare_sum
    FROM fact_trip f
    WHERE f.pickup_datetime >= @start_date AND f.pickup_datetime < @end_date
    GROUP BY YEAR(f.pickup_datetime), QUARTER(f.pickup_datetime), MONTH(f.pickup_datetime)
), quarters AS (
    SELECT pickup_year, pickup_quarter,
           SUM(trips) AS trips, SUM(revenue) AS revenue, SUM(fare_sum) AS fare_sum
    FROM months GROUP BY pickup_year, pickup_quarter
), years AS (
    SELECT pickup_year, SUM(trips) AS trips,
           SUM(revenue) AS revenue, SUM(fare_sum) AS fare_sum
    FROM months GROUP BY pickup_year
), grand AS (
    SELECT COALESCE(SUM(trips), 0) AS trips,
           COALESCE(SUM(revenue), 0) AS revenue,
           COALESCE(SUM(fare_sum), 0) AS fare_sum
    FROM months
), reference_rows AS (
    SELECT 'Month detail' AS row_type, m.pickup_year, m.pickup_quarter, m.pickup_month,
           m.trips, m.revenue, m.fare_sum,
           q.trips AS parent_trips, g.trips AS grand_trips, 1 AS row_order
    FROM months m JOIN quarters q
      ON q.pickup_year = m.pickup_year AND q.pickup_quarter = m.pickup_quarter
    CROSS JOIN grand g
    UNION ALL
    SELECT 'Quarter subtotal', q.pickup_year, q.pickup_quarter, NULL,
           q.trips, q.revenue, q.fare_sum, y.trips, g.trips, 2
    FROM quarters q JOIN years y ON y.pickup_year = q.pickup_year CROSS JOIN grand g
    UNION ALL
    SELECT 'Year subtotal', y.pickup_year, NULL, NULL,
           y.trips, y.revenue, y.fare_sum, g.trips, g.trips, 3
    FROM years y CROSS JOIN grand g
    UNION ALL
    SELECT 'Grand total', NULL, NULL, NULL, trips, revenue, fare_sum, NULL, trips, 4
    FROM grand
)
SELECT row_type, pickup_year, pickup_quarter, pickup_month, trips, revenue,
       COALESCE(fare_sum / NULLIF(trips, 0), 0) AS average_fare,
       100.0 * trips / NULLIF(parent_trips, 0) AS share_of_parent_pct,
       COALESCE(100.0 * trips / NULLIF(grand_trips, 0), 0) AS share_of_total_pct
FROM reference_rows ORDER BY row_order, pickup_year, pickup_quarter, pickup_month;


-- OLAP02A - TIME DRILL-DOWN AND ROLL-UP ---------------------------------
-- Website: Drill-down / roll-up > Time; start at All time.
-- Months: match SETUP; Day type: All days; untick ALL borough/payment boxes.
-- Run this query at each level, changing ONLY the applicable SET variables:
--   @time_depth=0: All time (year rows).
--   @time_depth=1: click 2025 (quarter rows).
--   @time_depth=2: click Q1 (month rows).
--   @time_depth=3: click January (day rows).
-- @drill_year/@drill_quarter/@drill_month must match your clicked path.
-- Then click Roll up and compare the previous level again.
-- Compare Trips, Revenue, Avg. fare, Trip share, Rank, vs. previous, Cumulative.
-- 'Total' below matches the website footer. First member has NULL growth.
WITH members AS (
    SELECT CASE @time_depth
               WHEN 0 THEN YEAR(f.pickup_datetime)
               WHEN 1 THEN QUARTER(f.pickup_datetime)
               WHEN 2 THEN MONTH(f.pickup_datetime)
               ELSE DAY(f.pickup_datetime)
           END AS member_order,
           CASE @time_depth
               WHEN 0 THEN CAST(YEAR(f.pickup_datetime) AS CHAR)
               WHEN 1 THEN CONCAT('Q', QUARTER(f.pickup_datetime))
               WHEN 2 THEN DATE_FORMAT(f.pickup_datetime, '%M')
               ELSE DATE_FORMAT(f.pickup_datetime, '%Y-%m-%d')
           END AS member,
           COUNT(*) AS trips, SUM(f.total_amount) AS revenue,
           SUM(f.fare_amount) AS fare_sum
    FROM fact_trip f
    WHERE f.pickup_datetime >= @start_date AND f.pickup_datetime < @end_date
      AND (@time_depth < 1 OR YEAR(f.pickup_datetime) = @drill_year)
      AND (@time_depth < 2 OR QUARTER(f.pickup_datetime) = @drill_quarter)
      AND (@time_depth < 3 OR MONTH(f.pickup_datetime) = @drill_month)
    GROUP BY member_order, member
), totals AS (
    SELECT COALESCE(SUM(trips), 0) AS trips, COALESCE(SUM(revenue), 0) AS revenue,
           COALESCE(SUM(fare_sum), 0) AS fare_sum FROM members
), with_previous AS (
    SELECT a.*,
           (SELECT p.trips FROM members p WHERE p.member_order < a.member_order
            ORDER BY p.member_order DESC LIMIT 1) AS previous_trips
    FROM members a
), reference_rows AS (
SELECT a.member, a.trips, a.revenue, a.fare_sum / a.trips AS average_fare,
       100.0 * a.trips / NULLIF(t.trips, 0) AS trip_share_pct,
       1 + (SELECT COUNT(*) FROM members r WHERE r.trips > a.trips) AS trip_rank,
       100.0 * (a.trips - a.previous_trips) / NULLIF(a.previous_trips, 0) AS growth_pct,
       100.0 * (SELECT SUM(c.trips) FROM members c WHERE c.member_order <= a.member_order)
           / NULLIF(t.trips, 0) AS cumulative_share_pct,
       a.member_order, 0 AS is_total
FROM with_previous a CROSS JOIN totals t
UNION ALL
SELECT 'Total', trips, revenue, COALESCE(fare_sum / NULLIF(trips, 0), 0),
       NULL, NULL, NULL, NULL, NULL, 1 FROM totals
)
SELECT member, trips, revenue, average_fare, trip_share_pct, trip_rank,
       growth_pct, cumulative_share_pct
FROM reference_rows ORDER BY is_total, member_order;


-- OLAP02B - PICKUP-LOCATION DRILL-DOWN AND ROLL-UP -----------------------
-- Website: Drill-down / roll-up > Pickup location; start at All pickup location.
-- Months: match SETUP; Day type: All days; untick ALL borough/payment boxes.
--   @location_depth=0: All pickup location (borough rows).
--   @location_depth=1: click Queens (service-zone rows).
--   @location_depth=2: click Boro Zone (taxi-zone rows).
-- @drill_borough/@drill_service_zone must match your clicked path.
-- Roll up and compare the parent level again.
-- This checks the CURRENT application's hierarchy. It asserts no PDF requirement.
-- Taxi zones are grouped by zone NAME, as in the website; names can repeat across
-- location IDs (e.g. Corona), so do not compare against one ID's count alone.
WITH members AS (
    SELECT CASE @location_depth
               WHEN 0 THEN l.borough
               WHEN 1 THEN l.service_zone
               ELSE l.zone
           END AS member,
           COUNT(*) AS trips, SUM(f.total_amount) AS revenue,
           SUM(f.fare_amount) AS fare_sum
    FROM fact_trip f JOIN dim_location l ON l.location_sk = f.pu_location_sk
    WHERE f.pickup_datetime >= @start_date AND f.pickup_datetime < @end_date
      AND (@location_depth < 1 OR l.borough = @drill_borough)
      AND (@location_depth < 2 OR l.service_zone = @drill_service_zone)
    GROUP BY member
), totals AS (
    SELECT COALESCE(SUM(trips), 0) AS trips, COALESCE(SUM(revenue), 0) AS revenue,
           COALESCE(SUM(fare_sum), 0) AS fare_sum FROM members
)
SELECT a.member, a.trips, a.revenue, a.fare_sum / a.trips AS average_fare,
       100.0 * a.trips / NULLIF(t.trips, 0) AS trip_share_pct,
       1 + (SELECT COUNT(*) FROM members r WHERE r.trips > a.trips) AS trip_rank,
       100.0 * (SELECT SUM(c.trips) FROM members c
                WHERE c.trips > a.trips OR (c.trips = a.trips AND c.member <= a.member))
           / NULLIF(t.trips, 0) AS cumulative_share_pct,
       0 AS is_total
FROM members a CROSS JOIN totals t
UNION ALL
SELECT 'Total', trips, revenue, COALESCE(fare_sum / NULLIF(trips, 0), 0),
       NULL, NULL, NULL, 1 FROM totals
ORDER BY is_total, trips DESC, member;


-- OLAP03 - SLICE (ONE MONTH FIXED) --------------------------------------
-- Website: Drill-down / roll-up > Time > All time.
-- From month: January; To month: January; Day type: All days.
-- Untick ALL borough/payment boxes, then Apply.
-- Badge should say Slice (only time is fixed to one month).
-- Compare the 2025 row AND Total footer with this one result row.
-- Literal dates intentionally keep this case fixed even if SETUP was changed.
SELECT COUNT(*) AS trips,
       COALESCE(SUM(f.total_amount), 0) AS revenue,
       COALESCE(AVG(f.fare_amount), 0) AS average_fare
FROM fact_trip f
WHERE f.pickup_datetime >= '2025-01-01'
  AND f.pickup_datetime < '2025-02-01';


-- OLAP04 - DICE (MULTIPLE FILTERS TOGETHER) ------------------------------
-- Website: Drill-down / roll-up > Time > All time.
-- From month: January; To month: January; Day type: Weekend.
-- Check ONLY Queens and Manhattan; payment: ONLY Credit card; then Apply.
-- Badge should say Dice. Compare 2025 row AND Total footer with this result.
-- WEEKDAY(): Monday=0, Saturday=5, Sunday=6. This independently checks is_weekend.
SELECT COUNT(*) AS trips,
       COALESCE(SUM(f.total_amount), 0) AS revenue,
       COALESCE(AVG(f.fare_amount), 0) AS average_fare
FROM fact_trip f JOIN dim_location l ON l.location_sk = f.pu_location_sk
WHERE f.pickup_datetime >= '2025-01-01'
  AND f.pickup_datetime < '2025-02-01'
  AND l.borough IN ('Queens', 'Manhattan')
  AND f.payment_sk = 1
  AND WEEKDAY(f.pickup_datetime) IN (5, 6);


-- OLAP05 - PAYMENT-BY-MONTH PIVOT ---------------------------------------
-- Website: Pivot; Rows: Payment method; Columns: Month.
-- Months: match SETUP; Day type: All days; untick ALL borough/payment boxes.
-- Change Measure through Trips, Revenue, Average fare and compare each.
-- The reference is a LONG list of (payment, month) cells, not a pivot itself.
--   Cell: match payment row + month column.
--   Payment total: match the rightmost Total column for that payment row.
--   Month total: match the bottom Total row for that month column.
--   Grand total: match the bottom-right Total.
-- Missing cell: website shows 0 for trips/revenue, a dash for average fare.
-- Missing payment entirely: website omits that payment row.
-- Average-fare totals are weighted by individual trips, not sums/means of cells.
-- Repeat Jan-Mar (change SETUP end date AND website To month) to check rotation
-- across several columns; January is a convenient first check.
WITH cells AS (
    SELECT CASE WHEN f.payment_sk = 1 THEN 'Credit card'
                WHEN f.payment_sk = 2 THEN 'Cash'
                ELSE 'Other / unknown' END AS payment_method,
           MONTH(f.pickup_datetime) AS pickup_month,
           COUNT(*) AS trips, SUM(f.total_amount) AS revenue,
           SUM(f.fare_amount) AS fare_sum
    FROM fact_trip f
    WHERE f.pickup_datetime >= @start_date AND f.pickup_datetime < @end_date
    GROUP BY payment_method, MONTH(f.pickup_datetime)
), reference_rows AS (
    SELECT 'Cell' AS row_type, payment_method, pickup_month,
           trips, revenue, fare_sum, 1 AS row_order FROM cells
    UNION ALL
    SELECT 'Payment total', payment_method, NULL,
           SUM(trips), SUM(revenue), SUM(fare_sum), 2
    FROM cells GROUP BY payment_method
    UNION ALL
    SELECT 'Month total', 'All payments', pickup_month,
           SUM(trips), SUM(revenue), SUM(fare_sum), 3
    FROM cells GROUP BY pickup_month
    UNION ALL
    SELECT 'Grand total', 'All payments', NULL,
           COALESCE(SUM(trips), 0), COALESCE(SUM(revenue), 0),
           COALESCE(SUM(fare_sum), 0), 4 FROM cells
)
SELECT row_type, payment_method, pickup_month, trips, revenue,
       fare_sum / NULLIF(trips, 0) AS average_fare
FROM reference_rows ORDER BY row_order, payment_method, pickup_month;

-- RECORDING EVIDENCE ---------------------------------------------------
-- Save matching Workbench and website results for each tested operation.
-- Record months, other filters, hierarchy path/depth or pivot dimensions/measure,
-- actual values, comparison outcome, and screenshot reference in your report.
-- A successful API response or source='warehouse' alone does not prove correctness.
