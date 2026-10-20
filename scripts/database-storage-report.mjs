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

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  keepAlive: true
});

try {
  const database = await pool.query(`
    select
      pg_size_pretty(pg_database_size(current_database())) as total_size,
      pg_database_size(current_database()) as total_bytes
  `);

  const relations = await pool.query(`
    select
      n.nspname as schema_name,
      c.relname as relation_name,
      case c.relkind
        when 'r' then 'table'
        when 'm' then 'materialized_view'
        when 'i' then 'index'
        else c.relkind::text
      end as relation_type,
      pg_total_relation_size(c.oid) as total_bytes,
      pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','m')
    order by pg_total_relation_size(c.oid) desc
    limit 30
  `);

  const rows = await pool.query(`
    select
      c.relname as table_name,
      greatest(c.reltuples::bigint, 0) as estimated_rows
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
    order by c.reltuples desc
    limit 30
  `);

  process.stdout.write(`Database: ${database.rows[0].total_size} (${database.rows[0].total_bytes} bytes)\n\n`);
  process.stdout.write("Largest public relations:\n");
  for (const row of relations.rows) {
    process.stdout.write(
      `${String(row.total_size).padStart(10)}  ${row.schema_name}.${row.relation_name}\n`
    );
  }

  process.stdout.write("\nEstimated table rows:\n");
  for (const row of rows.rows) {
    process.stdout.write(
      `${String(row.estimated_rows).padStart(12)}  public.${row.table_name}\n`
    );
  }
} finally {
  await pool.end();
}
