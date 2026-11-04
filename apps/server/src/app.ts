import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ZodError } from "zod";
import type pg from "pg";
import type { Config } from "./config.js";
import { HttpError } from "./errors.js";
import { createMailer, type Mailer } from "./mailer.js";
import { mfaRoutes } from "./routes/mfa.js";
import { authRoutes } from "./routes/auth.js";
import { environmentRoutes } from "./routes/environments.js";
import { orgRoutes } from "./routes/orgs.js";
import { projectRoutes } from "./routes/projects.js";
import { teamRoutes } from "./routes/teams.js";
import { tokenRoutes } from "./routes/tokens.js";

export async function buildApp(config: Config, pool: pg.Pool, opts: { mailer?: Mailer } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.logger ? { redact: ["req.headers.authorization"] } : false, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
  await app.register(rateLimit, { global: false });
  const mailer = opts.mailer ?? createMailer(config, (s) => app.log.info(s));
  const ctx = { pool, config, mailer };

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: "bad_request", message: err.issues[0]?.message ?? "Invalid request" } });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: "request_error", message: e.message ?? "Bad request" } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: "internal", message: "Internal server error" } });
  });

  // public and carries no data; CORS-open so the desktop app can verify a server URL before navigating to it
  app.get("/api/health", async (_req, reply) => reply.header("access-control-allow-origin", "*").send({ ok: true }));
  authRoutes(app, ctx);
  mfaRoutes(app, ctx);
  orgRoutes(app, ctx);
  projectRoutes(app, ctx);
  environmentRoutes(app, ctx);
  teamRoutes(app, ctx);
  tokenRoutes(app, ctx);

  const webDir = config.webDir && existsSync(join(config.webDir, "index.html")) ? config.webDir : null;
  if (webDir) await app.register(fastifyStatic, { root: webDir, cacheControl: true, maxAge: "1h", setHeaders: (res, path) => { if (path.endsWith("index.html")) res.header("cache-control", "no-cache"); } });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: { code: "not_found", message: "Not found" } });
    // single-page app: unknown GET paths get the app shell
    if (webDir && req.method === "GET") return reply.header("cache-control", "no-cache").sendFile("index.html");
    return reply.code(404).send("Not found");
  });
  return app;
}
