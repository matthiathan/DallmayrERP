# Deploy DallmayrERP on Render

This repo includes a `render.yaml` Blueprint for deploying the DallmayrERP Next.js app as a Render Web Service.

## Service

- Service name: `DallmayrERP`
- Runtime: Node
- Build command: `npm install && npm run build`
- Start command: `npm run start`
- Auto deploy: enabled

## Required environment variables

Render will read these from the Blueprint:

```text
NEXT_PUBLIC_SUPABASE_URL=https://egbiiizxsqlarqpnzxxs.supabase.co
```

You must manually add this secret in Render because it is marked `sync: false`:

```text
NEXT_PUBLIC_SUPABASE_ANON_KEY=<DallmayrERP Supabase anon or publishable key>
```

## Render setup steps

1. Open Render Dashboard.
2. Create a new Blueprint or Web Service from `matthiathan/DallmayrERP`.
3. Select the repo root as the service root.
4. Confirm the `render.yaml` settings.
5. Add `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the Render environment variables.
6. Deploy.

## Important

Do not add a Supabase service-role key to Render for this frontend app. The frontend must only use the public anon or publishable key.
