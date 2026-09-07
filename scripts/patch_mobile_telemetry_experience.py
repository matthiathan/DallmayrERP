from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'Missing expected source for {label}')
    return text.replace(old, new, 1)

# 1) App shell: the portal drawer owns scroll/focus locking, and mobile header
# should identify the actual page as well as its section.
path = Path('components/layout/AppShell.tsx')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    '''  useEffect(() => {\n    if (!menuOpen) return;\n    const previousOverflow = document.body.style.overflow;\n    document.body.style.overflow = 'hidden';\n\n    function handleKeyDown(event: KeyboardEvent) {\n      if (event.key === 'Escape') setMenuOpen(false);\n    }\n\n    window.addEventListener('keydown', handleKeyDown);\n    return () => {\n      document.body.style.overflow = previousOverflow;\n      window.removeEventListener('keydown', handleKeyDown);\n    };\n  }, [menuOpen]);\n\n''',
    '',
    'duplicate shell scroll lock',
)
text = replace_once(
    text,
    '''          <div aria-label={`Current area: ${activeArea}`} className="application-page-context telemetry-page-context-contract">\n            <span>{activeArea}</span>\n          </div>''',
    '''          <div aria-label={`Current page: ${activeTitle}`} className="application-page-context telemetry-page-context-contract">\n            <span>{activeArea}</span>\n            <strong>{activeTitle}</strong>\n          </div>''',
    'mobile page title',
)
path.write_text(text, encoding='utf-8')

# 2) Mobile navigation: featured links should not be repeated again inside
# grouped navigation. Also expose current-page state on the featured Alerts link.
path = Path('components/layout/MobileNavigation.tsx')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    '''function groupedSections(sections: NavSection[], homePath: string) {\n  const seen = new Set<string>();\n  return sections\n    .map((section) => ({\n      ...section,\n      items: section.items.filter((item) => {\n        if (item.href === homePath || item.href === '/work' || seen.has(item.href)) return false;\n        seen.add(item.href);\n        return true;\n      }),\n    }))\n    .filter((section) => section.items.length > 0);\n}''',
    '''function groupedSections(sections: NavSection[], homePath: string) {\n  const seen = new Set<string>();\n  const featuredPaths = new Set([homePath, '/machines', '/alerts', '/work']);\n  return sections\n    .map((section) => ({\n      ...section,\n      items: section.items.filter((item) => {\n        if (featuredPaths.has(item.href) || seen.has(item.href)) return false;\n        seen.add(item.href);\n        return true;\n      }),\n    }))\n    .filter((section) => section.items.length > 0);\n}''',
    'deduplicated mobile navigation',
)
text = replace_once(
    text,
    '''          {canSeeAlerts ? <Link className="mobile-menu-v2-link" href="/alerts" onClick={() => setOpen(false)}>''',
    '''          {canSeeAlerts ? <Link aria-current={activeHref === '/alerts' ? 'page' : undefined} className={`mobile-menu-v2-link ${activeHref === '/alerts' ? 'is-active' : ''}`} href="/alerts" onClick={() => setOpen(false)}>''',
    'featured alerts current page state',
)
path.write_text(text, encoding='utf-8')

# 3) Machines: phones get a tappable card register instead of a 1220px table.
path = Path('components/features/MachinesWorkspace.tsx')
text = path.read_text(encoding='utf-8')
marker = '''            </div>\n\n            {filteredRows.length === 0 ? <div className="fleet-empty-state"><strong>No machines match these filters</strong><p>Clear a filter or search for another machine, serial number, QR number or telemetry device.</p></div> : <div className="fleet-table-scroll"><table className="fleet-machine-table">'''
mobile_cards = '''            </div>\n\n            {filteredRows.length > 0 ? (\n              <div aria-label="Machine register" className="fleet-mobile-machine-list">\n                {visibleRows.map((machine) => (\n                  <Link aria-label={`Open ${machineTitle(machine)} dashboard`} className="fleet-mobile-machine-card" href={`/machines/${machine.id}`} key={`mobile-${machine.id}`}>\n                    <div className="fleet-mobile-machine-card-heading">\n                      <div>\n                        <span className={`fleet-status-pill is-${statusTone(machine.connectionStatus)}`}><i />{statusLabel(machine.connectionStatus)}</span>\n                        <h3>{machineTitle(machine)}</h3>\n                        <p>{machine.model ?? 'No model'} · {machine.manufacturer ?? 'No manufacturer'}</p>\n                      </div>\n                      <NavigationIcon kind="chevron-right" />\n                    </div>\n                    <dl>\n                      <div><dt>Serial / QR</dt><dd><strong>{machine.serial_number ?? 'No serial'}</strong><span>QR {machine.machine_barcode ?? machine.asset_tag ?? 'not recorded'}</span></dd></div>\n                      <div><dt>Location</dt><dd><strong>{machine.siteName}</strong><span>{machine.location}</span></dd></div>\n                      <div><dt>Telemetry</dt><dd>{machine.device ? <><strong>{machine.device.device_code}</strong><span>{machine.device.telemetry_mode} · {machine.device.machine_status}</span></> : <><strong>Not connected</strong><span>Assign a telemetry device</span></>}</dd></div>\n                      <div><dt>Connection</dt><dd><strong>{machine.device?.last_transport === 'cellular' ? 'Cellular' : machine.device?.last_transport === 'wifi' ? 'Wi-Fi' : 'Not reported'}</strong>{machine.device ? <SignalStrengthIndicator cellularCsq={machine.device.cellular_csq} compact transport={machine.device.last_transport} wifiRssi={machine.device.wifi_rssi} /> : <span>No signal data</span>}</dd></div>\n                      <div><dt>Faults</dt><dd><span className={`fleet-error-count ${machine.faultCount ? 'has-errors' : ''}`}>{machine.faultCount}</span></dd></div>\n                      <div><dt>Last contact</dt><dd><strong>{timeAgo(machine.lastContact)}</strong><span>{formatDateTime(machine.lastContact)}</span></dd></div>\n                    </dl>\n                  </Link>\n                ))}\n              </div>\n            ) : null}\n\n            {filteredRows.length === 0 ? <div className="fleet-empty-state"><strong>No machines match these filters</strong><p>Clear a filter or search for another machine, serial number, QR number or telemetry device.</p></div> : <div className="fleet-table-scroll fleet-desktop-machine-table"><table className="fleet-machine-table">'''
text = replace_once(text, marker, mobile_cards, 'mobile machine card register')
path.write_text(text, encoding='utf-8')

# 4) Canonical responsive authority. These rules intentionally live at the end
# so fleet-specific desktop declarations cannot override phone touch contracts.
path = Path('app/responsive-mobile-tablet.css')
text = path.read_text(encoding='utf-8')
css = r'''

/* Mobile telemetry usability pass: phone-first controls and machine cards. */
.fleet-mobile-machine-list { display: none; }

@media (max-width: 900px) {
  .fleet-workspace,
  .fleet-route-page {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    padding: 12px var(--responsive-edge) 20px !important;
  }

  .fleet-page-heading {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) !important;
    align-items: stretch !important;
    gap: 12px !important;
    margin-bottom: 14px !important;
  }

  .fleet-heading-actions {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    width: 100% !important;
    gap: 8px !important;
  }

  .fleet-heading-actions > *,
  .fleet-heading-actions .fleet-button {
    width: 100% !important;
    min-width: 0 !important;
  }

  .fleet-metric-grid,
  .fleet-alert-metric-grid {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 9px !important;
    overflow: visible !important;
  }

  .fleet-metric-card {
    min-width: 0 !important;
    min-height: 104px !important;
  }

  .fleet-table-heading,
  .fleet-panel > header,
  .device-fleet-usage-heading {
    align-items: flex-start !important;
    flex-direction: column !important;
  }

  .fleet-filters,
  .fleet-alert-filters,
  .device-register-filters {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 8px !important;
  }

  .fleet-filters .fleet-search,
  .fleet-alert-filters .fleet-search,
  .device-register-filters .fleet-search {
    grid-column: 1 / -1 !important;
  }

  .fleet-filters > .fleet-button,
  .fleet-alert-filters > .fleet-button,
  .device-register-filters > .fleet-button {
    grid-column: 1 / -1 !important;
  }

  /* Reassert the iOS no-focus-zoom contract after fleet-specific CSS. */
  .fleet-search,
  .fleet-button,
  .fleet-heading-actions button,
  .fleet-heading-actions a {
    min-height: 48px !important;
  }

  .fleet-search input,
  .fleet-filters input,
  .fleet-filters select,
  .fleet-machine-table input,
  .fleet-machine-table select,
  .fleet-config-panel input,
  .fleet-config-panel select,
  .device-detail-panel :is(input, select, textarea),
  .device-assignment-search input,
  .analytics-filter-bar :is(input, select) {
    min-height: 48px !important;
    font-size: 16px !important;
  }

  .fleet-button,
  .fleet-table-pagination button,
  .device-assignment-search button {
    min-height: 48px !important;
    font-size: .875rem !important;
  }

  .fleet-product-bars {
    grid-template-columns: 1fr !important;
  }

  .fleet-table-footer {
    align-items: stretch !important;
    flex-direction: column !important;
    gap: 10px !important;
  }

  .fleet-table-pagination {
    width: 100% !important;
    justify-content: space-between !important;
  }

  .fleet-mobile-machine-list {
    display: grid !important;
    gap: 10px !important;
    padding: 10px !important;
    background: #f8fafb !important;
  }

  .fleet-desktop-machine-table {
    display: none !important;
  }

  .fleet-mobile-machine-card {
    display: grid !important;
    gap: 12px !important;
    min-width: 0 !important;
    padding: 14px !important;
    color: var(--ops-ink) !important;
    background: #fff !important;
    border: 1px solid var(--ops-border) !important;
    border-radius: 10px !important;
    box-shadow: 0 1px 3px rgba(16, 24, 40, .06) !important;
    text-decoration: none !important;
    touch-action: manipulation;
  }

  .fleet-mobile-machine-card:active {
    background: #fffafa !important;
    border-color: #efb3b7 !important;
  }

  .fleet-mobile-machine-card:focus-visible {
    outline: 3px solid var(--responsive-focus) !important;
    outline-offset: 2px !important;
  }

  .fleet-mobile-machine-card-heading {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    align-items: start !important;
    gap: 10px !important;
  }

  .fleet-mobile-machine-card-heading > div {
    min-width: 0 !important;
  }

  .fleet-mobile-machine-card-heading > svg {
    width: 20px !important;
    height: 20px !important;
    margin-top: 4px !important;
    color: #667085 !important;
  }

  .fleet-mobile-machine-card h3 {
    margin: 8px 0 2px !important;
    color: #101828 !important;
    font-size: 1rem !important;
    line-height: 1.25 !important;
  }

  .fleet-mobile-machine-card p {
    margin: 0 !important;
    color: #667085 !important;
    font-size: .78rem !important;
    line-height: 1.35 !important;
  }

  .fleet-mobile-machine-card dl {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 10px 14px !important;
    margin: 0 !important;
  }

  .fleet-mobile-machine-card dl > div {
    min-width: 0 !important;
  }

  .fleet-mobile-machine-card dt {
    margin-bottom: 3px !important;
    color: #667085 !important;
    font-size: .68rem !important;
    font-weight: 700 !important;
    text-transform: uppercase !important;
  }

  .fleet-mobile-machine-card dd {
    display: grid !important;
    gap: 2px !important;
    min-width: 0 !important;
    margin: 0 !important;
    color: #101828 !important;
    font-size: .8rem !important;
    overflow-wrap: anywhere !important;
  }

  .fleet-mobile-machine-card dd strong,
  .fleet-mobile-machine-card dd span {
    min-width: 0 !important;
    overflow-wrap: anywhere !important;
  }

  .fleet-mobile-machine-card .signal-strength-indicator {
    margin-top: 3px !important;
  }
}

@media (max-width: 620px) {
  .fleet-heading-actions,
  .fleet-filters,
  .fleet-alert-filters,
  .device-register-filters {
    grid-template-columns: 1fr !important;
  }

  .fleet-filters .fleet-search,
  .fleet-alert-filters .fleet-search,
  .device-register-filters .fleet-search,
  .fleet-filters > .fleet-button,
  .fleet-alert-filters > .fleet-button,
  .device-register-filters > .fleet-button {
    grid-column: auto !important;
  }

  .fleet-mobile-machine-card dl {
    grid-template-columns: 1fr !important;
  }

  .fleet-table-pagination {
    display: grid !important;
    grid-template-columns: 1fr auto 1fr !important;
    align-items: center !important;
  }
}

@media (max-width: 360px) {
  .fleet-metric-grid,
  .fleet-alert-metric-grid {
    grid-template-columns: 1fr !important;
  }
}
'''
if '/* Mobile telemetry usability pass: phone-first controls and machine cards. */' in text:
    raise RuntimeError('Mobile telemetry usability rules already exist')
path.write_text(text.rstrip() + css + '\n', encoding='utf-8')

# 5) Strengthen static mobile interaction contract around the behaviors fixed here.
path = Path('scripts/check-mobile-interactions.mjs')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    '''const [search, mobile, responsive, application, responsiveAuthority, hygiene] = await Promise.all([\n  readFile(path.join(root, 'components', 'ui', 'GlobalSearch.tsx'), 'utf8'),\n  readFile(path.join(root, 'components', 'layout', 'MobileNavigation.tsx'), 'utf8'),\n  readFile(path.join(root, 'app', 'responsive-mobile-tablet.css'), 'utf8'),\n  readFile(path.join(root, 'app', 'styles', 'application.css'), 'utf8'),\n  readFile(path.join(root, 'app', 'styles', 'application', 'responsive.css'), 'utf8'),\n  readFile(path.join(root, 'components', 'layout', 'MobileBrowserHygiene.tsx'), 'utf8'),\n]);''',
    '''const [search, mobile, responsive, application, responsiveAuthority, hygiene, shell, machines] = await Promise.all([\n  readFile(path.join(root, 'components', 'ui', 'GlobalSearch.tsx'), 'utf8'),\n  readFile(path.join(root, 'components', 'layout', 'MobileNavigation.tsx'), 'utf8'),\n  readFile(path.join(root, 'app', 'responsive-mobile-tablet.css'), 'utf8'),\n  readFile(path.join(root, 'app', 'styles', 'application.css'), 'utf8'),\n  readFile(path.join(root, 'app', 'styles', 'application', 'responsive.css'), 'utf8'),\n  readFile(path.join(root, 'components', 'layout', 'MobileBrowserHygiene.tsx'), 'utf8'),\n  readFile(path.join(root, 'components', 'layout', 'AppShell.tsx'), 'utf8'),\n  readFile(path.join(root, 'components', 'features', 'MachinesWorkspace.tsx'), 'utf8'),\n]);''',
    'mobile interaction source list',
)
needle = '''requireSource(mobile, /window\\.dispatchEvent\\(new Event\\(OPEN_SEARCH_EVENT\\)\\)/, 'Bottom Search must open Global Search directly.');\n'''
addition = needle + '''requireSource(mobile, /featuredPaths = new Set\\(\\[homePath, '\\/machines', '\\/alerts', '\\/work'\\]\\)/, 'Featured mobile destinations must not be duplicated in grouped navigation.');\nrequireSource(shell, /<strong>\\{activeTitle\\}<\\/strong>/, 'Mobile header must expose the current page title, not only its section.');\nif (/if \\(!menuOpen\\) return;[\\s\\S]*document\\.body\\.style\\.overflow/.test(shell)) failures.push('AppShell must not compete with the portal drawer for mobile scroll locking.');\nrequireSource(machines, /fleet-mobile-machine-list/, 'Machines must expose a phone-native card register.');\nrequireSource(machines, /fleet-desktop-machine-table/, 'Desktop machine table must be independently hideable on phones.');\n'''
text = replace_once(text, needle, addition, 'mobile behavior assertions')
needle = '''requireSource(responsive, /font-size:\\s*16px\\s*!important/m, 'Form controls must prevent iOS focus zoom.');\n'''
addition = needle + '''requireSource(responsive, /\\.fleet-mobile-machine-list[\\s\\S]*display:\\s*grid\\s*!important/m, 'Phone machine register must use native cards instead of a desktop-width table.');\nrequireSource(responsive, /\\.fleet-desktop-machine-table[\\s\\S]*display:\\s*none\\s*!important/m, 'Desktop machine table must be hidden when phone cards are active.');\nrequireSource(responsive, /\\.fleet-search input,[\\s\\S]*font-size:\\s*16px\\s*!important/m, 'Fleet form controls must reassert 16px text after feature-specific styles.');\n'''
text = replace_once(text, needle, addition, 'responsive mobile assertions')
path.write_text(text, encoding='utf-8')
