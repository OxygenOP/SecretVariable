import { useEffect, useState, type FormEvent } from "react";
import type { TwoFactorStatus } from "@secretvariable/shared";
import { get, patch, post } from "../api";
import { CopyButton, ErrorBox, FormError, Loading, Modal, absTime, copyText, useAsync, useToast } from "../ui";

function groupSecret(s: string) { return s.replace(/(.{4})/g, "$1 ").trim(); }

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/** Shows the recovery codes once and makes the person confirm they saved them. */
function RecoveryCodes({ codes, onDone, title = "Save your recovery codes" }: { codes: string[]; onDone: () => void; title?: string }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const text = codes.join("\n") + "\n";
  return (
    <Modal title={title} onClose={() => { if (saved) onDone(); }}>
      <p className="muted">Each code works once if you lose your phone. They are shown only now, so store them somewhere safe, like a password manager.</p>
      <div className="recovery-grid" aria-label="Recovery codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
      <div className="actions">
        <button className="btn" onClick={async () => toast((await copyText(text)) ? "Copied to clipboard" : "Could not copy")}>Copy all</button>
        <button className="btn" onClick={() => downloadText("secretvariable-recovery-codes.txt", `SecretVariable recovery codes\n\n${text}`)}>Download .txt</button>
      </div>
      <label className="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved these codes</label>
      <div className="modal-actions"><button className="btn primary" disabled={!saved} onClick={onDone}>Done</button></div>
    </Modal>
  );
}

function SetupModal({ onClose, onEnabled }: { onClose: () => void; onEnabled: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<"password" | "scan" | "codes">("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!setup) return;
    let live = true;
    import("qrcode").then(({ default: QR }) => QR.toDataURL(setup.otpauthUri, { margin: 0, width: 176, errorCorrectionLevel: "M" })).then((u) => { if (live) setQr(u); });
    return () => { live = false; };
  }, [setup]);

  async function begin(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { setSetup(await post("/me/2fa/setup", { password })); setStep("scan"); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function enable(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { const r = await post("/me/2fa/enable", { code: code.trim() }); setCodes(r.recoveryCodes); setStep("codes"); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (step === "codes") return <RecoveryCodes codes={codes} onDone={onEnabled} title="Two-step verification is on" />;
  if (step === "password") {
    return (
      <Modal title="Set up two-step verification" onClose={onClose}>
        <form className="form" onSubmit={begin}>
          <p className="muted">You will need an authenticator app such as 1Password, Authy, Google Authenticator or Aegis. First confirm it is you.</p>
          <div className="field"><label htmlFor="sp">Your password</label><input id="sp" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus required /></div>
          <FormError message={error} />
          <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !password}>Continue</button></div>
        </form>
      </Modal>
    );
  }
  return (
    <Modal title="Scan the QR code" onClose={onClose} wide>
      <form className="form" onSubmit={enable}>
        <div className="mfa-steps">
          <div className="qr">{qr ? <img src={qr} alt="QR code to add SecretVariable to your authenticator app" /> : <span className="muted">Loading</span>}</div>
          <div className="form">
            <p className="muted">Scan this with your authenticator app, or enter the key by hand:</p>
            <div className="secret-box" aria-label="Setup key">{groupSecret(setup!.secret)}</div>
            <div className="actions"><button type="button" className="btn sm" onClick={async () => toast((await copyText(setup!.secret)) ? "Key copied" : "Could not copy")}>Copy key</button></div>
          </div>
        </div>
        <div className="field"><label htmlFor="sc">Then enter the 6-digit code it shows</label><input id="sc" className="input code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" autoComplete="one-time-code" maxLength={8} autoFocus required /></div>
        <FormError message={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || code.trim().length < 6}>Turn on</button></div>
      </form>
    </Modal>
  );
}

/** Asks for password + a code before a sensitive change. */
function ConfirmModal({ title, action, danger, children, onClose, onDone }: { title: string; action: string; danger?: boolean; children?: React.ReactNode; onClose: () => void; onDone: (r: any) => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError("");
        try { onDone(await (title.startsWith("Turn off") ? post("/me/2fa/disable", { password, code: code.trim() }) : post("/me/2fa/recovery-codes", { password, code: code.trim() }))); }
        catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        {children}
        <div className="field"><label htmlFor="cp">Your password</label><input id="cp" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus required /></div>
        <div className="field"><label htmlFor="cc">Authenticator or recovery code</label><input id="cc" className="input code-input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={24} required /></div>
        <FormError message={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className={`btn ${danger ? "danger" : "primary"}`} disabled={busy || !password || !code.trim()}>{action}</button></div>
      </form>
    </Modal>
  );
}

function EmailBackupModal({ turnOn, onClose, onDone }: { turnOn: boolean; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal title={turnOn ? "Turn on email codes" : "Turn off email codes"} onClose={onClose}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); try { await patch("/me/2fa", { password, emailBackup: turnOn }); onDone(); } catch (err) { setError((err as Error).message); } }}>
        <p className="muted">{turnOn ? "When you cannot use your authenticator app, you can sign in with a one-time code sent to your email address." : "You will only be able to sign in with your authenticator app or a recovery code."}</p>
        <div className="field"><label htmlFor="ep">Your password</label><input id="ep" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus required /></div>
        <FormError message={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!password}>{turnOn ? "Turn on" : "Turn off"}</button></div>
      </form>
    </Modal>
  );
}

export function TwoFactorSection() {
  const toast = useToast();
  const st = useAsync(() => get("/me/2fa") as Promise<TwoFactorStatus>, []);
  const [modal, setModal] = useState<null | "setup" | "disable" | "regen" | "email">(null);
  const [fresh, setFresh] = useState<string[] | null>(null);
  const s = st.data;

  return (
    <section className="setting" aria-label="Two-step verification">
      <div className="about"><h2>Two-step verification</h2><p>Ask for a code from your authenticator app, as well as your password, every time you sign in.</p></div>
      <div className="body">
        {st.error ? <ErrorBox error={st.error} retry={st.reload} /> : !s ? <Loading /> : !s.enabled ? (
          <>
            <div className="status-row"><div className="what"><strong>Off</strong><span>Your account is protected by your password only.</span></div><span className="pill warning">Not set up</span></div>
            <div><button className="btn primary" onClick={() => setModal("setup")}>Set up two-step verification</button></div>
          </>
        ) : (
          <div className="list-rows">
            <div className="status-row"><div className="what"><strong>Authenticator app</strong><span>On since {s.enabledAt ? absTime(s.enabledAt) : "now"}</span></div><button className="btn sm danger" onClick={() => setModal("disable")}>Turn off</button></div>
            <div className="status-row">
              <div className="what"><strong>Email codes</strong><span>{s.emailAvailable ? (s.emailBackup ? "Backup: you can get a sign-in code by email." : "Off: only your app or a recovery code can sign you in.") : "Not available: this server has no email set up."}</span></div>
              <button className="btn sm" disabled={!s.emailAvailable} onClick={() => setModal("email")}>{s.emailBackup ? "Turn off" : "Turn on"}</button>
            </div>
            <div className="status-row"><div className="what"><strong>Recovery codes</strong><span>{s.recoveryCodesRemaining} of 10 unused{s.recoveryCodesRemaining <= 2 ? ". Generate new ones soon." : ""}</span></div><button className="btn sm" onClick={() => setModal("regen")}>Generate new codes</button></div>
          </div>
        )}
      </div>
      {modal === "setup" && <SetupModal onClose={() => setModal(null)} onEnabled={() => { setModal(null); st.reload(); toast("Two-step verification is on"); }} />}
      {modal === "disable" && <ConfirmModal title="Turn off two-step verification" action="Turn off" danger onClose={() => setModal(null)} onDone={() => { setModal(null); st.reload(); toast("Two-step verification is off"); }}><p className="muted">Your account will be protected by your password only.</p></ConfirmModal>}
      {modal === "regen" && <ConfirmModal title="Generate new recovery codes" action="Generate" onClose={() => setModal(null)} onDone={(r) => { setModal(null); setFresh(r.recoveryCodes); st.reload(); }}><p className="muted">This replaces all of your current recovery codes.</p></ConfirmModal>}
      {modal === "email" && s && <EmailBackupModal turnOn={!s.emailBackup} onClose={() => setModal(null)} onDone={() => { setModal(null); st.reload(); toast("Saved"); }} />}
      {fresh && <RecoveryCodes codes={fresh} title="Your new recovery codes" onDone={() => setFresh(null)} />}
    </section>
  );
}
