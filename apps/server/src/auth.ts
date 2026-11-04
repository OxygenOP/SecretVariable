import argon2 from "argon2";
import { generateToken, hashToken } from "@secretvariable/crypto";
import type { FastifyRequest } from "fastify";
import type { Q } from "./db.js";
import { unauthorized } from "./errors.js";

export interface AuthUser { id: string; email: string; name: string }
export interface AuthToken {
  id: string;
  kind: "session" | "personal" | "service";
  projectId: string | null;
  environmentId: string | null;
  access: "read" | "write";
}
export interface AuthContext { user: AuthUser; token: AuthToken }

declare module "fastify" {
  interface FastifyRequest { auth?: AuthContext }
}

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });
export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw).catch(() => false);

const PREFIX = { session: "svs", personal: "svp", service: "svt" } as const;

export interface NewToken {
  userId: string;
  kind: AuthToken["kind"];
  name?: string;
  projectId?: string | null;
  environmentId?: string | null;
  access?: "read" | "write";
  expiresAt?: Date | null;
}

/** Returns the raw token once; only its hash is stored. */
export async function createToken(q: Q, t: NewToken): Promise<{ token: string; id: string }> {
  const token = generateToken(PREFIX[t.kind]);
  const r = await q.query(
    `INSERT INTO tokens(user_id, kind, name, token_hash, project_id, environment_id, access, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [t.userId, t.kind, t.name ?? "", hashToken(token), t.projectId ?? null, t.environmentId ?? null, t.access ?? "write", t.expiresAt ?? null],
  );
  return { token, id: r.rows[0].id as string };
}

export async function authenticate(q: Q, req: FastifyRequest): Promise<AuthContext> {
  const header = req.headers.authorization;
  const m = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  if (!m) throw unauthorized();
  const r = await q.query(
    `SELECT t.id, t.kind, t.project_id, t.environment_id, t.access, t.last_used_at,
            u.id AS user_id, u.email, u.name
       FROM tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())`,
    [hashToken(m[1]!)],
  );
  const row = r.rows[0];
  if (!row) throw unauthorized("Invalid or expired token");
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000) {
    void q.query("UPDATE tokens SET last_used_at = now() WHERE id = $1", [row.id]).catch(() => {});
  }
  return {
    user: { id: row.user_id, email: row.email, name: row.name },
    token: { id: row.id, kind: row.kind, projectId: row.project_id, environmentId: row.environment_id, access: row.access },
  };
}
