import argparse
import math
import os
import sys
import time

import pyarrow.parquet as pq
import pymysql

from etl_load import (BASE, COLUMN_ALIASES, EXIT_DATA, EXIT_OK, LoadError,
                      acquire_lock, file_identity, release_lock, resolve_columns)

SRC_COLS = list(COLUMN_ALIASES.keys())
INT_COLS = {"VendorID", "passenger_count", "RatecodeID", "PULocationID",
            "DOLocationID", "payment_type"}

TABLE_DDL = """CREATE TABLE `{table}` (
  `src_row` int unsigned NOT NULL AUTO_INCREMENT,
  `VendorID` int NULL,
  `tpep_pickup_datetime` datetime NULL,
  `tpep_dropoff_datetime` datetime NULL,
  `passenger_count` int NULL,
  `trip_distance` double NULL,
  `RatecodeID` int NULL,
  `store_and_fwd_flag` varchar(1) NULL,
  `PULocationID` int NULL,
  `DOLocationID` int NULL,
  `payment_type` int NULL,
  `fare_amount` double NULL,
  `extra` double NULL,
  `mta_tax` double NULL,
  `tip_amount` double NULL,
  `tolls_amount` double NULL,
  `improvement_surcharge` double NULL,
  `total_amount` double NULL,
  `congestion_surcharge` double NULL,
  `Airport_fee` double NULL,
  `cbd_congestion_fee` double NULL,
  PRIMARY KEY (`src_row`)
) ENGINE=InnoDB"""

LOG_DDL = """CREATE TABLE IF NOT EXISTS `source_load_log` (
  `src_file` varchar(20) NOT NULL,
  `sha256` char(64) NOT NULL,
  `file_bytes` bigint NULL,
  `row_count` bigint NULL,
  `source_path` varchar(255) NULL,
  `status` varchar(12) NOT NULL,
  `started_at` datetime NULL,
  `completed_at` datetime NULL,
  PRIMARY KEY (`src_file`)
) ENGINE=InnoDB"""


def insert_sql(table):
    cols = ", ".join(f"`{c}`" for c in SRC_COLS)
    placeholders = ", ".join(["%s"] * len(SRC_COLS))
    return f"INSERT INTO `{table}` ({cols}) VALUES ({placeholders})"


def convert(canon, v):
    if v is None:
        return None
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        if canon in INT_COLS:
            iv = int(v)
            if iv != v:
                raise LoadError(f"{canon}: non-integral source value {v!r}")
            return iv
        return v
    return v


def load_month(m, pwd, host="localhost", user="root",
               database="nyc_yellow_taxi_source", batch_size=50000,
               force=False, sample=None, progress_every=10):
    path = f"{BASE}\\yellow_tripdata_2025-{m}.parquet"
    full = sample is None
    table = f"trip_2025_{m}" if full else f"trip_2025_{m}_sample"
    src_key = f"2025-{m}" if full else f"sample-2025-{m}"
    sha, size = file_identity(path)
    con = pymysql.connect(host=host, user=user, password=pwd,
                          database=database, autocommit=False)
    lock = f"src_nyc_yellow_{database}_{src_key}"
    try:
        if not acquire_lock(con, lock, 0):
            raise LoadError(f"{src_key}: another loader holds the lock")
        try:
            cur = con.cursor()
            try:
                cur.execute("SELECT sha256, status, row_count FROM source_load_log "
                            "WHERE src_file=%s", (src_key,))
                row = cur.fetchone()
            finally:
                cur.close()
            if row and row[0] == sha and row[1] == "completed" and not force and full:
                print(f"{src_key}: already loaded (same sha256), skipping")
                return {"status": "skipped", "src_file": src_key,
                        "row_count": int(row[2] or 0)}

            pf = pq.ParquetFile(path)
            resolved = resolve_columns(pf.schema_arrow.names)
            expected = pf.metadata.num_rows
            print(f"{src_key}: {path} ({expected:,} rows, sha {sha[:12]}..., "
                  f"{size:,} bytes) -> {table}")
            cur = con.cursor()
            try:
                cur.execute(f"DROP TABLE IF EXISTS `{table}`")
                cur.execute(TABLE_DDL.format(table=table))
                cur.execute(
                    "INSERT INTO source_load_log (src_file,sha256,file_bytes,row_count,"
                    "source_path,status,started_at,completed_at) VALUES (%s,%s,%s,0,%s,"
                    "'running',NOW(),NULL) ON DUPLICATE KEY UPDATE sha256=VALUES(sha256),"
                    "file_bytes=VALUES(file_bytes),row_count=0,source_path=VALUES(source_path),"
                    "status='running',started_at=NOW(),completed_at=NULL",
                    (src_key, sha, size, path))
                con.commit()
                cur.execute("SET SESSION unique_checks=0")
                cur.execute("SET SESSION foreign_key_checks=0")
                sql = insert_sql(table)
                total, t0 = 0, time.time()
                for bi, batch in enumerate(pf.iter_batches(batch_size=batch_size)):
                    params = [tuple(convert(c, r[resolved[c]]) for c in SRC_COLS)
                              for r in batch.to_pylist()]
                    if not full:
                        need = sample - total
                        if need <= 0:
                            break
                        params = params[:need]
                    cur.executemany(sql, params)
                    con.commit()
                    total += len(params)
                    if full and (bi + 1) % progress_every == 0:
                        el = time.time() - t0
                        print(f"  ...{total:,} rows ({total/el:,.0f}/s)", flush=True)
                    if not full and total >= sample:
                        break
                el = time.time() - t0
                if full:
                    if total != expected:
                        raise LoadError(f"{src_key}: loaded {total} rows but parquet "
                                        f"has {expected}")
                    cur.execute("UPDATE source_load_log SET status='completed',"
                                "row_count=%s,completed_at=NOW() WHERE src_file=%s",
                                (total, src_key))
                else:
                    cur.execute("UPDATE source_load_log SET status='sample',"
                                "row_count=%s WHERE src_file=%s", (total, src_key))
                con.commit()
                print(f"{src_key}: loaded {total:,} rows in {el:.1f}s "
                      f"({total/max(el,0.01):,.0f} rows/s)")
                return {"status": "loaded", "src_file": src_key, "row_count": total}
            except Exception:
                con.rollback()
                raise
            finally:
                cur.close()
        finally:
            release_lock(con, lock)
    except LoadError:
        raise
    except Exception as e:
        try:
            cur = con.cursor()
            try:
                cur.execute("UPDATE source_load_log SET status='failed' "
                            "WHERE src_file=%s", (src_key,))
                con.commit()
            finally:
                cur.close()
        except Exception:
            pass
        raise LoadError(f"{src_key}: {type(e).__name__}: {e}") from e
    finally:
        try:
            con.close()
        except Exception:
            pass


def parse_args(argv=None):
    ap = argparse.ArgumentParser(
        description="Load NYC Yellow Taxi 2025 parquet files into the source "
                    "database (raw replica used by etl_load.py extraction).")
    ap.add_argument("--month", help="MM, e.g. 01")
    ap.add_argument("--all", action="store_true", help="load all 12 months")
    ap.add_argument("--db-password", default=os.environ.get("MYSQL_PWD"),
                    help="or MYSQL_PWD env var")
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--user", default="root")
    ap.add_argument("--database", default="nyc_yellow_taxi_source")
    ap.add_argument("--batch-size", type=int, default=50000)
    ap.add_argument("--sample", type=int, default=None,
                    help="load only first N rows into a _sample table (validation)")
    ap.add_argument("--force", action="store_true",
                    help="reload even if already loaded with the same sha256")
    a = ap.parse_args(argv)
    if not a.db_password:
        ap.error("database password required (--db-password or MYSQL_PWD)")
    if bool(a.all) == bool(a.month):
        ap.error("specify exactly one of --month MM or --all")
    return a


def main(argv=None):
    a = parse_args(argv)
    months = [f"{i:02d}" for i in range(1, 13)] if a.all else [a.month]
    try:
        con = pymysql.connect(host=a.host, user=a.user, password=a.db_password,
                              autocommit=True)
        try:
            cur = con.cursor()
            try:
                cur.execute(f"CREATE DATABASE IF NOT EXISTS `{a.database}` "
                            "CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
                cur.execute(f"USE `{a.database}`")
                cur.execute(LOG_DDL)
            finally:
                cur.close()
        finally:
            con.close()
        for m in months:
            load_month(m, a.db_password, a.host, a.user, a.database,
                       a.batch_size, a.force, a.sample)
    except LoadError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return EXIT_DATA
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
