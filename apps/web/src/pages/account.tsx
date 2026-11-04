import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { del, get, patch, post } from "../api";
import { useOrg } from "../App";
import { useAuth } from "../auth";
import { useTheme, type ThemePref } from "../theme";
import { CodeLine, CopyButton, ErrorBox, Icon, Loading, Modal, Who, absTime, relTime, useAsync, usePageTitle, useToast } from "../ui";
import { actionLabel } from "./labels";

export function InvitationsPage() {
  usePageTitle("Invitations");
  const nav = useNavigate();
  const toast = useToast();
  const { reload } = useOrg();
  const inv = useAsync(() => get("/me/invites").then((r) => r.invites as any[]), []);
  return (
    <div className="page">
      <div className="title-row"><div><h1>Invitations</h1><p className="sub">Projects you have been invited to join with this email address.</p></div></div>
      {inv.error ? <ErrorBox error={inv.error} retry={inv.reload} /> : inv.loading ? <Loading /> : !inv.data!.length ? (
        <div className="empty"><h3>No pending invitations</h3><p>When someone invites you to a project it will show up here. You can also open an invitation link you were sent, or accept a token from the command line.</p><CodeLine>svar accept INVITE_TOKEN</CodeLine></div>
      ) : (
        <table className="table" aria-label="Invitations">
          <thead><tr><th className="wide">Project</th><th>Invited by</th><th>Role</th><th>Expires</th><th /></tr></thead>
          <tbody>
            {inv.data!.map((i) => (
              <tr key={i.id}>
                <td className="fill"><span className="name">{i.projectName}</span> <span className="muted">{i.orgName}</span></td>
                <td><Who name={i.invitedBy} /></td>
                <td><span className="pill">{i.role}</span>{i.scope === "selected" && <span className="pill head-mark">limited</span>}</td>
                <td className="muted">{relTime(i.expiresAt)}</td>
                <td className="row-actions"><button className="btn sm primary" style={{ visibility: "visible" }} onClick={async () => { try { const r = await post(`/invites/${i.id}/accept`); toast(`Joined ${r.project.name}`); reload(); nav(`/p/${r.project.id}`); } catch (e) { toast((e as Error).message, true); } }}>Accept</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function OrgPage() {
  const { org, orgs, setOrgId, reload } = useOrg();
  const { user } = useAuth();
  const toast = useToast();
  usePageTitle("Organisation");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const detail = useAsync(() => (org ? get(`/orgs/${org.id}`) : Promise.resolve(null)), [org?.id]);
  const activity = useAsync(() => (org && org.role !== "member" ? get(`/orgs/${org.id}/audit`).then((r) => r.entries as any[]) : Promise.resolve([] as any[])), [org?.id]);
  if (!org) return <div className="page"><Loading /></div>;
  const owner = org.role === "owner";
  const members: any[] = detail.data?.members ?? [];

  async function createOrg(e: FormEvent) {
    e.preventDefault();
    try { const r = await post("/orgs", { name }); setCreating(false); setName(""); reload(); setOrgId(r.org.id); } catch (err) { toast((err as Error).message, true); }
  }
  return (
    <div className="page">
      <div className="title-row">
        <div><h1>{org.name}</h1><p className="sub">Organisation owners and admins can see every project. Everyone else only sees projects they were invited to.</p></div>
        <div className="actions">
          {orgs.length > 1 && <select className="select inline" aria-label="Organisation" value={org.id} onChange={(e) => setOrgId(e.target.value)}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
          <button className="btn" onClick={() => setCreating(true)}><Icon name="plus" /> New organisation</button>
        </div>
      </div>
      <section>
        <div className="section-head"><h2>Members</h2><span className="meta">{members.length} {members.length === 1 ? "person" : "people"}</span></div>
        {detail.error ? <ErrorBox error={detail.error} retry={detail.reload} /> : detail.loading ? <Loading /> : (
          <table className="table" aria-label="Organisation members">
            <thead><tr><th className="wide">Person</th><th>Role</th><th /></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId}>
                  <td className="fill"><div className="who"><Who name={m.name} /><span className="muted hide-sm">{m.email}</span></div></td>
                  <td>{owner && m.userId !== user?.id ? (
                    <select className="select inline" aria-label={`Role of ${m.name}`} value={m.role} onChange={async (e) => { try { await patch(`/orgs/${org.id}/members/${m.userId}`, { role: e.target.value }); toast("Role updated"); detail.reload(); } catch (err) { toast((err as Error).message, true); } }}>
                      <option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option>
                    </select>) : <span className="pill">{m.role}</span>}</td>
                  <td className="row-actions">
                    {(owner || m.userId === user?.id) && <button className="btn ghost sm" onClick={async () => {
                      if (!confirm(m.userId === user?.id ? `Leave ${org.name}?` : `Remove ${m.name} from ${org.name}? They lose access to all its projects.`)) return;
                      try { await del(`/orgs/${org.id}/members/${m.userId}`); toast("Done"); detail.reload(); if (m.userId === user?.id) reload(); } catch (err) { toast((err as Error).message, true); }
                    }}>{m.userId === user?.id ? "Leave" : "Remove"}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ marginTop: 12 }}>People join an organisation when they accept a project invitation.</p>
      </section>
      {org.role !== "member" && (
        <section>
          <div className="section-head"><h2>Activity</h2></div>
          {activity.loading ? <Loading /> : (
            <table className="table" aria-label="Organisation activity">
              <thead><tr><th>When</th><th>Who</th><th>What</th><th className="wide">Where</th></tr></thead>
              <tbody>
                {(activity.data ?? []).slice(0, 12).map((a: any) => (
                  <tr key={a.id}><td className="muted" title={absTime(a.createdAt)} style={{ whiteSpace: "nowrap" }}>{relTime(a.createdAt)}</td><td><Who name={a.actorName} /></td><td>{actionLabel(a.action)}</td><td className="mono fill">{[a.projectName, a.target].filter(Boolean).join(" / ") || "-"}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      {creating && (
        <Modal title="New organisation" onClose={() => setCreating(false)}>
          <form className="form" onSubmit={createOrg}>
            <div className="field"><label htmlFor="on">Name</label><input id="on" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required /></div>
            <div className="modal-actions"><button type="button" className="btn" onClick={() => setCreating(false)}>Cancel</button><button className="btn primary" disabled={!name.trim()}>Create</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function ThemeChoice() {
  const { pref, setPref } = useTheme();
  const options: { value: ThemePref; label: string }[] = [{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }];
  return (
    <div className="segmented" role="group" aria-label="Theme">
      {options.map((o) => <button key={o.value} aria-pressed={pref === o.value} onClick={() => setPref(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function AccountPage() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  usePageTitle("Account");
  const tokens = useAsync(() => get("/tokens").then((r) => r.tokens as any[]), []);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [access, setAccess] = useState("write");
  const [shown, setShown] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    try { const r = await post("/tokens", { name, kind: "personal", access, expiresInDays: 90 }); setCreating(false); setName(""); setShown(r.token); tokens.reload(); } catch (err) { toast((err as Error).message, true); }
  }
  const personal = (tokens.data ?? []).filter((t) => t.kind === "personal");
  return (
    <div className="page">
      <div className="title-row"><div><h1>Account</h1><p className="sub">{user?.name} · {user?.email}</p></div><div className="actions"><button className="btn" onClick={() => logout().then(() => nav("/login"))}>Sign out</button></div></div>
      <div>
        <section className="setting">
          <div className="about"><h2>Appearance</h2><p>Light, dark, or follow your device. This is remembered on this browser.</p></div>
          <div className="body"><ThemeChoice /></div>
        </section>
        <section className="setting">
          <div className="about"><h2>Personal access tokens</h2><p>Used by the command-line tool. Signing in with <span className="mono">svar login</span> creates one for you.</p></div>
          <div className="body">
            {tokens.error ? <ErrorBox error={tokens.error} retry={tokens.reload} /> : tokens.loading ? <Loading /> : personal.length === 0 ? <p className="muted">No personal tokens.</p> : (
              <div className="list-rows">
                {personal.map((t) => (
                  <div key={t.id}>
                    <span><span className="name">{t.name}</span> <span className="muted">{t.access}, {t.lastUsedAt ? `used ${relTime(t.lastUsedAt)}` : "never used"}{t.expiresAt ? `, expires ${relTime(t.expiresAt)}` : ""}</span></span>
                    <button className="btn ghost sm" onClick={async () => { if (!confirm(`Revoke "${t.name}"?`)) return; try { await del(`/tokens/${t.id}`); tokens.reload(); } catch (e) { toast((e as Error).message, true); } }}>Revoke</button>
                  </div>
                ))}
              </div>
            )}
            <div><button className="btn" onClick={() => setCreating(true)}><Icon name="plus" /> New token</button></div>
          </div>
        </section>
        <section className="setting">
          <div className="about"><h2>Command-line tool</h2><p>Install it, sign in, and link your project folder.</p></div>
          <div className="body">
            <CodeLine>npm install -g @secretvariable/cli</CodeLine>
            <CodeLine>{`svar login --server ${location.origin}`}</CodeLine>
            <CodeLine>svar init</CodeLine>
          </div>
        </section>
      </div>
      {creating && (
        <Modal title="New personal token" onClose={() => setCreating(false)}>
          <form className="form" onSubmit={create}>
            <div className="field"><label htmlFor="pt">Name</label><input id="pt" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Work laptop" autoFocus required /></div>
            <div className="field"><label htmlFor="pa">Access</label><select id="pa" className="select" value={access} onChange={(e) => setAccess(e.target.value)}><option value="write">Read and write</option><option value="read">Read only</option></select></div>
            <p className="muted">Expires in 90 days.</p>
            <div className="modal-actions"><button type="button" className="btn" onClick={() => setCreating(false)}>Cancel</button><button className="btn primary">Create token</button></div>
          </form>
        </Modal>
      )}
      {shown && (
        <Modal title="Copy your token now" onClose={() => setShown(null)}>
          <p className="muted">This is the only time it is shown.</p>
          <div className="code"><code>{shown}</code><CopyButton text={shown} label="Copy token" /></div>
          <div className="modal-actions"><button className="btn primary" onClick={() => setShown(null)}>I have stored it</button></div>
        </Modal>
      )}
    </div>
  );
}
