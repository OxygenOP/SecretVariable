import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppCtx } from "../app-context.js";
import { audit } from "../audit.js";
import { authenticate } from "../auth.js";
import { tx } from "../db.js";
import { conflict, forbidden, notFound } from "../errors.js";
import { orgRole } from "../permissions.js";
import { parse, slugify, uuidParam } from "../util.js";

export function orgRoutes(app: FastifyInstance, { pool }: AppCtx): void {
  app.get("/api/v1/orgs", async (req) => {
    const a = await authenticate(pool, req);
    const r = await pool.query(
      `SELECT o.id, o.name, o.slug, om.role FROM orgs o JOIN org_members om ON om.org_id = o.id
        WHERE om.user_id = $1 ORDER BY o.created_at`, [a.user.id]);
    return { orgs: r.rows };
  });

  app.post("/api/v1/orgs", async (req, reply) => {
    const a = await authenticate(pool, req);
    if (a.token.kind === "service") throw forbidden();
    const body = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
    const slug = slugify(body.name);
    const org = await tx(pool, async (c) => {
      if ((await c.query("SELECT 1 FROM orgs WHERE slug = $1", [slug])).rowCount) throw conflict("An organisation with that name already exists");
      const o = await c.query("INSERT INTO orgs(name, slug, created_by) VALUES ($1,$2,$3) RETURNING id", [body.name, slug, a.user.id]);
      await c.query("INSERT INTO org_members(org_id, user_id, role) VALUES ($1,$2,'owner')", [o.rows[0].id, a.user.id]);
      await audit(c, { orgId: o.rows[0].id, actorId: a.user.id, action: "org.create", target: body.name, ip: req.ip });
      return { id: o.rows[0].id, name: body.name, slug, role: "owner" };
    });
    reply.code(201);
    return { org };
  });

  app.get("/api/v1/orgs/:orgId", async (req) => {
    const a = await authenticate(pool, req);
    const { orgId } = parse(z.object({ orgId: uuidParam }), req.params);
    const role = await orgRole(pool, a.user.id, orgId);
    if (!role) throw notFound("Organisation not found");
    const o = await pool.query("SELECT id, name, slug FROM orgs WHERE id = $1", [orgId]);
    const m = await pool.query(
      `SELECT u.id AS "userId", u.name, u.email, om.role FROM org_members om JOIN users u ON u.id = om.user_id
        WHERE om.org_id = $1 ORDER BY om.created_at`, [orgId]);
    return { org: { ...o.rows[0], role }, members: role === "member" ? m.rows.filter((x) => x.userId === a.user.id) : m.rows };
  });

  app.get("/api/v1/orgs/:orgId/audit", async (req) => {
    const a = await authenticate(pool, req);
    const { orgId } = parse(z.object({ orgId: uuidParam }), req.params);
    const role = await orgRole(pool, a.user.id, orgId);
    if (!role) throw notFound("Organisation not found");
    if (role === "member") throw forbidden("Only organisation admins can view the audit log");
    const r = await pool.query(
      `SELECT l.id, l.action, u.name AS "actorName", l.target, l.meta, l.ip, l.created_at AS "createdAt", p.name AS "projectName"
         FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id LEFT JOIN projects p ON p.id = l.project_id
        WHERE l.org_id = $1 ORDER BY l.id DESC LIMIT 200`, [orgId]);
    return { entries: r.rows };
  });
}
