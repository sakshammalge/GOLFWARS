# Deployment

Nothing is deployed yet. This is the setup for when the owner is ready. Everything is on free tiers.

## Server: Render (free web service)

`render.yaml` at the repo root is a Render Blueprint.

1. Create a free account at https://render.com and connect your GitHub account.
2. New > Blueprint, pick `sakshammalge/golfwars`. Render reads `render.yaml` and creates `golfwars-server`.
3. After the first deploy, check `https://<service>.onrender.com/health`. It should return `{"ok":true,"protocol":1}`.

The server is one Node process (Colyseus `golf` rooms, room codes are unique per process): keep it at a single instance. It listens on `PORT` and `/health` is unchanged, so `render.yaml` needs no changes for M3. Never set `GOLFWARS_CHEATS` in production (it enables a hole-out test hook used only by the local e2e).

The free plan spins down after inactivity; the first connection after a pause takes about 30-60 seconds.
The WebSocket URL is `wss://<service>.onrender.com`.

## Client: Cloudflare Pages

Build settings (if you connect the repo in the Cloudflare dashboard instead of using the workflow):

- Build command: `pnpm install --frozen-lockfile && pnpm build:libs && pnpm --filter @golfwars/client build`
- Build output directory: `apps/client/dist`
- Environment variable: `VITE_SERVER_URL` = `wss://<service>.onrender.com`
- Node version: 20 (env `NODE_VERSION=20`)

### Automatic deploy via GitHub Actions

`.github/workflows/deploy-client.yml` deploys on every push to `main`, but only if both secrets exist. Without them the job succeeds and skips deploying.

1. Create a free Cloudflare account and a Pages project named `golfwars` (Workers & Pages > Create > Pages > Direct Upload). If you use another name, edit `--project-name` in the workflow.
2. Create an API token (My Profile > API Tokens) with the "Cloudflare Pages: Edit" permission, and note your Account ID.
3. In GitHub: Settings > Secrets and variables > Actions:
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variable: `VITE_SERVER_URL` set to `wss://<service>.onrender.com`

## Local development

`pnpm dev` runs the server on `:2567` and the client on `http://localhost:5173` (listening on all interfaces for LAN play). The client connects to `ws://<page host>:2567` unless `VITE_SERVER_URL` is set (see `apps/client/.env.example`). Production builds on Cloudflare Pages must set `VITE_SERVER_URL`, because the page host there is not the game server.
