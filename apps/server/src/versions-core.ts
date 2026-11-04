import { decryptValue, encryptValue, unwrapKey } from "@secretvariable/crypto";
import { envEqual, type EnvMap } from "@secretvariable/shared";
import type { Q } from "./db.js";

export function projectKey(masterKey: Buffer, projectId: string, wrapped: string): Buffer {
  return unwrapKey(masterKey, wrapped, projectId);
}

export async function readVersionVars(q: Q, dek: Buffer, versionId: string): Promise<EnvMap> {
  const r = await q.query("SELECT key, encrypted_value FROM variables WHERE version_id = $1", [versionId]);
  const out: EnvMap = {};
  for (const row of r.rows) out[row.key] = decryptValue(dek, row.encrypted_value, `${versionId}:${row.key}`);
  return out;
}

export interface NewVersion {
  environmentId: string;
  dek: Buffer;
  vars: EnvMap;
  message: string;
  authorId: string;
}

/**
 * Append a version to an environment. Must run inside a transaction.
 * If the variables equal the current head, nothing is written and `created` is false.
 */
export async function appendVersion(c: Q, n: NewVersion): Promise<{ id: string; number: number; created: boolean }> {
  // Lock the environment row first, then read the head in a fresh statement so a
  // concurrent writer's new head is visible (READ COMMITTED re-reads only the locked row).
  await c.query("SELECT 1 FROM environments WHERE id = $1 FOR UPDATE", [n.environmentId]);
  const env = await c.query(
    `SELECT e.head_version_id, v.number AS head_number
       FROM environments e LEFT JOIN versions v ON v.id = e.head_version_id
      WHERE e.id = $1`, [n.environmentId]);
  const head = env.rows[0];
  if (head.head_version_id) {
    const current = await readVersionVars(c, n.dek, head.head_version_id);
    if (envEqual(current, n.vars)) return { id: head.head_version_id, number: head.head_number, created: false };
  }
  const number = (head.head_number ?? 0) + 1;
  const v = await c.query(
    "INSERT INTO versions(environment_id, number, parent_version_id, message, author_id) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [n.environmentId, number, head.head_version_id, n.message, n.authorId]);
  const versionId = v.rows[0].id as string;
  for (const [key, value] of Object.entries(n.vars)) {
    await c.query("INSERT INTO variables(version_id, key, encrypted_value) VALUES ($1,$2,$3)", [versionId, key, encryptValue(n.dek, value, `${versionId}:${key}`)]);
  }
  await c.query("UPDATE environments SET head_version_id = $2 WHERE id = $1", [n.environmentId, versionId]);
  return { id: versionId, number, created: true };
}
