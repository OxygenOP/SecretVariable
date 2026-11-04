import type { FastifyInstance } from "fastify";
import { generateKey } from "@secretvariable/crypto";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { createPool, migrate } from "../src/db.js";

export const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/secretvariable_test";

export async function setup(overrides: Partial<Config> = {}) {
  const pool = createPool(DB_URL);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool);
  const config: Config = {
    databaseUrl: DB_URL, masterKey: generateKey(), host: "127.0.0.1", port: 0, webDir: null,
    allowRegistration: true, sessionTtlDays: 30, rateLimitMax: 1000, logger: false, ...overrides,
  };
  const app = await buildApp(config, pool);
  return { app, pool, config };
}

export class Client {
  constructor(public app: FastifyInstance, public token = "") {}
  async req(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown) {
    const res = await this.app.inject({
      method, url, payload: body as object | undefined,
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
    });
    let json: any = null;
    try { json = res.json(); } catch { /* not json */ }
    return { status: res.statusCode, body: json };
  }
  get = (u: string) => this.req("GET", u);
  post = (u: string, b?: unknown) => this.req("POST", u, b ?? {});
  patch = (u: string, b: unknown) => this.req("PATCH", u, b);
  del = (u: string) => this.req("DELETE", u);
  withToken(token: string) { return new Client(this.app, token); }
}

let n = 0;
export async function register(app: FastifyInstance, name = "Alice") {
  const email = `${name.toLowerCase()}${++n}@example.com`;
  const c = new Client(app);
  const r = await c.post("/api/v1/auth/register", { email, name, password: "correct horse battery" });
  if (r.status !== 201) throw new Error("register failed: " + JSON.stringify(r.body));
  const client = c.withToken(r.body.token);
  const orgs = await client.get("/api/v1/orgs");
  return { client, user: r.body.user, email, org: orgs.body.orgs[0] };
}
