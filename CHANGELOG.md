# Changelog

All notable changes are recorded here. The project follows [Semantic Versioning](https://semver.org/) once it reaches 1.0; until then minor versions may include breaking changes.

## 0.2.0

- `svar env use <name>` now switches the env file too, in one step. It only replaces the file when nothing would be lost (untouched since the last pull or push, or nothing the current environment lacks); otherwise it stops and lists the keys, with `--backup`, `--discard` and `--no-pull` as the ways forward, or a prompt in a terminal. `svar env use -` returns to the previous environment, and unambiguous prefixes (`prod`, `dev`) work for names and for `--env`.
- `svar pull` updates a file you have not edited without `--force`, and has `--backup`. The CLI remembers what it last wrote in `.secretvariable.state.json` (a salted fingerprint, never contents).
- `svar env list` shows the project and the environment in use; `pull`, `push` and `status` print the project name.
- In a terminal, `svar push` to a `production` environment asks for confirmation (`--yes` skips; scripts are not blocked).

## 0.1.1

- The npm package page and the README now link to the website, <https://www.secretvariable.com>, and its guides. No code changes.

## 0.1.0

First public version.

### Added
- Emailed invitations: when SMTP is configured, admins can have the server email the invitation link (web app checkbox, `svar invite --send-email`, `sendEmail` in the API), and resend it from the pending invitations list (a resend issues a fresh link and retires the old one). The invitation is still created if the mail server fails, so the link can be shared by hand. New `SV_PUBLIC_URL` setting for the link's address; `/api/config` reports `emailEnabled`.
- Two-step verification: authenticator app (TOTP) with QR setup, one-time email codes as a backup (optional SMTP: `SV_SMTP_URL`, `SV_MAIL_FROM`), 10 single-use recovery codes, attempt limits, replay protection, audit events; supported in the web app and `svar login` (`--code`, `--method`).
- Invitation expiry: choose 1-30 days when inviting, see and extend expired invitations, clear "expired" message for the invitee; `svar invite --expires`.
- Light theme with a switch (rail, sign-in page and Account > Appearance). Follows the system setting by default and is applied before first paint.
- Short command `svar` (same program as `secretvariable`; chosen because `sv` is already the Svelte CLI and a Linux runit command).
- Envelope encryption (AES-256-GCM) with a master key and per-project data keys.
- API: accounts, organisations, projects, environments, linear versions, diff, rollback, members, per-environment access, invitations, personal and service tokens, audit log.
- Command-line tool: login, init, env, pull, push, status, run, log, diff, rollback, invite, accept, members, token.
- Web app (dark "data terminal" style, with a light theme) with desktop and phone layouts.
- Tauri desktop shell.
- Dockerfile, Docker Compose, GitHub Actions CI.
