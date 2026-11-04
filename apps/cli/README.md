# @secretvariable/cli

The command-line tool for [SecretVariable](https://www.secretvariable.com), an open-source, self-hosted home for your team's `.env` files ([source on GitHub](https://github.com/OxygenOP/SecretVariable)). Pull, push and run versioned environment variables from your terminal.

```bash
npm install -g @secretvariable/cli     # Node.js 20+, no other dependencies
svar --version
```

The program is installed under two names: **`svar`** (short) and `secretvariable`.

## Quick start

```bash
svar login --server https://secrets.example.com
cd my-project
svar init                    # link this folder to a project and environment
svar pull                    # write .env from the current environment
svar push -m "rotate Stripe key"   # upload .env as a new version
svar run -- npm start        # inject variables without writing a file
svar log                     # version history
svar diff 3 4                # key names that changed (values only with --reveal)
svar rollback 3              # save version 3 as a new version
```

In CI, set `SECRETVARIABLE_URL` and `SECRETVARIABLE_TOKEN` (a read-only service token from `svar token create`) instead of logging in.

Invite teammates with `svar invite dana@example.com --role viewer --envs staging`; add `--send-email` to have the server email the link (needs SMTP on the server).

## Requirements

You need a SecretVariable server to talk to. It is a single Docker image plus PostgreSQL: see the [self-hosting guide](https://www.secretvariable.com/docs/self-hosting). The full command reference is in the [CLI guide](https://www.secretvariable.com/docs/cli); [installation](https://www.secretvariable.com/docs/installation) walks through the whole setup.

## Security notes

- Credentials are stored in `~/.config/secretvariable/config.json` with mode `0600`. Your password is never stored.
- `svar pull` writes `.env` with mode `0600`.
- Values are never printed unless you ask (`--reveal`).

## License

MIT
