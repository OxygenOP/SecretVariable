# Roadmap

Done: crypto core, API, CLI, web app (light and dark), teams and per-environment access, audit log, two-step verification (authenticator app, email and recovery codes), invitation expiry, emailed invitations (when SMTP is configured), Docker image and Compose file, CI, desktop shell.

Planned, roughly in order:
1. **Master-key rotation command** (re-wrap project keys) and a documented backup/restore drill.
2. **Password change and reset**, and optional "require two-step verification" for an organisation.
3. **Integrations**: push an environment to GitHub Actions secrets and Vercel with a button/CLI command (plugin interface `Provider.push(project, environment, variables)`).
4. **Desktop polish**: signed installers, "change server" menu entry.
5. **Optional zero-knowledge mode** (client-side encryption). Large change; the schema leaves room for per-member wrapped keys.
6. OIDC single sign-on.

Ideas and votes welcome in issues.
