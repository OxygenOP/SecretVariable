import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppCtx } from "../app-context.js";
import { audit } from "../audit.js";
import { authenticate, createToken } from "../auth.js";
import { badRequest, forbidden, notFound } from "../errors.js";
import { loadProject, requireAdmin } from "../permissions.js";
import { parse, uuidParam } from "../util.js";

export function tokenRoutes(app: FastifyInstance, { pool }: AppCtx): void {
  app.get("/api/v1/tokens", async (req) => {
    const a = await authenticate(pool, req);
    if (a.token.kind === "service") throw forbidden();
    const r = await pool.query(
      `SELECT t.id, t.kind, t.name, t.access, t.project_id AS "projectId", p.name AS "projectName", t.environment_id AS "environmentId",
              e.name AS "environmentName", t.expires_at AS "expiresAt", t.last_used_at AS "lastUsedAt", t.created_at AS "createdAt"
         FROM tokens t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN environments e ON e.id = t.environment_id
        WHERE t.user_id = $1 AND t.kind <> 'session' AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())
        ORDER BY t.created_at DESC`, [a.user.id]);
    return { tokens: r.rows };
  });

  app.post("/api/v1/tokens", async (req, reply) => {
    const a = await authenticate(pool, req);
    if (a.token.kind !== "session" && a.token.kind !== "personal") throw forbidden();
    const body = parse(z.object({
      name: z.string().trim().min(1).max(80),
      kind: z.enum(["personal", "service"]).default("personal"),
      projectId: uuidParam.optional(),
      environmentId: uuidParam.optional(),
      access: z.enum(["read", "write"]).default("read"),
      expiresInDays: z.number().int().min(1).max(730).optional(),
    }), req.body);
    if (body.kind === "service" && !body.projectId) throw badRequest("Service tokens must be scoped to a project");
    let orgId: string | null = null;
    if (body.projectId) {
      const ctx = await loadProject(pool, a, body.projectId);
      orgId = ctx.project.orgId;
      if (body.kind === "service") requireAdmin(ctx, a);
      if (body.environmentId) {
        const e = await pool.query("SELECT 1 FROM environments WHERE id = $1 AND project_id = $2", [body.environmentId, body.projectId]);
        if (!e.rowCount) throw notFound("Environment not found");
      }
    } else if (body.environmentId) throw badRequest("environmentId requires projectId");
    const t = await createToken(pool, {
      userId: a.user.id, kind: body.kind, name: body.name, projectId: body.projectId, environmentId: body.environmentId, access: body.access,
      expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
    });
    await audit(pool, { orgId, projectId: body.projectId, actorId: a.user.id, action: "token.create", target: body.name, meta: { kind: body.kind, access: body.access }, ip: req.ip });
    reply.code(201);
    return { id: t.id, token: t.token };
  });

  app.delete("/api/v1/tokens/:tokenId", async (req) => {
    const a = await authenticate(pool, req);
    const { tokenId } = parse(z.object({ tokenId: uuidParam }), req.params);
    const r = await pool.query("UPDATE tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND kind <> 'session' AND revoked_at IS NULL RETURNING name", [tokenId, a.user.id]);
    if (!r.rowCount) throw notFound("Token not found");
    await audit(pool, { actorId: a.user.id, action: "token.revoke", target: r.rows[0].name, ip: req.ip });
    return { ok: true };
  });
}
