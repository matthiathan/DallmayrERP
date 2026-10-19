'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AdminActivityLog } from '@/components/features/AdminActivityLog';
import { AdminUsersWorkspace } from '@/components/features/AdminUsersWorkspace';
import { ClientAccessControl } from '@/components/features/ClientAccessControl';
import styles from './AdministrationWorkspace.module.css';

type AdminTab = 'users' | 'roles' | 'profiles' | 'provisioning' | 'firmware' | 'recommendations' | 'audit' | 'settings';

const tabs: Array<{ id: AdminTab; label: string }> = [
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles & Permissions' },
  { id: 'profiles', label: 'Machine Profiles' },
  { id: 'provisioning', label: 'Device Provisioning' },
  { id: 'firmware', label: 'Firmware' },
  { id: 'recommendations', label: 'Recommendation Rules' },
  { id: 'audit', label: 'Audit History' },
  { id: 'settings', label: 'Settings' },
];

const roleCards = [
  ['Administrator', 'Full administrative access across telemetry operations, user access and system configuration.'],
  ['Operations', 'Fleet, service, maintenance, machine and operational reporting access.'],
  ['Technician', 'Assigned technical work, machine lookup, diagnostics and field execution.'],
  ['Road Technician', 'Assigned route, field service, delivery and technical work.'],
  ['Executive', 'Read-focused oversight of fleet performance, service and reporting.'],
  ['Sales / Finance / Marketing', 'Business-area access retained from the existing account model.'],
] as const;

export function AdministrationWorkspace({ initialTab = 'users' }: { initialTab?: AdminTab }) {
  const [tab, setTab] = useState<AdminTab>(initialTab);

  const tabMeta = useMemo(() => tabs.find((item) => item.id === tab) ?? tabs[0], [tab]);

  return (
    <section className={styles.workspace} data-administration-workspace="v1">
      <header className={styles.header}>
        <div>
          <span>Administration</span>
          <h1>Administration</h1>
          <p>Manage access, machine identity, device provisioning, configuration controls and auditable system activity.</p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/telemetry/devices">Device Management</Link>
          <Link href="/telemetry/test-center">Test Center</Link>
        </div>
      </header>

      <section className={styles.metrics} aria-label="Administration summary">
        <article><span>User access</span><strong>Controlled</strong><small>Role and branch scoped</small></article>
        <article><span>Machine profiles</span><strong>Versioned</strong><small>Identity and decoder workflows</small></article>
        <article><span>Provisioning</span><strong>Operational</strong><small>Enrollment and configuration</small></article>
        <article><span>Audit</span><strong>Enabled</strong><small>Administrative activity trail</small></article>
      </section>

      <nav className={styles.tabs} aria-label="Administration sections" role="tablist">
        {tabs.map((item) => (
          <button
            aria-selected={tab === item.id}
            className={tab === item.id ? styles.activeTab : ''}
            key={item.id}
            onClick={() => setTab(item.id)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      <section className={styles.content} aria-label={tabMeta.label}>
        {tab === 'users' ? (
          <div className={styles.userStack}>
            <section className={styles.sectionIntro}>
              <div><span>Identity & access</span><h2>Users</h2><p>Create Dallmayr staff access, approve new users and manage customer-scoped client accounts.</p></div>
            </section>
            <ClientAccessControl />
            <AdminUsersWorkspace />
          </div>
        ) : null}

        {tab === 'roles' ? (
          <div className={styles.panel}>
            <header><div><span>Access model</span><h2>Roles & Permissions</h2><p>The current production model assigns role-based rights and branch scope. Changes remain enforced by the existing navigation, RPC and RLS boundaries.</p></div></header>
            <div className={styles.roleGrid}>
              {roleCards.map(([name, description]) => <article key={name}><strong>{name}</strong><p>{description}</p></article>)}
            </div>
            <div className={styles.infoBox}><strong>Current implementation</strong><p>Permissions are role-driven rather than a free-form per-user permission matrix. A granular permission editor should only be introduced together with matching database/RLS enforcement.</p></div>
          </div>
        ) : null}

        {tab === 'profiles' ? (
          <div className={styles.panel}>
            <header><div><span>Machine intelligence</span><h2>Machine Profiles</h2><p>Review machine identity evidence, decoder profile assignment and controlled profile rollout.</p></div></header>
            <div className={styles.actionGrid}>
              <Link href="/telemetry/devices/profile-identity"><strong>Profile identity evidence</strong><span>Review automatic identity evidence, confidence and profile resolution.</span></Link>
              <Link href="/telemetry/devices/profile-rollout"><strong>Profile rollout</strong><span>Review controlled profile rollout queue and deployment state.</span></Link>
              <Link href="/machines"><strong>Fleet profile status</strong><span>See configured, pending, ambiguous and unmatched machines in fleet context.</span></Link>
            </div>
          </div>
        ) : null}

        {tab === 'provisioning' ? (
          <div className={styles.panel}>
            <header><div><span>Controller lifecycle</span><h2>Device Provisioning</h2><p>Use the existing enrollment and device-management workflows for controller assignment, configuration and commissioning.</p></div></header>
            <div className={styles.actionGrid}>
              <Link href="/factory"><strong>Factory readiness</strong><span>Review controller identity, firmware, communication, network and configuration evidence.</span></Link>
              <Link href="/telemetry/devices"><strong>Telemetry devices</strong><span>Enrollment, machine assignment, connectivity, data controls and advanced configuration.</span></Link>
              <Link href="/telemetry/test-center"><strong>Test Center</strong><span>Live device diagnostics and commissioning evidence.</span></Link>
              <Link href="/machines"><strong>Commissioning readiness</strong><span>Review machines that are ready, unlinked or need profile/configuration attention.</span></Link>
            </div>
          </div>
        ) : null}

        {tab === 'firmware' ? (
          <div className={styles.panel}>
            <header><div><span>Controller software</span><h2>Firmware</h2><p>The repository already maintains telemetry firmware and CI validation, but this branch does not yet expose a production firmware-rollout database/API.</p></div></header>
            <div className={styles.infoBox}><strong>No fake rollout controls added</strong><p>A firmware administration screen needs release records, target-device population, staged waves, health gates, pause/rollback state and audit records before deployment controls are safe to expose.</p></div>
            <div className={styles.actionGrid}><Link href="/telemetry/devices"><strong>Review installed firmware</strong><span>Current firmware version is visible per telemetry device.</span></Link></div>
          </div>
        ) : null}

        {tab === 'recommendations' ? (
          <div className={styles.panel}>
            <header><div><span>Explainable automation</span><h2>Recommendation Rules</h2><p>Recommendation-rule lifecycle was approved for the platform, but there is not yet a persistent rule/version model in the production schema.</p></div></header>
            <div className={styles.infoBox}><strong>Backend prerequisite</strong><p>Before this becomes editable, the backend needs versioned Draft / Test / Approved / Production / Retired rules, evidence inputs, explanations, pilot scope, rollback and audit history.</p></div>
            <div className={styles.actionGrid}><Link href="/alerts"><strong>Review operational alerts</strong><span>Use the current alert investigation workflow while recommendation rules remain read-only/unconfigured.</span></Link></div>
          </div>
        ) : null}

        {tab === 'audit' ? (
          <div className={styles.panel}>
            <header><div><span>Evidence</span><h2>Audit History</h2><p>Latest auditable administrative and operational events from the existing audit event store.</p></div></header>
            <AdminActivityLog />
          </div>
        ) : null}

        {tab === 'settings' ? (
          <div className={styles.panel}>
            <header><div><span>Platform configuration</span><h2>Settings</h2><p>Administrative entry points for the settings that are already backed by production controls.</p></div></header>
            <div className={styles.settingsGrid}>
              <article><span>Connectivity</span><strong>Device transport & reporting</strong><p>Wi-Fi/cellular preference, enablement, reporting mode and SIM thresholds are managed per device.</p><Link href="/telemetry/devices">Open device settings</Link></article>
              <article><span>Machine identity</span><strong>Profile resolution</strong><p>Identity evidence and decoder profile rollout remain managed through the existing profile workspaces.</p><Link href="/telemetry/devices/profile-identity">Open identity settings</Link></article>
              <article><span>User access</span><strong>Roles & branch scope</strong><p>Staff access and client tenancy remain enforced through the production access-control functions.</p><button onClick={() => setTab('users')} type="button">Open users</button></article>
              <article><span>Audit</span><strong>Administrative activity</strong><p>Review recorded administrative and operational changes.</p><button onClick={() => setTab('audit')} type="button">Open audit history</button></article>
            </div>
          </div>
        ) : null}
      </section>
    </section>
  );
}
