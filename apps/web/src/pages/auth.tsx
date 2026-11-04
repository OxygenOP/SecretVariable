import { useEffect, useState, type FormEvent } from "react";
import type { MfaChallenge, MfaMethod } from "@secretvariable/shared";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { post, ApiError } from "../api";
import { useAuth } from "../auth";
import { BrandMark, FormError, ThemeToggle, usePageTitle, useAsync } from "../ui";

function Side() {
  return (
    <aside className="auth-side">
      <div style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 600 }}><BrandMark size={28} /> SecretVariable</div>
      <div>
        <h2>Every .env, versioned and in one place.</h2>
        <p>Store environment files encrypted, pull any version into your project with one command, and decide who can see which environment.</p>
      </div>
      <div className="diff-demo" aria-hidden="true">
        <div className="l"><span className="s">~</span><span>DATABASE_URL</span><span className="sans">v7 to v8</span></div>
        <div className="l"><span className="s">+</span><span>SENTRY_DSN</span><span className="sans">v6 to v7</span></div>
        <div className="l"><span className="s">~</span><span>JWT_SIGNING_KEY</span><span className="sans">v5 to v6</span></div>
      </div>
    </aside>
  );
}

function useConfig() { return useAsync(() => fetch("/api/config").then((r) => r.json()).catch(() => ({ allowRegistration: true })), []); }

function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { login, register, completeMfa, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? "/";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState<MfaChallenge | null>(null);
  usePageTitle(mode === "login" ? "Sign in" : "Create account");
  const cfg = useConfig();
  if (user) { setTimeout(() => nav(from, { replace: true }), 0); }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      if (mode === "login") {
        const challenge = await login(email, password);
        if (challenge) { setMfa(challenge); setPassword(""); setBusy(false); return; }
      } else await register(name, email, password);
      nav(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally { setBusy(false); }
  }
  const closed = mode === "register" && cfg.data && (cfg.data as any).allowRegistration === false;

  return (
    <div className="auth">
      <div className="auth-theme"><ThemeToggle /></div>
      <Side />
      <div className="auth-form">
        {mfa ? (
          <SecondStep mfa={mfa} onBack={() => { setMfa(null); setError(""); }} onDone={async (method, code) => { await completeMfa(mfa.challenge, method, code); nav(from, { replace: true }); }} />
        ) : (
          <form onSubmit={submit} noValidate>
            <h1>{mode === "login" ? "Sign in" : "Create your account"}</h1>
            {mode === "register" && (
              <div className="field"><label htmlFor="name">Name</label><input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></div>
            )}
            <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
              {mode === "register" && <span className="hint">At least 10 characters.</span>}
            </div>
            <FormError message={error || (closed ? "Registration is closed. Ask an admin for an invite." : "")} />
            <button className="btn primary block" disabled={busy || !!closed}>{busy ? "Please wait" : mode === "login" ? "Sign in" : "Create account"}</button>
            <p className="switch-mode">
              {mode === "login" ? <>No account? <Link to="/register" state={{ from }}>Create one</Link></> : <>Already registered? <Link to="/login" state={{ from }}>Sign in</Link></>}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

const METHOD_COPY: Record<MfaMethod, { label: string; help: string; placeholder: string }> = {
  totp: { label: "Authenticator code", help: "Open your authenticator app and enter the 6-digit code.", placeholder: "123456" },
  email: { label: "Code from your email", help: "Enter the 6-digit code we emailed you.", placeholder: "123456" },
  recovery: { label: "Recovery code", help: "Enter one of the recovery codes you saved. Each works once.", placeholder: "abcde-fghij" },
};

function SecondStep({ mfa, onBack, onDone }: { mfa: MfaChallenge; onBack: () => void; onDone: (method: MfaMethod, code: string) => Promise<void> }) {
  const [method, setMethod] = useState<MfaMethod>("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  usePageTitle("Two-step verification");
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const copy = METHOD_COPY[method];
  const canEmail = mfa.methods.includes("email");

  async function sendEmail() {
    setError(""); setNote("");
    try {
      const r = await post("/auth/2fa/email", { challenge: mfa.challenge });
      setNote(`Code sent to ${r.to}. It expires in ${r.expiresInMinutes} minutes.`);
      setCooldown(60);
    } catch (e) { setError((e as Error).message); }
  }
  async function pick(next: MfaMethod) {
    setMethod(next); setCode(""); setError(""); setNote("");
    if (next === "email") await sendEmail();
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await onDone(method, code.trim()); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Something went wrong"); setCode(""); setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1>Two-step verification</h1>
      <div className="field">
        <label htmlFor="code">{copy.label}</label>
        <input id="code" className="input code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder={copy.placeholder} inputMode={method === "recovery" ? "text" : "numeric"} autoComplete="one-time-code" autoFocus spellCheck={false} maxLength={24} required />
        <span className="hint">{note || copy.help}</span>
      </div>
      <FormError message={error} />
      <button className="btn primary block" disabled={busy || !code.trim()}>{busy ? "Verifying" : "Verify"}</button>
      <div className="alt-methods">
        {method !== "totp" && <button type="button" className="link-btn" onClick={() => pick("totp")}>Use authenticator app</button>}
        {method !== "email" && canEmail && <button type="button" className="link-btn" onClick={() => pick("email")}>Email me a code</button>}
        {method === "email" && <button type="button" className="link-btn" disabled={cooldown > 0} onClick={sendEmail}>{cooldown > 0 ? `Send again in ${cooldown}s` : "Send a new code"}</button>}
        {method !== "recovery" && <button type="button" className="link-btn" onClick={() => pick("recovery")}>Use a recovery code</button>}
      </div>
      <p className="switch-mode"><button type="button" className="link-btn" onClick={onBack}>Back to sign in</button></p>
    </form>
  );
}
export const LoginPage = () => <AuthForm mode="login" />;
export const RegisterPage = () => <AuthForm mode="register" />;

export function InvitePage() {
  const { token } = useParams();
  const nav = useNavigate();
  const [state, setState] = useState<{ error?: string; project?: { id: string; name: string } }>({});
  const [busy, setBusy] = useState(false);
  usePageTitle("Invitation");
  async function accept() {
    setBusy(true);
    try { const r = await post("/invites/accept", { token }); setState({ project: r.project }); }
    catch (e) { setState({ error: (e as Error).message }); }
    finally { setBusy(false); }
  }
  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <div className="title-row"><div><h1>Project invitation</h1><p className="sub">Accept to join the project. The invitation only works for the email address it was sent to.</p></div></div>
      {state.project ? (
        <div className="panel"><p>You joined <strong>{state.project.name}</strong>.</p><div className="actions stack-top-sm"><button className="btn primary" onClick={() => nav(`/p/${state.project!.id}`)}>Open project</button></div></div>
      ) : (
        <div className="panel form">
          <FormError message={state.error} />
          <div className="actions"><button className="btn primary" disabled={busy} onClick={accept}>Accept invitation</button><Link className="btn" to="/">Not now</Link></div>
        </div>
      )}
    </div>
  );
}
