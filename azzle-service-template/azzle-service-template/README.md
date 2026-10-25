# AZZLE service template

A Next.js shop for **one agent service** paid through AZZLE escrow on Base. A customer fills a form, signs in
with email (Privy embedded wallet), pays in USDC, and the agent's payment sits in on-chain escrow until the
customer approves the delivery. The agent (a person or an AI agent running the worker CLI) claims the task, does
the work, uploads a preview, and the final deliverable unlocks only after approval.

Everything service-specific lives in one file: `src/config/services/<name>.mjs`. The neutral default is a
"launch copy" text service; `examples/cb20` is a real production config (a $5 launch-video shop) to copy from.

- **Generic flow:** order form → agent brief → sign in → deposit + post + publish scope → claim → fund escrow →
  deliver → approve / request changes / dispute → unlock.
- **Wallet modal:** balance pill in the header; address, USDC / ETH / AZL balances, AZZLE deposit
  (total / reserved / available) and one-click withdraw of the free part.
- **Deliverable types:** `file` (watermarked or uploaded preview), `text` (excerpt preview), `url` (optional
  screenshot preview). Finals are served only after a fresh on-chain read says `COMPLETED`.
- **Ops:** `/ops` dashboard and `/api/ops/*` behind `OPS_TOKEN`, a worker CLI (`tools/worker.mjs`), pluggable
  notifier (webhook / Resend / FormSubmit), a daily cron sync, storage drivers (local fs, Vercel Blob, S3).

See [ARCHITECTURE.md](ARCHITECTURE.md), [CUSTOMIZE.md](CUSTOMIZE.md) and [AGENT-GUIDE.md](AGENT-GUIDE.md).

## Quickstart (local)

```bash
npm install
cp .env.example .env.local        # fill NEXT_PUBLIC_PRIVY_APP_ID at least; generate OPS_TOKEN with `openssl rand -hex 32`
npm run dev                       # http://localhost:3000 — orders are stored in ./data (local driver)
```

Requirements: Node 20+, a Privy app (email login + embedded wallets, Base enabled). ffmpeg is only needed for
`file` services with watermark previews. Foundry (`anvil`, `cast`) is only needed for the fork tests.

Make it yours: copy `src/config/services/default.mjs`, edit it, point `src/config/service.mjs` at it (or run
`npm run use-example cb20` to try the example; `npm run use-example default` switches back).

## Deploy to Vercel

1. Push the folder to your own repo and import it in Vercel (framework: Next.js, no build settings needed).
2. Storage → create a **Blob** store (private) and connect it: Vercel sets `BLOB_READ_WRITE_TOKEN` and the
   template switches to the blob driver automatically. The local driver is **not persistent** on Vercel.
3. Set the env vars below (Production + Preview). `CRON_SECRET` is required in production; `vercel.json`
   already schedules `/api/cron/sync` daily at 06:00 UTC (`0 6 * * *`, Hobby allows one daily cron).
4. In Privy: add your domain to allowed origins. Optional: enable gas sponsorship for Base and set
   `NEXT_PUBLIC_PRIVY_SPONSOR=1`.
5. Deploy, open `/ops`, paste the `OPS_TOKEN`, and run the worker CLI against `SITE_URL=https://your-domain`.

## Environment

All values are empty in `.env.example`. Never commit a filled-in copy (`.env*` is git-ignored).

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | site | yes | Canonical URL; written into scopes, notifications, metadata |
| `NEXT_PUBLIC_PRIVY_APP_ID` | site | yes | Privy app id (email sign-in, embedded wallet) |
| `NEXT_PUBLIC_PRIVY_SPONSOR` | site | no | `1` if Privy gas sponsorship is enabled for Base |
| `NEXT_PUBLIC_RPC_URL` / `RPC_URL` | site | no | Base RPC for browser / server (default public `mainnet.base.org`) |
| `NEXT_PUBLIC_WORKER_ADDRESS` | site | recommended | Public address of the agent wallet (footer, ops) |
| `NEXT_PUBLIC_CONTACT_EMAIL` | site | no | Support address in the footer |
| `OPS_TOKEN` | site + worker | yes | Guards `/ops` and `/api/ops/*` |
| `CRON_SECRET` | site | prod | Bearer secret Vercel Cron sends to `/api/cron/sync` |
| `ORDER_RATE_LIMIT` | site | no | New orders per IP per hour, per instance (default 20) |
| `BRIEF_USER_AGENT`, `GITHUB_TOKEN` | site | no | Fetching the customer's link for the brief (read-only token) |
| `STORAGE_DRIVER` | site | no | `local` \| `blob` \| `s3` (default: blob if a token exists, else local) |
| `DATA_DIR` | site | no | Local driver directory (default `./data`) |
| `BLOB_READ_WRITE_TOKEN` | site | blob | Vercel Blob token (set by Vercel when you connect a store) |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | site | s3 | S3 / R2 driver (install the optional `@aws-sdk/*` deps) |
| `NOTIFY_WEBHOOK_URL`, `NOTIFY_WEBHOOK_SECRET` | site | no | JSON webhook per order event, HMAC-signed (`x-notify-signature`) |
| `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_PROVIDER`, `RESEND_API_KEY`, `NOTIFY_EMAIL_FROM`, `NOTIFY_FORMSUBMIT_ID` | site | no | Email alerts via Resend or FormSubmit |
| `WATERMARK_FONT` | worker | no | `.ttf` for ffmpeg watermarks |
| `WORKER_KEY_FILE` | worker only | key cmds | Path to the agent wallet key file. **No default. Never set on Vercel.** |
| `SITE_URL` | worker only | yes | Deployed site the CLI talks to |

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | `tsc --noEmit` / `next lint` |
| `npm run test:unit` | Cost math, order schema (public/private split), ids, scope round-trip |
| `npm run test:swap` | USDC→AZL swap encoding against the live Uniswap v4 pool (read-only quotes) |
| `npm run test:fork` | Starts an anvil fork of Base and runs the withdraw test and the full escrow e2e with random keys |
| `npm run leak-scan` | Fails on private keys, tokens, filled-in secret env lines, private paths |
| `npm run use-example <name>` | Activates `examples/<name>` (copies its config and public assets) |
| `npm run worker -- <cmd>` | Worker CLI, see AGENT-GUIDE.md |

Run `npm run leak-scan` before every commit or share.
