# Security Operations

This project has repo-level checks and hosted Supabase controls. Keep both in sync before promoting a release.

## Automated Checks

GitHub Actions runs the core verification path on every push and pull request to `main`:

- `npm run stylecheck`
- `npm run typecheck`
- `npm run build`
- `npm run security:pentest`

The pentest command starts from the configured target and checks response security headers, login form autocomplete, service worker scope, native shell hardening, and the committed Supabase security migrations.

Run the same check locally against a local production server:

```bash
npm run build
npm run start
SECURITY_PENTEST_TARGET=http://localhost:3000 npm run security:pentest
```

Run it against production after Render deploys:

```bash
SECURITY_PENTEST_TARGET=https://dallmayrerp.onrender.com npm run security:pentest
```

## Supabase Auth

Enable leaked-password protection in the Supabase Dashboard for the DallmayrERP project:

1. Open `DallmayrERP` in Supabase.
2. Go to `Authentication > Providers > Email`.
3. Enable leaked-password protection.
4. Keep minimum password length at 8 or higher.
5. Prefer the strongest character requirement available for the plan.
6. Re-run Supabase Security Advisor.

Supabase documents leaked-password protection as an Auth setting that rejects passwords found in known breach lists. It is available on the Pro plan and above.

## Supabase Advisors

Security Advisor should be checked after any migration touching RLS, views, functions, storage, or Auth:

- Anonymous and public execution of `SECURITY DEFINER` functions must remain revoked.
- Views over sensitive data should use `security_invoker = true` or have direct API access revoked.
- Public schema functions should keep an explicit `search_path`.
- Any signed-in `SECURITY DEFINER` RPC that remains callable must have an internal app-role guard or row ownership check.

Performance Advisor findings can be fixed separately from security hardening. Prefer low-risk foreign-key index additions first, then consolidate duplicate permissive RLS policies table by table.
