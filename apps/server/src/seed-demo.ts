/**
 * Fills a database with a believable demo workspace (all values are fake).
 * Usage: DATABASE_URL=... SV_MASTER_KEY=... node dist/seed-demo.js
 * Signs in as demo@secretvariable.dev / "demo-password-123".
 */
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";

const config = { ...loadConfig(), logger: false, rateLimitMax: 10000 };
const pool = createPool(config.databaseUrl);
await migrate(pool);
const app = await buildApp(config, pool);

async function call(token: string | null, method: string, url: string, body?: unknown) {
  const r = await app.inject({ method: method as "GET", url, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (r.statusCode >= 300) throw new Error(`${method} ${url} -> ${r.statusCode} ${r.body}`);
  return r.json();
}
async function user(name: string, email: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { name, email, password: "demo-password-123" } });
  if (r.statusCode === 409) {
    const l = await call(null, "POST", "/api/v1/auth/login", { email, password: "demo-password-123" });
    return { token: l.token as string, id: l.user.id as string };
  }
  const j = r.json();
  return { token: j.token as string, id: j.user.id as string };
}

const mara = await user("Mara Okonkwo", "demo@secretvariable.dev");
const jonas = await user("Jonas Brandt", "jonas@secretvariable.dev");
await user("Priya Raman", "priya@secretvariable.dev");

const orgs = (await call(mara.token, "GET", "/api/v1/orgs")).orgs;
const org = orgs[0];
const existing = (await call(mara.token, "GET", `/api/v1/orgs/${org.id}/projects`)).projects;
if (existing.length) { console.log("Demo data already present."); process.exit(0); }

const project = (await call(mara.token, "POST", `/api/v1/orgs/${org.id}/projects`, { name: "payments-api" })).project;
await call(mara.token, "POST", `/api/v1/orgs/${org.id}/projects`, { name: "marketing-site", environments: ["development", "production"] });
const envs: Record<string, string> = {};
for (const e of (await call(mara.token, "GET", `/api/v1/projects/${project.id}/environments`)).environments) envs[e.name] = e.id;

const base: Record<string, string> = {
  NODE_ENV: "production",
  PORT: "8080",
  DATABASE_URL: "postgres://payments:s3cr3t-fake@db.internal:5432/payments",
  REDIS_URL: "redis://cache.internal:6379/0",
  STRIPE_SECRET_KEY: "sk_test_51FAKEfakeFAKEfakeFAKE0001",
  STRIPE_WEBHOOK_SECRET: "whsec_fakefakefakefakefakefake01",
  JWT_SIGNING_KEY: "fake-signing-key-0f9a1c77d2e34b1b",
  SENTRY_DSN: "https://fakekey@o0.ingest.sentry.io/1234567",
  S3_BUCKET: "payments-receipts-prod",
  LOG_LEVEL: "info",
};
async function write(token: string, env: string, vars: Record<string, string>, message: string) {
  await call(token, "POST", `/api/v1/environments/${envs[env]}/versions`, { variables: vars, message });
}

// development: a short history
let dev: Record<string, string> = { ...base, NODE_ENV: "development", DATABASE_URL: "postgres://payments:dev@localhost:5432/payments", REDIS_URL: "redis://localhost:6379/0", STRIPE_SECRET_KEY: "sk_test_51FAKEfakeFAKEfakeFAKEdev1", S3_BUCKET: "payments-receipts-dev", LOG_LEVEL: "debug" };
await write(mara.token, "development", dev, "Initial development settings");

// staging
let stg: Record<string, string> = { ...base, NODE_ENV: "staging", DATABASE_URL: "postgres://payments:stg-fake@db.staging.internal:5432/payments", S3_BUCKET: "payments-receipts-staging", LOG_LEVEL: "debug" };
await write(mara.token, "staging", stg, "Copy from development, point at staging database");

// production: a longer history
let prod: Record<string, string> = { NODE_ENV: "production", PORT: "8080", DATABASE_URL: base.DATABASE_URL!, JWT_SIGNING_KEY: base.JWT_SIGNING_KEY!, LOG_LEVEL: "info" };
await write(mara.token, "production", prod, "First production release");
prod = { ...prod, REDIS_URL: base.REDIS_URL!, S3_BUCKET: base.S3_BUCKET! };
await write(mara.token, "production", prod, "Add cache and receipt storage");
prod = { ...prod, STRIPE_SECRET_KEY: base.STRIPE_SECRET_KEY!, STRIPE_WEBHOOK_SECRET: base.STRIPE_WEBHOOK_SECRET! };
await write(mara.token, "production", prod, "Enable card payments");
prod = { ...prod, SENTRY_DSN: base.SENTRY_DSN! };
await write(mara.token, "production", prod, "Report errors to Sentry");
prod = { ...prod, JWT_SIGNING_KEY: "fake-signing-key-7be41a09c3d85f26" };
await write(mara.token, "production", prod, "Rotate JWT signing key");

// a teammate joins with limited access and makes a change
const inv = await call(mara.token, "POST", `/api/v1/projects/${project.id}/invites`, { email: "jonas@secretvariable.dev", role: "editor", scope: "selected", grants: [{ environmentId: envs.development, access: "write" }, { environmentId: envs.staging, access: "write" }, { environmentId: envs.production, access: "read" }] });
await call(jonas.token, "POST", "/api/v1/invites/accept", { token: inv.token });
stg = { ...stg, FEATURE_NEW_CHECKOUT: "true" };
await write(jonas.token, "staging", stg, "Trial the new checkout flow");
prod = { ...prod, LOG_LEVEL: "warn" };
await write(mara.token, "production", prod, "Quieter logs after launch week");
await call(mara.token, "POST", `/api/v1/projects/${project.id}/invites`, { email: "priya@secretvariable.dev", role: "viewer" });

console.log("Demo data created. Sign in as demo@secretvariable.dev / demo-password-123");
await app.close();
await pool.end();
