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
NODE_VERSION=22
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

## Correct Render settings for this app

DallmayrERP is a Next.js server app, so it must be deployed as a **Web Service**, not as a Static Site.

Use these settings:

```text
Runtime: Node
Build Command: npm install && npm run build
Start Command: npm run start
Publish Directory: leave blank / not applicable
```

Do not use:

```text
Build Command: npm install; npm run dev
Publish Directory: dist
```

`next build` creates a production Next.js build in `.next`. It does not create a `dist` folder. If Render says `Publish directory dist does not exist`, the service is configured like a Static Site or has a stale Publish Directory override. Remove the publish directory or create a new Render Web Service.

## Important

Do not add a Supabase service-role key to Render for this frontend app. The frontend must only use the public anon or publishable key.
