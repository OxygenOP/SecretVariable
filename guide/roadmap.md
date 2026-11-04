# Roadmap

Done: crypto core, API, CLI, web app, teams and per-environment access, audit log, Docker image and Compose file, CI, desktop shell.

Planned, roughly in order:
1. **Master-key rotation command** (re-wrap project keys) and a documented backup/restore drill.
2. **Two-factor authentication** (TOTP) and password change/reset.
3. **Email delivery** for invitations (optional SMTP).
4. **Integrations**: push an environment to GitHub Actions secrets and Vercel with a button/CLI command (plugin interface `Provider.push(project, environment, variables)`).
5. **Desktop polish**: signed installers, "change server" menu entry.
6. **Optional zero-knowledge mode** (client-side encryption). Large change; the schema leaves room for per-member wrapped keys.
7. OIDC single sign-on.

Ideas and votes welcome in issues.
