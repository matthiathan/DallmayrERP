# Dallmayr fleet workspace UI

Reference: the user-approved private Sites preview at https://dallmayr-telemetry-review.matt14934.chatgpt.site.

The user requested implementation in matthiathan/DallmayrERP on 16 November 2026. The implementation branch builds on the unmerged scalability work in PR #309. Neither PR is to be merged as part of this task.

## Acceptance criteria

- Use the preview's navy sidebar, gold active marker, white surfaces, quiet headers and readable typography on the dashboard, machine directory/detail, maintenance and technician workspaces.
- Prioritise daily fleet work in navigation; group reports and specialist tools without removing existing routes or changing tenant/role access checks. Expand the current specialist group automatically; retain collapsed-rail and mobile navigation.
- Put operational attention before dashboard metrics, with direct links to maintenance, machines and reports. Preserve production queries, charts, exports, refresh/error handling and independent telemetry health semantics.
- Present device contact, machine communication and sales report freshness as three distinct machine-detail cards. Missing evidence remains Unknown.
- Bundle the same official Dallmayr logo used by the approved preview.
- Preserve production data, authentication, pagination, maintenance mutations and reports. Do not introduce fictional records or placeholders from the static preview into production.
- Run repository checks and production build; inspect representative visual surfaces and disclose any authenticated interaction checks that cannot be performed.

## Scope decisions

The static preview's report/administration placeholder screens are replaced by the existing working production tools. All existing specialist destinations remain accessible. The real maintenance and technician workflows are retained rather than replacing them with the preview's fictional records. No backend, schema, firmware or paid service changes are required.

## Confirmed telemetry redesign: stage 1

The user confirmed the full interview specification on 16 November 2026. This replaces the initial navigation proposal above. Stage 1 covers navigation and overview; machine-page redesign, sales/map refinements, device controls and technician workflow remain subsequent review stages.

- Main navigation: Fleet Overview, Machines, Sales & Reports, Map, Devices. Analytics, maintenance, alerts and other specialist destinations remain reachable under Administration; Technician remains in Field experience. Role and tenant allowlists remain unchanged.
- Attention comes first, with separately counted actionable issues and expandable evidence gaps. Unknown/never-seen connectivity and Unknown machine/report evidence are verification needs, not confirmed machine faults. Machines without active devices are included as unverified.
- Verified machine interpretations, raw codes needing verification and telemetry-platform diagnostics remain distinct; only verified interpretations count as machine faults. Actionable issues and evidence gaps have separate visible counts.
- Open fault events are loaded independently of the historical chart window, so an unresolved older fault does not disappear after 30 days.
- Customer/site, machine type and attention-category filters apply to the attention list before pagination. The selected region and filter scope remain visible. Existing charts/metrics and fleet CSV remain explicitly fleet-wide; sales-report filtering belongs to stage 3. Changing customer resets site; automatic refresh preserves selection and position, clamped if a page disappears.
- Machine/site context and open faults use deterministic, bounded range requests under existing RLS; failure rejects the refresh and preserves the last successful dated snapshot. Retired machines do not generate missing-device warnings.
- Read-only production inspection confirmed that the deployed schema does not yet have the optional machine_type column. Optional-column fallback displays Not reported without inferring classifications or hiding unrelated query failures. No live schema or data writes are needed.
- Stages remain unmerged until user approval. No additional paid services, firmware work or replacement database.

### Stage 1 verification

Repository tests and contracts cover route/access preservation and attention classification, intersection filters, missing type, unlinked machines and older open faults. A limited read-only production sample exercised the model without writing live data. A disposable synthetic snapshot harness exercised the production view's markup/state/styles in the browser: main navigation, intersecting filters, clear filters, verification disclosure and pagination. Visual inspection caught and corrected truncated evidence descriptions. The harness and its development adapter are removed from the final source. Authenticated end-to-end queries, automatic-refresh transitions and phone/touch interaction still need signed-in acceptance; fixture checks do not establish those behaviors.

## Reference layout correction

The user explicitly requested the same layout and styling as the private Sites reference after the first redesign was merged. The reference's current version is 1. This follow-up uses its 228px navy rail, centred 105×70 logo, 72px quiet header, 30/32px content inset, 15px body type, white 12px-radius cards, restrained gold selection, and four-metric dashboard composition.

The first view pairs attention with today's maintenance, followed by headline metrics and sales/quick access. Additional diagnostics and existing report controls remain reachable in a disclosure. Attention filters and independent evidence states remain functional. Production maintenance is a bounded existing-RPC read for jobs due or reported during the Johannesburg calendar day; unscheduled jobs are explicitly labelled, and the card identifies truncated previews; failures are shown as unavailable, never fictional jobs. The primary maintenance link opens the existing workflow rather than copying the reference's simulated create-job form.

Legacy ERP shell/navigation classes and automatic legacy template classes no longer style the owned telemetry shell. Functional IDs, authentication/tenant guards, the agreed navigation destinations, search, account menu, collapsed rail and mobile menu remain. The style guard's rail-width contract changes from 226px to the reference's 228px. No Sites content, live data, schema, firmware or unrelated app is changed.
