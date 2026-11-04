import pg from "pg";
import { migrations } from "./migrations.js";

export type Q = pg.Pool | pg.PoolClient;

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

export async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function migrate(pool: pg.Pool): Promise<string[]> {
  const applied: string[] = [];
  const c = await pool.connect();
  try {
    await c.query("SELECT pg_advisory_lock(727274)");
    await c.query("CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await c.query("SELECT name FROM _migrations")).rows.map((r) => r.name as string));
    for (const m of migrations) {
      if (done.has(m.name)) continue;
      await c.query("BEGIN");
      try {
        await c.query(m.sql);
        await c.query("INSERT INTO _migrations(name) VALUES ($1)", [m.name]);
        await c.query("COMMIT");
        applied.push(m.name);
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await c.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
    c.release();
  }
  return applied;
}
