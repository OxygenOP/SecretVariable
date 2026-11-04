# Self-hosting guide

SecretVariable is one container (API + web app) plus PostgreSQL.

## Requirements
- Docker with Compose, or Node.js 20+ and PostgreSQL 14+
- A domain name and a TLS-terminating reverse proxy for anything beyond local testing

## 1. Generate and protect the master key

```bash
openssl rand -hex 32
```

The **master key** wraps every project's data key. Without it, stored data cannot be decrypted, and nobody (including the maintainers) can recover it. Store it in a password manager or secret store **separate from your database backups**. Rotating it is not automated yet (see [roadmap](roadmap.md)).

## 2. Start with Docker Compose

```bash
git clone https://github.com/OxygenOP/SecretVariable.git && cd SecretVariable
cp .env.example .env        # then edit .env: SV_MASTER_KEY, POSTGRES_PASSWORD
docker compose up -d
docker compose logs -f app
```

Migrations run automatically at start. Open `http://localhost:8080`. The first account you register owns its own workspace; invite others to projects from the web app.

### Without Docker

```bash
pnpm install && pnpm build
export DATABASE_URL=postgres://user:pass@localhost:5432/secretvariable
export SV_MASTER_KEY=<64 hex characters>
export SV_WEB_DIR=$PWD/apps/web/dist
node apps/server/dist/index.js
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `SV_MASTER_KEY` | required | 32 bytes as 64 hex characters (or base64) |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `SV_WEB_DIR` | unset | Folder with the built web app (set in the Docker image) |
| `SV_ALLOW_REGISTRATION` | `true` | Set `false` to close public sign-up once your team has accounts. Invited people must already have an account, so create theirs first or re-open registration briefly |
| `SV_SESSION_TTL_DAYS` | `30` | Web sign-in lifetime |
| `SV_AUTH_RATE_LIMIT` | `20` | Login/register attempts per minute per IP |
| `SV_LOG` | `true` | Request logging (the Authorization header is redacted) |

## HTTPS with a reverse proxy

The app trusts `X-Forwarded-*` headers (for client IPs in the audit log and rate limits), so only expose the proxy, not the app port.

Caddy (automatic certificates):

```
secrets.example.com {
    reverse_proxy app:8080
}
```

nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name secrets.example.com;
    # ssl_certificate ...;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

In `docker-compose.yml`, change the app's `ports` to `"127.0.0.1:8080:8080"` when a proxy runs on the same host.

## Backups
You need **both** of these, kept separately:

1. The database: `docker compose exec db pg_dump -U secretvariable secretvariable > backup.sql`
2. The master key.

Restore: start a fresh stack with the same `SV_MASTER_KEY`, then `psql ... < backup.sql`. Test a restore before you rely on it.

## Upgrades

```bash
git pull
docker compose build
docker compose up -d       # migrations run on start
```

Back up before upgrading. Check the [changelog](../CHANGELOG.md) for notes.

## Operating notes
- Health check: `GET /api/health`.
- Logs go to stdout. They never contain secret values.
- Run the app as a non-root user (the image does) and keep PostgreSQL off the public internet.
- Invitations are links you share yourself; the server does not send email.
