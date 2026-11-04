import type { FastifyInstance } from "fastify";
import { diffEnv, isValidKey, type EnvMap } from "@secretvariable/shared";
import { z } from "zod";
import type { AppCtx } from "../app-context.js";
import { audit } from "../audit.js";
import { authenticate, type AuthContext } from "../auth.js";
import { tx, type Q } from "../db.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { envAccess, loadProject, requireAdmin, requireEnv, type ProjectCtx } from "../permissions.js";
import { envName, parse, uuidParam } from "../util.js";
import { appendVersion, projectKey, readVersionVars } from "../versions-core.js";

const MAX_VARS = 1000;
const MAX_VALUE = 64 * 1024;

const variables = z.record(z.string(), z.string().max(MAX_VALUE)).superRefine((v, ctx) => {
  const keys = Object.keys(v);
  if (keys.length > MAX_VARS) ctx.addIssue({ code: "custom", message: `at most ${MAX_VARS} variables` });
  for (const k of keys) if (!isValidKey(k)) ctx.addIssue({ code: "custom", message: `invalid variable name "${k}"` });
});

export function environmentRoutes(app: FastifyInstance, { pool, config }: AppCtx): void {
  async function loadEnv(q: Q, auth: AuthContext, environmentId: string) {
    const r = await q.query("SELECT id, project_id, name, head_version_id FROM environments WHERE id = $1", [environmentId]);
    const env = r.rows[0];
    if (!env) throw notFound("Environment not found");
    const ctx = await loadProject(q, auth, env.project_id);
    return { env: { id: env.id as string, projectId: env.project_id as string, name: env.name as string, headVersionId: env.head_version_id as string | null }, ctx };
  }
  const dekOf = (ctx: ProjectCtx) => projectKey(config.masterKey, ctx.project.id, ctx.project.wrappedDek);

  app.get("/api/v1/projects/:projectId/environments", async (req) => {
    const a = await authenticate(pool, req);
    const { projectId } = parse(z.object({ projectId: uuidParam }), req.params);
    const ctx = await loadProject(pool, a, projectId);
    const r = await pool.query(
      `SELECT e.id, e.name, e.head_version_id AS "headVersionId", v.number AS "headNumber", v.created_at AS "updatedAt",
              (SELECT count(*)::int FROM variables x WHERE x.version_id = e.head_version_id) AS "variableCount"
         FROM environments e LEFT JOIN versions v ON v.id = e.head_version_id
        WHERE e.project_id = $1 ORDER BY e.seq`, [projectId]);
    const environments = r.rows
      .map((e) => ({ ...e, projectId, access: envAccess(a, ctx, e.id) }))
      .filter((e) => e.access);
    return { environments };
  });

  app.post("/api/v1/projects/:projectId/environments", async (req, reply) => {
    const a = await authenticate(pool, req);
    const { projectId } = parse(z.object({ projectId: uuidParam }), req.params);
    const body = parse(z.object({ name: envName, copyFromVersionId: uuidParam.optional() }), req.body);
    const ctx = await loadProject(pool, a, projectId);
    requireAdmin(ctx, a);
    const env = await tx(pool, async (c) => {
      if ((await c.query("SELECT 1 FROM environments WHERE project_id = $1 AND name = $2", [projectId, body.name])).rowCount) {
        throw conflict(`An environment named "${body.name}" already exists`);
      }
      const e = await c.query("INSERT INTO environments(project_id, name) VALUES ($1,$2) RETURNING id", [projectId, body.name]);
      const id = e.rows[0].id as string;
      if (body.copyFromVersionId) {
        const src = await c.query(
          "SELECT v.id, e.name FROM versions v JOIN environments e ON e.id = v.environment_id WHERE v.id = $1 AND e.project_id = $2",
          [body.copyFromVersionId, projectId]);
        if (!src.rows[0]) throw badRequest("Source version not found in this project");
        const dek = dekOf(ctx);
        const vars = await readVersionVars(c, dek, src.rows[0].id);
        await appendVersion(c, { environmentId: id, dek, vars, message: `Copied from ${src.rows[0].name}`, authorId: a.user.id });
      }
      await audit(c, { orgId: ctx.project.orgId, projectId, actorId: a.user.id, action: "environment.create", target: body.name, ip: req.ip });
      return { id, name: body.name, projectId };
    });
    reply.code(201);
    return { environment: env };
  });

  app.patch("/api/v1/environments/:environmentId", async (req) => {
    const a = await authenticate(pool, req);
    const { environmentId } = parse(z.object({ environmentId: uuidParam }), req.params);
    const body = parse(z.object({ name: envName }), req.body);
    const { env, ctx } = await loadEnv(pool, a, environmentId);
    requireAdmin(ctx, a);
    if ((await pool.query("SELECT 1 FROM environments WHERE project_id = $1 AND name = $2 AND id <> $3", [env.projectId, body.name, env.id])).rowCount) {
      throw conflict(`An environment named "${body.name}" already exists`);
    }
    await pool.query("UPDATE environments SET name = $2 WHERE id = $1", [env.id, body.name]);
    await audit(pool, { orgId: ctx.project.orgId, projectId: env.projectId, actorId: a.user.id, action: "environment.rename", target: `${env.name} -> ${body.name}`, ip: req.ip });
    return { ok: true };
  });

  app.delete("/api/v1/environments/:environmentId", async (req) => {
    const a = await authenticate(pool, req);
    const { environmentId } = parse(z.object({ environmentId: uuidParam }), req.params);
    const { env, ctx } = await loadEnv(pool, a, environmentId);
    requireAdmin(ctx, a);
    await pool.query("DELETE FROM environments WHERE id = $1", [env.id]);
    await audit(pool, { orgId: ctx.project.orgId, projectId: env.projectId, actorId: a.user.id, action: "environment.delete", target: env.name, ip: req.ip });
    return { ok: true };
  });

  app.get("/api/v1/environments/:environmentId/versions", async (req) => {
    const a = await authenticate(pool, req);
    const { environmentId } = parse(z.object({ environmentId: uuidParam }), req.params);
    const { env, ctx } = await loadEnv(pool, a, environmentId);
    requireEnv(a, ctx, env.id, "read");
    const r = await pool.query(
      `SELECT v.id, v.number, v.message, u.name AS "authorName", v.created_at AS "createdAt", v.summary,
              (SELECT count(*)::int FROM variables x WHERE x.version_id = v.id) AS "variableCount"
         FROM versions v LEFT JOIN users u ON u.id = v.author_id
        WHERE v.environment_id = $1 ORDER BY v.number DESC`, [env.id]);
    return { environment: { id: env.id, name: env.name, headVersionId: env.headVersionId }, versions: r.rows };
  });

  app.post("/api/v1/environments/:environmentId/versions", async (req, reply) => {
    const a = await authenticate(pool, req);
    const { environmentId } = parse(z.object({ environmentId: uuidParam }), req.params);
    const body = parse(z.object({ variables, message: z.string().trim().max(200).default("") }), req.body);
    const { env, ctx } = await loadEnv(pool, a, environmentId);
    requireEnv(a, ctx, env.id, "write");
    const dek = dekOf(ctx);
    const v = await tx(pool, (c) => appendVersion(c, { environmentId: env.id, dek, vars: body.variables, message: body.message, authorId: a.user.id }));
    if (v.created) {
      await audit(pool, { orgId: ctx.project.orgId, projectId: env.projectId, actorId: a.user.id, action: "variables.write", target: env.name, meta: { version: v.number, count: Object.keys(body.variables).length }, ip: req.ip });
    }
    reply.code(v.created ? 201 : 200);
    return { version: { id: v.id, number: v.number }, unchanged: !v.created };
  });

  app.get("/api/v1/environments/:environmentId/versions/:number", async (req) => {
    const a = await authenticate(pool, req);
    const params = parse(z.object({ environmentId: uuidParam, number: z.union([z.literal("head"), z.coerce.number().int().min(1)]) }), req.params);
    const { keys: keysOnly } = parse(z.object({ keys: z.enum(["1", "true"]).optional() }), req.query);
    const { env, ctx } = await loadEnv(pool, a, params.environmentId);
    requireEnv(a, ctx, env.id, "read");
    const r = await pool.query(
      `SELECT v.id, v.number, v.message, u.name AS "authorName", v.created_at AS "createdAt"
         FROM versions v LEFT JOIN users u ON u.id = v.author_id
        WHERE v.environment_id = $1 AND ${params.number === "head" ? "v.id = $2" : "v.number = $2"}`,
      [env.id, params.number === "head" ? env.headVersionId : params.number]);
    const version = r.rows[0];
    if (!version) throw notFound(params.number === "head" ? "This environment has no versions yet" : "Version not found");
    if (keysOnly) {
      // names only: nothing is decrypted, so this is not recorded as reading secrets
      const k = await pool.query("SELECT key FROM variables WHERE version_id = $1 ORDER BY key", [version.id]);
      return { environment: { id: env.id, name: env.name }, version, keys: k.rows.map((r) => r.key as string) };
    }
    const vars = await readVersionVars(pool, dekOf(ctx), version.id);
    await audit(pool, { orgId: ctx.project.orgId, projectId: env.projectId, actorId: a.user.id, action: "variables.read", target: env.name, meta: { version: version.number, via: a.token.kind }, ip: req.ip });
    return { environment: { id: env.id, name: env.name }, version, variables: vars };
  });

  app.post("/api/v1/environments/:environmentId/rollback", async (req, reply) => {
    const a = await authenticate(pool, req);
    const { environmentId } = parse(z.object({ environmentId: uuidParam }), req.params);
    const body = parse(z.object({ number: z.number().int().min(1) }), req.body);
    const { env, ctx } = await loadEnv(pool, a, environmentId);
    requireEnv(a, ctx, env.id, "write");
    const src = await pool.query("SELECT id FROM versions WHERE environment_id = $1 AND number = $2", [env.id, body.number]);
    if (!src.rows[0]) throw notFound("Version not found");
    const dek = dekOf(ctx);
    const v = await tx(pool, async (c) => {
      const vars = await readVersionVars(c, dek, src.rows[0].id);
      return appendVersion(c, { environmentId: env.id, dek, vars, message: `Rolled back to v${body.number}`, authorId: a.user.id });
    });
    if (v.created) await audit(pool, { orgId: ctx.project.orgId, projectId: env.projectId, actorId: a.user.id, action: "variables.rollback", target: env.name, meta: { to: body.number, version: v.number }, ip: req.ip });
    reply.code(v.created ? 201 : 200);
    return { version: { id: v.id, number: v.number }, unchanged: !v.created };
  });

  app.get("/api/v1/environments/:environmentId/diff", async (req) => {
    const a = await authenticate(pool, req);
    const { environmentId } = parse(z.object({ environmentId: uuidParam }), req.params);
    const q = parse(z.object({ from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1), reveal: z.enum(["1", "true", "0", "false"]).optional() }), req.query);
    const { env, ctx } = await loadEnv(pool, a, environmentId);
    requireEnv(a, ctx, env.id, "read");
    const rows = await pool.query("SELECT id, number FROM versions WHERE environment_id = $1 AND number = ANY($2::int[])", [env.id, [q.from, q.to]]);
    const byNum = new Map<number, string>(rows.rows.map((r) => [r.number, r.id]));
    if (!byNum.has(q.from) || !byNum.has(q.to)) throw notFound("Version not found");
    const dek = dekOf(ctx);
    const [from, to]: EnvMap[] = [await readVersionVars(pool, dek, byNum.get(q.from)!), await readVersionVars(pool, dek, byNum.get(q.to)!)];
    const d = diffEnv(from!, to!);
    const reveal = q.reveal === "1" || q.reveal === "true";
    if (reveal) await audit(pool, { orgId: ctx.project.orgId, projectId: env.projectId, actorId: a.user.id, action: "variables.read", target: env.name, meta: { diff: [q.from, q.to], via: a.token.kind }, ip: req.ip });
    return {
      from: q.from, to: q.to,
      added: d.added.map((key) => ({ key, ...(reveal ? { new: to![key] } : {}) })),
      removed: d.removed.map((key) => ({ key, ...(reveal ? { old: from![key] } : {}) })),
      changed: d.changed.map((key) => ({ key, ...(reveal ? { old: from![key], new: to![key] } : {}) })),
      unchangedCount: d.unchanged.length,
    };
  });
}
