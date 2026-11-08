import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CodeLine, CopyButton, usePageTitle } from "../ui";

/** The command-line guide, inside the app: everything about `svar`, with this server's address filled in. */

const TOC = [
  ["install", "Install"],
  ["sign-in", "Sign in"],
  ["link", "Link a folder"],
  ["daily", "Everyday commands"],
  ["switch", "Switching environments"],
  ["history", "History and rollback"],
  ["team", "Team and tokens"],
  ["ci", "Using it in CI"],
  ["help", "When something goes wrong"],
] as const;

function Block({ children, label = "Copy" }: { children: string; label?: string }) {
  return (
    <div className="code block"><pre><code>{children}</code></pre><CopyButton text={children} label={label} /></div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="guide-section"><h2>{title}</h2>{children}</section>;
}

function Rows({ head, rows }: { head: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="guide-table">
      <table className="table">
        <thead><tr><th>{head[0]}</th><th className="wide">{head[1]}</th></tr></thead>
        <tbody>{rows.map(([a, b], i) => <tr key={i}><td className="top"><code className="mono">{a}</code></td><td className="wrap">{b}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export function CliGuidePage() {
  usePageTitle("CLI guide");
  const server = typeof location !== "undefined" ? location.origin : "https://secrets.example.com";
  return (
    <div className="page guide">
      <div className="title-row">
        <div>
          <h1>CLI guide</h1>
          <p className="sub">Pull, push and run your <code className="mono">.env</code> files from the terminal with <code className="mono">svar</code>. Commands below already point at this server.</p>
        </div>
      </div>

      <div className="guide-layout">
        <div className="guide-body">
          <Section id="install" title="Install">
            <p>The CLI is one file with no dependencies and needs <strong>Node.js 20 or newer</strong>.</p>
            <CodeLine>npm install -g @secretvariable/cli</CodeLine>
            <CodeLine>svar --version</CodeLine>
            <p className="muted">The package installs two names for the same program: <code className="mono">svar</code> (short, used here) and <code className="mono">secretvariable</code>. If your shell says <code className="mono">command not found</code>, add the <code className="mono">bin</code> folder printed by <code className="mono">npm config get prefix</code> to your <code className="mono">PATH</code>. If <code className="mono">npm install -g</code> fails with a permissions error, do not use sudo: set a folder you own with <code className="mono">npm config set prefix ~/.local</code> or use a Node version manager. Update later with <code className="mono">npm update -g @secretvariable/cli</code>.</p>
          </Section>

          <Section id="sign-in" title="Sign in">
            <CodeLine>{`svar login --server ${server}`}</CodeLine>
            <p>You are asked for your email and password. If your account uses two-step verification you are then asked for a code: type the authenticator code, <code className="mono">email</code> to get a code by email (when the server has email set up), or <code className="mono">recovery</code> to use a recovery code. Without a terminal, pass <code className="mono">--code 123456</code> (or <code className="mono">--method recovery --code ...</code>).</p>
            <p>Your password is exchanged for a 90-day personal token and is never stored. Credentials live in <code className="mono">~/.config/secretvariable/config.json</code> with owner-only permissions. Check who you are with <code className="mono">svar whoami</code>, forget the token on this machine with <code className="mono">svar logout</code>, and revoke it for good under <Link to="/account" className="link">Account</Link>.</p>
          </Section>

          <Section id="link" title="Link a folder">
            <p>Run this once inside your project's folder, and choose the organisation and project.</p>
            <CodeLine>svar init</CodeLine>
            <p>It writes <code className="mono">.secretvariable.json</code> (the project and the environment in use; no secrets, safe to commit). Skip the questions with <code className="mono">svar init --project payments-api --env development</code>, or create the project from the terminal with <code className="mono">svar init --create --project payments-api</code>. The CLI also keeps <code className="mono">.secretvariable.state.json</code>, a private fingerprint of the last env file it wrote; add it to <code className="mono">.gitignore</code> together with <code className="mono">.env</code>.</p>
          </Section>

          <Section id="daily" title="Everyday commands">
            <Rows head={["Command", "What it does"]} rows={[
              ["svar pull", <>Write the environment's variables to <code className="mono">.env</code> (owner-only permissions). A file you have not edited is simply updated. If you have edited it, it stops and lists the keys; add <code className="mono">--backup</code> to keep a copy first or <code className="mono">--force</code> to overwrite.</>],
              ["svar push -m \"rotate key\"", <>Upload <code className="mono">.env</code> as a new version. It shows the project and environment and what was added, changed or removed first. Removing variables asks for confirmation (<code className="mono">--yes</code> without a terminal). Pushing to <code className="mono">production</code> in a terminal asks you to confirm. Identical content creates no version.</>],
              ["svar status", "Compare your local file with the server, key by key."],
              ["svar run -- npm start", <>Run any command with the variables injected. Nothing is written to disk, and the command's exit code is passed through.</>],
              ["--env E, --file F, --version N", <>Work on another environment (<code className="mono">svar pull --env production</code>), another file, or an older version (<code className="mono">svar pull --version 3</code>) without changing your folder's default.</>],
            ]} />
          </Section>

          <Section id="switch" title="Switching environments">
            <Block>{`svar env list           # the project you are in, and the environment in use (*)
svar env use staging    # switch, and update .env to match
svar env use -          # go back to the previous environment
svar env use prod       # unambiguous prefixes work (also with --env)`}</Block>
            <p><code className="mono">svar env use</code> changes the folder's default environment <strong>and</strong> rewrites the env file with the new environment's variables, in one step, with no <code className="mono">--force</code>. The result confirms where you are, for example <code className="mono">Now using payments-api / staging (v12). Wrote 9 variables to .env.</code></p>
            <h3>Your edits are protected</h3>
            <p>The CLI remembers what it last wrote. If the file is still exactly that, or holds nothing the current environment does not already have, the switch just happens. If you have edited it, the CLI stops and lists the keys instead of overwriting them:</p>
            <Rows head={["You want to", "Use"]} rows={[
              ["Keep your edits and switch", <><code className="mono">svar env use staging --backup</code> saves <code className="mono">.env.backup-&lt;time&gt;</code> (owner-only), then switches.</>],
              ["Drop your edits and switch", <code className="mono">svar env use staging --discard</code>],
              ["Switch without touching the file", <code className="mono">svar env use staging --no-pull</code>],
              ["Save your edits first", <><code className="mono">svar push</code> to the current environment, then switch.</>],
            ]} />
            <p className="muted">In a terminal it simply asks: back up, discard or cancel. Without a terminal (scripts) it refuses until you pass one of the flags. If the folder has no env file yet, none is created; run <code className="mono">svar pull</code>.</p>
            <h3>Create environments</h3>
            <Block>{`svar env create preview --from production      # copy the current head
svar env create preview --from production@4    # copy version 4`}</Block>
          </Section>

          <Section id="history" title="History and rollback">
            <Block>{`svar log                  # versions of the current environment
svar diff 3 4             # key names that changed
svar diff 3 4 --reveal    # with values (recorded in the audit log)
svar rollback 3           # saves version 3's content as a new version`}</Block>
            <p>Every push is a numbered version, and nothing is rewritten: a rollback creates a new version with the old content, so you can always undo it.</p>
          </Section>

          <Section id="team" title="Team and tokens">
            <Block>{`svar invite dana@example.com --role viewer --envs staging --expires 3
svar invite dana@example.com --role editor --send-email   # also email the link (needs email set up on the server)
svar accept <invite-token>
svar members
svar token create --name ci --env production --access read --expires 90
svar token list
svar token revoke <id>`}</Block>
            <p>Invitations are single-use, tied to the invited email address, and expire (1 to 30 days, default 7). Roles are <code className="mono">viewer</code>, <code className="mono">editor</code> and <code className="mono">admin</code>; <code className="mono">--envs</code> limits someone to the environments you name. Tokens created inside a project folder are service tokens for that project; add <code className="mono">--env</code> to limit one environment and <code className="mono">--access read</code> to make them read-only.</p>
          </Section>

          <Section id="ci" title="Using it in CI">
            <p>Create a read-only token for one environment, store it as a secret in your CI system, and set two variables instead of signing in:</p>
            <Block>{`SECRETVARIABLE_URL=${server}
SECRETVARIABLE_TOKEN=svt_...`}</Block>
            <Block>{`# GitHub Actions
- run: npm install -g @secretvariable/cli
- run: svar run --env production -- npm run deploy
  env:
    SECRETVARIABLE_URL: ${server}
    SECRETVARIABLE_TOKEN: \${{ secrets.SECRETVARIABLE_TOKEN }}`}</Block>
            <p className="muted">Run the command from a checkout that contains <code className="mono">.secretvariable.json</code>, or pass the project another way. Scripts without a terminal are never blocked by confirmations, so use a read-only token wherever you can.</p>
          </Section>

          <Section id="help" title="When something goes wrong">
            <Rows head={["You see", "What to do"]} rows={[
              ["You are not signed in", <>Run <code className="mono">svar login --server {server}</code>.</>],
              ["This folder is not linked to a project", <>Run <code className="mono">svar init</code> in the project's folder.</>],
              ["…has local changes that would be overwritten", <>Your env file has edits. Run <code className="mono">svar status</code>, then <code className="mono">svar push</code> them, or use <code className="mono">--backup</code> or <code className="mono">--force</code>.</>],
              ["No environment named …", <>Run <code className="mono">svar env list</code> for the names you can use; a prefix works if it is unique.</>],
              ["read-only token", "The token cannot write. Use a personal login or a write token."],
              ["Not on this list", <>Run <code className="mono">svar help</code>, or <code className="mono">svar &lt;command&gt; --help</code>.</>],
            ]} />
          </Section>
        </div>

        <nav className="guide-toc" aria-label="On this page">
          <div className="toc-title">On this page</div>
          {TOC.map(([id, label]) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{label}</a>)}
        </nav>
      </div>
    </div>
  );
}
