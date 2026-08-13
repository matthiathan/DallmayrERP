# Production role UI verification

This workflow extends the existing single-account production visual verification with authenticated role-specific route coverage.

## Required secret

Create one repository secret named `PRODUCTION_ROLE_MATRIX_JSON`. Store credentials only in the secret; do not commit them to the repository.

Example shape:

```json
[
  {
    "name": "Administrator",
    "roleLabel": "Administrator",
    "email": "admin-test@example.com",
    "password": "replace-in-secret",
    "routes": ["/", "/workspace", "/admin/users", "/customers", "/warehouse/stock", "/work"]
  },
  {
    "name": "Operations",
    "roleLabel": "Operations Manager",
    "email": "operations-test@example.com",
    "password": "replace-in-secret",
    "routes": ["/workspace", "/operations/dashboard", "/operations/assets", "/operations/dispatch", "/warehouse/stock", "/work"]
  },
  {
    "name": "Warehouse",
    "roleLabel": "Warehouse Staff",
    "email": "warehouse-test@example.com",
    "password": "replace-in-secret",
    "routes": ["/workspace", "/warehouse/stock", "/warehouse/locations", "/warehouse/purchasing", "/work"]
  },
  {
    "name": "Technician",
    "roleLabel": "Technician",
    "email": "technician-test@example.com",
    "password": "replace-in-secret",
    "routes": ["/workspace", "/technician", "/operations/assets", "/work"]
  }
]
```

Use dedicated representative test accounts rather than personal employee accounts. The configured routes must be routes that the role is expected to access through the existing permission model.

## What the workflow checks

For every configured role profile it signs in once per device profile and opens each configured protected route at:

- desktop 1440 × 1000
- touch tablet 820 × 1180
- mobile 390 × 844

For every route it requires:

- the session must not return to `/login`
- exactly one `main` landmark must remain
- the application must not render the role-access-denied state
- the expected role label must be visible when `roleLabel` is supplied
- document and body widths must not overflow the viewport
- a full-page screenshot must be written to the workflow artifact

## Running it

Open **Actions → Production role UI verification → Run workflow** and confirm the Render base URL. The workflow fails immediately if `PRODUCTION_ROLE_MATRIX_JSON` is missing or malformed.

The resulting `production-role-ui-screenshots` artifact is retained for 30 days and is organized by role profile and device size.

## Recommended rollout

Start with Administrator, Operations Manager, Warehouse Staff and Technician because they exercise the broadest differences in navigation and operational layouts. Add Sales, Finance, Marketing, Executive and Road Technician profiles once representative accounts are available.
