import argparse
import hashlib
import math
import os
import sys
import time
from datetime import datetime

import pandas as pd
import pyarrow.parquet as pq
import pymysql

BASE = r"C:\Users\Justin Miguel\Documents\NYC_Taxi_DW\NYC_Yellow_Taxi_2025"

KEY_COLS = ["tpep_pickup_datetime", "tpep_dropoff_datetime", "PULocationID",
            "DOLocationID", "fare_amount", "total_amount"]

COLUMN_ALIASES = {
    "VendorID": ["VendorID"],
    "tpep_pickup_datetime": ["tpep_pickup_datetime"],
    "tpep_dropoff_datetime": ["tpep_dropoff_datetime"],
    "passenger_count": ["passenger_count"],
    "trip_distance": ["trip_distance"],
    "RatecodeID": ["RatecodeID"],
    "store_and_fwd_flag": ["store_and_fwd_flag"],
    "PULocationID": ["PULocationID"],
    "DOLocationID": ["DOLocationID"],
    "payment_type": ["payment_type"],
    "fare_amount": ["fare_amount"],
    "extra": ["extra"],
    "mta_tax": ["mta_tax"],
    "tip_amount": ["tip_amount"],
    "tolls_amount": ["tolls_amount"],
    "improvement_surcharge": ["improvement_surcharge"],
    "total_amount": ["total_amount"],
    "congestion_surcharge": ["congestion_surcharge"],
    "Airport_fee": ["Airport_fee", "airport_fee"],
    "cbd_congestion_fee": ["cbd_congestion_fee"],
}

ZERO_DEFAULT_MONEY = ["extra", "mta_tax", "tip_amount", "tolls_amount",
                      "improvement_surcharge"]
NULLABLE_MONEY = ["congestion_surcharge", "Airport_fee", "cbd_congestion_fee"]

MAX_DISTANCE_MI = 500.0
MAX_DURATION_MIN = 720

EXIT_OK, EXIT_DATA, EXIT_USAGE = 0, 1, 2

SRC_COLS = list(COLUMN_ALIASES.keys())
SOURCE_DB_DEFAULT = "nyc_yellow_taxi_source"


class LoadError(Exception):
    pass


def is_missing(v):
    if v is None:
        return True
    try:
        if v is __import__("pandas").NA or v is __import__("pandas").NaT:
            return True
    except Exception:
        pass
    if isinstance(v, float) and math.isnan(v):
        return True
    try:
        import pandas as pd
        if isinstance(v, pd.Timestamp) and pd.isna(v):
            return True
    except Exception:
        pass
    return False


def to_int(v):
    if is_missing(v):
        return None, True
    if isinstance(v, bool):
        return None, False
    if isinstance(v, float):
        if not math.isfinite(v) or v != int(v):
            return None, False
        return int(v), True
    try:
        return int(v), True
    except (ValueError, TypeError):
        return None, False


def to_float(v):
    if is_missing(v):
        return None, True
    try:
        f = float(v)
    except (ValueError, TypeError):
        return None, False
    if not math.isfinite(f):
        return None, False
    return f, True


def to_ts(v):
    if is_missing(v):
        return None, True
    try:
        import pandas as pd
        ts = pd.Timestamp(v)
        if pd.isna(ts):
            return None, False
        return ts.to_pydatetime(), True
    except (ValueError, TypeError, OverflowError):
        return None, False


def resolve_columns(schema_names):
    resolved = {}
    missing = []
    for canon, aliases in COLUMN_ALIASES.items():
        hit = next((a for a in aliases if a in schema_names), None)
        if hit is None:
            missing.append(canon)
        else:
            resolved[canon] = hit
    if missing:
        raise LoadError(f"parquet schema missing columns: {missing} "
                        f"(got: {sorted(schema_names)})")
    return resolved


def load_dim_maps(con):
    cur = con.cursor()
    try:
        cur.execute("SELECT tlc_id, location_sk FROM dim_location")
        loc_map = {int(a): int(b) for a, b in cur.fetchall()}
        cur.execute("SELECT full_date, date_sk FROM dim_date")
        date_map, bad_convention = {}, 0
        for full_date, sk in cur.fetchall():
            d = full_date.date() if isinstance(full_date, datetime) else full_date
            date_map[d] = int(sk)
            if int(sk) != d.year * 10000 + d.month * 100 + d.day:
                bad_convention += 1
        cur.execute("SELECT vendor_sk FROM dim_vendor")
        vendors = {int(r[0]) for r in cur.fetchall()}
        cur.execute("SELECT payment_sk FROM dim_payment")
        payments = {int(r[0]) for r in cur.fetchall()}
        cur.execute("SELECT ratecode_sk FROM dim_ratecode")
        rates = {int(r[0]) for r in cur.fetchall()}
    finally:
        cur.close()
    if 0 not in vendors:
        raise LoadError("dim_vendor missing 0='Unknown' member")
    if -1 not in payments or -1 not in rates:
        raise LoadError("dim_payment/dim_ratecode missing -1='Unknown' member")
    if not loc_map or not date_map:
        raise LoadError("dim_location/dim_date are empty; seed dimensions first")
    maps = {"loc": loc_map, "date": date_map,
            "vendor_codes": vendors, "payment_codes": payments, "rate_codes": rates,
            "date_convention_ok": bad_convention == 0}
    return maps


def dedupe_hash(get):
    h = hashlib.blake2b(digest_size=8)
    for c in KEY_COLS:
        h.update(repr(get(c)).encode())
    return h.digest()


def classify(row, get, maps):
    pk, ok1 = to_ts(get("tpep_pickup_datetime"))
    dp, ok2 = to_ts(get("tpep_dropoff_datetime"))
    if not ok1 or not ok2 or pk is None or dp is None:
        return ("reject", "missing_or_bad_timestamp", None, None,
                None if pk is None else str(pk), None if dp is None else str(dp)), None
    if dp < pk:
        return ("reject", "dropoff_before_pickup", None, None, str(pk), str(dp)), None
    pu_raw, do_raw = get("PULocationID"), get("DOLocationID")
    pu, okp = to_int(pu_raw)
    do, okd = to_int(do_raw)
    if not okp or not okd or pu is None or do is None:
        return ("reject", "missing_or_bad_zone", None, None, str(pk), str(dp)), None
    pu_sk = maps["loc"].get(pu)
    do_sk = maps["loc"].get(do)
    if pu_sk is None or do_sk is None:
        return ("reject", "unknown_zone", pu, do, str(pk), str(dp)), None
    if pk.date() not in maps["date"] or dp.date() not in maps["date"]:
        return ("reject", "date_out_of_dimension", pu, do, str(pk), str(dp)), None
    vendor, okv = to_int(get("VendorID"))
    if not okv:
        return ("reject", "bad_vendor_id", pu, do, str(pk), str(dp)), None
    rate, okr = to_int(get("RatecodeID"))
    if not okr:
        return ("reject", "bad_ratecode", pu, do, str(pk), str(dp)), None
    pay, okpay = to_int(get("payment_type"))
    if not okpay:
        return ("reject", "bad_payment_type", pu, do, str(pk), str(dp)), None
    pax, okpax = to_int(get("passenger_count"))
    if not okpax or (pax is not None and not (0 <= pax <= 10)):
        return ("reject", "bad_passenger_count", pu, do, str(pk), str(dp)), None
    dist, okd2 = to_float(get("trip_distance"))
    if not okd2 or dist is None or dist < 0:
        return ("reject", "bad_trip_distance", pu, do, str(pk), str(dp)), None
    fare, okf = to_float(get("fare_amount"))
    total, okt = to_float(get("total_amount"))
    if not okf or not okt or fare is None or total is None:
        return ("reject", "bad_fare_or_total", pu, do, str(pk), str(dp)), None
    money = {}
    for c in ZERO_DEFAULT_MONEY:
        f, okm = to_float(get(c))
        if not okm:
            return ("reject", f"bad_{c}", pu, do, str(pk), str(dp)), None
        money[c] = 0.00 if f is None else f
    for c in NULLABLE_MONEY:
        f, okm = to_float(get(c))
        if not okm:
            return ("reject", f"bad_{c}", pu, do, str(pk), str(dp)), None
        money[c] = f
    flag = get("store_and_fwd_flag")
    if is_missing(flag):
        flag = None
    else:
        flag = str(flag).strip().upper()[:1]
        if flag not in ("Y", "N"):
            return ("reject", "bad_store_fwd_flag", pu, do, str(pk), str(dp)), None
    vendor_sk = vendor if vendor in maps["vendor_codes"] else 0
    rate_sk = rate if rate in maps["rate_codes"] else -1
    pay_sk = pay if pay in maps["payment_codes"] else -1
    if vendor is None:
        vendor_sk = 0
    if rate is None:
        rate_sk = -1
    if pay is None:
        pay_sk = -1
    duration = int((dp - pk).total_seconds() // 60)
    suspicious = dist > MAX_DISTANCE_MI or duration > MAX_DURATION_MIN
    fact = (maps["date"][pk.date()], maps["date"][dp.date()],
            pk.strftime("%Y-%m-%d %H:%M:%S"), dp.strftime("%Y-%m-%d %H:%M:%S"),
            pu_sk, do_sk, vendor_sk, rate_sk, flag, pay_sk, pax,
            round(dist, 2), duration, round(fare, 2),
            *[round(money[c], 2) for c in ZERO_DEFAULT_MONEY],
            round(total, 2),
            *[None if money[c] is None else round(money[c], 2) for c in NULLABLE_MONEY])
    return ("fact", None, pu, do, str(pk), str(dp)), (fact, suspicious)


FACT_SQL = """INSERT INTO fact_trip (pickup_date_sk,dropoff_date_sk,pickup_datetime,
dropoff_datetime,pu_location_sk,do_location_sk,vendor_sk,ratecode_sk,store_and_fwd_flag,
payment_sk,passenger_count,trip_distance,duration_min,fare_amount,extra,mta_tax,tip_amount,
tolls_amount,improvement_surcharge,total_amount,congestion_surcharge,airport_fee,
cbd_congestion_fee,src_file,src_row) VALUES
(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"""
REJECT_SQL = """INSERT INTO fact_trip_reject (src_file,src_row,reject_reason,pickup_datetime,
dropoff_datetime,pu_id,do_id,payload) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)"""


def file_identity(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(8 << 20), b""):
            h.update(chunk)
    import os as _os
    return h.hexdigest(), _os.path.getsize(path)


def acquire_lock(con, name, timeout=0):
    cur = con.cursor()
    try:
        cur.execute("SELECT GET_LOCK(%s,%s)", (name, timeout))
        return cur.fetchone()[0] == 1
    finally:
        cur.close()


def release_lock(con, name):
    cur = con.cursor()
    try:
        cur.execute("SELECT RELEASE_LOCK(%s)", (name,))
    finally:
        cur.close()


def begin_batch(con, batch_id, sha, size):
    cur = con.cursor()
    try:
        cur.execute("SELECT status, file_sha256 FROM etl_batch_log WHERE src_file=%s",
                    (batch_id,))
        row = cur.fetchone()
        if row is None:
            cur.execute("INSERT INTO etl_batch_log (src_file,src_rows,loaded_rows,"
                        "rejected_rows,status,file_sha256,file_bytes,started_at) VALUES "
                        "(%s,0,0,0,'running',%s,%s,NOW())", (batch_id, sha, size))
            con.commit()
            return "fresh"
        status, old_sha = row[0], row[1]
        if status == "completed" and old_sha == sha:
            return "skip"
        if status == "completed":
            raise LoadError(f"{batch_id} already completed with a DIFFERENT source file "
                            f"(sha changed). Refusing; use --force to reload.")
        cur.execute("DELETE FROM fact_trip WHERE src_file=%s", (batch_id,))
        cur.execute("DELETE FROM fact_trip_reject WHERE src_file=%s", (batch_id,))
        cur.execute("UPDATE etl_batch_log SET status='running',file_sha256=%s,file_bytes=%s,"
                    "src_rows=0,loaded_rows=0,rejected_rows=0,duplicate_rows=0,"
                    "suspicious_rows=0,started_at=NOW(),completed_at=NULL WHERE src_file=%s",
                    (sha, size, batch_id))
        con.commit()
        return "recovered"
    finally:
        cur.close()


def finish_batch(con, batch_id, counts, ok):
    cur = con.cursor()
    try:
        if ok:
            cur.execute("UPDATE etl_batch_log SET status='completed',src_rows=%s,"
                        "loaded_rows=%s,rejected_rows=%s,duplicate_rows=%s,suspicious_rows=%s,"
                        "completed_at=NOW() WHERE src_file=%s", (*counts, batch_id))
        else:
            cur.execute("UPDATE etl_batch_log SET status='failed',src_rows=%s,"
                        "loaded_rows=%s,rejected_rows=%s,duplicate_rows=%s,suspicious_rows=%s "
                        "WHERE src_file=%s", (*counts, batch_id))
        con.commit()
    finally:
        cur.close()


def parquet_source(path, batch_size):
    pf = pq.ParquetFile(path)
    resolved = resolve_columns(pf.schema_arrow.names)

    def gen():
        for batch in pf.iter_batches(batch_size=batch_size):
            yield batch.to_pandas()

    return gen(), resolved


def db_source(con_src, table, batch_size, limit=None):
    resolved = {c: c for c in SRC_COLS}

    def gen():
        cur = con_src.cursor(pymysql.cursors.SSCursor)
        try:
            collist = ",".join(f"`{c}`" for c in SRC_COLS)
            sql = f"SELECT {collist} FROM `{table}` ORDER BY src_row"
            if limit is not None:
                sql += f" LIMIT {int(limit)}"
            cur.execute(sql)
            while True:
                rows = cur.fetchmany(batch_size)
                if not rows:
                    break
                yield pd.DataFrame.from_records(rows, columns=SRC_COLS)
        finally:
            cur.close()

    return gen(), resolved


def source_identity(con_src, m, source_database):
    cur = con_src.cursor()
    try:
        cur.execute("SELECT sha256, file_bytes FROM source_load_log "
                    "WHERE src_file=%s AND status='completed'", (f"2025-{m}",))
        row = cur.fetchone()
    finally:
        cur.close()
    if row is None:
        raise LoadError(f"source load for 2025-{m} not found in "
                        f"{source_database}.source_load_log; run "
                        f"etl/load_source_db.py first (or use --source parquet)")
    return row[0], int(row[1])


def run_load(frames, resolved, batch_id, con, maps, dedupe=True, sample=None,
             progress_every=10):
    counts = dict(src=0, loaded=0, rejected=0, dup=0, susp=0)
    seen = set()
    fact_buf, rej_buf = [], []
    t0 = time.time()

    def flush(cur):
        if fact_buf:
            cur.executemany(FACT_SQL, fact_buf)
            fact_buf.clear()
        if rej_buf:
            cur.executemany(REJECT_SQL, rej_buf)
            rej_buf.clear()

    cur = con.cursor()
    try:
        for bi, df in enumerate(frames):
            if sample is not None:
                need = sample - counts["src"]
                if need <= 0:
                    break
                df = df.head(need)
            cols = {canon: df[src] for canon, src in resolved.items()}
            for i in range(len(df)):
                src_row = counts["src"]
                counts["src"] += 1
                get = lambda c, _i=i: cols[c].iat[_i]
                if dedupe:
                    key = dedupe_hash(get)
                    if key in seen:
                        counts["dup"] += 1
                        continue
                    seen.add(key)
                (kind, reason, pu, do, pks, dps), payload = classify(
                    None, get, maps)
                if kind == "duplicate":
                    counts["dup"] += 1
                elif kind == "reject":
                    import json
                    rej_buf.append((batch_id, src_row, reason, pks, dps, pu, do,
                                    json.dumps({c: str(cols[c].iat[i]) for c in cols},
                                               default=str)[:65535]))
                    counts["rejected"] += 1
                else:
                    fact, susp = payload
                    fact_buf.append(fact + (batch_id, src_row))
                    counts["loaded"] += 1
                    counts["susp"] += 1 if susp else 0
            if fact_buf or rej_buf:
                flush(cur)
                con.commit()
            if (bi + 1) % progress_every == 0:
                el = time.time() - t0
                print(f"  ...{counts['src']} rows ({counts['src']/el:,.0f}/s), "
                      f"loaded={counts['loaded']} rej={counts['rejected']} "
                      f"dup={counts['dup']}", flush=True)
            if sample is not None and counts["src"] >= sample:
                break
        flush(cur)
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        cur.close()
        try:
            frames.close()
        except Exception:
            pass
    el = time.time() - t0
    assert counts["src"] == counts["loaded"] + counts["rejected"] + counts["dup"], \
        f"count equation violated: {counts}"
    print(f"  done in {el:.1f}s ({counts['src']/max(el,0.01):,.0f} rows/s)")
    return counts


def load_month(m, pwd, host="localhost", user="root", database="nyc_yellow_taxi_2025",
               batch_size=100000, dedupe=True, sample=None, force=False,
               source="db", source_database=SOURCE_DB_DEFAULT):
    path = f"{BASE}\\yellow_tripdata_2025-{m}.parquet"
    table = f"trip_2025_{m}"
    batch_id = f"2025-{m}" if sample is None else f"sample-{m}-{sample}"
    con = pymysql.connect(host=host, user=user, password=pwd, database=database,
                          autocommit=False)
    con_src = None
    lock = f"etl_nyc_yellow_{database}_{batch_id}"
    try:
        if not acquire_lock(con, lock, 0):
            raise LoadError(f"{batch_id}: another worker holds the load lock")
        try:
            if source == "db":
                con_src = pymysql.connect(host=host, user=user, password=pwd,
                                          database=source_database, autocommit=True)
                sha, size = source_identity(con_src, m, source_database)
                origin = f"{source_database}.{table}"
            else:
                sha, size = file_identity(path)
                origin = path
            if force and sample is None:
                cur = con.cursor()
                try:
                    cur.execute("DELETE FROM fact_trip WHERE src_file=%s", (batch_id,))
                    cur.execute("DELETE FROM fact_trip_reject WHERE src_file=%s", (batch_id,))
                    cur.execute("DELETE FROM etl_batch_log WHERE src_file=%s", (batch_id,))
                    con.commit()
                finally:
                    cur.close()
            state = begin_batch(con, batch_id, sha, size)
            if state == "skip":
                print(f"{batch_id}: already completed (same sha256), skipping")
                return {"status": "skipped", "batch_id": batch_id}
            print(f"{batch_id}: {state} <- {origin} (sha {sha[:12]}..., {size:,} bytes)")
            maps = load_dim_maps(con)
            print(f"  dims: {len(maps['loc'])} zones, {len(maps['date'])} dates, "
                  f"date_YYYYMMDD_convention={'ok' if maps['date_convention_ok'] else 'MISMATCH->using map'}")
            if source == "db":
                frames, resolved = db_source(con_src, table, batch_size, sample)
            else:
                frames, resolved = parquet_source(path, batch_size)
            counts = run_load(frames, resolved, batch_id, con, maps, dedupe, sample)
            finish_batch(con, batch_id, (counts["src"], counts["loaded"],
                                         counts["rejected"], counts["dup"], counts["susp"]), True)
            print(f"{batch_id}: src={counts['src']} loaded={counts['loaded']} "
                  f"rejected={counts['rejected']} duplicates={counts['dup']} "
                  f"suspicious={counts['susp']}")
            return {"status": state, "batch_id": batch_id, **counts}
        finally:
            release_lock(con, lock)
    except LoadError:
        raise
    except Exception as e:
        try:
            con.rollback()
        except Exception:
            pass
        try:
            cur = con.cursor()
            try:
                cur.execute("UPDATE etl_batch_log SET status='failed' WHERE src_file=%s",
                            (batch_id,))
                con.commit()
            finally:
                cur.close()
        except Exception:
            pass
        raise LoadError(f"{batch_id}: {type(e).__name__}: {e}") from e
    finally:
        try:
            con.close()
        except Exception:
            pass
        if con_src is not None:
            try:
                con_src.close()
            except Exception:
                pass


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="Load NYC Yellow Taxi 2025 into the warehouse. "
                                             "Extracts from the source database by default "
                                             "(--source parquet reads the files directly).")
    ap.add_argument("--month", help="MM, e.g. 01")
    ap.add_argument("--all", action="store_true", help="load all 12 months")
    ap.add_argument("--db-password", default=os.environ.get("MYSQL_PWD"),
                    help="or MYSQL_PWD env var")
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--user", default="root")
    ap.add_argument("--database", default="nyc_yellow_taxi_2025")
    ap.add_argument("--source", choices=["db", "parquet"], default="db",
                    help="extraction source (default: db)")
    ap.add_argument("--source-database", default=SOURCE_DB_DEFAULT,
                    help="source database name (default: %(default)s)")
    ap.add_argument("--batch-size", type=int, default=100000)
    ap.add_argument("--no-dedupe", action="store_true")
    ap.add_argument("--sample", type=int, default=None,
                    help="load only first N rows (validation; separate batch id)")
    ap.add_argument("--force", action="store_true",
                    help="reload even if source changed after success")
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
        for m in months:
            load_month(m, a.db_password, a.host, a.user, a.database,
                       a.batch_size, not a.no_dedupe, a.sample, a.force,
                       a.source, a.source_database)
    except LoadError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return EXIT_DATA
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
