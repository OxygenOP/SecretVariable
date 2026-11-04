# Security

## The model in one sentence
The server keeps secrets encrypted at rest and decrypts them only to serve an authorised request, so protect the **server, its database backups and the master key** as carefully as the secrets themselves.

## What is protected
- **Database theft.** Values are AES-256-GCM encrypted. A stolen database (or backup) without the master key reveals variable names and metadata, not values.
- **Tampering and swapping.** Each value is bound to its version and key name as authenticated data. Moving a ciphertext to another key or version makes decryption fail instead of returning the wrong secret.
- **Passwords.** Argon2id. Wrong-email and wrong-password logins take similar time.
- **Tokens.** Session, personal, service and invite tokens are random 256-bit values stored only as SHA-256 hashes. They are shown once.
- **Authorization.** Every request is checked against organisation role, project role, per-environment access and token scope. Resources you cannot see return 404, not 403.
- **Auditing.** Reads of values, writes, rollbacks, sharing and token events are recorded with actor and IP. Values never appear in the audit log or request logs.
- **Browser.** Values are masked until revealed. Name-only views (the variables list, history, diffs) never decrypt anything.

## What is NOT protected
- **A malicious or compromised server operator.** Anyone with the master key and database access can decrypt everything. This is not a zero-knowledge design.
- **A compromised machine** that has pulled a `.env`: the file is plain text on disk (mode `0600`). Prefer `svar run -- cmd` where you can.
- **Variable names and version messages** are stored in plain text.
- **Account takeover** through a weak or reused password is reduced, not removed: two-step verification is optional per user, and personal/service tokens (which are for scripts and CI) do not need a second step. Treat them like passwords and keep them scoped and short-lived.
- **Email codes are only as safe as the mailbox.** If someone controls a user's email and password they can sign in with an emailed code. Turn email codes off (Account > Two-step verification) for people who want authenticator-only sign-in.
- **Browser storage.** The web app keeps its session token in `localStorage`; an XSS bug would expose it. The app sets no cookies and renders all values through React's escaping.

## Two-step verification
Each person can turn it on under **Account > Two-step verification**.

- **Authenticator app (TOTP, RFC 6238):** 6-digit codes that change every 30 seconds, set up by scanning a QR code. The secret is encrypted with the master key like project keys are; a code is accepted once (replays are rejected) with one step of clock drift allowed.
- **Recovery codes:** 10 single-use codes shown once at setup; stored only as keyed hashes. Regenerating replaces all of them.
- **Email codes (backup):** a 6-digit code emailed on request, valid for 10 minutes and once, limited to 3 emails per sign-in and one per minute. Needs SMTP ([self-hosting guide](self-hosting.md#email)); otherwise the option is hidden. Stored only as a keyed hash.
- **How sign-in works:** the correct password returns no session, only a 5-minute challenge. A challenge allows 5 attempts in total (counted before the code is checked, so parallel guessing cannot beat the limit), then must be restarted.
- **Sensitive changes** (turning it off, new recovery codes, email-code switch) need the password and a current code. Turning it on signs out every other session.
- Everything is recorded in the audit log (never the codes).

## Key hierarchy
```
master key (you provide, never stored in the DB)
  └── wraps → per-project data key (random 256-bit, stored wrapped)
                └── encrypts → each variable value (AES-256-GCM, fresh 96-bit nonce)
```
Rotating the master key means re-wrapping the per-project keys (a helper exists in `packages/crypto`; there is no command for it yet).

## Hardening checklist
- Terminate TLS in front of the app; never expose port 8080 directly.
- Back up the master key separately from database backups.
- Set `SV_ALLOW_REGISTRATION=false` after onboarding.
- Use read-only, environment-scoped, expiring service tokens in CI.
- Restrict who is org owner/admin: they can see every project in the organisation.
- Keep PostgreSQL private and patched; keep the image updated.
- Review the audit log (Project > Audit log, Organisation > Activity).

## Reporting a vulnerability
See [SECURITY.md](../SECURITY.md). Please do not open a public issue for security problems.
