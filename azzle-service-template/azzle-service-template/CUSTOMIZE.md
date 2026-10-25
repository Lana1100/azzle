# Customize

One service = one config file. Start from `src/config/services/default.mjs`:

```bash
cp src/config/services/default.mjs src/config/services/myshop.mjs
# edit it, then in src/config/service.mjs:
#   import service from "./services/myshop.mjs";
```

Or try the example: `npm run use-example cb20` (copies `examples/cb20/service.mjs` and its `public/` assets;
existing files are kept unless `--force`). `npm run use-example default` switches back.

## Config reference (`src/config/service-types.d.ts`)

| Field | Meaning |
|---|---|
| `appTag` | Written into every on-chain scope; how the site, cron and CLI find *your* tasks. Short, lowercase, unique. **Never change after real orders.** |
| `legacyAppTags` | Older tags to keep listing after a rename |
| `kind` | Scope `kind`, e.g. `launch-copy`, `logo`, `audit-report` |
| `orderIdPrefix` | Order ids look like `<prefix>_x7k2…` |
| `market` | `micro` or `standard` AZZLE market (selects the pinned manifest) |
| `priceUsd` | Escrow amount in USD, paid in AZL at the live oracle quote |
| `turnaround` | `{label, deadlineDays}`: label is copy; `deadlineDays` becomes the on-chain deadline |
| `name`, `agentName`, `persona` | Shop name, agent name, tagline / voice (used in copy and the brief) |
| `deliverable` | See below |
| `orderFields` | The order form, see below |
| `brand` | `ink`, `paper`, `accent`, `accentInk`, `radius`, `logo` (`/public` path or null), `ogImage` |
| `copy` | `heroTitle`, `heroSub`, `orderTitle`, `orderSub`, `ctaOrder`, `previewNote`, `approveCta`, `finalReady`, `footer`, optional `privyHeader`, `privyMessage` |
| `faq` | Extra `{q, a}` entries appended to the built-in FAQ (deposit, escrow, disputes) |
| `steps` | Optional 5 labels for the order steps |
| `brief.extend` | Optional pure function `(brief) => extra keys`; `extraMarkdown` is appended to `brief.md` |
| `agentWallet` | Public agent address (prefer `NEXT_PUBLIC_WORKER_ADDRESS`) |

### Deliverable

| `type` | Final | `preview` options | Notes |
|---|---|---|---|
| `text` | Markdown/text, shown and downloadable after approval | `excerpt` (first `previewChars` chars, cut server-side) | `ext`, `mime` set the download |
| `file` | Any file (`mime`, `ext`), e.g. `video/mp4`, `image/png`, `application/pdf` | `watermark` (ffmpeg, video/image; `watermarkText`, `watermarkFooter`) or `upload` (agent uploads its own preview) | Big files go direct to Blob/S3 |
| `url` | A link (+ note) revealed after approval | `none` or `upload` (a screenshot) | For hosted sites, repos, dashboards |

`scopeHint` is the short `deliver` line in the on-chain scope ("mp4, 9:16, ~30 s").

### Order fields

`{ name, type, label, placeholder?, help?, required?, public?, scrape?, maxLength?, max?, default?, options? }`

- Types: `url`, `text`, `textarea`, `select` (`options`), `colors` (up to `max` hex colors), `email`.
- `public: true` → clear text in the on-chain scope **(anyone can read it)**. Keep emails, notes, anything personal
  private (the default). Private values are only hashed on-chain.
- `scrape: true` on a `url` field → the brief builder fetches it (GitHub repos via the API, other sites via HTML
  meta) to pre-fill the agent brief.

## Branding

The neutral theme in `src/app/globals.css` maps the five brand tokens to Tailwind utilities (`bg-paper`,
`text-ink`, `bg-brand`, `text-brand-ink`, `text-ink-64`, `border-rule`). Put your logo and OG image in `public/`
and reference them as `/logo.png`. For deeper changes edit the components in `src/components` and
`src/app`; the flow logic in `order-flow.tsx` / `order-status.tsx` reads copy and labels from the config, so
most shops never need to touch it.

## Examples

`examples/cb20` is the config behind cb20.fun, a $5 launch-video shop: `file` deliverable (`video/mp4`,
watermark preview), a public scraped `sourceUrl`, a public `aspect` select, private `brandColors` and `notes`,
custom brand and copy, and a `brief.extend` storyboard. Its `appTag` is `cb20-example` on purpose, so a copy never
lists the live shop's tasks. Only public assets are included.

Add your own under `examples/<name>/{service.mjs, public/}`.

## Checklist before launch

- Unique `appTag`, real `priceUsd`, `deadlineDays` you can meet.
- Review which fields are `public`.
- `npm run typecheck && npm run build && npm run test:unit && npm run leak-scan`.
- `npm run test:fork` (needs Foundry) to rehearse the escrow lifecycle with random keys.
- Set production env vars (README), connect Blob, set `CRON_SECRET`.
