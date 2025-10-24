import { useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { UserInfo } from '../components/UserInfo';
import styles from './DashboardLayout.module.css';

type NavItem = {
  label: string;
  to: string;
  icon: ReactNode;
  exact?: boolean;
};

const navItems: NavItem[] = [
  { label: '总览', to: '/', icon: '📊', exact: true },
  { label: '上传作品', to: '/upload', icon: '📤' },
  { label: '项目空间', to: '/novels', icon: '📚' },
  { label: '导出中心', to: '/exports', icon: '📦' }
];

function SidebarNav({ children }: PropsWithChildren) {
  return <nav className={styles.sidebarNav}>{children}</nav>;
}

export function DashboardLayout() {
  const location = useLocation();
  const { isAuthenticated, login } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigation = useMemo(() => navItems, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const sidebarClassName = [styles.sidebar, mobileOpen ? styles.sidebarMobileOpen : ''].join(' ').trim();

  const handleNavClick = () => {
    setMobileOpen(false);
  };

  return (
    <div className={styles.appShell}>
      <aside className={sidebarClassName}>
        <button type="button" className={styles.closeSidebar} onClick={() => setMobileOpen(false)} aria-label="关闭导航">
          ×
        </button>
        <div className={styles.brand}>
          <Link to={isAuthenticated ? '/' : '/login'}>
            <span className={styles.brandEmoji}>🖌️</span>
            <div className={styles.brandText}>
              <strong>Comic Studio</strong>
              <span>全流程创作工作台</span>
            </div>
          </Link>
        </div>
        <SidebarNav>
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                [
                  styles.navItem,
                  isActive ||
                  (item.to === '/novels' && location.pathname.startsWith('/novels/'))
                    ? styles.navItemActive
                    : ''
                ].join(' ')
              }
              onClick={handleNavClick}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </SidebarNav>
        <div className={styles.sidebarFooter}>
          <p className={styles.sidebarHint}>连接故事、角色、分镜的统一控制中心</p>
          <a
            href="https://github.com/Ethanlita/qnyproj"
            target="_blank"
            rel="noreferrer"
            className={styles.sidebarLink}
          >
            代码库 ↗
          </a>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className={`${styles.mobileBackdrop} ${styles.mobileBackdropVisible}`}
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.mobileToggle}
            onClick={() => setMobileOpen(true)}
            aria-label="打开导航"
          >
            ☰
          </button>
          <div className={styles.topbarBreadcrumb}>
            {breadcrumbFromPath(location.pathname)}
          </div>
          <div className={styles.topbarActions}>
            {isAuthenticated ? (
              <UserInfo compact />
            ) : (
              <button type="button" className={styles.loginButton} onClick={() => login()}>
                登录以继续
              </button>
            )}
          </div>
        </header>

        <main className={styles.mainContent}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function breadcrumbFromPath(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return <span className={styles.breadcrumbHome}>总览</span>;
  }

  const crumbs = segments.map((segment, idx) => {
    const href = `/${segments.slice(0, idx + 1).join('/')}`;
    const label = decodeURIComponent(segment)
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (s) => s.toUpperCase());
    return (
      <span key={href} className={styles.breadcrumbSegment}>
        {idx > 0 && <span className={styles.breadcrumbDivider}>/</span>}
        <Link to={href}>{label}</Link>
      </span>
    );
  });

  return <>{crumbs}</>;
}

export default DashboardLayout;
