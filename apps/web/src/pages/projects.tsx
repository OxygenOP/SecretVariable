import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AuditEntry, Project } from "@secretvariable/shared";
import { get, post } from "../api";
import { useOrg } from "../App";
import { CodeLine, ErrorBox, FormError, Icon, Loading, Modal, Who, absTime, relTime, useAsync, usePageTitle, useToast } from "../ui";
import { actionLabel } from "./labels";

function NewProject({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [envs, setEnvs] = useState("development, staging, production");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const environments = envs.split(",").map((x) => x.trim()).filter(Boolean);
      const r = await post(`/orgs/${orgId}/projects`, { name, environments });
      nav(`/p/${r.project.id}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <Modal title="New project" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="field"><label htmlFor="pn">Project name</label><input id="pn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="payments-api" autoFocus required /></div>
        <div className="field"><label htmlFor="pe">Environments</label><input id="pe" className="input" value={envs} onChange={(e) => setEnvs(e.target.value)} /><span className="hint">Comma separated. You can add or rename them later.</span></div>
        <FormError message={error} />
        <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !name.trim()}>Create project</button></div>
      </form>
    </Modal>
  );
}

export function ProjectsPage() {
  const { org, orgs, setOrgId, invites } = useOrg();
  const [creating, setCreating] = useState(false);
  usePageTitle("Projects");
  const projects = useAsync(() => (org ? get(`/orgs/${org.id}/projects`).then((r) => r.projects as Project[]) : Promise.resolve([] as Project[])), [org?.id]);
  const activity = useAsync(() => (org && org.role !== "member" ? get(`/orgs/${org.id}/audit`).then((r) => r.entries as (AuditEntry & { projectName?: string })[]) : Promise.resolve([])), [org?.id, org?.role]);

  if (!org) return <div className="page"><Loading /></div>;
  const list = projects.data ?? [];
  // the overview shows what changed; reads and sign-ins stay in the full audit log
  const changes = (activity.data ?? []).filter((a) => a.action !== "variables.read" && a.action !== "user.login");
  const noProjects = !projects.loading && !list.length;

  return (
    <div className="page">
      <div className="title-row">
        <div>
          <h1>Projects</h1>
          <p className="sub">{projects.loading ? "Loading" : list.length ? <><strong>{list.length}</strong> {list.length === 1 ? "project" : "projects"} in {org.name}</> : `No projects in ${org.name} yet`}</p>
        </div>
        <div className="actions">
          {orgs.length > 1 && (
            <select className="select inline" aria-label="Organisation" value={org.id} onChange={(e) => setOrgId(e.target.value)}>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" /> New project</button>
        </div>
      </div>

      {invites > 0 && (
        <div className="notice"><span>You have {invites} pending {invites === 1 ? "invitation" : "invitations"}.</span><Link className="btn sm" to="/invitations">Review</Link></div>
      )}

      {noProjects && (
        <section aria-label="Getting started">
          <div className="section-head"><h2>Get started</h2></div>
          <div className="strip">
            <button className="cell" onClick={() => setCreating(true)}>
              <span className="step">1</span><span className="t">Create a project</span><span className="d">One project per app or service.</span><Icon name="arrow" className="ico arrow" />
            </button>
            <div><span className="step">2</span><span className="t">Install the CLI</span><span className="d mono">npm i -g @secretvariable/cli</span></div>
            <div><span className="step">3</span><span className="t">Push your .env</span><span className="d mono">svar push</span></div>
            <div><span className="step">4</span><span className="t">Invite your team</span><span className="d">Choose which environments they see.</span></div>
          </div>
        </section>
      )}

      {projects.error ? <ErrorBox error={projects.error} retry={projects.reload} /> : projects.loading ? <Loading /> : list.length > 0 && (
        <section>
          <table className="table">
            <thead><tr><th className="wide">Project</th><th>Environments</th><th>Your role</th><th className="hide-sm">Created</th></tr></thead>
            <tbody>
              {list.map((p) => (
                <ProjectRow key={p.id} p={p} />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {changes.length > 0 && (
        <section>
          <div className="section-head"><h2>Recent activity</h2><span className="meta"><span className="dot" /> Updated {relTime(changes[0]!.createdAt)}</span></div>
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th className="hide-sm wide">Where</th></tr></thead>
            <tbody>
              {changes.slice(0, 5).map((a) => (
                <tr key={a.id}>
                  <td className="muted" title={absTime(a.createdAt)} style={{ whiteSpace: "nowrap" }}>{relTime(a.createdAt)}</td>
                  <td><Who name={a.actorName} /></td>
                  <td>{actionLabel(a.action)}</td>
                  <td className="hide-sm fill"><span className="mono">{[(a as any).projectName, a.target].filter(Boolean).join(" / ") || "-"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!noProjects && !projects.loading && <CodeLine>svar init</CodeLine>}
      {creating && <NewProject orgId={org.id} onClose={() => setCreating(false)} />}
    </div>
  );
}

function ProjectRow({ p }: { p: Project }) {
  const nav = useNavigate();
  return (
    <tr className="row-link" tabIndex={0} onClick={() => nav(`/p/${p.id}`)} onKeyDown={(e) => { if (e.key === "Enter") nav(`/p/${p.id}`); }}>
      <td className="name fill"><Link to={`/p/${p.id}`} onClick={(e) => e.stopPropagation()}>{p.name}</Link></td>
      <td className="num" style={{ textAlign: "left" }}>{p.environmentCount}</td>
      <td><span className="pill">{p.role}</span></td>
      <td className="muted hide-sm" title={absTime(p.createdAt)}>{relTime(p.createdAt)}</td>
    </tr>
  );
}
