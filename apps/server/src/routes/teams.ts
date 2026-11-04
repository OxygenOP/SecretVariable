import type { FastifyInstance } from "fastify";
import { generateToken, hashToken } from "@secretvariable/crypto";
import { z } from "zod";
import type { AppCtx } from "../app-context.js";
import { audit } from "../audit.js";
import { authenticate } from "../auth.js";
import { tx, type Q } from "../db.js";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../errors.js";
import { loadProject, orgRole, requireAdmin } from "../permissions.js";
import { parse, uuidParam } from "../util.js";

const role = z.enum(["admin", "editor", "viewer"]);
const scope = z.enum(["all", "selected"]);
const grants = z.array(z.object({ environmentId: uuidParam, access: z.enum(["read", "write"]) })).max(50).default([]);
const accessSchema = z.object({ role, scope: scope.default("all"), grants });

type Grant = { environmentId: string; access: "read" | "write" };

async function checkGrants(q: Q, projectId: string, list: Grant[]) {
  if (!list.length) return;
  const ids = list.map((g) => g.environmentId);
  const r = await q.query("SELECT count(*)::int AS n FROM environments WHERE project_id = $1 AND id = ANY($2::uuid[])", [projectId, ids]);
  if (r.rows[0].n !== new Set(ids).size) throw badRequest("One or more environments do not belong to this project");
}

async function applyAccess(q: Q, projectId: string, userId: string, a: { role: string; scope: string; grants: Grant[] }) {
  await q.query(
    `INSERT INTO project_members(project_id, user_id, role, scope) VALUES ($1,$2,$3,$4)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, scope = EXCLUDED.scope`,
    [projectId, userId, a.role, a.scope]);
  await q.query("DELETE FROM environment_grants WHERE user_id = $2 AND environment_id IN (SELECT id FROM environments WHERE project_id = $1)", [projectId, userId]);
  if (a.scope === "selected") {
    for (const g of a.grants) {
      await q.query("INSERT INTO environment_grants(environment_id, user_id, access) VALUES ($1,$2,$3) ON CONFLICT (environment_id, user_id) DO UPDATE SET access = EXCLUDED.access", [g.environmentId, userId, g.access]);
    }
  }
}

async function adminCount(q: Q, projectId: string): Promise<number> {
  const r = await q.query("SELECT count(*)::int AS n FROM project_members WHERE project_id = $1 AND role = 'admin'", [projectId]);
  return r.rows[0].n;
}

export function teamRoutes(app: FastifyInstance, { pool }: AppCtx): void {
  // ---- project members -------------------------------------------------
  app.get("/api/v1/projects/:projectId/members", async (req) => {
    const a = await authenticate(pool, req);
    const { projectId } = parse(z.object({ projectId: uuidParam }), req.params);
    const ctx = await loadProject(pool, a, projectId);
    const r = await pool.query(
      `SELECT u.id AS "userId", u.name, u.email, pm.role, pm.scope,
              COALESCE((SELECT json_agg(json_build_object('environmentId', eg.environment_id, 'access', eg.access))
                          FROM environment_grants eg JOIN environments e ON e.id = eg.environment_id
                         WHERE e.project_id = pm.project_id AND eg.user_id = pm.user_id), '[]'::json) AS grants
         FROM project_members pm JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = $1 ORDER BY pm.created_at`, [projectId]);
    const org = await pool.query(
      `SELECT u.id AS "userId", u.name, u.email, om.role FROM org_members om JOIN users u ON u.id = om.user_id
        WHERE om.org_id = $1 AND om.role IN ('owner','admin')`, [ctx.project.orgId]);
    const explicit = new Set(r.rows.map((m) => m.userId));
    const orgAdmins = org.rows.filter((o) => !explicit.has(o.userId)).map((o) => ({ ...o, role: "admin", scope: "all", grants: [], viaOrg: true }));
    const all = [...r.rows.map((m) => ({ ...m, viaOrg: false })), ...orgAdmins];
    return { members: ctx.role === "admin" ? all : all.filter((m) => m.userId === a.user.id) };
  });

  app.put("/api/v1/projects/:projectId/members/:userId", async (req) => {
    const a = await authenticate(pool, req);
    const p = parse(z.object({ projectId: uuidParam, userId: uuidParam }), req.params);
    const body = parse(accessSchema, req.body);
    const ctx = await loadProject(pool, a, p.projectId);
    requireAdmin(ctx, a);
    await tx(pool, async (c) => {
      const m = await c.query("SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2 FOR UPDATE", [p.projectId, p.userId]);
      if (!m.rows[0]) throw notFound("Member not found");
      if (m.rows[0].role === "admin" && body.role !== "admin" && (await adminCount(c, p.projectId)) <= 1) {
        throw conflict("A project needs at least one admin");
      }
      await checkGrants(c, p.projectId, body.grants);
      await applyAccess(c, p.projectId, p.userId, body);
      await audit(c, { orgId: ctx.project.orgId, projectId: p.projectId, actorId: a.user.id, action: "member.update", target: p.userId, meta: { role: body.role, scope: body.scope, grants: body.grants.length }, ip: req.ip });
    });
    return { ok: true };
  });

  app.delete("/api/v1/projects/:projectId/members/:userId", async (req) => {
    const a = await authenticate(pool, req);
    const p = parse(z.object({ projectId: uuidParam, userId: uuidParam }), req.params);
    const ctx = await loadProject(pool, a, p.projectId);
    if (p.userId !== a.user.id) requireAdmin(ctx, a);
    await tx(pool, async (c) => {
      const m = await c.query("SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2 FOR UPDATE", [p.projectId, p.userId]);
      if (!m.rows[0]) throw notFound("Member not found");
      if (m.rows[0].role === "admin" && (await adminCount(c, p.projectId)) <= 1) throw conflict("A project needs at least one admin");
      await c.query("DELETE FROM environment_grants WHERE user_id = $2 AND environment_id IN (SELECT id FROM environments WHERE project_id = $1)", [p.projectId, p.userId]);
      await c.query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2", [p.projectId, p.userId]);
      await c.query("UPDATE tokens SET revoked_at = now() WHERE user_id = $2 AND project_id = $1 AND revoked_at IS NULL", [p.projectId, p.userId]);
      await audit(c, { orgId: ctx.project.orgId, projectId: p.projectId, actorId: a.user.id, action: p.userId === a.user.id ? "member.leave" : "member.remove", target: p.userId, ip: req.ip });
    });
    return { ok: true };
  });

  // ---- invites -----------------------------------------------------------
  app.get("/api/v1/projects/:projectId/invites", async (req) => {
    const a = await authenticate(pool, req);
    const { projectId } = parse(z.object({ projectId: uuidParam }), req.params);
    const ctx = await loadProject(pool, a, projectId);
    requireAdmin(ctx, a);
    const r = await pool.query(
      `SELECT id, email, role, scope, grants, expires_at AS "expiresAt", created_at AS "createdAt", (expires_at <= now()) AS expired
         FROM invites WHERE project_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
        ORDER BY created_at DESC`, [projectId]);
    return { invites: r.rows };
  });

  app.post("/api/v1/projects/:projectId/invites", async (req, reply) => {
    const a = await authenticate(pool, req);
    const { projectId } = parse(z.object({ projectId: uuidParam }), req.params);
    const body = parse(accessSchema.extend({ email: z.string().trim().toLowerCase().email().max(254), expiresInDays: z.number().int().min(1).max(30).default(7) }), req.body);
    const ctx = await loadProject(pool, a, projectId);
    requireAdmin(ctx, a);
    if (body.scope === "selected" && !body.grants.length) throw badRequest("Choose at least one environment for a limited invite");
    await checkGrants(pool, projectId, body.grants);
    const existing = await pool.query(
      `SELECT 1 FROM users u JOIN project_members pm ON pm.user_id = u.id AND pm.project_id = $1 WHERE u.email = $2`, [projectId, body.email]);
    if (existing.rowCount) throw conflict("That person is already a member of this project");
    const token = generateToken("svi");
    const r = await pool.query(
      `INSERT INTO invites(project_id, email, role, scope, grants, token_hash, invited_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' days')::interval) RETURNING id, expires_at AS "expiresAt"`,
      [projectId, body.email, body.role, body.scope, JSON.stringify(body.scope === "selected" ? body.grants : []), hashToken(token), a.user.id, String(body.expiresInDays)]);
    await audit(pool, { orgId: ctx.project.orgId, projectId, actorId: a.user.id, action: "invite.create", target: body.email, meta: { role: body.role, scope: body.scope }, ip: req.ip });
    reply.code(201);
    return { invite: { id: r.rows[0].id, email: body.email, expiresAt: r.rows[0].expiresAt }, token };
  });

  /** Give an invitation (including an expired one) a new deadline, counted from now. The link itself does not change. */
  app.post("/api/v1/projects/:projectId/invites/:inviteId/extend", async (req) => {
    const a = await authenticate(pool, req);
    const p = parse(z.object({ projectId: uuidParam, inviteId: uuidParam }), req.params);
    const body = parse(z.object({ expiresInDays: z.number().int().min(1).max(30).default(7) }), req.body);
    const ctx = await loadProject(pool, a, p.projectId);
    requireAdmin(ctx, a);
    const r = await pool.query(
      `UPDATE invites SET expires_at = now() + ($3 || ' days')::interval
        WHERE id = $1 AND project_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING email, expires_at AS "expiresAt"`,
      [p.inviteId, p.projectId, String(body.expiresInDays)]);
    if (!r.rowCount) throw notFound("Invite not found");
    await audit(pool, { orgId: ctx.project.orgId, projectId: p.projectId, actorId: a.user.id, action: "invite.extend", target: r.rows[0].email, meta: { days: body.expiresInDays }, ip: req.ip });
    return { expiresAt: r.rows[0].expiresAt };
  });

  app.delete("/api/v1/projects/:projectId/invites/:inviteId", async (req) => {
    const a = await authenticate(pool, req);
    const p = parse(z.object({ projectId: uuidParam, inviteId: uuidParam }), req.params);
    const ctx = await loadProject(pool, a, p.projectId);
    requireAdmin(ctx, a);
    const r = await pool.query("UPDATE invites SET revoked_at = now() WHERE id = $1 AND project_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL", [p.inviteId, p.projectId]);
    if (!r.rowCount) throw notFound("Invite not found");
    await audit(pool, { orgId: ctx.project.orgId, projectId: p.projectId, actorId: a.user.id, action: "invite.revoke", target: p.inviteId, ip: req.ip });
    return { ok: true };
  });

  /** Invites addressed to the signed-in user's email. */
  app.get("/api/v1/me/invites", async (req) => {
    const a = await authenticate(pool, req);
    const r = await pool.query(
      `SELECT i.id, p.name AS "projectName", o.name AS "orgName", u.name AS "invitedBy", i.role, i.scope, i.expires_at AS "expiresAt"
         FROM invites i JOIN projects p ON p.id = i.project_id JOIN orgs o ON o.id = p.org_id LEFT JOIN users u ON u.id = i.invited_by
        WHERE i.email = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() ORDER BY i.created_at DESC`, [a.user.email]);
    return { invites: r.rows };
  });

  async function accept(a: Awaited<ReturnType<typeof authenticate>>, where: string, value: string, ip: string) {
    if (a.token.kind === "service") throw forbidden();
    return tx(pool, async (c) => {
      const r = await c.query(
        `SELECT i.*, p.org_id, p.name AS project_name FROM invites i JOIN projects p ON p.id = i.project_id
          WHERE ${where} AND i.accepted_at IS NULL AND i.revoked_at IS NULL FOR UPDATE OF i`, [value]);
      const inv = r.rows[0];
      if (!inv) throw notFound("Invite not found. It may have been used or withdrawn.");
      if (inv.expires_at <= new Date()) throw new HttpError(410, "invite_expired", "This invitation has expired. Ask a project admin for a new one.");
      if (inv.email !== a.user.email) throw forbidden("This invite was sent to a different email address");
      await c.query("INSERT INTO org_members(org_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING", [inv.org_id, a.user.id]);
      // drop grants for environments deleted since the invite was sent; never widen the scope
      const wanted: Grant[] = inv.grants;
      const live = await c.query("SELECT id FROM environments WHERE project_id = $1 AND id = ANY($2::uuid[])", [inv.project_id, wanted.map((g) => g.environmentId)]);
      const ok = new Set(live.rows.map((r) => r.id as string));
      await applyAccess(c, inv.project_id, a.user.id, { role: inv.role, scope: inv.scope, grants: wanted.filter((g) => ok.has(g.environmentId)) });
      await c.query("UPDATE invites SET accepted_at = now() WHERE id = $1", [inv.id]);
      await audit(c, { orgId: inv.org_id, projectId: inv.project_id, actorId: a.user.id, action: "invite.accept", target: inv.email, ip });
      return { project: { id: inv.project_id as string, name: inv.project_name as string, orgId: inv.org_id as string } };
    });
  }

  app.post("/api/v1/invites/accept", async (req) => {
    const a = await authenticate(pool, req);
    const body = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    return accept(a, "i.token_hash = $1", hashToken(body.token), req.ip);
  });

  app.post("/api/v1/invites/:inviteId/accept", async (req) => {
    const a = await authenticate(pool, req);
    const { inviteId } = parse(z.object({ inviteId: uuidParam }), req.params);
    return accept(a, "i.id = $1", inviteId, req.ip);
  });

  // ---- organisation members ---------------------------------------------
  app.patch("/api/v1/orgs/:orgId/members/:userId", async (req) => {
    const a = await authenticate(pool, req);
    const p = parse(z.object({ orgId: uuidParam, userId: uuidParam }), req.params);
    const body = parse(z.object({ role: z.enum(["owner", "admin", "member"]) }), req.body);
    if ((await orgRole(pool, a.user.id, p.orgId)) !== "owner" || a.token.kind === "service") throw forbidden("Only organisation owners can change roles");
    await tx(pool, async (c) => {
      const cur = await c.query("SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2 FOR UPDATE", [p.orgId, p.userId]);
      if (!cur.rows[0]) throw notFound("Member not found");
      if (cur.rows[0].role === "owner" && body.role !== "owner") {
        const n = await c.query("SELECT count(*)::int AS n FROM org_members WHERE org_id = $1 AND role = 'owner'", [p.orgId]);
        if (n.rows[0].n <= 1) throw conflict("An organisation needs at least one owner");
      }
      await c.query("UPDATE org_members SET role = $3 WHERE org_id = $1 AND user_id = $2", [p.orgId, p.userId, body.role]);
      await audit(c, { orgId: p.orgId, actorId: a.user.id, action: "org.member.role", target: p.userId, meta: { role: body.role }, ip: req.ip });
    });
    return { ok: true };
  });

  app.delete("/api/v1/orgs/:orgId/members/:userId", async (req) => {
    const a = await authenticate(pool, req);
    const p = parse(z.object({ orgId: uuidParam, userId: uuidParam }), req.params);
    const mine = await orgRole(pool, a.user.id, p.orgId);
    if (!mine) throw notFound("Organisation not found");
    if (p.userId !== a.user.id && mine !== "owner") throw forbidden("Only organisation owners can remove members");
    await tx(pool, async (c) => {
      const cur = await c.query("SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2 FOR UPDATE", [p.orgId, p.userId]);
      if (!cur.rows[0]) throw notFound("Member not found");
      if (cur.rows[0].role === "owner") {
        const n = await c.query("SELECT count(*)::int AS n FROM org_members WHERE org_id = $1 AND role = 'owner'", [p.orgId]);
        if (n.rows[0].n <= 1) throw conflict("An organisation needs at least one owner");
      }
      await c.query(`DELETE FROM environment_grants WHERE user_id = $2 AND environment_id IN
                      (SELECT e.id FROM environments e JOIN projects p ON p.id = e.project_id WHERE p.org_id = $1)`, [p.orgId, p.userId]);
      await c.query("DELETE FROM project_members WHERE user_id = $2 AND project_id IN (SELECT id FROM projects WHERE org_id = $1)", [p.orgId, p.userId]);
      await c.query("UPDATE tokens SET revoked_at = now() WHERE user_id = $2 AND revoked_at IS NULL AND project_id IN (SELECT id FROM projects WHERE org_id = $1)", [p.orgId, p.userId]);
      await c.query("DELETE FROM org_members WHERE org_id = $1 AND user_id = $2", [p.orgId, p.userId]);
      await audit(c, { orgId: p.orgId, actorId: a.user.id, action: "org.member.remove", target: p.userId, ip: req.ip });
    });
    return { ok: true };
  });
}
