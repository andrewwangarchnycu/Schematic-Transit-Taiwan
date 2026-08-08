# Taiwan Transit Live

Nationwide (all 22 counties/cities) public-transit stop search and live
arrival times, bilingual (zh-TW / en), responsive for mobile and desktop.

- `worker/` — Cloudflare Worker that holds the TDX credentials and proxies
  a small read-only JSON API to the frontend. Required because GitHub
  Pages is static-only and can never hold a secret safely.
- `web/` — React + Vite frontend, deployed to GitHub Pages via
  `.github/workflows/deploy-web.yml`.
- `tdx_taichung_bus_schematic.py` — separate PyQGIS script for a
  grid-simplified metro-style schematic map of Taichung buses; unrelated
  to the web app.

## 1. Register a TDX application

1. Sign up / log in at https://tdx.transportdata.tw/.
2. Member Center -> Application Management -> create a new application to
   get a **Client ID** and **Client Secret**. Free tier is enough.

## 2. Deploy the Worker (holds the secret)

```
cd worker
npm install
npx wrangler login
npx wrangler secret put TDX_CLIENT_ID
npx wrangler secret put TDX_CLIENT_SECRET
npm run deploy
```

`wrangler deploy` prints your Worker URL, e.g.
`https://tw-transit-proxy.YOUR-SUBDOMAIN.workers.dev`. Keep it.

## 3. Configure and run the frontend

```
cd web
cp .env.example .env.local
# edit .env.local -> VITE_API_BASE=<your worker URL from step 2>
npm install
npm run dev
```

## 4. Deploy the frontend to GitHub Pages

1. Push this repo to GitHub.
2. Repo Settings -> Pages -> Source: **GitHub Actions**.
3. Repo Settings -> Secrets and variables -> Actions -> **Variables** tab ->
   add `VITE_API_BASE` = your Worker URL from step 2.
4. Push to `main` (or run the "Deploy web to GitHub Pages" workflow
   manually) — `web/dist` gets built and published automatically.

## Notes

- The Worker caches the TDX OAuth token per warm isolate (tokens are
  valid ~24h), so steady traffic re-authenticates rarely.
- v1 scope is stop search + live estimated-time-of-arrival, no
  cross-operator transfer/trip planning yet.
- Never commit real TDX credentials. `worker/wrangler.toml` only holds
  non-secret config; the actual Client ID/Secret live in Cloudflare via
  `wrangler secret put` and are never written to a file in this repo.
