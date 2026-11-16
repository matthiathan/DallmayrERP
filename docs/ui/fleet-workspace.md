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
