'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';

const nav = [
  {
    heading: 'Operations',
    items: [
      { href: '/', label: 'Dashboard' },
      { href: '/admin/users', label: 'Users' },
      { href: '/warehouse/stock', label: 'Warehouse Stock' },
    ],
  },
  {
    heading: 'Marketing',
    items: [
      { href: '/marketing', label: 'Marketing Dashboard' },
      { href: '/marketing/segments', label: 'Segments' },
      { href: '/marketing/campaigns', label: 'Campaigns' },
      { href: '/marketing/contract-renewals', label: 'Contract Renewals' },
      { href: '/marketing/reports', label: 'Marketing Reports' },
    ],
  },
  {
    heading: 'Executive',
    items: [
      { href: '/executive', label: 'Executive Overview' },
      { href: '/executive/branches', label: 'Branch Performance' },
      { href: '/executive/contracts', label: 'Contract Risk' },
      { href: '/executive/service', label: 'Service Performance' },
      { href: '/executive/warehouse', label: 'Warehouse Risk' },
      { href: '/executive/reports', label: 'Executive Reports' },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const signOut = async () => {
    await getSupabaseClient().auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">DallmayrERP</div>
        <div className="brand-subtitle">Operations, marketing and executive control</div>
        {nav.map((section) => (
          <div className="nav-section" key={section.heading}>
            <div className="nav-heading">{section.heading}</div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                className={`nav-link ${pathname === item.href ? 'active' : ''}`}
                href={item.href}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
        <button className="button secondary" onClick={signOut} type="button">
          Sign out
        </button>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
