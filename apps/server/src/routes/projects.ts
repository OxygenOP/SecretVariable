import type { FastifyInstance } from "fastify";
import { generateKey, wrapKey } from "@secretvariable/crypto";
import { z } from "zod";
import type { AppCtx } from "../app-context.js";
import { audit } from "../audit.js";
import { authenticate } from "../auth.js";
import { tx } from "../db.js";
import { conflict, forbidden, notFound } from "../errors.js";
import { loadProject, orgRole, requireAdmin } from "../permissions.js";
import { envName, parse, slugify, uuidParam } from "../util.js";

export function projectRoutes(app: FastifyInstance, { pool, config }: AppCtx): void {
  app.get("/api/v1/orgs/:orgId/projects", async (req) => {
    const a = await authenticate(pool, req);
    const { orgId } = parse(z.object({ orgId: uuidParam }), req.params);
    const role = await orgRole(pool, a.user.id, orgId);
    if (!role) throw notFound("Organisation not found");
    const admin = role === "owner" || role === "admin";
    const r = await pool.query(
      `SELECT p.id, p.org_id AS "orgId", p.name, p.slug, p.created_at AS "createdAt",
              CASE WHEN $3 THEN 'admin' ELSE pm.role END AS role,
              (SELECT count(*)::int FROM environments e WHERE e.project_id = p.id) AS "environmentCount"
         FROM projects p LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
        WHERE p.org_id = $1 AND ($3 OR pm.user_id IS NOT NULL)
        ORDER BY p.name`, [orgId, a.user.id, admin]);
    const scoped = a.token.projectId ? r.rows.filter((p) => p.id === a.token.projectId) : r.rows;
    return { projects: scoped };
  });

  app.post("/api/v1/orgs/:orgId/projects", async (req, reply) => {
    const a = await authenticate(pool, req);
    if (a.token.kind === "service") throw forbidden();
    const { orgId } = parse(z.object({ orgId: uuidParam }), req.params);
    const body = parse(z.object({
      name: z.string().trim().min(1).max(80),
      environments: z.array(envName).max(10).default(["development", "staging", "production"]),
    }), req.body);
    const role = await orgRole(pool, a.user.id, orgId);
    if (!role) throw notFound("Organisation not found");
    const slug = slugify(body.name);
    const out = await tx(pool, async (c) => {
      if ((await c.query("SELECT 1 FROM projects WHERE org_id = $1 AND slug = $2", [orgId, slug])).rowCount) {
        throw conflict("A project with that name already exists in this organisation");
      }
      const id = (await c.query("SELECT gen_random_uuid() AS id")).rows[0].id as string;
      const wrapped = wrapKey(config.masterKey, generateKey(), id);
      await c.query("INSERT INTO projects(id, org_id, name, slug, wrapped_dek, created_by) VALUES ($1,$2,$3,$4,$5,$6)", [id, orgId, body.name, slug, wrapped, a.user.id]);
      await c.query("INSERT INTO project_members(project_id, user_id, role, scope) VALUES ($1,$2,'admin','all')", [id, a.user.id]);
      for (const n of new Set(body.environments)) await c.query("INSERT INTO environments(project_id, name) VALUES ($1,$2)", [id, n]);
      await audit(c, { orgId, projectId: id, actorId: a.user.id, action: "project.create", target: body.name, ip: req.ip });
      return { id, orgId, name: body.name, slug, role: "admin" };
    });
    reply.code(201);
    return { project: out };
  });

  app.get("/api/v1/projects/:projectId", async (req) => {
    const a = await authenticate(pool, req);
    const { projectId } = parse(z.object({ projectId: uuidParam }), req.params);
    const ctx = await loadProject(pool, a, projectId);
    const o = await pool.query("SELECT name, slug FROM orgs WHERE id = $1", [ctx.project.orgId]);
    const { wrappedDek: _omit, ...project } = ctx.project;
    return { project: { ...project, role: ctx.role, scope: ctx.scope, orgName: o.rows[0].name, orgSlug: o.rows[0].slug } };
  });

  app.patch("/api/v1/projects/:projectId", async (req) => {
    const a = await authenticate(pool, req);
    const { projectId } = parse(z.object({ projectId: uuidParam }), req.params);
    const body = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
    const ctx = await loadProject(pool, a, projectId);
    requireAdmin(ctx, a);
    const slug = slugify(body.name);
    const dup = await pool.query("SELECT 1 FROM projects WHERE org_id = $1 AND slug = $2 AND id <> $3", [ctx.project.orgId, slug, projectId]);
    if (dup.rowCount) throw conflict("A project with that name already exists in this organisation");
    await pool.query("UPDATE projects SET name = $2, slug = $3 WHERE id = $1", [projectId, body.name, slug]);
    await audit(pool, { orgId: ctx.project.orgId, projectId, actorId: a.user.id, action: "project.rename", target: body.name, ip: req.ip });
    return { ok: true };
  });

  app.delete("/api/v1/projects/:projectId", async (req) => {
    const a = await authenticate(pool, req);
    const { projectId } = parse(z.object({ projectId: uuidParam }), req.params);
    const ctx = await loadProject(pool, a, projectId);
    requireAdmin(ctx, a);
    await audit(pool, { orgId: ctx.project.orgId, actorId: a.user.id, action: "project.delete", target: ctx.project.name, ip: req.ip });
    await pool.query("DELETE FROM projects WHERE id = $1", [projectId]);
    return { ok: true };
  });

  app.get("/api/v1/projects/:projectId/audit", async (req) => {
    const a = await authenticate(pool, req);
    const { projectId } = parse(z.object({ projectId: uuidParam }), req.params);
    const ctx = await loadProject(pool, a, projectId);
    requireAdmin(ctx, a);
    const r = await pool.query(
      `SELECT l.id, l.action, u.name AS "actorName", l.target, l.meta, l.ip, l.created_at AS "createdAt"
         FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id
        WHERE l.project_id = $1 ORDER BY l.id DESC LIMIT 200`, [projectId]);
    return { entries: r.rows };
  });
}
