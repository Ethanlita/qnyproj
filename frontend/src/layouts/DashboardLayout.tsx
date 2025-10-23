import { PropsWithChildren, ReactNode } from 'react';
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

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <Link to={isAuthenticated ? '/' : '/login'}>
            <span className={styles.brandEmoji}>🖌️</span>
            <div className={styles.brandText}>
              <strong>Comic Studio</strong>
              <span>M4 milestone workspace</span>
            </div>
          </Link>
        </div>
        <SidebarNav>
          {navItems.map((item) => (
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
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </SidebarNav>
        <div className={styles.sidebarFooter}>
          <p className={styles.sidebarHint}>M4 目标：修改闭环、高清批跑、导出中心</p>
          <a
            href="https://github.com/Ethanlita/qnyproj"
            target="_blank"
            rel="noreferrer"
            className={styles.sidebarLink}
          >
            项目文档 ↗
          </a>
        </div>
      </aside>

      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
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
    return <span>总览</span>;
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
