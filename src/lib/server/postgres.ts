import { Pool } from "pg";

let pool: Pool | null = null;

function strictSslUrl(value: string) {
  return value.replace(
    /([?&])sslmode=require(?=&|$)/,
    "$1sslmode=verify-full"
  );
}

export function getPostgresPool() {
  if (pool) return pool;

  const rawConnectionString = process.env.DATABASE_URL?.trim();
  if (!rawConnectionString) {
    throw new Error(
      "DATABASE_URL is not configured. Run `neon env pull --service postgres`."
    );
  }

  pool = new Pool({
    connectionString: strictSslUrl(rawConnectionString),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true
  });

  return pool;
}
