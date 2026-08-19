# User-first interface standards

These standards apply to every DallmayrERP interface change. They combine the existing ERP interaction contract with the supplied web best-practice requirements for responsive design, accessibility, browser compatibility, performance, security, clear navigation and visual hierarchy.

## Start with the user’s job

Each page must answer, in this order:

1. Where am I?
2. What needs my attention?
3. What can I do next?
4. What happened after I acted?

Page titles, descriptions, filters and actions must use operational language rather than database names, internal codes or implementation terminology.

## Required page priority order

Pages should follow this vertical hierarchy unless the workflow has a documented reason not to:

1. **Identity and purpose** — breadcrumb/context, one page title and a short purpose statement.
2. **Urgent attention** — errors, warnings, active faults, overdue work and blocking states.
3. **Operational summary** — the few KPIs or statuses required to understand the page immediately.
4. **Primary action or primary workspace** — the task the role is most likely to perform next.
5. **Main records and live operational data** — searchable/sortable tables, maps, queues and worklists.
6. **Analysis and history** — trends, charts, historical reporting and secondary comparisons.
7. **Configuration, technical detail and test tools** — advanced filters, device configuration, identifiers, diagnostics and proof-of-concept controls.

Do not put a large settings panel, technical identifiers or test utilities above active faults, live operational state, primary actions or the main work queue.

## Information hierarchy

- Show the primary task and urgent exceptions before secondary detail.
- Keep one visible page title. Use breadcrumbs for location and the page header for purpose.
- Put the most likely primary action first and make destructive actions visually distinct.
- Keep high-value summaries near the top and detailed tables immediately after the summary they explain.
- Hide technical identifiers until they help identify or verify a record.
- Prefer progressive disclosure for advanced filters, configuration and diagnostic controls.
- Avoid duplicate tables that repeat information already available in a more complete activity or record view.
- Keep supporting context visually flatter and quieter than the page's operational content.

## Navigation

- Navigation is role-aware and task-oriented.
- Use plain-language labels and one-sentence descriptions.
- Search must remain available from every authenticated page.
- Do not expose module codes, environment strings or implementation details as primary navigation.
- Mobile navigation must use the same labels and ordering as desktop navigation.
- Long operational dashboards should provide in-page navigation when major sections cannot fit comfortably above the fold.

## Responsive web design

- Design for the smallest supported screen first and enhance progressively for larger screens.
- Use flexible grids and wrapping layouts; do not rely on a fixed desktop width.
- Keep primary actions reachable without horizontal scrolling.
- Forms must collapse to one column before labels or controls become cramped.
- Tables may scroll horizontally, but critical identity, status and action information must remain understandable without hunting across the row.
- KPI grids should reduce columns before cards become too narrow.
- Maps and charts should use viewport-aware dimensions rather than fixed desktop heights.
- Touch targets should be at least 44 by 44 CSS pixels where practical.
- Test portrait and landscape behaviour at phone, tablet, compact desktop and wide desktop widths.

## Cross-browser compatibility

- Prefer standards-based HTML, CSS and browser APIs supported by the project's defined browser matrix.
- Use progressive enhancement: core navigation, reading and data workflows must not depend on decorative effects.
- Avoid browser-specific layout assumptions when a standards-based equivalent exists.
- Real-browser CI must cover the critical authenticated workflows after production build.
- Features that are optional or unsupported must degrade without hiding the user's data or next action.

## Performance

- Do not make decorative effects responsible for page structure or interaction.
- Prefer CSS and existing shared components over additional runtime packages for visual treatment.
- Avoid unnecessary duplicate network requests and unnecessary per-render work.
- Background refreshes should be quiet and must not replace usable content with a loader.
- Mutation observers and resize observers must watch the narrowest practical DOM scope and batch expensive updates.
- Maps, tables and charts should only render the detail needed for the current view.
- Preserve browser caching and static asset reuse wherever the framework already provides it.

## Interaction, labels and feedback

- Every form control must have a clear visible label or an equivalent accessible name.
- Buttons must describe the action they perform; avoid ambiguous labels such as “Go” or “Do it”.
- Every action must provide a loading, success, validation or error state.
- Background refreshes must preserve the current screen and user-entered filters.
- Preserve user-entered data after validation or server errors.
- Confirmation is required for irreversible or high-impact actions.
- Empty states must explain why the area is empty and provide the relevant next step.
- Sorting and filtering labels must describe whether they apply to the visible page or the complete server-side result set.

## Accessibility

- Every workflow must be usable with a keyboard.
- Keyboard order must follow visual order; do not visually reorder meaningful content with CSS alone.
- Focus indicators must remain clearly visible.
- Dialogs and menus must close with Escape and return focus predictably.
- Do not rely on colour, elevation or shadow alone to communicate status.
- Images that carry information need appropriate alternative text; decorative images should be hidden from assistive technology.
- Respect reduced-motion preferences.
- Maintain readable contrast in both light and dark themes.
- Use semantic headings, landmarks, tables and status/alert roles where they improve navigation and feedback.

## Adaptive colour and contrast

- User-selected accent, theme and background colours must never be used directly as text without a contrast calculation.
- Normal text and interactive labels must maintain at least a 4.5:1 contrast ratio against their rendered surface.
- Focus indicators and essential graphical boundaries must maintain at least a 3:1 contrast ratio.
- Text placed on an accent-coloured control must automatically switch between black and white according to the stronger contrast ratio.
- Accent-coloured links must be adjusted toward black or white until they remain readable on the active light or dark surface.
- Form controls and data tables use neutral tone-matched surfaces so arbitrary palette choices cannot reduce legibility.
- Semantic danger, warning, success and information states use fixed accessible colour pairs and must not inherit the decorative accent.
- Colour changes must apply before hydration to avoid a flash of unreadable text.

## Professional visual design

- Use neomorphism as a restrained depth system, not as decoration on every element.
- Keep the canvas and dense data rows comparatively flat.
- Use raised surfaces for important cards/panels and recessed surfaces for inputs or selected/pressed controls.
- Preserve borders so components remain understandable when shadows are weak, unavailable or difficult to perceive.
- Limit each page to a small number of visual emphasis levels.
- Use whitespace and alignment before adding borders, shadows or colour.
- Keep status colours semantic and consistent across all modules.

## Internationalization and language

- Keep user-facing text in plain operational language and avoid culturally specific shorthand when a clearer term exists.
- Dates, times, numbers and money must use locale-aware formatters rather than hand-built strings where practical.
- Layouts must tolerate longer translated labels without clipping primary actions or hiding data.
- Do not bake left/right directional meaning into a workflow when a neutral start/end or logical layout is possible.

## Privacy and security

- HTTPS, authentication, authorization and row-level/data access controls remain functional requirements, not visual concerns.
- Never expose service credentials, device secrets, tokens or internal security material in the interface.
- Role-restricted actions must remain protected by backend authorization even when the UI hides or disables them.
- Do not display more personal or technical data than the user's task requires.
- Error feedback should be useful without leaking sensitive implementation detail.

## Telemetry page reference hierarchy

Machine Telemetry is the reference implementation for long operational dashboards:

1. Page purpose and quick section navigation.
2. Live device health and active faults.
3. Current machine location map.
4. Sales and error activity with the summary before filters and detail rows.
5. Historical reporting and trends.
6. Remote/advanced device configuration through progressive disclosure.
7. POC/test-only telemetry last.

This hierarchy keeps faults, connectivity, location and operational sales above configuration and test utilities.

## Review checklist

Before a pull request is approved, verify:

- A new user can identify the page purpose within five seconds.
- Urgent exceptions appear before supporting history or configuration.
- The next action is visually obvious.
- The most useful KPIs are visible before large filters or detailed tables.
- Technical codes and database language are not leading the interface.
- Advanced controls use progressive disclosure when permanent visibility would create clutter.
- Keyboard order follows the visual order.
- Loading, empty, error and success states are present.
- Background refreshes do not blank existing content.
- The workflow remains usable at phone, tablet and desktop widths and orientations.
- Critical workflows work in the defined real-browser test matrix.
- Light and dark themes both remain legible.
- Every accent preset and custom black, white and mid-tone colour keeps buttons, links, focus rings, inputs and table text readable.
- No sensitive token, credential or secret is rendered to the browser.
