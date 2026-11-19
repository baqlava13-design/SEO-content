# SEO Content Engine V3 — Railway only

This version serves the Vite React build and Express API from **one existing Railway service** and one Railway URL.

## Preserve your current settings
1. Do **not** delete your existing Railway service or its persistent volume.
2. Back up the Railway volume before changing deployment, particularly your saved projects and SQLite database.
3. In the existing Railway service, deploy this repository using its `Dockerfile` (the included `railway.json` selects Dockerfile).
4. **Keep all existing Railway environment variables and secrets unchanged**, including `OPENAI_API_KEY`, `OPENAI_MODEL`, `SERPER_API_KEY`, `DATA_DIR`, and any Google integration credentials you already configured.
5. Keep the existing volume mounted at the same path (normally `/data`). The backend changes directory into `DATA_DIR` for persistent data, while serving static files from `/app/dist`.
6. The Railway `PORT` variable is automatically respected. Do not change it unless your existing setup requires it.
7. Remove `VITE_API_URL` from Railway if set to an old Vercel or separate backend address: the frontend defaults to relative `/api` on the same Railway domain. **This is not an API key** and does not change any API credentials.
8. Deploy, open your existing Railway public URL, and check `/api/health` returns `{ "ok": true }`.
9. Confirm SERP & Brief, Topical Growth and previously saved projects work before disabling the Vercel deployment.

## Google OAuth callback
If Google OAuth is enabled, its **redirect URI** must be the callback on your Railway domain: `https://YOUR-RAILWAY-DOMAIN/api/google/callback`. Update the authorized redirect URI in Google Cloud and the Railway Google redirect environment variable as described in README. This is the one Google integration setting that may need to change when the public URL changes; OAuth client ID and secret remain unchanged.

## What this migration changes
- Docker builds React using Vite, then bundles it into the same Express server.
- The frontend uses same-origin `/api` requests, removing the need for a Vercel URL.
- API endpoints, API keys, project storage, and data volume remain the same.
- No database migration is performed.

## Operational notes
The existing API routes are not protected by user authentication (except Google endpoints guarded by an admin key). Do not publicly expose confidential project information without adding access control. Railway usage-based compute/network costs still apply.
