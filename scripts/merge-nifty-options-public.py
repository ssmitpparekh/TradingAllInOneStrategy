#!/usr/bin/env python3
from __future__ import annotations
import argparse
from pathlib import Path
import duckdb

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / ".data" / "nifty-options-public" / "NIFTY_2026.parquet"
EXTRA = ROOT / ".data" / "nifty-options-public" / "extra"
OUT = ROOT / ".data" / "nifty-options-public" / "NIFTY_2026_combined.parquet"

def q(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--base", default=str(BASE))
    ap.add_argument("--extra-dir", default=str(EXTRA))
    ap.add_argument("--out", default=str(OUT))
    args=ap.parse_args()

    base=Path(args.base)
    extra_dir=Path(args.extra_dir)
    out=Path(args.out)
    if not base.exists():
        raise SystemExit(f"Base parquet not found: {base}")
    extras=sorted(extra_dir.glob("*.parquet"))
    if not extras:
        raise SystemExit(f"No extra parquet files found in: {extra_dir}")

    con=duckdb.connect(database=":memory:")

    pieces=[f"""
      SELECT
        CAST("date" AS VARCHAR) AS "date",
        timestamp,
        'NIFTY' AS underlying,
        CAST(expiry AS VARCHAR) AS expiry,
        CAST(strike AS DOUBLE) AS strike,
        option_type,
        exercise_style,
        CAST(open AS DOUBLE) AS open,
        CAST(high AS DOUBLE) AS high,
        CAST(low AS DOUBLE) AS low,
        CAST(close AS DOUBLE) AS close,
        CAST(volume AS DOUBLE) AS volume,
        CAST(oi AS DOUBLE) AS oi,
        CAST(settle_price AS DOUBLE) AS settle_price,
        source,
        '1min' AS granularity,
        0 AS source_priority
      FROM read_parquet({q(str(base))})
      WHERE underlying='NIFTY' AND granularity='1min'
    """]

    for p in extras:
        pieces.append(f"""
          SELECT
            CAST(trading_day AS VARCHAR) AS "date",
            timezone('Asia/Kolkata', timestamp) AS timestamp,
            'NIFTY' AS underlying,
            CAST(expiry AS VARCHAR) AS expiry,
            CAST(strike AS DOUBLE) AS strike,
            option_type,
            'european' AS exercise_style,
            CAST(open AS DOUBLE) AS open,
            CAST(high AS DOUBLE) AS high,
            CAST(low AS DOUBLE) AS low,
            CAST(close AS DOUBLE) AS close,
            CAST(volume AS DOUBLE) AS volume,
            CAST(open_interest AS DOUBLE) AS oi,
            NULL::DOUBLE AS settle_price,
            'thetrademarkk' AS source,
            '1min' AS granularity,
            1 AS source_priority
          FROM read_parquet({q(str(p))})
        """)

    union_sql=" UNION ALL ".join(pieces)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()

    con.execute(f"""
      COPY (
        SELECT
          "date", timestamp, underlying, expiry, strike, option_type,
          exercise_style, open, high, low, close, volume, oi,
          settle_price, source, granularity
        FROM (
          SELECT *,
            ROW_NUMBER() OVER (
              PARTITION BY "date", expiry, strike, option_type, timestamp
              ORDER BY source_priority
            ) AS rn
          FROM ({union_sql})
        )
        WHERE rn=1
        ORDER BY "date", timestamp, expiry, strike, option_type
      )
      TO {q(str(out))}
      (FORMAT PARQUET, COMPRESSION ZSTD)
    """)

    row=con.execute(f"""
      SELECT MIN(CAST("date" AS DATE)), MAX(CAST("date" AS DATE)), COUNT(*)
      FROM read_parquet({q(str(out))})
    """).fetchone()
    print(f"Combined file: {out}")
    print(f"Coverage: {row[0]} -> {row[1]}")
    print(f"Rows: {row[2]:,}")
    print("Extra files merged:")
    for p in extras:
        print(f"  {p.name}")

if __name__=="__main__":
    main()
