# Roadmap

Done: crypto core, API, CLI, web app (light and dark), teams and per-environment access, audit log, two-step verification (authenticator app, email and recovery codes), invitation expiry, Docker image and Compose file, CI, desktop shell.

Planned, roughly in order:
1. **Master-key rotation command** (re-wrap project keys) and a documented backup/restore drill.
2. **Password change and reset**, and optional "require two-step verification" for an organisation.
3. **Email delivery** for invitations (SMTP is already used for sign-in codes).
4. **Integrations**: push an environment to GitHub Actions secrets and Vercel with a button/CLI command (plugin interface `Provider.push(project, environment, variables)`).
5. **Desktop polish**: signed installers, "change server" menu entry.
6. **Optional zero-knowledge mode** (client-side encryption). Large change; the schema leaves room for per-member wrapped keys.
7. OIDC single sign-on.

Ideas and votes welcome in issues.
