export type OrgRole = "owner" | "admin" | "member";
export type ProjectRole = "admin" | "editor" | "viewer";
export type Access = "read" | "write";
export type MemberScope = "all" | "selected";

export interface User { id: string; email: string; name: string }
export interface Org { id: string; name: string; slug: string; role: OrgRole }
export interface Project { id: string; orgId: string; name: string; slug: string; createdAt: string; role: ProjectRole | "owner"; environmentCount?: number }
export interface Environment { id: string; projectId: string; name: string; headNumber: number | null; headVersionId: string | null; variableCount: number; updatedAt: string | null; access: Access }
export interface VersionSummary { id: string; number: number; message: string; authorName: string | null; createdAt: string; variableCount: number }
export interface MemberInfo { userId: string; name: string; email: string; role: ProjectRole | "owner"; scope: MemberScope; environmentIds: string[]; grants: { environmentId: string; access: Access }[] }
export interface InviteInfo { id: string; email: string; role: ProjectRole; scope: MemberScope; expiresAt: string; acceptedAt: string | null; environmentIds: string[] }
export interface AuditEntry { id: number; action: string; actorName: string | null; target: string | null; meta: Record<string, unknown>; ip: string | null; createdAt: string }
