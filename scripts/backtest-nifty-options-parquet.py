#!/usr/bin/env python3
"""
Exact local NIFTY options backtest using the public NIFTY_2026.parquet file.

Option candles: local Parquet (1-minute expired NIFTY options).
Spot 09:15: previously cached FYERS 1-minute NIFTY spot JSON.
No FYERS option-history API calls are made.
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import math
import os
import sys
from collections import defaultdict
from datetime import date as Date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    import duckdb
except ImportError:
    print(
        "Missing dependency: duckdb\n"
        "Install it once with: py -m pip install duckdb",
        file=sys.stderr,
    )
    raise SystemExit(2)

IST = timezone(timedelta(hours=5, minutes=30))
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PARQUET = ROOT / ".data" / "nifty-options-public" / "NIFTY_2026.parquet"
CACHE_DIR = ROOT / ".data" / "nifty-options-backtest" / "cache"
OUTPUT_DIR = ROOT / ".data" / "nifty-options-backtest"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="from_date", default="2026-04-27")
    parser.add_argument("--to", dest="to_date", default="2026-10-26")
    parser.add_argument("--parquet", default=str(DEFAULT_PARQUET))
    parser.add_argument("--spot-cache", default="")
    parser.add_argument("--inspect-only", action="store_true")
    return parser.parse_args()


def iso(v: Any) -> str:
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, Date):
        return v.isoformat()
    return str(v)[:10]


def qstr(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def week_tuesday(day: str) -> str:
    d = Date.fromisoformat(day)
    monday = d - timedelta(days=d.weekday())
    return (monday + timedelta(days=1)).isoformat()


def nearest_strike(strikes: list[float], value: float, side: str | None = None) -> float | None:
    if not strikes:
        return None

    def key(strike: float):
        distance = abs(strike - value)
        if side == "CE":
            tie = -strike  # exact tie => higher strike
        elif side == "PE":
            tie = strike   # exact tie => lower strike
        else:
            tie = strike
        return (distance, tie)

    return min(strikes, key=key)


def locate_spot_cache(from_date: str, to_date: str, explicit: str) -> Path:
    if explicit:
        p = Path(explicit)
        if p.exists():
            return p
        raise FileNotFoundError(f"Spot cache not found: {p}")

    candidates: list[tuple[str, str, Path]] = []
    pattern = str(CACHE_DIR / "nifty-spot-*-*-1m.json")
    for name in glob.glob(pattern):
        p = Path(name)
        stem = p.name
        prefix = "nifty-spot-"
        suffix = "-1m.json"
        middle = stem[len(prefix):-len(suffix)]
        # Dates are fixed width YYYY-MM-DD-YYYY-MM-DD.
        if len(middle) < 21:
            continue
        start = middle[:10]
        end = middle[11:21]
        try:
            Date.fromisoformat(start)
            Date.fromisoformat(end)
        except ValueError:
            continue
        if start <= from_date and end >= to_date:
            candidates.append((start, end, p))

    if not candidates:
        raise FileNotFoundError(
            "No cached FYERS NIFTY spot file covers "
            f"{from_date} to {to_date}. Expected under {CACHE_DIR}."
        )

    # Prefer the tightest covering cache.
    candidates.sort(key=lambda item: ((Date.fromisoformat(item[1]) - Date.fromisoformat(item[0])).days, item[0]))
    return candidates[0][2]


def load_spot_915(path: Path, from_date: str, to_date: str) -> dict[str, float]:
    with path.open("r", encoding="utf-8") as fh:
        rows = json.load(fh)

    out: dict[str, float] = {}
    for row in rows:
        try:
            ts = int(row["time"])
            local = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(IST)
            day = local.date().isoformat()
            if from_date <= day <= to_date and local.hour == 9 and local.minute == 15:
                out[day] = float(row["open"])
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
    return out


def read_dataset_info(con: duckdb.DuckDBPyConnection, parquet: Path) -> dict[str, Any]:
    pq = qstr(str(parquet))
    row = con.execute(
        f"""
        SELECT
          MIN(CAST("date" AS DATE)),
          MAX(CAST("date" AS DATE)),
          COUNT(*),
          COUNT(DISTINCT CAST(expiry AS DATE)),
          COUNT(DISTINCT strike)
        FROM read_parquet({pq})
        WHERE underlying='NIFTY' AND granularity='1min'
        """
    ).fetchone()
    return {
        "min_date": iso(row[0]) if row and row[0] else "",
        "max_date": iso(row[1]) if row and row[1] else "",
        "rows": int(row[2]) if row else 0,
        "expiries": int(row[3]) if row else 0,
        "strikes": int(row[4]) if row else 0,
    }


def load_universe_and_915(
    con: duckdb.DuckDBPyConnection,
    parquet: Path,
    from_date: str,
    to_date: str,
):
    pq = qstr(str(parquet))
    # Load the contract universe seen during the requested trading-date window.
    universe_rows = con.execute(
        f"""
        SELECT DISTINCT
          CAST(expiry AS DATE) AS expiry,
          CAST(strike AS DOUBLE) AS strike,
          option_type
        FROM read_parquet({pq})
        WHERE underlying='NIFTY'
          AND granularity='1min'
          AND CAST("date" AS DATE) BETWEEN DATE {qstr(from_date)} AND DATE {qstr(to_date)}
          AND option_type IN ('CE','PE')
        ORDER BY expiry, strike, option_type
        """
    ).fetchall()

    contract_sides: dict[str, dict[float, set[str]]] = defaultdict(lambda: defaultdict(set))
    expiries: set[str] = set()
    for expiry, strike, option_type in universe_rows:
        e = iso(expiry)
        s = float(strike)
        expiries.add(e)
        contract_sides[e][s].add(str(option_type))

    paired: dict[str, list[float]] = {}
    for expiry, by_strike in contract_sides.items():
        paired[expiry] = sorted(
            strike for strike, sides in by_strike.items() if {"CE", "PE"}.issubset(sides)
        )

    # Only one minute per contract: small enough to keep in memory.
    open_rows = con.execute(
        f"""
        SELECT
          CAST("date" AS DATE) AS trading_date,
          CAST(expiry AS DATE) AS expiry,
          CAST(strike AS DOUBLE) AS strike,
          option_type,
          CAST(open AS DOUBLE) AS open
        FROM read_parquet({pq})
        WHERE underlying='NIFTY'
          AND granularity='1min'
          AND CAST("date" AS DATE) BETWEEN DATE {qstr(from_date)} AND DATE {qstr(to_date)}
          AND CAST(timezone('Asia/Kolkata', timestamp) AS TIME) = TIME '09:15:00'
          AND option_type IN ('CE','PE')
        """
    ).fetchall()

    open915: dict[tuple[str, str, float, str], float] = {}
    for trading_date, expiry, strike, option_type, price in open_rows:
        if price is None:
            continue
        open915[(iso(trading_date), iso(expiry), float(strike), str(option_type))] = float(price)

    return sorted(expiries), paired, open915


def build_day_plans(
    spot915: dict[str, float],
    expiries: list[str],
    paired: dict[str, list[float]],
    open915: dict[tuple[str, str, float, str], float],
    from_date: str,
    to_date: str,
):
    plans: list[dict[str, Any]] = []
    selected_keys: set[tuple[str, str, float, str]] = set()

    for day in sorted(d for d in spot915 if from_date <= d <= to_date):
        row: dict[str, Any] = {
            "date": day,
            "expiry": "",
            "spot915": spot915[day],
            "atmStrike": None,
            "atmCall915": None,
            "atmPut915": None,
            "atmTotal": None,
            "rawUpper": None,
            "rawLower": None,
            "tradeCallStrike": None,
            "tradePutStrike": None,
            "tradeCall915": None,
            "tradePut915": None,
            "triggeredSide": "PENDING",
            "triggeredStrike": None,
            "triggerTime": "",
            "entry": None,
            "tp": None,
            "sl": None,
            "reached100": "",
            "exitTime": "",
            "exitPrice": None,
            "pnlPoints": None,
            "outcome": "PENDING_DATA",
            "worked": "PENDING",
            "notes": "",
        }

        tuesday = week_tuesday(day)
        expiry = next((e for e in expiries if e > tuesday), None)
        if not expiry:
            row.update(
                outcome="DATA_MISSING",
                worked="UNRESOLVED",
                notes="No dataset expiry exists strictly after this calendar week's Tuesday.",
            )
            plans.append(row)
            continue

        row["expiry"] = expiry
        strikes = paired.get(expiry, [])
        atm = nearest_strike(strikes, row["spot915"])
        if atm is None:
            row.update(outcome="DATA_MISSING", worked="UNRESOLVED", notes="No paired CE/PE strikes for selected expiry.")
            plans.append(row)
            continue

        row["atmStrike"] = atm
        ce_open = open915.get((day, expiry, atm, "CE"))
        pe_open = open915.get((day, expiry, atm, "PE"))
        row["atmCall915"] = ce_open
        row["atmPut915"] = pe_open
        if ce_open is None or pe_open is None:
            row.update(outcome="DATA_MISSING", worked="UNRESOLVED", notes="Missing ATM CE/PE 09:15 candle in public dataset.")
            plans.append(row)
            continue

        total = ce_open + pe_open
        row["atmTotal"] = total
        row["rawUpper"] = row["spot915"] + total
        row["rawLower"] = row["spot915"] - total

        call_strike = nearest_strike(strikes, row["rawUpper"], "CE")
        put_strike = nearest_strike(strikes, row["rawLower"], "PE")
        row["tradeCallStrike"] = call_strike
        row["tradePutStrike"] = put_strike

        if call_strike is None or put_strike is None:
            row.update(outcome="DATA_MISSING", worked="UNRESOLVED", notes="Unable to determine selected CE/PE strike.")
            plans.append(row)
            continue

        row["tradeCall915"] = open915.get((day, expiry, call_strike, "CE"))
        row["tradePut915"] = open915.get((day, expiry, put_strike, "PE"))
        if row["tradeCall915"] is None or row["tradePut915"] is None:
            row.update(outcome="DATA_MISSING", worked="UNRESOLVED", notes="Selected CE/PE is missing a 09:15 candle.")
            plans.append(row)
            continue

        selected_keys.add((day, expiry, call_strike, "CE"))
        selected_keys.add((day, expiry, put_strike, "PE"))
        plans.append(row)

    return plans, selected_keys


def load_selected_candles(
    con: duckdb.DuckDBPyConnection,
    parquet: Path,
    selected_keys: set[tuple[str, str, float, str]],
):
    con.execute(
        """
        CREATE TEMP TABLE selected_contracts(
          trading_date DATE,
          expiry DATE,
          strike DOUBLE,
          option_type VARCHAR
        )
        """
    )
    if selected_keys:
        con.executemany(
            "INSERT INTO selected_contracts VALUES (?, ?, ?, ?)",
            [(Date.fromisoformat(d), Date.fromisoformat(e), s, side) for d, e, s, side in sorted(selected_keys)],
        )

    pq = qstr(str(parquet))
    rows = con.execute(
        f"""
        SELECT
          CAST(p."date" AS DATE) AS trading_date,
          CAST(p.expiry AS DATE) AS expiry,
          CAST(p.strike AS DOUBLE) AS strike,
          p.option_type,
          timezone('Asia/Kolkata', p.timestamp) AS local_timestamp,
          CAST(p.open AS DOUBLE),
          CAST(p.high AS DOUBLE),
          CAST(p.low AS DOUBLE),
          CAST(p.close AS DOUBLE)
        FROM read_parquet({pq}) p
        INNER JOIN selected_contracts s
          ON CAST(p."date" AS DATE)=s.trading_date
         AND CAST(p.expiry AS DATE)=s.expiry
         AND CAST(p.strike AS DOUBLE)=s.strike
         AND p.option_type=s.option_type
        WHERE p.underlying='NIFTY'
          AND p.granularity='1min'
          AND CAST(timezone('Asia/Kolkata', p.timestamp) AS TIME)
              BETWEEN TIME '09:15:00' AND TIME '15:30:00'
        ORDER BY trading_date, expiry, strike, option_type, p.timestamp
        """
    ).fetchall()

    out: dict[tuple[str, str, float, str], list[dict[str, Any]]] = defaultdict(list)
    for trading_date, expiry, strike, side, timestamp, o, h, l, c in rows:
        if not isinstance(timestamp, datetime):
            timestamp = datetime.fromisoformat(str(timestamp))
        out[(iso(trading_date), iso(expiry), float(strike), str(side))].append(
            {
                "timestamp": timestamp,
                "time": timestamp.strftime("%H:%M"),
                "open": float(o),
                "high": float(h),
                "low": float(l),
                "close": float(c),
            }
        )
    return out


def first_break(candles: list[dict[str, Any]]):
    if not candles or candles[0]["time"] != "09:15":
        return None
    previous = candles[0]["open"]
    for idx, candle in enumerate(candles):
        if previous <= 50 and candle["close"] > 50:
            return idx, candle
        previous = candle["close"]
    return None


def evaluate(candles: list[dict[str, Any]], trigger_idx: int, entry: float):
    tp = entry + 50
    sl = entry - 25
    reached100 = entry >= 100

    for candle in candles[trigger_idx + 1:]:
        if candle["high"] >= 100:
            reached100 = True
        hit_tp = candle["high"] >= tp
        hit_sl = candle["low"] <= sl
        if hit_tp and hit_sl:
            return {
                "tp": tp, "sl": sl, "reached100": reached100,
                "outcome": "AMBIGUOUS", "exitTime": candle["time"],
                "exitPrice": None, "pnlPoints": None,
            }
        if hit_tp:
            return {
                "tp": tp, "sl": sl, "reached100": reached100,
                "outcome": "TP", "exitTime": candle["time"],
                "exitPrice": tp, "pnlPoints": 50.0,
            }
        if hit_sl:
            return {
                "tp": tp, "sl": sl, "reached100": reached100,
                "outcome": "SL", "exitTime": candle["time"],
                "exitPrice": sl, "pnlPoints": -25.0,
            }

    # Exact time-exit rule used in the automation description: exit at the 15:29 candle close.
    eod = next((c for c in reversed(candles) if c["time"] <= "15:29"), None)
    if eod:
        exit_price = eod["close"]
        return {
            "tp": tp, "sl": sl, "reached100": reached100,
            "outcome": "EOD_EXIT", "exitTime": eod["time"],
            "exitPrice": exit_price, "pnlPoints": exit_price - entry,
        }

    return {
        "tp": tp, "sl": sl, "reached100": reached100,
        "outcome": "DATA_MISSING", "exitTime": "",
        "exitPrice": None, "pnlPoints": None,
    }


def complete_plans(plans: list[dict[str, Any]], candles_by_key):
    for row in plans:
        if row["outcome"] != "PENDING_DATA":
            continue

        day = row["date"]
        expiry = row["expiry"]
        call_key = (day, expiry, float(row["tradeCallStrike"]), "CE")
        put_key = (day, expiry, float(row["tradePutStrike"]), "PE")
        calls = candles_by_key.get(call_key, [])
        puts = candles_by_key.get(put_key, [])

        if not calls or not puts:
            row.update(outcome="DATA_MISSING", worked="UNRESOLVED", notes="Missing selected contract intraday candles.")
            continue

        call_break = first_break(calls)
        put_break = first_break(puts)

        if call_break is None and put_break is None:
            row.update(triggeredSide="NONE", outcome="NO_BREAK", worked="NO_TRADE", notes="Neither selected option closed across ₹50.")
            continue

        if call_break and put_break and call_break[1]["timestamp"] == put_break[1]["timestamp"]:
            row.update(
                triggeredSide="BOTH",
                triggerTime=call_break[1]["time"],
                outcome="BOTH_TRIGGERED_SAME_MINUTE",
                worked="NO_TRADE",
                notes="Both CE and PE first crossed ₹50 on the same completed 1-minute candle; no trade for the day.",
            )
            continue

        choose_call = call_break is not None and (
            put_break is None or call_break[1]["timestamp"] < put_break[1]["timestamp"]
        )
        chosen = call_break if choose_call else put_break
        chosen_candles = calls if choose_call else puts
        side = "CE" if choose_call else "PE"
        strike = row["tradeCallStrike"] if choose_call else row["tradePutStrike"]
        assert chosen is not None

        idx, candle = chosen
        entry = float(candle["close"])
        result = evaluate(chosen_candles, idx, entry)
        row.update(
            triggeredSide=side,
            triggeredStrike=strike,
            triggerTime=candle["time"],
            entry=entry,
            tp=result["tp"],
            sl=result["sl"],
            reached100="YES" if result["reached100"] else "NO",
            exitTime=result["exitTime"],
            exitPrice=result["exitPrice"],
            pnlPoints=result["pnlPoints"],
            outcome=result["outcome"],
        )
        if result["outcome"] == "TP":
            row["worked"] = "YES"
        elif result["outcome"] == "SL":
            row["worked"] = "NO"
        elif result["outcome"] == "EOD_EXIT":
            row["worked"] = "YES" if (result["pnlPoints"] or 0) > 0 else "NO"
            row["notes"] = "Neither TP nor SL hit; exited at 15:29 candle close."
        elif result["outcome"] == "AMBIGUOUS":
            row["worked"] = "AMBIGUOUS"
            row["notes"] = "TP and SL both occurred inside the same post-entry 1-minute candle; intraminute ordering is unknown."
        else:
            row["worked"] = "UNRESOLVED"


COLUMNS = [
    "date", "expiry", "spot915", "atmStrike", "atmCall915", "atmPut915", "atmTotal",
    "rawUpper", "rawLower", "tradeCallStrike", "tradePutStrike", "tradeCall915",
    "tradePut915", "triggeredSide", "triggeredStrike", "triggerTime", "entry", "tp",
    "sl", "reached100", "exitTime", "exitPrice", "pnlPoints", "outcome", "worked", "notes",
]


def write_outputs(plans: list[dict[str, Any]], from_date: str, to_date: str):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = OUTPUT_DIR / f"nifty-options-public-{from_date}-to-{to_date}.csv"
    md_path = OUTPUT_DIR / f"nifty-options-public-{from_date}-to-{to_date}.md"

    with csv_path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows({k: row.get(k) for k in COLUMNS} for row in plans)

    def fmt(v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, float):
            return f"{v:.2f}"
        return str(v)

    headers = ["Date", "Expiry", "Spot 09:15", "ATM", "ATM CE", "ATM PE", "Total", "Trade CE", "Trade PE", "Trigger", "Time", "Entry", "TP", "SL", "Exit", "P&L", "Outcome"]
    lines = [
        "| " + " | ".join(headers) + " |",
        "|" + "|".join(["---"] * len(headers)) + "|",
    ]
    for r in plans:
        vals = [
            r["date"], r["expiry"], r["spot915"], r["atmStrike"], r["atmCall915"], r["atmPut915"],
            r["atmTotal"], r["tradeCallStrike"], r["tradePutStrike"], r["triggeredSide"],
            r["triggerTime"], r["entry"], r["tp"], r["sl"], r["exitPrice"], r["pnlPoints"], r["outcome"],
        ]
        lines.append("| " + " | ".join(fmt(v) for v in vals) + " |")
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return csv_path, md_path


def main() -> int:
    args = parse_args()
    parquet = Path(args.parquet)
    if not parquet.exists():
        print(f"Parquet file not found:\n{parquet}", file=sys.stderr)
        return 2

    try:
        Date.fromisoformat(args.from_date)
        Date.fromisoformat(args.to_date)
    except ValueError:
        print("--from and --to must be YYYY-MM-DD", file=sys.stderr)
        return 2

    if args.from_date > args.to_date:
        print("--from must be <= --to", file=sys.stderr)
        return 2

    con = duckdb.connect(database=":memory:")
    info = read_dataset_info(con, parquet)

    print("NIFTY PUBLIC-PARQUET EXACT-DATA CHECK")
    print(f"File: {parquet}")
    print(f"Dataset 1-minute coverage: {info['min_date']} -> {info['max_date']}")
    print(f"NIFTY 1-minute rows in file: {info['rows']:,}")
    print(f"Expiries: {info['expiries']:,} | Strikes: {info['strikes']:,}")

    if args.inspect_only:
        return 0

    if not info["min_date"] or not info["max_date"]:
        print("No NIFTY 1-minute rows found in this Parquet file.", file=sys.stderr)
        return 2

    effective_from = max(args.from_date, info["min_date"])
    effective_to = min(args.to_date, info["max_date"])

    if args.from_date < info["min_date"] or args.to_date > info["max_date"]:
        print(
            "\nWARNING: requested period is not fully covered by this public file. "
            "Days outside dataset coverage will not be fabricated."
        )
        print(
            "This run will use only the exact public-data overlap: "
            f"{effective_from} -> {effective_to}"
        )

    if effective_from > effective_to:
        print("Requested period has no overlap with this Parquet dataset.", file=sys.stderr)
        return 2

    spot_cache = locate_spot_cache(args.from_date, args.to_date, args.spot_cache)
    spot915 = load_spot_915(spot_cache, effective_from, effective_to)
    print(f"Spot cache: {spot_cache}")
    print(f"FYERS NIFTY 09:15 spot days available in exact overlap: {len(spot915)}")

    expiries, paired, open915 = load_universe_and_915(
        con, parquet, effective_from, effective_to
    )
    print(f"Public dataset expiries seen in requested window: {len(expiries)}")
    print(f"09:15 option candles loaded: {len(open915):,}")

    plans, selected_keys = build_day_plans(
        spot915, expiries, paired, open915, effective_from, effective_to
    )
    print(f"Trading days planned: {len(plans)}")
    print(f"Selected CE/PE day-contracts needing intraday candles: {len(selected_keys)}")

    candles = load_selected_candles(con, parquet, selected_keys)
    complete_plans(plans, candles)

    csv_path, md_path = write_outputs(plans, effective_from, effective_to)

    tp = sum(r["outcome"] == "TP" for r in plans)
    sl = sum(r["outcome"] == "SL" for r in plans)
    eod = sum(r["outcome"] == "EOD_EXIT" for r in plans)
    no_break = sum(r["outcome"] == "NO_BREAK" for r in plans)
    double = sum(r["outcome"] == "BOTH_TRIGGERED_SAME_MINUTE" for r in plans)
    ambiguous = sum(r["outcome"] == "AMBIGUOUS" for r in plans)
    missing = sum(r["outcome"] == "DATA_MISSING" for r in plans)
    resolved_tp_sl = tp + sl
    pnl = sum(float(r["pnlPoints"]) for r in plans if r["pnlPoints"] is not None)
    reached100 = sum(r["reached100"] == "YES" for r in plans)

    print("\nBACKTEST OUTPUT")
    print(f"Rows: {len(plans)}")
    print(f"TP wins: {tp}")
    print(f"SL losses: {sl}")
    print(f"EOD exits: {eod}")
    print(f"TP/SL win rate: {(tp / resolved_tp_sl * 100):.2f}%" if resolved_tp_sl else "TP/SL win rate: n/a")
    print(f"No break: {no_break}")
    print(f"Same-minute CE+PE => no trade: {double}")
    print(f"Ambiguous TP+SL candle: {ambiguous}")
    print(f"Missing exact data: {missing}")
    print(f"Trades that reached absolute ₹100: {reached100}")
    print(f"Net option points including 15:29 EOD exits: {pnl:.2f}")
    print("FYERS expired-F&O API requests used: 0")
    print(f"CSV: {csv_path}")
    print(f"Markdown: {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
