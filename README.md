# SEO Content Engine — Web Dashboard + CLI

A private, personal-scale content research dashboard with the original CLI preserved. The React/Vite frontend runs on Vercel; the Express API runs on Railway with a persistent SQLite volume. No user accounts or telemetry are included.

## Features
- `brief "keyword"`: Serper top-10 search, Cheerio + Mozilla Readability page extraction, median word count, recurring H2/H3, 30 simple TF-IDF-style terms, OpenAI-generated Markdown brief.
- `score draft.md "keyword"`: local deterministic term and exact H2/H3 coverage scoring; no LLM call.
- Web: generate or load briefs, view/download Markdown, paste/upload Markdown drafts, see coverage percentage and missing terms/headings.
- SQLite caches SERPs and extracted pages. Repeated identical SERP requests consume zero Serper credits. **Regenerating a brief still calls the LLM**, and failed fetches are cached too.

## Deploy — Railway backend
1. Push this repository to GitHub (never commit `.env`).
2. Create a Railway service from that repository; choose **Dockerfile** builder. The included `Dockerfile` runs the Express API on `0.0.0.0:$PORT`.
3. Add a **persistent volume** mounted at `/data`. Set `DATA_DIR=/data`. Without the volume, SQLite cache and briefs disappear on redeploy.
4. Add `SERPER_API_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-4.1-mini`, `SERPER_GL=us`, `SERPER_HL=en`, and `FRONTEND_ORIGIN=https://YOUR-VERCEL-DOMAIN.vercel.app` to Railway Variables. Do not put these secrets in Vercel frontend variables.
5. Generate a public Railway domain, then visit `https://YOUR-RAILWAY-DOMAIN/api/health` (expect `{ "ok": true }`). The API is **not authenticated**; for personal use restrict access via private networking or add authentication before exposing it publicly. CORS is **not** access control.

## Deploy — Vercel frontend
1. Import the same GitHub repository in Vercel.
2. Framework: **Other**, Root Directory: repository root, Build Command: `npm run build`, Output Directory: `dist`.
3. Set `VITE_API_URL=https://YOUR-RAILWAY-DOMAIN` as an environment variable. This is a public API base URL, not a secret.
4. Redeploy after setting the variable. Update Railway `FRONTEND_ORIGIN` to the exact Vercel production URL, redeploy Railway if needed.
5. Open the Vercel site. If you see 404, check that `dist/index.html` exists in the deployment output and that the Vercel Root Directory is correct.

## Local development
Requires Node.js 22+ (Node 20+ may also work). Run `npm install`, copy `.env.example` to `.env` and set keys. For the API: `npm start`; for the frontend in another terminal: `npm run dev`. Vite proxies `/api` to `localhost:3001`. For CLI: `npm run brief -- "custom socks manufacturer"` and `npm run score -- draft.md "custom socks manufacturer"`. Tests: `npm test`.

## API endpoints
- `GET /api/health`
- `POST /api/brief` with `{ "keyword": "..." }` → `{ "id": "..." }` (async task)
- `GET /api/tasks/:id` → task status, results and Markdown when complete
- `GET /api/brief?keyword=...` → latest saved Markdown brief
- `POST /api/score` with `{ "keyword": "...", "draft": "# ..." }` → scoring report

## Costs and limitations
Get a Serper API key at https://serper.dev/ . One new keyword typically uses **one Serper search credit** for the top ten results; check Serper's current pricing/credit allocation at https://serper.dev/ for the actual cost per credit. Rough cost per brief is `(your Serper plan price / included search credits) + LLM token charges`. At an illustrative $50 / 50,000 searches, the search request is about **$0.001**; this is an example, not a current price quote. An OpenAI API key from https://platform.openai.com/ is also required; the LLM is separately billed. Some pages cannot be scraped because of bot protection, paywalls, JavaScript rendering or changing HTML. This is not a full Surfer SEO replacement: no live editor, site audits or rank tracking. Scoring measures coverage, **not ranking probability**. The original simple TF-IDF algorithm is preserved, not a semantic embedding model.

## Operational notes
- Tasks are in server memory and are lost on restart; completed briefs and SQLite cache persist on the volume.
- The API currently allows concurrent analysis requests and is not rate limited; for a public deployment add authentication, rate limits, and a job queue before sharing the URL.
- Generated Markdown can be copied into your CMS or content workflow; this dashboard does not publish directly to GitHub or your website.


## Reliability patch (2026-11-19)
- Competitor HTML is stripped of style/script and navigation elements before jsdom Readability parsing, preventing noisy third-party stylesheet parsing errors.
- Up to three competitor pages are fetched concurrently; failures are recorded per page.
- Brief generation logs each stage and failures, and the browser stops waiting after four minutes.
- The backend task is held in memory; restarting Railway loses in-flight task IDs.

## V2 topical authority workflow

Open **Topical Growth** in the sidebar. Enter a website, seed keywords, target market, and verified business facts. Generate a proposed topical map (12–20 pages), inspect its menu and cluster structure, select a page, and generate a complete Markdown draft. Export the map as JSON or drafts as Markdown. Projects persist under `$DATA_DIR/growth-projects` on the Railway volume. This is an AI-generated *proposal*, not an audited site crawl or measured search-volume analysis. Review page duplication, facts, and intent before publishing. The current MVP generates pages one at a time; it does not auto-publish or translate.

## V3: SEO + AEO + GEO research and Google integrations

This update retains V2 projects, SERP briefs, and Railway DATA_DIR persistence. In Topical Growth, select a page, click **Research competitors & AEO questions**, review the measured benchmark, and then generate its full page. Research uses the existing cached Serper results and cached page extraction; it also requests People Also Ask questions. This is a real SERP benchmark, **not** an AI-search citation-frequency measurement. Content can be edited and must have recorded human review notes before approval.

### Google integration (optional)

Set Railway environment variables:

- `PUBLIC_API_URL=https://your-backend.up.railway.app` (exact backend origin)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Google Cloud OAuth Web application)
- `ADMIN_API_KEY` (strong private secret; enter it in the Topical Growth Google integration field when using Google data)
- Optional Keyword Planner: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`; optionally `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `GOOGLE_ADS_API_VERSION` (default `v22`)

Configure the OAuth redirect URI in Google Cloud as `PUBLIC_API_URL/api/google/callback`. Enable the Search Console API and Google Ads API. Connect Google from the UI and grant access to the desired property/account. The Google Ads API requires its own access approvals; keyword estimates may be unavailable without an eligible Ads account. Search Console property must exactly match the project's URL, or use the verified `sc-domain:example.com` property if necessary. The current UI defaults to the project's website URL.

Google OAuth tokens are stored in `DATA_DIR/google-oauth-tokens.json` on the persistent Railway volume. **Use a private backend**: V2's other project endpoints are not authenticated. Google data endpoints require `ADMIN_API_KEY`, but existing project content endpoints remain unchanged. Do not share the admin key or expose the app to untrusted users. For multiuser production, implement full user authentication, token encryption at rest, and per-user permissions.

### Cost discipline

- SERP results and extracted pages reuse the existing SQLite cache.
- Benchmark only selected high-priority pages first; do not research all 20 pages automatically.
- Reuse one competitor research result across writing and draft diagnostics.
- Google Search Console is generally free within quota. Keyword Planner is optional; Google Ads eligibility applies.
- No backlink subscription or invented domain-authority scores.
- AI outputs require expert fact checking. AEO/GEO opportunities do not guarantee citations or rankings.

### Validation

`node --check src/server.js && node --check src/growth.js && node --check src/intelligence.js && npm test && npm run build`


## Railway-only deployment
See [RAILWAY_ONLY_DEPLOY.md](RAILWAY_ONLY_DEPLOY.md). The React frontend and Express API run on one Railway service; Vercel is not required.
