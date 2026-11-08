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
import { CliGuidePage } from "./pages/cli-guide";
import { BrandMark, Icon, ThemeToggle, useAsync } from "./ui";

interface OrgState { orgs: Org[]; org: Org | null; setOrgId: (id: string) => void; reload: () => void; invites: number }
const OrgCtx = createContext<OrgState>(null as never);
export const useOrg = () => useContext(OrgCtx);

function SideLink({ to, icon, label, count, end, onClick }: { to: string; icon: string; label: string; count?: number; end?: boolean; onClick?: () => void }) {
  return (
    <NavLink to={to} end={end} className="side-item" data-tip={label} aria-label={label} onClick={onClick}>
      <Icon name={icon} />
      <span className="label">{label}</span>
      {count ? <span className="count" aria-label={`${count} pending`}>{count}</span> : null}
    </NavLink>
  );
}

/** Sidebar open/closed, remembered per browser. Starts open on screens wide enough for it. */
function useSidebar(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { const v = localStorage.getItem("sv.sidebar"); if (v === "collapsed") return true; if (v === "open") return false; } catch { /* ignore */ }
    return typeof window !== "undefined" && window.innerWidth < 1100;
  });
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("sv.sidebar", c ? "open" : "collapsed"); } catch { /* ignore */ } return !c; });
  return [collapsed, toggle];
}

function Shell() {
  const { user, ready, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [orgId, setOrgIdState] = useState<string | null>(() => { try { return localStorage.getItem("sv.org"); } catch { return null; } });
  const orgs = useAsync(() => (user ? get("/orgs").then((r) => r.orgs as Org[]) : Promise.resolve([] as Org[])), [user?.id]);
  const inv = useAsync(() => (user ? get("/me/invites").then((r) => r.invites.length as number) : Promise.resolve(0)), [user?.id, loc.pathname]);

  const [collapsed, toggleSidebar] = useSidebar();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [menuOpen]);

  useEffect(() => { if (ready && !user) nav("/login", { replace: true, state: { from: loc.pathname + loc.search } }); }, [ready, user]);
  if (!ready || !user) return null;

  const list = orgs.data ?? [];
  const org = list.find((o) => o.id === orgId) ?? list[0] ?? null;
  const setOrgId = (id: string) => { setOrgIdState(id); try { localStorage.setItem("sv.org", id); } catch { /* ignore */ } };
  const isActive = (p: string) => loc.pathname.startsWith(p);

  return (
    <OrgCtx.Provider value={{ orgs: list, org, setOrgId, reload: orgs.reload, invites: inv.data ?? 0 }}>
      <div className="app" data-collapsed={collapsed}>
        <nav className="side" aria-label="Main">
          <NavLink to="/" className="side-brand" aria-label="SecretVariable home"><BrandMark /><span className="side-name">SecretVariable</span></NavLink>
          <div className="side-nav">
            <SideLink to="/" icon="grid" label="Projects" end />
            <SideLink to="/org" icon="users" label="Organisation" />
            <SideLink to="/invitations" icon="mail" label="Invites" count={inv.data ?? 0} />
            <SideLink to="/cli" icon="terminal" label="CLI guide" />
          </div>
          <div className="side-spacer" />
          <div className="side-nav">
            <ThemeToggle variant="side" />
            <SideLink to="/account" icon="user" label="Account" />
            <button className="side-item" data-tip="Sign out" aria-label="Sign out" onClick={() => logout().then(() => nav("/login"))}><Icon name="logout" /><span className="label">Sign out</span></button>
            <button className="side-item side-collapse" data-tip={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} onClick={toggleSidebar}><Icon name="sidebar" /><span className="label">{collapsed ? "Expand" : "Collapse"}</span></button>
          </div>
        </nav>

        <header className="mbar">
          <NavLink to="/" className="mbar-brand" aria-label="SecretVariable home"><BrandMark size={28} /><span>SecretVariable</span></NavLink>
          <button className="burger" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="mobile-menu" data-open={menuOpen} onClick={() => setMenuOpen((o) => !o)}><span /><span /><span /></button>
        </header>
        <div id="mobile-menu" className="mmenu" data-open={menuOpen} aria-hidden={!menuOpen} onClick={(e) => { if (e.target === e.currentTarget) setMenuOpen(false); }}>
          <nav className="mmenu-panel" aria-label="Main menu">
            {[
              { to: "/", icon: "grid", label: "Projects", end: true },
              { to: "/org", icon: "users", label: "Organisation" },
              { to: "/invitations", icon: "mail", label: "Invites", count: inv.data ?? 0 },
              { to: "/cli", icon: "terminal", label: "CLI guide" },
              { to: "/account", icon: "user", label: "Account" },
            ].map((l, i) => (
              <NavLink key={l.to} to={l.to} end={l.end} className="mmenu-item" style={{ "--i": i } as React.CSSProperties} tabIndex={menuOpen ? 0 : -1}>
                <Icon name={l.icon} /><span>{l.label}</span>{l.count ? <span className="count">{l.count}</span> : null}
              </NavLink>
            ))}
            <div className="mmenu-foot" style={{ "--i": 5 } as React.CSSProperties}>
              <ThemeToggle variant="side" />
              <button className="side-item" tabIndex={menuOpen ? 0 : -1} onClick={() => logout().then(() => nav("/login"))}><Icon name="logout" /><span className="label">Sign out</span></button>
            </div>
          </nav>
        </div>

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
        <Route path="cli" element={<CliGuidePage />} />
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
