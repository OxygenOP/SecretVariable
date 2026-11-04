# Development guide

## Setup
Requirements: Node.js 20+ (22 recommended), pnpm 10, PostgreSQL 14+.

```bash
pnpm install
createdb secretvariable && createdb secretvariable_test
export DATABASE_URL=postgres://localhost/secretvariable
export SV_MASTER_KEY=$(openssl rand -hex 32)
pnpm build                                   # builds shared packages first
pnpm --filter @secretvariable/server seed:demo   # optional: demo workspace (demo@secretvariable.dev / demo-password-123)
pnpm --filter @secretvariable/server dev     # API on :8080
pnpm --filter @secretvariable/web dev        # web app on :5173, proxies /api to :8080
```

## Tests
```bash
export TEST_DATABASE_URL=postgres://localhost/secretvariable_test   # WARNING: the schema is dropped on every run
pnpm test            # crypto, shared, web, CLI, server
pnpm typecheck
```
- `packages/*`: unit tests.
- `apps/server`, `apps/cli`: integration tests against a real PostgreSQL (the CLI tests run the real CLI code against an in-process server).
- `apps/web/e2e`: browser end-to-end test. Needs Playwright with Chromium (`npx playwright install chromium`) and a running server with the built web app:
  ```bash
  pnpm --filter @secretvariable/web build
  SV_WEB_DIR=$PWD/apps/web/dist node apps/server/dist/index.js &
  SV_E2E_URL=http://localhost:8080 pnpm --filter @secretvariable/web e2e
  # optional: also test emailed codes by starting the server with SV_SMTP_URL=console SV_LOG=true,
  # redirecting its output to a file, and passing SV_E2E_MAIL_LOG=<that file>
  ```

## Layout
See the [README](../README.md#how-it-is-built) and [architecture](architecture.md).

## Conventions
- TypeScript strict; ESM; no runtime dependency without a reason.
- Never log secret values. Audit entries contain names and ids only.
- Anything that grants access needs a test for the denied case.
- Web UI follows `apps/web/src/styles.css` tokens (dark "data terminal" style): colour only on data and status, accent only as a 1px selection line.
- Keep `docker build` working: the server is bundled with `pnpm deploy`.
