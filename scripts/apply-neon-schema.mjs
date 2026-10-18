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
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (!(key in process.env)) process.env[key] = value;
  }
}

function strictSslUrl(value) {
  return value.replace(/([?&])sslmode=require(?=&|$)/, "$1sslmode=verify-full");
}

loadLocalEnv();

const rawConnectionString =
  process.env.DATABASE_URL_UNPOOLED?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "";

if (!rawConnectionString) {
  throw new Error(
    "No Neon connection string found. Run `neon env pull --service postgres` first."
  );
}

const sql = [
  readFileSync("database/order-flow.sql", "utf8"),
  readFileSync("database/market-data.sql", "utf8"),
  readFileSync("database/trading-journal.sql", "utf8")
].join("\n\n");
const client = new Client({
  connectionString: strictSslUrl(rawConnectionString)
});

try {
  await client.connect();
  await client.query(sql);
  process.stdout.write("Neon order-flow + market-data + trading-journal schemas applied successfully.\n");
} finally {
  await client.end();
}
