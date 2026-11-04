import { Fragment, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, useNavigate, useParams } from "react-router-dom";
import { diffEnv, isValidKey, parseEnv, serializeEnv, type EnvMap, type VersionSummary } from "@secretvariable/shared";
import { get, post } from "../api";
import { CodeLine, CopyButton, ErrorBox, FormError, Icon, Loading, Modal, Signs, Who, absTime, copyText, relTime, useAsync, usePageTitle, useToast } from "../ui";
import { useProject } from "./project";

type VersionRow = VersionSummary & { summary: { added: string[]; changed: string[]; removed: string[] } | null };

function useEnv() {
  const { env: name } = useParams();
  const ctx = useProject();
  const env = ctx.envs.find((e) => e.name === name);
  return { ...ctx, env, name };
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function EnvTabs({ envName, section }: { envName: string; section: "variables" | "history" }) {
  const { project } = useProject();
  const base = `/p/${project.id}/e/${encodeURIComponent(envName)}`;
  return (
    <div className="tabs tabs-sub" role="tablist">
      <NavLink to={base} end role="tab" aria-selected={section === "variables"} className="tab">Variables</NavLink>
      <NavLink to={`${base}/history`} role="tab" aria-selected={section === "history"} className="tab">History</NavLink>
    </div>
  );
}

export function useFinding(versions: VersionRow[] | null, envName: string) {
  const { setSub } = useProject();
  useEffect(() => {
    if (!versions) return;
    const h = versions[0];
    if (!h) { setSub(<>{envName} has no variables yet.</>); return; }
    const s = h.summary;
    if (h.number === 1) {
      setSub(<><strong>{envName}</strong> has <strong className="mono">{h.variableCount}</strong> variables, first saved {relTime(h.createdAt)} by {h.authorName ?? "someone"}{h.message ? <>: <span className="muted">{h.message}</span></> : null}.</>);
      return () => setSub(null);
    }
    const what = s ? [s.added.length && `${s.added.length} added`, s.changed.length && `${s.changed.length} changed`, s.removed.length && `${s.removed.length} removed`].filter(Boolean).join(", ") : "";
    const keys = s ? [...s.changed, ...s.added, ...s.removed].slice(0, 3).join(", ") : "";
    setSub(<><strong>{envName}</strong> is at <strong className="mono">v{h.number}</strong>, saved {relTime(h.createdAt)} by {h.authorName ?? "someone"}{h.message ? <>: <span className="muted">{h.message}</span></> : null}{what ? <>. <span className="muted">{what}{keys ? ` (${keys}${(s!.added.length + s!.changed.length + s!.removed.length) > 3 ? ", ..." : ""})` : ""}</span></> : null}</>);
    return () => setSub(null);
  }, [versions, envName]);
}

export function VariablesPage() {
  const { project, env, name, reloadEnvs } = useEnv();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [values, setValues] = useState<EnvMap | null>(null);
  const [reveal, setReveal] = useState(false);
  const [rowsShown, setRowsShown] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{ key: string; value: string; id: number }[] | null>(null);
  const [paste, setPaste] = useState(false);
  const [confirm, setConfirm] = useState(false);
  usePageTitle(`${name} · ${project.name}`);

  const keys = useAsync(() => (env?.headNumber ? get(`/environments/${env.id}/versions/head?keys=1`).then((r) => r.keys as string[]) : Promise.resolve([] as string[])), [env?.id, env?.headNumber]);
  const versions = useAsync(() => (env ? get(`/environments/${env.id}/versions`).then((r) => r.versions as VersionRow[]) : Promise.resolve(null)), [env?.id, env?.headNumber]);
  useFinding(versions.data, name ?? "");
  useEffect(() => { setValues(null); setReveal(false); setRowsShown(new Set()); setEdit(null); setQuery(""); }, [env?.id, env?.headNumber]);

  if (!env) return <Navigate to={`/p/${project.id}`} replace />;
  const canWrite = env.access === "write";

  async function loadValues(): Promise<EnvMap> {
    if (values) return values;
    const r = await get(`/environments/${env!.id}/versions/head`);
    setValues(r.variables);
    return r.variables;
  }
  const guard = async <T,>(fn: () => Promise<T>) => { try { return await fn(); } catch (e) { toast((e as Error).message, true); } };

  let nextId = 1000;
  async function startEdit() {
    const v = await guard(loadValues);
    if (!v) return;
    setEdit(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([key, value], i) => ({ key, value, id: i })));
    setReveal(true);
  }

  const allKeys = keys.data ?? [];
  // for each key, the newest version that added or changed it (from key-name summaries; no values involved)
  const lastChanged = useMemo(() => {
    const m = new Map<string, VersionRow>();
    for (const v of versions.data ?? []) {
      for (const k of [...(v.summary?.added ?? []), ...(v.summary?.changed ?? [])]) if (!m.has(k)) m.set(k, v);
    }
    return m;
  }, [versions.data]);
  const shown = allKeys.filter((k) => k.toLowerCase().includes(query.trim().toLowerCase()));
  const draftMap: EnvMap | null = edit ? Object.fromEntries(edit.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value])) : null;
  const draftErrors = edit ? edit.flatMap((r) => (r.key.trim() && !isValidKey(r.key.trim()) ? [`"${r.key}" is not a valid name`] : [])).concat(
    edit.length && new Set(edit.filter((r) => r.key.trim()).map((r) => r.key.trim())).size !== edit.filter((r) => r.key.trim()).length ? ["Duplicate variable names"] : []) : [];

  return (
    <>
      <div className="toolbar">
        <div className="left">
          <EnvTabs envName={env.name} section="variables" />
        </div>
        <div className="right">
          {!edit && allKeys.length > 0 && (
            <>
              <div className="search"><Icon name="search" /><input className="input" placeholder="Filter variables" aria-label="Filter variables" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
              <span className="count">{query ? `${shown.length} of ${allKeys.length}` : `${allKeys.length} variables`}</span>
            </>
          )}
        </div>
      </div>

      <div className="toolbar">
        <div className="left">
          {edit ? <span className="muted">Editing {env.name}. Changes are saved as a new version.</span> : <span className="muted">Values are hidden until you reveal them. Revealing is recorded in the audit log.</span>}
        </div>
        <div className="right actions">
          {!edit && allKeys.length > 0 && (
            <>
              <button className="btn" onClick={async () => { if (!reveal) { const v = await guard(loadValues); if (!v) return; } setReveal((r) => !r); }}>
                <Icon name={reveal ? "eyeoff" : "eye"} /> {reveal ? "Hide values" : "Reveal values"}
              </button>
              <button className="btn" onClick={async () => { const v = await guard(loadValues); if (v) download(`${env.name}.env`, serializeEnv(v)); }}><Icon name="download" /> Download .env</button>
            </>
          )}
          {!edit && canWrite && <button className="btn primary" onClick={startEdit}><Icon name="edit" /> {allKeys.length ? "Edit variables" : "Add variables"}</button>}
          {edit && (
            <>
              <button className="btn" onClick={() => setPaste(true)}>Paste .env</button>
              <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn primary" disabled={!!draftErrors.length} onClick={() => setConfirm(true)}>Review and save</button>
            </>
          )}
        </div>
      </div>

      {keys.error ? <ErrorBox error={keys.error} retry={keys.reload} /> : keys.loading && !edit ? <Loading /> : edit ? (
        <section>
          <table className="table" aria-label="Edit variables">
            <thead><tr><th style={{ width: "34%" }}>Name</th><th className="wide">Value</th><th /></tr></thead>
            <tbody>
              {edit.map((r) => (
                <tr key={r.id}>
                  <td><input className="input var-input" aria-label="Variable name" value={r.key} placeholder="NAME" spellCheck={false} onChange={(e) => setEdit(edit.map((x) => (x.id === r.id ? { ...x, key: e.target.value } : x)))} /></td>
                  <td><input className="input var-input" aria-label={`Value of ${r.key || "new variable"}`} value={r.value} placeholder="value" spellCheck={false} onChange={(e) => setEdit(edit.map((x) => (x.id === r.id ? { ...x, value: e.target.value } : x)))} /></td>
                  <td className="row-actions" style={{ paddingLeft: 12 }}><button className="icon-btn" aria-label={`Remove ${r.key || "row"}`} onClick={() => setEdit(edit.filter((x) => x.id !== r.id))} style={{ visibility: "visible" }}><Icon name="x" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions stack-top-sm">
            <button className="btn sm" onClick={() => setEdit([...edit, { key: "", value: "", id: nextId++ + edit.length }])}><Icon name="plus" /> Add variable</button>
            {draftErrors.map((e) => <span key={e} className="error-text">{e}</span>)}
          </div>
        </section>
      ) : allKeys.length === 0 ? (
        <div className="empty">
          <h3>{env.name} has no variables yet</h3>
          <p>{canWrite ? "Paste an existing .env file here, or push one from your project folder with the CLI." : "Someone with write access needs to add variables first."}</p>
          {canWrite && <div className="actions"><button className="btn primary" onClick={async () => { setEdit([]); setPaste(true); setValues({}); }}>Paste a .env file</button></div>}
          <CodeLine>{`svar push --env ${env.name}`}</CodeLine>
        </div>
      ) : (
        <section>
          <table className="table" aria-label={`Variables in ${env.name}`}>
            <thead><tr><th style={{ width: "28%" }}>Name</th><th style={{ width: "38%" }}>Value</th><th className="hide-sm">Last changed</th><th /></tr></thead>
            <tbody>
              {shown.map((k) => (
                <tr key={k}>
                  <td><span className="var-name">{k}</span></td>
                  <td>
                    <div className="value-cell">
                      {(reveal || rowsShown.has(k)) && values ? <span className="var-value shown" title={values[k]}>{values[k] === "" ? <span className="muted">(empty)</span> : values[k]}</span> : <span className="var-value masked" aria-label="Hidden value">{"\u2022".repeat(14)}</span>}
                      <button className="icon-btn" aria-label={rowsShown.has(k) ? `Hide value of ${k}` : `Reveal value of ${k}`} title={rowsShown.has(k) ? "Hide" : "Reveal this value"} onClick={async () => {
                        if (!rowsShown.has(k)) { const v = await guard(loadValues); if (!v) return; }
                        setRowsShown((cur) => { const n = new Set(cur); n.has(k) ? n.delete(k) : n.add(k); return n; });
                      }}><Icon name={rowsShown.has(k) ? "eyeoff" : "eye"} /></button>
                    </div>
                  </td>
                  <td className="changed hide-sm">{lastChanged.get(k) ? <><span className="mono">v{lastChanged.get(k)!.number}</span> {relTime(lastChanged.get(k)!.createdAt)} by {lastChanged.get(k)!.authorName ?? "someone"}</> : <span className="dash">-</span>}</td>
                  <td className="row-actions"><CopyButton label={`Copy value of ${k}`} text={async () => (await loadValues())[k] ?? ""} /></td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={4} className="muted">No variables match "{query}".</td></tr>}
            </tbody>
          </table>
          <div className="stack-top"><CodeLine>{`svar pull --env ${env.name}`}</CodeLine></div>
        </section>
      )}

      {paste && <PasteModal onClose={() => setPaste(false)} onApply={(vars, replace) => {
        const current: EnvMap = replace ? {} : Object.fromEntries((edit ?? []).filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));
        const merged = { ...current, ...vars };
        setEdit(Object.entries(merged).map(([key, value], i) => ({ key, value, id: 5000 + i })));
        setReveal(true); setPaste(false);
      }} />}
      {confirm && draftMap && (
        <SaveModal envId={env.id} envName={env.name} before={values ?? {}} after={draftMap} onClose={() => setConfirm(false)}
          onSaved={(n, unchanged) => { setConfirm(false); setEdit(null); setValues(null); setReveal(false); reloadEnvs(); keys.reload(); versions.reload(); toast(unchanged ? "No changes to save" : `Saved ${env.name} as v${n}`); }} />
      )}
    </>
  );
}

function PasteModal({ onClose, onApply }: { onClose: () => void; onApply: (v: EnvMap, replace: boolean) => void }) {
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  const parsed = useMemo(() => parseEnv(text), [text]);
  const n = Object.keys(parsed).length;
  return (
    <Modal title="Paste a .env file" onClose={onClose} wide>
      <div className="field"><label htmlFor="paste">Contents</label><textarea id="paste" className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={"DATABASE_URL=postgres://...\nAPI_KEY=..."} autoFocus spellCheck={false} /></div>
      <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace all current variables instead of merging</label>
      <div className="modal-actions">
        <span className="note">{n} {n === 1 ? "variable" : "variables"} found</span>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!n} onClick={() => onApply(parsed, replace)}>Use these</button>
      </div>
    </Modal>
  );
}

function SaveModal({ envId, envName, before, after, onClose, onSaved }: { envId: string; envName: string; before: EnvMap; after: EnvMap; onClose: () => void; onSaved: (n: number, unchanged: boolean) => void }) {
  const d = diffEnv(before, after);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changes = d.added.length + d.changed.length + d.removed.length;
  async function save() {
    setBusy(true); setError("");
    try { const r = await post(`/environments/${envId}/versions`, { variables: after, message }); onSaved(r.version.number, r.unchanged); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <Modal title={`Save ${envName}`} onClose={onClose}>
      {changes === 0 ? <p className="muted">Nothing has changed.</p> : (
        <div className="keys" style={{ flexDirection: "column", gap: 4, padding: 0 }}>
          {d.added.map((k) => <span key={k}><b>+</b> {k}</span>)}
          {d.changed.map((k) => <span key={k}><b>~</b> {k}</span>)}
          {d.removed.map((k) => <span key={k}><b>{"−"}</b> {k}</span>)}
        </div>
      )}
      <div className="field"><label htmlFor="msg">Message</label><input id="msg" className="input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Why did these change?" maxLength={200} autoFocus /></div>
      <FormError message={error} />
      <div className="modal-actions"><button className="btn" onClick={onClose}>Back</button><button className="btn primary" disabled={busy || changes === 0} onClick={save}>Save new version</button></div>
    </Modal>
  );
}

/* ================= history ================= */
export function HistoryPage() {
  const { project, env, name } = useEnv();
  const toast = useToast();
  const { reloadEnvs } = useProject();
  const [open, setOpen] = useState<number | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [rollback, setRollback] = useState<VersionRow | null>(null);
  usePageTitle(`History · ${name}`);
  const versions = useAsync(() => (env ? get(`/environments/${env.id}/versions`).then((r) => r.versions as VersionRow[]) : Promise.resolve(null)), [env?.id, env?.headNumber]);
  useFinding(versions.data, name ?? "");
  if (!env) return <Navigate to={`/p/${project.id}`} replace />;
  const list = versions.data ?? [];

  return (
    <>
      <div className="toolbar">
        <div className="left"><EnvTabs envName={env.name} section="history" /></div>
        <div className="right"><span className="count">{list.length} {list.length === 1 ? "version" : "versions"}</span></div>
      </div>
      {versions.error ? <ErrorBox error={versions.error} retry={versions.reload} /> : versions.loading ? <Loading /> : !list.length ? (
        <div className="empty"><h3>No versions yet</h3><p>Every save creates a new numbered version that you can view, compare and roll back to.</p></div>
      ) : (
        <section>
          <table className="table" aria-label="Version history">
            <thead><tr><th>Version</th><th className="wide">Message</th><th className="hide-sm">Author</th><th>When</th><th>Changes</th><th /></tr></thead>
            <tbody>
              {list.map((v, i) => (
                <Fragment key={v.id}>
                  <tr>
                    <td style={{ whiteSpace: "nowrap" }}><span className="mono">v{v.number}</span>{i === 0 && <span className="pill head-mark">head</span>}</td>
                    <td className="fill">{v.message || <span className="dash">-</span>}</td>
                    <td className="hide-sm"><Who name={v.authorName} /></td>
                    <td className="muted" title={absTime(v.createdAt)} style={{ whiteSpace: "nowrap" }}>{relTime(v.createdAt)}</td>
                    <td><button className="btn ghost sm" aria-expanded={open === v.number} onClick={() => setOpen(open === v.number ? null : v.number)} style={{ padding: 0 }}><Signs s={v.summary} /></button></td>
                    <td className="row-actions">
                      <button className="btn ghost sm" onClick={() => setView(v.number)}>View</button>
                      {i < list.length - 1 && <DiffButton envId={env.id} from={list[i + 1]!.number} to={v.number} />}
                      {i > 0 && env.access === "write" && <button className="btn ghost sm" onClick={() => setRollback(v)}><Icon name="undo" /> Roll back</button>}
                    </td>
                  </tr>
                  {open === v.number && v.summary && (
                    <tr><td colSpan={6} style={{ height: "auto", borderTop: 0 }}>
                      <div className="keys">
                        {v.summary.added.map((k) => <span key={k}><b>+</b> {k}</span>)}
                        {v.summary.changed.map((k) => <span key={k}><b>~</b> {k}</span>)}
                        {v.summary.removed.map((k) => <span key={k}><b>{"−"}</b> {k}</span>)}
                        {!v.summary.added.length && !v.summary.changed.length && !v.summary.removed.length && <span>No changes</span>}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {view !== null && <ViewVersion envId={env.id} number={view} onClose={() => setView(null)} />}
      {rollback && (
        <Modal title={`Roll back to v${rollback.number}?`} onClose={() => setRollback(null)}>
          <p className="muted">This saves a new version with the contents of v{rollback.number}. Nothing is deleted, so you can undo it by rolling forward again.</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setRollback(null)}>Cancel</button>
            <button className="btn primary" onClick={async () => {
              try { const r = await post(`/environments/${env.id}/rollback`, { number: rollback.number }); toast(r.unchanged ? "Already identical" : `Saved as v${r.version.number}`); setRollback(null); reloadEnvs(); versions.reload(); }
              catch (e) { toast((e as Error).message, true); }
            }}>Roll back</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function DiffButton({ envId, from, to }: { envId: string; from: number; to: number }) {
  const [open, setOpen] = useState(false);
  return (<><button className="btn ghost sm" onClick={() => setOpen(true)}>Compare</button>{open && <DiffModal envId={envId} from={from} to={to} onClose={() => setOpen(false)} />}</>);
}

function DiffModal({ envId, from, to, onClose }: { envId: string; from: number; to: number; onClose: () => void }) {
  const [reveal, setReveal] = useState(false);
  const d = useAsync(() => get(`/environments/${envId}/diff?from=${from}&to=${to}${reveal ? "&reveal=1" : ""}`), [envId, from, to, reveal]);
  const rows = d.data ? [
    ...d.data.added.map((x: any) => ({ sign: "+", ...x })),
    ...d.data.changed.map((x: any) => ({ sign: "~", ...x })),
    ...d.data.removed.map((x: any) => ({ sign: "−", ...x })),
  ] : [];
  return (
    <Modal title={`v${from} to v${to}`} onClose={onClose} wide>
      {d.error ? <ErrorBox error={d.error} /> : d.loading && !d.data ? <Loading /> : (
        <>
          {!rows.length ? <p className="muted">No differences.</p> : (
            <table className="table" aria-label="Differences">
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.sign + r.key}>
                    <td style={{ width: 24 }} className="mono">{r.sign}</td>
                    <td style={{ width: "42%" }}><span className="var-name">{r.key}</span></td>
                    <td>{reveal ? <span className="var-value shown">{r.sign === "~" ? `${r.old}  →  ${r.new}` : r.new ?? r.old}</span> : <span className="muted">{r.sign === "~" ? "value changed" : r.sign === "+" ? "added" : "removed"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted">{d.data?.unchangedCount ?? 0} unchanged</p>
        </>
      )}
      <div className="modal-actions"><button className="btn" onClick={() => setReveal((r) => !r)}><Icon name={reveal ? "eyeoff" : "eye"} /> {reveal ? "Hide values" : "Reveal values"}</button><button className="btn primary" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

function ViewVersion({ envId, number, onClose }: { envId: string; number: number; onClose: () => void }) {
  const [reveal, setReveal] = useState(false);
  const toast = useToast();
  const r = useAsync(() => get(`/environments/${envId}/versions/${number}`), [envId, number]);
  const vars: EnvMap = r.data?.variables ?? {};
  return (
    <Modal title={`Version ${number}`} onClose={onClose} wide>
      {r.error ? <ErrorBox error={r.error} /> : r.loading ? <Loading /> : (
        <table className="table" aria-label={`Variables in v${number}`}>
          <tbody>
            {Object.keys(vars).sort().map((k) => (
              <tr key={k}><td><span className="var-name">{k}</span></td><td>{reveal ? <span className="var-value shown">{vars[k] || <span className="muted">(empty)</span>}</span> : <span className="var-value">{"•".repeat(14)}</span>}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={() => setReveal((x) => !x)}><Icon name={reveal ? "eyeoff" : "eye"} /> {reveal ? "Hide values" : "Reveal values"}</button>
        <button className="btn" onClick={async () => { toast((await copyText(serializeEnv(vars))) ? "Copied to clipboard" : "Could not copy", false); }}>Copy as .env</button>
        <button className="btn primary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
