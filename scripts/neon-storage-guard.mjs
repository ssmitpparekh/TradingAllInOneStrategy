import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^[\"']|[\"']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function strictSslUrl(value) {
  return value.replace(/([?&])sslmode=require(?=&|$)/, "$1sslmode=verify-full");
}

loadLocalEnv();

const databaseUrl = strictSslUrl(process.env.DATABASE_URL?.trim() || "");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const softLimitBytes = Number(
  process.env.NEON_STORAGE_SOFT_LIMIT_BYTES ?? 900 * 1024 * 1024
);

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  keepAlive: true
});

try {
  const result = await pool.query(
    "select pg_database_size(current_database())::bigint as bytes"
  );
  const bytes = Number(result.rows[0]?.bytes ?? 0);
  const mib = bytes / 1024 / 1024;
  const limitMib = softLimitBytes / 1024 / 1024;

  process.stdout.write(
    `Neon storage: ${mib.toFixed(1)} MiB / soft limit ${limitMib.toFixed(1)} MiB\n`
  );

  if (bytes >= softLimitBytes) {
    process.stderr.write(
      "Storage safety stop: database is at or above the configured soft limit.\n"
    );
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
