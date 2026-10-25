# Agent guide (running the worker)

This is for the agent, human or AI, that fulfils orders. The website never signs anything for the agent.
All agent transactions come from `tools/worker.mjs` on a machine you control.

## Safety rules (non-negotiable)

1. **Never expose the wallet key.** Keep it in a JSON file (`{"address": "0x…", "privateKey": "0x…"}`) with
   mode `600`, outside the repo, and point `WORKER_KEY_FILE` at it. Never paste it into chats, logs, issues,
   env vars on Vercel, prompts or tool output. The CLI only ever prints the derived **address**. If you are an
   AI agent, never `cat`, `echo`, `grep` or upload the key file, and never read it into your context.
2. **No default key path.** Every command that needs a key fails unless `WORKER_KEY_FILE` is set explicitly.
3. **Dry run first.** `claim` and `deliver` print a confirmation template (network, target, method, args,
   expected change, irreversible effects) and stop. `--send` broadcasts **only to a local anvil/hardhat fork**.
   Mainnet additionally needs `--i-confirm-mainnet`, which you only add after the responsible human (or your own
   written policy) approved that exact transaction.
4. **Human go-ahead is a policy you choose.** Recommended default: a human approves every mainnet send. You can
   relax it (e.g. auto-claim tasks under $X for this shop's `appTag` only). Write the policy down and keep the
   `--i-confirm-mainnet` flag as the single switch.
5. **Private customer data stays private.** `brief` writes `jobs/<order>/brief.md` (mode 600, git-ignored)
   with private fields. Don't publish it, don't put it on-chain, delete it when the job is done.
6. **Only deliver what you made for this order**, and only upload finals through the ops API. Finals stay
   locked until the customer approves on-chain.
7. Run `npm run leak-scan` before you share or commit anything.

## Setup

```bash
export SITE_URL=https://your-shop.example     # the deployed site
export OPS_TOKEN=…                            # same value as on the site (from your secret store, not typed into logs)
export WORKER_KEY_FILE=/secure/path/worker-key.json
export RPC_URL=…                              # optional Base RPC
```

## Commands

| Command | Key? | Chain write? | What |
|---|---|---|---|
| `orders [--all] [--since=ISO]` | no | no | Orders on the site (OPS_TOKEN) |
| `archive <order_id> [reason]` | no | no | Hide a test/spam order from /ops (only before it has a task) |
| `readiness` | address only | no | Worker deposit vs what a claim reserves |
| `list [--funded]` | address only | no | This shop's tasks (by `appTag`) and what the worker can do on each |
| `brief <v2:market:N>` | no | no | Save the brief incl. private fields to `jobs/<order>/brief.md` |
| `claim <v2:market:N> [--send]` | yes | **yes** | Claim a POSTED task (reserves worker deposit) |
| `deliver <ref> <input> [--preview=img] [--note=…] [--send]` | yes | **yes** (first time) | Upload preview + final, then `markDelivered` |

`<input>` depends on the deliverable type: a file path (`file`), a `.md`/`.txt` file (`text`) or an
`https://` URL (`url`). For `file` services with `preview: "watermark"` the CLI renders the watermark with
ffmpeg; big files go direct to Blob/S3 (presign + commit). After the first delivery, running `deliver`
again uploads a **revision** only (no chain call); the customer sees the newest version.

Typical loop:

```bash
npm run worker -- orders --since=2026-01-01T00:00:00Z
npm run worker -- list --funded
npm run worker -- brief v2:micro:123
# … do the work …
npm run worker -- claim v2:micro:123            # dry run, read the template
npm run worker -- claim v2:micro:123 --send --i-confirm-mainnet   # only after approval
npm run worker -- deliver v2:micro:123 ./out/final.md
npm run worker -- deliver v2:micro:123 ./out/final.md --send --i-confirm-mainnet
```

## Deposit, credits and getting paid

- Claiming reserves part of the worker's AZZLE deposit (entry floor + per-task reserve). Check with `readiness`.
  Top up via `PaymentGateway.fundWithEth` / `fundWithUsdc` (dry-run it the same way).
- **Action Credits** come from the AZZLE staking vault (`creditsOf(address)`, only while `stakingActive()`).
  A credit waives the access fee on a post. Credits do not replace the deposit. See AZZLE's own docs for how
  credits are issued; the template only reads them.
- You are paid when the customer calls `complete`. There is **no auto-release**. If the customer goes silent,
  the task can be expired after the deadline (plus 1 day after a timely delivery), which **refunds the
  customer**, so follow up before the deadline. A dispute that times out also refunds the customer.

## Ops endpoints (all need header `x-ops-token: $OPS_TOKEN`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/ops/orders` | GET | List orders (`?all=1` includes archived, `?since=ISO`) |
| `/api/ops/orders/[id]/archive` | POST | Archive (`{unarchive:true}` restores); refused once a task exists |
| `/api/ops/orders/[id]/brief` | GET / POST | Read brief (`?format=md`) / rebuild it |
| `/api/ops/orders/[id]/deliverable` | POST | Upload a version (multipart by type, or JSON presign/commit for big files) |
| `/api/ops/orders/[id]/delivered` | POST | Record the on-chain delivery tx on the order |
| `/api/cron/sync` | GET | Refresh chain snapshots + send due notifications (`Bearer $CRON_SECRET` or ops token) |

## Testing without real funds

`npm run test:fork` starts an anvil fork of Base and runs everything with freshly generated random keys
(funded on the fork only): a happy path, a dispute that times out to a full refund, and a silent customer that
expires. Point the CLI at the fork with `RPC_URL=http://127.0.0.1:8545` and a throwaway key file to rehearse.
