# Command-line reference

## Install

Once published to npm:

```bash
npm install -g @secretvariable/cli
```

From source (Node.js 20+, pnpm):

```bash
pnpm install && pnpm --filter @secretvariable/cli build
node apps/cli/dist/index.js help     # or: pnpm --filter @secretvariable/cli link --global
```

## Sign in

```bash
secretvariable login --server https://secrets.example.com
```

You are asked for your email and password (they can also be passed with `--email` and `--password`). The password is exchanged for a 90-day personal token and is never stored. Credentials live in `~/.config/secretvariable/config.json` (mode `0600`). `secretvariable login --token <token>` signs in with an existing token. `secretvariable logout` forgets the local credentials; revoke the token in the web app (Account) or with `secretvariable token revoke <id>`.

## Link a folder to a project

```bash
secretvariable init                                   # choose interactively
secretvariable init --org acme --project payments-api # no prompts
secretvariable init --create --project "New app"      # create it first
```

This writes `.secretvariable.json` (project id and current environment; contains no secrets, safe to commit).

## Sync

| Command | What it does |
|---|---|
| `pull [--env E] [--version N] [--file F] [--force]` | Write the environment's variables to `.env` (mode `0600`). Refuses to overwrite local-only or differing keys unless `--force`. Warns if `.env` is not in `.gitignore`. |
| `push [--env E] [--file F] [-m msg] [--yes]` | Upload `.env` as a new version. Shows `+ added ~ changed - removed` first. Removing variables asks for confirmation (`--yes` without a terminal). Identical content creates no version. |
| `status [--env E]` | Compare your local file with the server's head. |
| `run [--env E] -- cmd args` | Run a command with the variables injected. Nothing is written to disk; the exit code is passed through. |

## History

```bash
secretvariable log                  # versions of the current environment
secretvariable diff 3 4             # key names only
secretvariable diff 3 4 --reveal    # with values (recorded in the audit log)
secretvariable rollback 3           # saves v3's content as a new version
```

## Environments

```bash
secretvariable env list
secretvariable env use staging
secretvariable env create preview --from production        # copy from the head
secretvariable env create preview --from production@4      # copy from v4
```

## Team and tokens

```bash
secretvariable invite dana@example.com --role viewer --envs staging
secretvariable accept <invite-token>
secretvariable members
secretvariable token create --name ci --env production --access read --expires 90
secretvariable token list
secretvariable token revoke <id>
```

## Using it in CI

Create a read-only service token for one environment and store it as a CI secret:

```yaml
# GitHub Actions example
- run: npx @secretvariable/cli pull --force
  env:
    SECRETVARIABLE_URL: ${{ secrets.SV_URL }}
    SECRETVARIABLE_TOKEN: ${{ secrets.SV_TOKEN }}
```

The repository needs its `.secretvariable.json` checked in (it only holds ids), or pass the project with `init` first.

Environment variables override stored credentials: `SECRETVARIABLE_URL`, `SECRETVARIABLE_TOKEN`, `SECRETVARIABLE_CONFIG_DIR`.
