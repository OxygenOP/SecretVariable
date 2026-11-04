import type { Access, ProjectRole } from "@secretvariable/shared";
import type { AuthContext } from "./auth.js";
import type { Q } from "./db.js";
import { forbidden, notFound } from "./errors.js";

export interface ProjectCtx {
  project: { id: string; orgId: string; name: string; slug: string; wrappedDek: string; createdAt: string };
  role: ProjectRole;
  viaOrg: boolean;
  scope: "all" | "selected";
  grants: Map<string, Access>;
}

const rank = { read: 1, write: 2 } as const;
const min = (a: Access, b: Access): Access => (rank[a] <= rank[b] ? a : b);

/**
 * Load a project and work out what the caller may do in it.
 * Returns 404 (not 403) when the caller cannot see the project at all, so ids do not leak.
 */
export async function loadProject(q: Q, auth: AuthContext, projectId: string): Promise<ProjectCtx> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw notFound("Project not found");
  if (auth.token.projectId && auth.token.projectId !== projectId) throw notFound("Project not found");
  const r = await q.query(
    `SELECT p.id, p.org_id, p.name, p.slug, p.wrapped_dek, p.created_at,
            om.role AS org_role, pm.role AS project_role, pm.scope AS scope
       FROM projects p
       LEFT JOIN org_members om ON om.org_id = p.org_id AND om.user_id = $2
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
      WHERE p.id = $1`,
    [projectId, auth.user.id],
  );
  const row = r.rows[0];
  if (!row) throw notFound("Project not found");
  const viaOrg = row.org_role === "owner" || row.org_role === "admin";
  const role: ProjectRole | null = viaOrg ? "admin" : row.project_role;
  if (!role) throw notFound("Project not found");
  const scope: "all" | "selected" = viaOrg ? "all" : row.scope;
  const grants = new Map<string, Access>();
  if (scope === "selected") {
    const g = await q.query(
      `SELECT eg.environment_id, eg.access FROM environment_grants eg
         JOIN environments e ON e.id = eg.environment_id
        WHERE e.project_id = $1 AND eg.user_id = $2`,
      [projectId, auth.user.id],
    );
    for (const x of g.rows) grants.set(x.environment_id, x.access);
  }
  return {
    project: { id: row.id, orgId: row.org_id, name: row.name, slug: row.slug, wrappedDek: row.wrapped_dek, createdAt: row.created_at.toISOString() },
    role, viaOrg, scope, grants,
  };
}

/** What the caller may do with one environment, or null for no access. */
export function envAccess(auth: AuthContext, ctx: ProjectCtx, environmentId: string): Access | null {
  const t = auth.token;
  if (t.environmentId && t.environmentId !== environmentId) return null;
  let a: Access | null;
  if (ctx.role === "admin") a = "write";
  else {
    const roleCap: Access = ctx.role === "editor" ? "write" : "read";
    if (ctx.scope === "all") a = roleCap;
    else {
      const g = ctx.grants.get(environmentId);
      a = g ? min(g, roleCap) : null;
    }
  }
  if (!a) return null;
  return t.kind === "session" ? a : min(a, t.access);
}

export function requireAdmin(ctx: ProjectCtx, auth: AuthContext): void {
  const t = auth.token;
  const fullToken = t.kind === "session" || (t.kind === "personal" && t.access === "write" && !t.projectId && !t.environmentId);
  if (ctx.role !== "admin" || !fullToken) {
    throw forbidden("Only project admins can do that");
  }
}

export function requireEnv(auth: AuthContext, ctx: ProjectCtx, environmentId: string, need: Access): Access {
  const a = envAccess(auth, ctx, environmentId);
  if (!a) throw notFound("Environment not found");
  if (need === "write" && a !== "write") throw forbidden("You have read-only access to this environment");
  return a;
}

export async function orgRole(q: Q, userId: string, orgId: string): Promise<"owner" | "admin" | "member" | null> {
  const r = await q.query("SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2", [orgId, userId]);
  return r.rows[0]?.role ?? null;
}
