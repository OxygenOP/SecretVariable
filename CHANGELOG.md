# Changelog

All notable changes are recorded here. The project follows [Semantic Versioning](https://semver.org/) once it reaches 1.0; until then minor versions may include breaking changes.

## [Unreleased] - 0.1.0

First public version.

### Added
- Light theme with a switch (rail, sign-in page and Account > Appearance). Follows the system setting by default and is applied before first paint.
- Short command `sv` (same program as `secretvariable`).
- Envelope encryption (AES-256-GCM) with a master key and per-project data keys.
- API: accounts, organisations, projects, environments, linear versions, diff, rollback, members, per-environment access, invitations, personal and service tokens, audit log.
- Command-line tool: login, init, env, pull, push, status, run, log, diff, rollback, invite, accept, members, token.
- Web app (dark "data terminal" style, with a light theme) with desktop and phone layouts.
- Tauri desktop shell.
- Dockerfile, Docker Compose, GitHub Actions CI.
