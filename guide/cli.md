# Command-line reference

Installing the package gives you two names for the same program: **`svar`** (short, used throughout this guide) and `secretvariable`. Use whichever you prefer; hints and errors print the name you typed. (The short name is not `sv` because that is already the Svelte CLI and, on many Linux systems, the runit `sv` command.)

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
svar login --server https://secrets.example.com
```

You are asked for your email and password (they can also be passed with `--email` and `--password`). If your account has two-step verification, you are then asked for a code: type the authenticator code, or `email` to get a code by email, or `recovery` to use a recovery code. Without a terminal pass it as `--code 123456` (and `--method recovery --code abcde-fghij` for a recovery code); emailed codes need a terminal. The password is exchanged for a 90-day personal token and is never stored. Credentials live in `~/.config/secretvariable/config.json` (mode `0600`). `svar login --token <token>` signs in with an existing token. `svar logout` forgets the local credentials; revoke the token in the web app (Account) or with `svar token revoke <id>`.

## Link a folder to a project

```bash
svar init                                   # choose interactively
svar init --org acme --project payments-api # no prompts
svar init --create --project "New app"      # create it first
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
svar log                  # versions of the current environment
svar diff 3 4             # key names only
svar diff 3 4 --reveal    # with values (recorded in the audit log)
svar rollback 3           # saves v3's content as a new version
```

## Environments

```bash
svar env list
svar env use staging
svar env create preview --from production        # copy from the head
svar env create preview --from production@4      # copy from v4
```

## Team and tokens

```bash
svar invite dana@example.com --role viewer --envs staging --expires 3   # link valid for 3 days (1-30, default 7)
svar accept <invite-token>
svar members
svar token create --name ci --env production --access read --expires 90
svar token list
svar token revoke <id>
```

## Using it in CI

Create a read-only service token for one environment and store it as a CI secret:

```yaml
# GitHub Actions example
- run: npx -p @secretvariable/cli svar pull --force
  env:
    SECRETVARIABLE_URL: ${{ secrets.SV_URL }}
    SECRETVARIABLE_TOKEN: ${{ secrets.SV_TOKEN }}
```

The repository needs its `.secretvariable.json` checked in (it only holds ids), or pass the project with `init` first.

Environment variables override stored credentials: `SECRETVARIABLE_URL`, `SECRETVARIABLE_TOKEN`, `SECRETVARIABLE_CONFIG_DIR`.
