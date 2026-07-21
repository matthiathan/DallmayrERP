'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { DensityToggle } from '@/components/ui/DensityToggle';
import { GlobalSearch } from '@/components/ui/GlobalSearch';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { canAccessPath, getDefaultPathForRole, isNavItemAllowed, navSections, roleLabels } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';
import { displayProfileName, isProfileComplete } from '@/types/dallmayrerp';

type OpenTab = {
  href: string;
  label: string;
  code: string;
};

const DESKTOP_PRIMARY_SECTION_LIMIT = 5;
const DESKTOP_OVERFLOW_THRESHOLD = 6;
const DESKTOP_OVERFLOW_KEY = '__desktop_more__';

function StatusScreen({
  title,
  message,
  action,
  loading = false,
}: {
  title: string;
  message: string;
  action?: ReactNode;
  loading?: boolean;
}) {
  return (
    <main aria-busy={loading} className="main auth-state-page" role={loading ? 'status' : 'main'}>
      <div className="neo-card auth-state-card">
        <div className="orb" />
        {loading ? <HamsterLoader label={title} /> : null}
        <h1>{title}</h1>
        <p>{message}</p>
        {action ? <div className="action-row">{action}</div> : null}
      </div>
    </main>
  );
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

function moduleCode(label: string, href: string) {
  const fromLabel = label
    .replace(/&/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 5)
    .toUpperCase();
  const fallback = href.split('/').filter(Boolean).at(-1)?.replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase();
  return fromLabel || fallback || 'HOME';
}

function safeTabList(value: string | null): OpenTab[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as OpenTab[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.href === 'string' && typeof item.label === 'string' && typeof item.code === 'string')
      .slice(-9);
  } catch {
    return [];
  }
}

function NotchRail({ side }: { side: 'left' | 'right' }) {
  return (
    <div aria-hidden="true" className={`notch-rail notch-rail-${side}`}>
      <svg className="notch-line-svg" preserveAspectRatio="none">
        <line x1="0" y1="39.5" x2="100%" y2="39.5" />
        <line x1="0" y1="36.5" x2="100%" y2="36.5" />
      </svg>
    </div>
  );
}

function NotchCorner({ side }: { side: 'left' | 'right' }) {
  const backgroundPath = side === 'left'
    ? 'M0 0 H52 V64 C26 64 26 40 0 40 Z'
    : 'M0 0 H52 V40 C26 40 26 64 0 64 Z';
  const outlineOne = side === 'left'
    ? 'M0 39.5 C26 39.5 26 63.5 52 63.5'
    : 'M0 63.5 C26 63.5 26 39.5 52 39.5';
  const outlineTwo = side === 'left'
    ? 'M0 36.5 C26 36.5 26 60.5 52 60.5'
    : 'M0 60.5 C26 60.5 26 36.5 52 36.5';

  return (
    <div aria-hidden="true" className={`notch-corner notch-corner-${side}`}>
      <svg className="notch-corner-bg" viewBox="0 0 52 64" preserveAspectRatio="none">
        <path d={backgroundPath} />
      </svg>
      <svg className="notch-corner-lines" viewBox="0 0 52 64" preserveAspectRatio="none">
        <path d={outlineOne} />
        <path d={outlineTwo} />
      </svg>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { authUser, businessProfile, businessUser, userDetails, loading, error } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openDesktopSection, setOpenDesktopSection] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const profileComplete = isProfileComplete(userDetails);
  const role = userDetails?.role;

  useEffect(() => {
    if (!loading && !authUser) {
      router.replace('/login');
    }
  }, [authUser, loading, router]);

  useEffect(() => {
    if (loading || !businessUser || !role) return;

    if (!profileComplete && pathname !== '/onboarding') {
      router.replace('/onboarding');
      return;
    }

    if (profileComplete && pathname === '/onboarding') {
      router.replace(getDefaultPathForRole(role));
      return;
    }

    if (pathname === '/' && role !== 'admin') {
      router.replace(getDefaultPathForRole(role));
    }
  }, [businessUser, loading, pathname, profileComplete, role, router]);

  useEffect(() => {
    setMenuOpen(false);
    setOpenDesktopSection(null);
  }, [pathname]);

  useEffect(() => {
    setOpenTabs(safeTabList(window.localStorage.getItem('dallmayr-open-tabs')));
  }, []);

  useEffect(() => {
    if (!userDetails?.role) return;
    const allowedSections = navSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => isNavItemAllowed(userDetails.role, item)),
      }))
      .filter((section) => section.items.length > 0);
    const activeSection = allowedSections.find((section) => section.items.some((item) => isActivePath(pathname, item.href)));
    const activeItem = activeSection?.items.find((item) => isActivePath(pathname, item.href));
    if (!activeItem) return;

    const nextTab: OpenTab = {
      href: activeItem.href,
      label: activeItem.label,
      code: activeItem.code || moduleCode(activeItem.label, activeItem.href),
    };

    setOpenTabs((current) => {
      const next = [...current.filter((item) => item.href !== nextTab.href), nextTab].slice(-9);
      window.localStorage.setItem('dallmayr-open-tabs', JSON.stringify(next));
      return next;
    });
  }, [pathname, userDetails?.role]);

  useEffect(() => {
    if (openTabs.length < 2) return;

    function handleTabKeys(event: KeyboardEvent) {
      if (!event.ctrlKey || event.key !== 'Tab') return;
      event.preventDefault();
      const currentIndex = openTabs.findIndex((tab) => isActivePath(pathname, tab.href));
      const nextIndex = event.shiftKey
        ? currentIndex <= 0 ? openTabs.length - 1 : currentIndex - 1
        : currentIndex < 0 || currentIndex === openTabs.length - 1 ? 0 : currentIndex + 1;
      router.push(openTabs[nextIndex].href);
    }

    window.addEventListener('keydown', handleTabKeys);
    return () => window.removeEventListener('keydown', handleTabKeys);
  }, [openTabs, pathname, router]);

  useEffect(() => {
    if (!menuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const signOut = async () => {
    await getSupabaseClient().auth.signOut();
    window.location.href = '/login';
  };

  if (loading) {
    return <StatusScreen title="Loading secure workspace" message="Checking your Supabase session, access invite and user details." loading />;
  }

  if (!authUser) {
    return <StatusScreen title="Redirecting to sign in" message="You need to sign in before opening DallmayrERP." />;
  }

  if (error) {
    return <StatusScreen title="Profile check failed" message={error} />;
  }

  if (!businessUser) {
    return (
      <StatusScreen
        title="Access pending"
        message="Your login exists in Supabase Auth, but no matching access invite was found in public.users. Ask an administrator to invite your email address first."
        action={<button className="button secondary" onClick={signOut} type="button">Sign out</button>}
      />
    );
  }

  if (!userDetails) {
    return (
      <StatusScreen
        title="Role assignment pending"
        message="Your email exists in public.users, but no corresponding user_details record was found. Ask an administrator to assign your role and branch."
        action={<button className="button secondary" onClick={signOut} type="button">Sign out</button>}
      />
    );
  }

  const homePath = getDefaultPathForRole(userDetails.role);
  const allowedPath = canAccessPath(userDetails.role, pathname);
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isNavItemAllowed(userDetails.role, item)),
    }))
    .filter((section) => section.items.length > 0);
  const useDesktopOverflow = visibleSections.length > DESKTOP_OVERFLOW_THRESHOLD;
  const primaryDesktopSections = useDesktopOverflow
    ? visibleSections.slice(0, DESKTOP_PRIMARY_SECTION_LIMIT)
    : visibleSections;
  const overflowDesktopSections = useDesktopOverflow
    ? visibleSections.slice(DESKTOP_PRIMARY_SECTION_LIMIT)
    : [];
  const overflowDesktopActive = overflowDesktopSections.some((section) =>
    section.items.some((item) => isActivePath(pathname, item.href)),
  );
  const activeSection = visibleSections.find((section) => section.items.some((item) => isActivePath(pathname, item.href)));
  const activeItem = activeSection?.items.find((item) => isActivePath(pathname, item.href));
  const activeTitle = activeItem?.label ?? 'Start Page';
  const activeCode = activeItem?.code ?? moduleCode(activeTitle, activeItem?.href ?? homePath);
  const activeBranch = userDetails.branch.toUpperCase();
  const activeTitleWithContext = activeItem ? `${activeTitle}-${activeBranch}` : activeTitle;
  const userName = displayProfileName(businessProfile);
  const environmentName = process.env.NEXT_PUBLIC_APP_ENVIRONMENT || 'Production';
  const tabsToRender = openTabs.length > 0 ? openTabs : [{ href: homePath, label: 'Start Page', code: 'STP01' }];

  function closeTab(tabHref: string) {
    const next = openTabs.filter((item) => item.href !== tabHref);
    setOpenTabs(next);
    window.localStorage.setItem('dallmayr-open-tabs', JSON.stringify(next));
    if (isActivePath(pathname, tabHref)) {
      router.push(next.at(-1)?.href ?? homePath);
    }
  }

  return (
    <div className={`app-shell top-shell ${menuOpen ? 'mobile-menu-open' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>

      {menuOpen ? <button aria-label="Close navigation menu" className="mobile-nav-backdrop" onClick={() => setMenuOpen(false)} type="button" /> : null}

      <header className="topbar erp-chrome notch-erp-navbar">
        <div className="notch-navbar-frame">
          <NotchRail side="left" />
          <div className="notch-navbar-shell">
            <NotchCorner side="left" />

            <div className="notch-navbar-center">
              <div className="erp-menu-row notch-menu-row">
                <Link className="erp-brand-button notch-logo-button" href={homePath} aria-label="Open Start Page">
                  <span className="notch-logo-mark">D</span>
                  <span>DallmayrERP</span>
                </Link>

                <nav aria-label="ERP menu bar" className="erp-menubar notch-menubar">
                  {primaryDesktopSections.map((section) => {
                    const sectionActive = section.items.some((item) => isActivePath(pathname, item.href));
                    const sectionOpen = openDesktopSection === section.heading;
                    return (
                      <details
                        className={`erp-menu ${sectionActive ? 'has-active' : ''}`}
                        key={section.heading}
                        onToggle={(event) => {
                          const isOpen = event.currentTarget.open;
                          setOpenDesktopSection((current) => {
                            if (isOpen) return section.heading;
                            return current === section.heading ? null : current;
                          });
                        }}
                        open={sectionOpen}
                      >
                        <summary className="erp-menu-label">{section.heading}</summary>
                        <div className="erp-menu-panel">
                          {section.items.map((item) => {
                            const active = isActivePath(pathname, item.href);
                            return (
                              <Link aria-current={active ? 'page' : undefined} className={`erp-menu-item ${active ? 'active' : ''}`} href={item.href} key={item.href}>
                                <span className="erp-menu-code">{item.code}</span>
                                <span className="erp-menu-text">
                                  <strong>{item.label}</strong>
                                  {item.description ? <small>{item.description}</small> : null}
                                </span>
                              </Link>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })}

                  {overflowDesktopSections.length > 0 ? (
                    <details
                      className={`erp-menu erp-menu-overflow ${overflowDesktopActive ? 'has-active' : ''}`}
                      onToggle={(event) => {
                        const isOpen = event.currentTarget.open;
                        setOpenDesktopSection((current) => {
                          if (isOpen) return DESKTOP_OVERFLOW_KEY;
                          return current === DESKTOP_OVERFLOW_KEY ? null : current;
                        });
                      }}
                      open={openDesktopSection === DESKTOP_OVERFLOW_KEY}
                    >
                      <summary className="erp-menu-label">More</summary>
                      <div className="erp-menu-panel erp-overflow-menu-panel">
                        {overflowDesktopSections.map((section) => (
                          <section className="erp-overflow-section" key={section.heading}>
                            <h3>{section.heading}</h3>
                            <div className="erp-overflow-section-links">
                              {section.items.map((item) => {
                                const active = isActivePath(pathname, item.href);
                                return (
                                  <Link aria-current={active ? 'page' : undefined} className={`erp-menu-item ${active ? 'active' : ''}`} href={item.href} key={item.href}>
                                    <span className="erp-menu-code">{item.code}</span>
                                    <span className="erp-menu-text">
                                      <strong>{item.label}</strong>
                                      {item.description ? <small>{item.description}</small> : null}
                                    </span>
                                  </Link>
                                );
                              })}
                            </div>
                          </section>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </nav>

                <div className="erp-command-area notch-command-area">
                  <GlobalSearch />
                  <DensityToggle />
                  <button className="erp-signout" onClick={signOut} type="button">Sign out</button>
                </div>

                <button
                  aria-controls="mobile-navigation"
                  aria-expanded={menuOpen}
                  aria-label={menuOpen ? 'Close quick navigation menu' : 'Open quick navigation menu'}
                  className="hamburger-button notch-mobile-button"
                  onClick={() => setMenuOpen((current) => !current)}
                  type="button"
                >
                  <span />
                  <span />
                  <span />
                </button>
              </div>
            </div>

            <NotchCorner side="right" />
          </div>
          <NotchRail side="right" />
        </div>

        <div aria-label="Open screens" className="erp-tab-row notch-tab-row" role="navigation">
          <span aria-hidden="true" className="erp-window-icon">◉</span>
          {tabsToRender.map((tab) => {
            const active = isActivePath(pathname, tab.href);
            return (
              <div className={`erp-tab ${active ? 'active' : ''}`} key={tab.href}>
                <Link aria-current={active ? 'page' : undefined} className="erp-tab-link" href={tab.href}>
                  <span>{tab.label}</span>
                  <small>[{tab.code}]</small>
                </Link>
                {tabsToRender.length > 1 ? (
                  <button
                    aria-label={`Close ${tab.label} tab`}
                    className="erp-tab-close"
                    onClick={() => closeTab(tab.href)}
                    type="button"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="erp-active-titlebar notch-titlebar">
          <div>
            <span>{activeTitleWithContext}</span>
            <strong>[{activeCode}]</strong>
          </div>
          <strong className="erp-context-strip">{environmentName} | {activeBranch} | {roleLabels[userDetails.role]} | {userName}</strong>
        </div>

        <div aria-modal="true" className="mobile-nav-panel" hidden={!menuOpen} id="mobile-navigation" role="dialog">
          <div className="user-chip mobile-user-chip">
            <span>{userName}</span>
            <strong>{roleLabels[userDetails.role]}</strong>
            {!profileComplete ? <em>Profile setup required</em> : null}
          </div>
          <Link aria-current={isActivePath(pathname, homePath) ? 'page' : undefined} className="mobile-primary-link" href={homePath}>
            Start Page
          </Link>
          <nav aria-label="Mobile navigation">
            {visibleSections.map((section) => (
              <div className="nav-section" key={section.heading}>
                <div className="nav-heading">{section.heading}</div>
                {section.items.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  return (
                    <Link
                      aria-current={active ? 'page' : undefined}
                      key={item.href}
                      className={`nav-link mobile-nav-card ${active ? 'active' : ''}`}
                      href={item.href}
                    >
                      <span className="nav-card-copy">
                        <strong>{item.code} — {item.label}</strong>
                        {item.description ? <small>{item.description}</small> : null}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <button className="button secondary sign-out" onClick={signOut} type="button">
            Sign out
          </button>
        </div>
      </header>

      <main className="main top-main" id="main-content" tabIndex={-1}>
        {!allowedPath ? (
          <div className="neo-card access-denied" role="alert">
            <div className="badge danger">Access blocked</div>
            <h1>This page is not assigned to your role.</h1>
            <p>
              Your current role is <strong>{roleLabels[userDetails.role]}</strong>. Use the navigation menu to open your assigned pages.
            </p>
            <Link className="button" href={homePath}>Go to Start Page</Link>
          </div>
        ) : (
          <>
            <Breadcrumbs />
            {children}
          </>
        )}
      </main>
    </div>
  );
}
