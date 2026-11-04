# Architecture

```
 web app ─┐
 CLI ─────┼── REST/JSON (/api/v1, bearer tokens) ──► Fastify server ──► PostgreSQL
 desktop ─┘                                           │ crypto (master key from env)
```

One server, three thin clients. The web app is static files served by the same server; the desktop app only wraps it.

## Concepts
| Concept | Notes |
|---|---|
| Organisation | Owns projects. Owner/admin see every project. Every user starts with a personal one. |
| Project | Has a wrapped data key, environments, members. |
| Environment | A named set of variables (`development`...). Own linear history; `head_version_id` points at the current version. |
| Version | Immutable, numbered per environment, with author, message and a key-name change summary. |
| Variable | `(version, key) -> encrypted value`. |
| Member | Project role (`admin`/`editor`/`viewer`) with scope `all` or `selected` environments (grants: `read`/`write`). |
| Token | `session` (web), `personal` (CLI), `service` (CI, project/environment scoped). |

## Permission model
1. Org owner/admin: project admin everywhere.
2. Otherwise the project role decides read/write; a viewer is read-only even if granted write.
3. With scope `selected`, only granted environments exist for that person.
4. Tokens can only narrow access (project, environment, read-only), never widen it, and act as their creator, so removing the person disables the token.
5. Administrative actions (members, invitations, tokens, settings) need a session or unscoped write personal token.

## Versioning
Writing locks the environment row, compares the new content with the head, and only then appends `n+1` (identical content creates nothing). Rollback appends a copy of an old version. History is never rewritten, so concurrent writers get distinct numbers.

## API overview
Auth: `POST /auth/register|login|logout`, `GET /me`. Orgs: `/orgs`, `/orgs/:id`, members, audit. Projects: `/orgs/:id/projects`, `/projects/:id`, audit. Environments: `/projects/:id/environments`, `/environments/:id`. Versions: `GET|POST /environments/:id/versions`, `GET .../versions/:n|head[?keys=1]`, `POST .../rollback`, `GET .../diff?from&to[&reveal=1]`. Team: members, invites, `/me/invites`, `/invites/accept`. Tokens: `/tokens`. Health: `/api/health`, `/api/config`.

Errors are `{ "error": { "code", "message" } }`.

## Schema
Migrations are in `apps/server/src/migrations.ts` and run on start under an advisory lock.
