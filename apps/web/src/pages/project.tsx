import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useNavigate, useParams } from "react-router-dom";
import type { Environment } from "@secretvariable/shared";
import { get } from "../api";
import { ErrorBox, Loading, useAsync, usePageTitle } from "../ui";

export interface ProjectInfo { id: string; orgId: string; name: string; slug: string; role: "admin" | "editor" | "viewer"; scope: "all" | "selected"; orgName: string; createdAt: string }
interface Ctx { project: ProjectInfo; envs: Environment[]; reloadEnvs: () => void; reloadProject: () => void; setSub: (n: ReactNode) => void }
const ProjectCtx = createContext<Ctx>(null as never);
export const useProject = () => useContext(ProjectCtx);

export function ProjectLayout() {
  const { projectId } = useParams();
  const nav = useNavigate();
  const proj = useAsync(() => get(`/projects/${projectId}`).then((r) => r.project as ProjectInfo), [projectId]);
  const envs = useAsync(() => get(`/projects/${projectId}/environments`).then((r) => r.environments as Environment[]), [projectId]);
  const [sub, setSub] = useState<ReactNode>(null);
  usePageTitle(proj.data?.name ?? "Project");
  useEffect(() => { if (proj.error && (proj.error as any).status === 404) nav("/", { replace: true }); }, [proj.error]);

  if (proj.error) return <div className="page"><ErrorBox error={proj.error} retry={proj.reload} /></div>;
  if (!proj.data || !envs.data) return <div className="page"><Loading /></div>;
  const project = proj.data;
  const admin = project.role === "admin";

  return (
    <ProjectCtx.Provider value={{ project, envs: envs.data, reloadEnvs: envs.reload, reloadProject: proj.reload, setSub }}>
      <div className="page">
        <div>
          <div className="crumbs"><Link to="/">Projects</Link><span>/</span><span>{project.orgName}</span></div>
          <div className="title-row" style={{ marginTop: 10 }}>
            <div>
              <h1>{project.name}</h1>
              <div className="sub">{sub}</div>
            </div>
          </div>
        </div>
        <nav className="tabs" aria-label="Project">
          {envs.data.map((e) => (
            <NavLink key={e.id} to={`/p/${project.id}/e/${encodeURIComponent(e.name)}`} className="tab">{e.name}</NavLink>
          ))}
          <span className="grow" />
          <ProjectTab to="members">Members</ProjectTab>
          {admin && <ProjectTab to="tokens">Tokens</ProjectTab>}
          {admin && <ProjectTab to="audit">Audit log</ProjectTab>}
          {admin && <ProjectTab to="settings">Settings</ProjectTab>}
        </nav>
        <Outlet />
      </div>
    </ProjectCtx.Provider>
  );
}

function ProjectTab({ to, children }: { to: string; children: ReactNode }) {
  return <NavLink to={to} className="tab">{children}</NavLink>;
}

export function ProjectIndex() {
  const { project, envs } = useProject();
  if (!envs[0]) return <div className="empty"><h3>No environments you can access</h3><p>Ask a project admin to give you access to an environment.</p></div>;
  return <Navigate to={`/p/${project.id}/e/${encodeURIComponent(envs[0]!.name)}`} replace />;
}
