# SecretVariable

Open-source, self-hostable secret manager for `.env` files, with versioned environments.

> Status: early development. Nothing is usable yet.

## Planned

- Organisations, projects and named environments (dev, staging, prod) with linear version history
- Encrypted storage (AES-256-GCM envelope encryption)
- Web app, CLI (`secretvariable pull` / `push` / `run`) and desktop app
- Invites and per-environment access control
- Self-hosting with Docker + PostgreSQL

## Repository layout

```
apps/server     API server
apps/cli        command-line tool
apps/web        web application
packages/shared shared types
packages/crypto encryption helpers
deploy/         Docker and deployment files
```

## Development

Requires Node.js 20+ and pnpm.

```bash
pnpm install
pnpm typecheck
```

## License

[MIT](LICENSE)
