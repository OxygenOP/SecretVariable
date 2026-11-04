import type { Q } from "./db.js";

export interface AuditInput {
  orgId?: string | null;
  projectId?: string | null;
  actorId?: string | null;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

/** Audit entries never contain secret values, only names and ids. */
export async function audit(q: Q, a: AuditInput): Promise<void> {
  await q.query(
    "INSERT INTO audit_log(org_id, project_id, actor_id, action, target, meta, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [a.orgId ?? null, a.projectId ?? null, a.actorId ?? null, a.action, a.target ?? null, JSON.stringify(a.meta ?? {}), a.ip ?? null],
  );
}
