import { createContext, useContext, useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { Org } from "@secretvariable/shared";
import { get } from "./api";
import { useAuth } from "./auth";
import { AccountPage, InvitationsPage, OrgPage } from "./pages/account";
import { InvitePage, LoginPage, RegisterPage } from "./pages/auth";
import { ProjectLayout, ProjectIndex } from "./pages/project";
import { HistoryPage, VariablesPage } from "./pages/variables";
import { AuditPage, MembersPage, SettingsPage, TokensPage } from "./pages/team";
import { ProjectsPage } from "./pages/projects";
import { BrandMark, Icon, ThemeToggle, useAsync } from "./ui";

interface OrgState { orgs: Org[]; org: Org | null; setOrgId: (id: string) => void; reload: () => void; invites: number }
const OrgCtx = createContext<OrgState>(null as never);
export const useOrg = () => useContext(OrgCtx);

function RailLink({ to, icon, label, short, count, end }: { to: string; icon: string; label: string; short?: string; count?: number; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className="rail-item" data-tip={label} aria-label={label}>
      <Icon name={icon} />
      <span className="label">{short ?? label}</span>
      {count ? <span className="count" aria-label={`${count} pending`}>{count}</span> : null}
    </NavLink>
  );
}

function Shell() {
  const { user, ready, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [orgId, setOrgIdState] = useState<string | null>(() => { try { return localStorage.getItem("sv.org"); } catch { return null; } });
  const orgs = useAsync(() => (user ? get("/orgs").then((r) => r.orgs as Org[]) : Promise.resolve([] as Org[])), [user?.id]);
  const inv = useAsync(() => (user ? get("/me/invites").then((r) => r.invites.length as number) : Promise.resolve(0)), [user?.id, loc.pathname]);

  useEffect(() => { if (ready && !user) nav("/login", { replace: true, state: { from: loc.pathname + loc.search } }); }, [ready, user]);
  if (!ready || !user) return null;

  const list = orgs.data ?? [];
  const org = list.find((o) => o.id === orgId) ?? list[0] ?? null;
  const setOrgId = (id: string) => { setOrgIdState(id); try { localStorage.setItem("sv.org", id); } catch { /* ignore */ } };
  const isActive = (p: string) => loc.pathname.startsWith(p);

  return (
    <OrgCtx.Provider value={{ orgs: list, org, setOrgId, reload: orgs.reload, invites: inv.data ?? 0 }}>
      <div className="app">
        <nav className="rail" aria-label="Main">
          <NavLink to="/" className="brand" aria-label="SecretVariable home"><BrandMark /></NavLink>
          <RailLink to="/" icon="grid" label="Projects" end />
          <RailLink to="/org" icon="users" label="Organisation" short="Org" />
          <RailLink to="/invitations" icon="mail" label="Invites" count={inv.data ?? 0} />
          <div className="rail-sep" />
          <div className="rail-spacer" />
          <ThemeToggle variant="rail" />
          <RailLink to="/account" icon="user" label="Account" />
          <button className="rail-item" data-tip="Sign out" aria-label="Sign out" onClick={() => logout().then(() => nav("/login"))}><Icon name="logout" /><span className="label">Sign out</span></button>
        </nav>
        <main className="main" data-section={isActive("/p/") ? "project" : "other"}><Outlet /></main>
      </div>
    </OrgCtx.Provider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<Shell />}>
        <Route index element={<ProjectsPage />} />
        <Route path="invite/:token" element={<InvitePage />} />
        <Route path="invitations" element={<InvitationsPage />} />
        <Route path="org" element={<OrgPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="p/:projectId" element={<ProjectLayout />}>
          <Route index element={<ProjectIndex />} />
          <Route path="e/:env" element={<VariablesPage />} />
          <Route path="e/:env/history" element={<HistoryPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="tokens" element={<TokensPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
