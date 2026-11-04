import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { AuditEntry, InviteInfo, MemberInfo } from "@secretvariable/shared";
import { del, get, patch, post, put } from "../api";
import { CodeLine, CopyButton, ErrorBox, FormError, Icon, Loading, Modal, Who, absTime, relTime, useAsync, usePageTitle, useToast } from "../ui";
import { actionLabel } from "./labels";
import { useProject } from "./project";

/* ============================ members ============================ */
type Member = MemberInfo & { viaOrg?: boolean };

function AccessEditor({ initial, envs, onChange }: { initial: { role: string; scope: "all" | "selected"; grants: Record<string, "read" | "write" | "none"> }; envs: { id: string; name: string }[]; onChange: (v: typeof initial) => void }) {
  const set = (patch: Partial<typeof initial>) => onChange({ ...initial, ...patch });
  return (
    <>
      <div className="field"><label htmlFor="role">Role</label>
        <select id="role" className="select" value={initial.role} onChange={(e) => set({ role: e.target.value })}>
          <option value="viewer">Viewer: can read variables</option>
          <option value="editor">Editor: can read and change variables</option>
          <option value="admin">Admin: manages the project and its members</option>
        </select>
      </div>
      {initial.role !== "admin" && (
        <div className="field"><span className="label">Environments</span>
          <label className="check"><input type="radio" name="scope" checked={initial.scope === "all"} onChange={() => set({ scope: "all" })} /> All environments</label>
          <label className="check"><input type="radio" name="scope" checked={initial.scope === "selected"} onChange={() => set({ scope: "selected" })} /> Only selected environments</label>
          {initial.scope === "selected" && (
            <div className="list-rows">
              {envs.map((e) => (
                <div key={e.id}>
                  <span className="mono">{e.name}</span>
                  <select className="select inline" aria-label={`Access to ${e.name}`} value={initial.grants[e.id] ?? "none"} onChange={(ev) => set({ grants: { ...initial.grants, [e.id]: ev.target.value as "none" } })}>
                    <option value="none">No access</option>
                    <option value="read">Read</option>
                    <option value="write" disabled={initial.role === "viewer"}>Read and write</option>
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
const grantsOut = (g: Record<string, string>) => Object.entries(g).filter(([, a]) => a !== "none").map(([environmentId, access]) => ({ environmentId, access }));

function accessSummary(m: Member, envName: (id: string) => string): string {
  if (m.role === "admin" || m.scope === "all") return "All environments";
  if (!m.grants.length) return "None";
  return m.grants.map((g) => `${envName(g.environmentId)} (${g.access})`).join(", ");
}

export function MembersPage() {
  const { project, envs } = useProject();
  const toast = useToast();
  const admin = project.role === "admin";
  usePageTitle(`Members · ${project.name}`);
  const members = useAsync(() => get(`/projects/${project.id}/members`).then((r) => r.members as Member[]), [project.id]);
  const invites = useAsync(() => (admin ? get(`/projects/${project.id}/invites`).then((r) => r.invites as InviteInfo[]) : Promise.resolve([] as InviteInfo[])), [project.id, admin]);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [created, setCreated] = useState<{ email: string; link: string } | null>(null);
  const envName = (id: string) => envs.find((e) => e.id === id)?.name ?? "?";

  return (
    <>
      <div className="toolbar">
        <div className="left"><h2>{admin ? "People with access" : "Your access"}</h2></div>
        {admin && <div className="right"><button className="btn primary" onClick={() => setInviting(true)}><Icon name="plus" /> Invite someone</button></div>}
      </div>
      {members.error ? <ErrorBox error={members.error} retry={members.reload} /> : members.loading ? <Loading /> : (
        <table className="table" aria-label="Members">
          <thead><tr><th className="wide">Person</th><th>Role</th><th>Environments</th><th /></tr></thead>
          <tbody>
            {members.data!.map((m) => (
              <tr key={m.userId}>
                <td className="fill"><div className="who"><Who name={m.name} /><span className="muted hide-sm">{m.email}</span></div></td>
                <td><span className="pill">{m.role}{m.viaOrg ? " (org)" : ""}</span></td>
                <td className="muted">{accessSummary(m, envName)}</td>
                <td className="row-actions">
                  {admin && !m.viaOrg && <button className="btn ghost sm" onClick={() => setEditing(m)}>Edit access</button>}
                  {admin && !m.viaOrg && <button className="btn ghost sm" onClick={async () => {
                    if (!confirm(`Remove ${m.name} from ${project.name}?`)) return;
                    try { await del(`/projects/${project.id}/members/${m.userId}`); toast(`Removed ${m.name}`); members.reload(); } catch (e) { toast((e as Error).message, true); }
                  }}>Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {admin && (invites.data?.length ?? 0) > 0 && (
        <section>
          <div className="section-head"><h2>Pending invitations</h2></div>
          <table className="table" aria-label="Pending invitations">
            <thead><tr><th className="wide">Email</th><th>Role</th><th>Expires</th><th /></tr></thead>
            <tbody>
              {invites.data!.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td><td><span className="pill">{i.role}</span></td><td className="muted">{relTime(i.expiresAt)}</td>
                  <td className="row-actions"><button className="btn ghost sm" onClick={async () => { try { await del(`/projects/${project.id}/invites/${i.id}`); invites.reload(); } catch (e) { toast((e as Error).message, true); } }}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {inviting && <InviteModal onClose={() => setInviting(false)} onCreated={(email, link) => { setInviting(false); setCreated({ email, link }); invites.reload(); }} />}
      {editing && <EditAccessModal member={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); members.reload(); toast("Access updated"); }} />}
      {created && (
        <Modal title="Invitation created" onClose={() => setCreated(null)}>
          <p className="muted">Send this link to {created.email}. It works once, only for that email address, and expires in 7 days. Email is not sent automatically.</p>
          <div className="code"><code>{created.link}</code><CopyButton text={created.link} label="Copy invitation link" /></div>
          <div className="modal-actions"><button className="btn primary" onClick={() => setCreated(null)}>Done</button></div>
        </Modal>
      )}
    </>
  );
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (email: string, link: string) => void }) {
  const { project, envs } = useProject();
  const [email, setEmail] = useState("");
  const [acc, setAcc] = useState<{ role: string; scope: "all" | "selected"; grants: Record<string, "read" | "write" | "none"> }>({ role: "viewer", scope: "all", grants: {} });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await post(`/projects/${project.id}/invites`, { email, role: acc.role, scope: acc.role === "admin" ? "all" : acc.scope, grants: grantsOut(acc.grants) });
      onCreated(email, `${location.origin}/invite/${r.token}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <Modal title="Invite someone" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="field"><label htmlFor="ie">Email</label><input id="ie" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" autoFocus required /></div>
        <AccessEditor initial={acc} envs={envs} onChange={setAcc} />
        <FormError message={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Create invitation</button></div>
      </form>
    </Modal>
  );
}

function EditAccessModal({ member, onClose, onSaved }: { member: Member; onClose: () => void; onSaved: () => void }) {
  const { project, envs } = useProject();
  const [acc, setAcc] = useState<{ role: string; scope: "all" | "selected"; grants: Record<string, "read" | "write" | "none"> }>({
    role: member.role, scope: member.scope, grants: Object.fromEntries(member.grants.map((g) => [g.environmentId, g.access])),
  });
  const [error, setError] = useState("");
  return (
    <Modal title={`Access for ${member.name}`} onClose={onClose}>
      <div className="form">
        <AccessEditor initial={acc} envs={envs} onChange={setAcc} />
        <FormError message={error} />
        <div className="modal-actions"><button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={async () => {
            try { await put(`/projects/${project.id}/members/${member.userId}`, { role: acc.role, scope: acc.role === "admin" ? "all" : acc.scope, grants: grantsOut(acc.grants) }); onSaved(); }
            catch (e) { setError((e as Error).message); }
          }}>Save</button></div>
      </div>
    </Modal>
  );
}

/* ============================ tokens ============================ */
export function TokensPage() {
  const { project, envs } = useProject();
  usePageTitle(`Tokens · ${project.name}`);
  const toast = useToast();
  const tokens = useAsync(() => get("/tokens").then((r) => (r.tokens as any[]).filter((t) => t.projectId === project.id)), [project.id]);
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [envId, setEnvId] = useState("");
  const [access, setAccess] = useState("read");
  const [expires, setExpires] = useState("90");
  const [error, setError] = useState("");

  async function create(e: FormEvent) {
    e.preventDefault(); setError("");
    try {
      const r = await post("/tokens", { name, kind: "service", projectId: project.id, environmentId: envId || undefined, access, expiresInDays: expires ? Number(expires) : undefined });
      setCreating(false); setShown(r.token); setName(""); tokens.reload();
    } catch (err) { setError((err as Error).message); }
  }
  return (
    <>
      <div className="toolbar">
        <div className="left"><h2>Service tokens</h2><span className="muted">For CI and deployments. They act as you and are limited to this project.</span></div>
        <div className="right"><button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" /> New token</button></div>
      </div>
      {tokens.error ? <ErrorBox error={tokens.error} retry={tokens.reload} /> : tokens.loading ? <Loading /> : !tokens.data!.length ? (
        <div className="empty"><h3>No service tokens</h3><p>Create a read-only token for one environment, then give it to your CI system as SECRETVARIABLE_TOKEN.</p></div>
      ) : (
        <table className="table" aria-label="Service tokens">
          <thead><tr><th className="wide">Name</th><th>Environment</th><th>Access</th><th>Last used</th><th>Expires</th><th /></tr></thead>
          <tbody>
            {tokens.data!.map((t) => (
              <tr key={t.id}>
                <td className="name">{t.name}</td>
                <td className="mono">{t.environmentName ?? "all"}</td>
                <td><span className="pill">{t.access}</span></td>
                <td className="muted">{t.lastUsedAt ? relTime(t.lastUsedAt) : "never"}</td>
                <td className="muted">{t.expiresAt ? relTime(t.expiresAt) : "never"}</td>
                <td className="row-actions"><button className="btn ghost sm" onClick={async () => { if (!confirm(`Revoke "${t.name}"? Anything using it stops working.`)) return; try { await del(`/tokens/${t.id}`); toast("Token revoked"); tokens.reload(); } catch (e) { toast((e as Error).message, true); } }}>Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && (
        <Modal title="New service token" onClose={() => setCreating(false)}>
          <form className="form" onSubmit={create}>
            <div className="field"><label htmlFor="tn">Name</label><input id="tn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="GitHub Actions deploy" autoFocus required /></div>
            <div className="field"><label htmlFor="te">Environment</label>
              <select id="te" className="select" value={envId} onChange={(e) => setEnvId(e.target.value)}><option value="">All environments</option>{envs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
            <div className="field"><label htmlFor="ta">Access</label>
              <select id="ta" className="select" value={access} onChange={(e) => setAccess(e.target.value)}><option value="read">Read only</option><option value="write">Read and write</option></select></div>
            <div className="field"><label htmlFor="tx">Expires</label>
              <select id="tx" className="select" value={expires} onChange={(e) => setExpires(e.target.value)}><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In a year</option><option value="">Never</option></select></div>
            <FormError message={error} />
            <div className="modal-actions"><button type="button" className="btn" onClick={() => setCreating(false)}>Cancel</button><button className="btn primary">Create token</button></div>
          </form>
        </Modal>
      )}
      {shown && (
        <Modal title="Copy your token now" onClose={() => setShown(null)}>
          <p className="muted">This is the only time it is shown. Store it in your CI system's secret store.</p>
          <div className="code"><code>{shown}</code><CopyButton text={shown} label="Copy token" /></div>
          <CodeLine>{`SECRETVARIABLE_URL=${location.origin} SECRETVARIABLE_TOKEN=... sv pull`}</CodeLine>
          <div className="modal-actions"><button className="btn primary" onClick={() => setShown(null)}>I have stored it</button></div>
        </Modal>
      )}
    </>
  );
}

/* ============================ audit ============================ */
export function AuditPage() {
  const { project } = useProject();
  usePageTitle(`Audit log · ${project.name}`);
  const log = useAsync(() => get(`/projects/${project.id}/audit`).then((r) => r.entries as AuditEntry[]), [project.id]);
  return (
    <>
      <div className="toolbar"><div className="left"><h2>Audit log</h2><span className="muted">Every read, change and access decision. Secret values are never recorded.</span></div><div className="right"><button className="btn" onClick={log.reload}>Refresh</button></div></div>
      {log.error ? <ErrorBox error={log.error} retry={log.reload} /> : log.loading ? <Loading /> : (
        <table className="table" aria-label="Audit log">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th className="wide">Target</th><th className="hide-sm num">From</th></tr></thead>
          <tbody>
            {log.data!.map((a) => (
              <tr key={a.id}>
                <td className="muted" title={absTime(a.createdAt)} style={{ whiteSpace: "nowrap" }}>{relTime(a.createdAt)}</td>
                <td><Who name={a.actorName} /></td>
                <td>{actionLabel(a.action)}</td>
                <td className="fill"><span className="mono">{a.target ?? "-"}</span>{a.meta && (a.meta as any).version ? <span className="muted mono"> v{String((a.meta as any).version)}</span> : null}</td>
                <td className="muted mono hide-sm num">{a.ip ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ============================ settings ============================ */
export function SettingsPage() {
  const { project, envs, reloadEnvs, reloadProject } = useProject();
  const nav = useNavigate();
  const toast = useToast();
  usePageTitle(`Settings · ${project.name}`);
  const [name, setName] = useState(project.name);
  const [newEnv, setNewEnv] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); } catch (e) { toast((e as Error).message, true); } };

  return (
    <div>
      <section className="setting">
        <div className="about"><h2>Project name</h2><p>Shown to everyone with access.</p></div>
        <form className="body" onSubmit={(e) => { e.preventDefault(); run(async () => { await patch(`/projects/${project.id}`, { name }); reloadProject(); }, "Project renamed"); }}>
          <div className="field"><label htmlFor="sn">Name</label><input id="sn" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><button className="btn primary" disabled={!name.trim() || name === project.name}>Save</button></div>
        </form>
      </section>

      <section className="setting">
        <div className="about"><h2>Environments</h2><p>Each environment has its own variables and its own linear version history.</p></div>
        <div className="body">
          <div className="list-rows">
            {envs.map((e) => (
              <div key={e.id}>
                <span><span className="mono">{e.name}</span> <span className="muted">{e.headNumber ? `v${e.headNumber}, ${e.variableCount} variables` : "empty"}</span></span>
                <span className="actions">
                  <button className="btn ghost sm" onClick={() => { const n = prompt("Rename environment", e.name); if (n && n !== e.name) run(async () => { await patch(`/environments/${e.id}`, { name: n }); reloadEnvs(); }, "Environment renamed"); }}>Rename</button>
                  <button className="btn ghost sm" onClick={() => { if (confirm(`Delete "${e.name}" and all of its versions? This cannot be undone.`)) run(async () => { await del(`/environments/${e.id}`); reloadEnvs(); }, "Environment deleted"); }}>Delete</button>
                </span>
              </div>
            ))}
          </div>
          <form className="form" onSubmit={(ev) => {
            ev.preventDefault();
            run(async () => {
              const src = envs.find((x) => x.id === copyFrom);
              let copyFromVersionId: string | undefined;
              if (src?.headVersionId) copyFromVersionId = src.headVersionId;
              await post(`/projects/${project.id}/environments`, { name: newEnv, copyFromVersionId });
              setNewEnv(""); setCopyFrom(""); reloadEnvs();
            }, "Environment created");
          }}>
            <div className="field"><label htmlFor="ne">Add an environment</label>
              <div className="inline-form">
                <input id="ne" className="input" value={newEnv} onChange={(e) => setNewEnv(e.target.value)} placeholder="preview" />
                <select className="select" aria-label="Copy variables from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}><option value="">Start empty</option>{envs.filter((x) => x.headVersionId).map((x) => <option key={x.id} value={x.id}>Copy from {x.name}</option>)}</select>
                <button className="btn" disabled={!newEnv.trim()}>Add</button>
              </div></div>
          </form>
        </div>
      </section>

      <section className="setting">
        <div className="about"><h2>Delete project</h2><p>Permanently deletes the project, its environments, every version and all tokens.</p></div>
        <div className="body">
          <div className="field"><label htmlFor="dn">Type <span className="mono">{project.name}</span> to confirm</label><input id="dn" className="input" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} /></div>
          <div><button className="btn danger" disabled={confirmName !== project.name} onClick={() => run(async () => { await del(`/projects/${project.id}`); nav("/"); }, "Project deleted")}>Delete this project</button></div>
        </div>
      </section>
    </div>
  );
}
