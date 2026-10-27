import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

const { Client } = pg;

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function strictSslUrl(value) {
  return value.replace(/([?&])sslmode=require(?=&|$)/, "$1sslmode=verify-full");
}

loadLocalEnv();

if (
  process.env.CONFIRM_PLATFORM_GO_LIVE !== "YES" &&
  !process.argv.includes("--confirm")
) {
  throw new Error(
    "Refusing to lock the live boundary. Run only when strategy + UI are final with CONFIRM_PLATFORM_GO_LIVE=YES."
  );
}

const strategyVersion = "AIOV-1.0.0";
const OFFICIAL_LIVE_AT = "2026-10-20T00:52:25-08:00";
const raw =
  process.env.DATABASE_URL_UNPOOLED?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "";

if (!raw) throw new Error("DATABASE_URL is required.");

const gitCommit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const client = new Client({ connectionString: strictSslUrl(raw) });

try {
  await client.connect();

  const existing = await client.query(
    "select strategy_version, live_at, git_commit from public.platform_strategy_releases where status='LIVE' limit 1"
  );

  let row;

  if (existing.rowCount) {
    const existingRow = existing.rows[0];
    const existingTime = new Date(existingRow.live_at).getTime();
    const requestedTime = new Date(OFFICIAL_LIVE_AT).getTime();

    if (
      String(existingRow.strategy_version) !== strategyVersion ||
      existingTime !== requestedTime
    ) {
      throw new Error(
        "A different platform strategy release is already LIVE: " +
          existingRow.strategy_version +
          " at " +
          existingRow.live_at
      );
    }

    row = existingRow;
    process.stdout.write(
      "\nOfficial live boundary already locked; resuming the same release.\n"
    );
  } else {
    const result = await client.query(
      `insert into public.platform_strategy_releases (
         strategy_version, status, live_at, git_commit, ui_commit, notes
       )
       values ($1, 'LIVE', $4::timestamptz, $2, $2, $3)
       returning strategy_version, live_at, git_commit`,
      [
        strategyVersion,
        gitCommit,
        "Official ALLINONEVIEW live boundary. All earlier strategy evidence belongs to backtesting; all later platform calls must be genuinely live.",
        OFFICIAL_LIVE_AT
      ]
    );

    row = result.rows[0];
  }

  await client.query(
    "delete from public.platform_signal_journal where signal_time < extract(epoch from $1::timestamptz)::bigint",
    [OFFICIAL_LIVE_AT]
  );

  process.stdout.write(
    "\nALLINONEVIEW LIVE BOUNDARY LOCKED\n" +
      "Strategy: " + row.strategy_version +
      "\nLive at: " + new Date(row.live_at).toISOString() +
      "\nGit/UI commit: " + row.git_commit +
      "\n\nThis timestamp is immutable.\n"
  );
} finally {
  await client.end();
}

if (process.env.SKIP_AUTO_BACKTEST !== "YES") {
  process.stdout.write(
    "\nStarting the automatic pre-live strategy backtest suite…\n"
  );
  execSync("npm run backtest:platform", {
    stdio: "inherit",
    env: process.env
  });
}
