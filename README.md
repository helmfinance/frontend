# Helm — Frontend

The web app for **Helm**, an AI Agent ETF marketplace on Mantle Sepolia.
Each agent is its own ERC-4626 vault: deposit USDC, get share tokens, earn
yield as on-chain dividends. Capital gains stay in NAV. Founder stake is
subordinated, so external holders always settle first if the agent winds
down.

This repo is the UI layer. It pairs with two siblings:

- [`helmfinance/contracts`](https://github.com/helmfinance/contracts) — Solidity
- [`helmfinance/backend`](https://github.com/helmfinance/backend) — FastAPI indexer + LLM mandate parser

## Stack

- Next.js 16.2 (App Router, Turbopack) on React 19.2 + TypeScript
- wagmi v2, viem 2.51, RainbowKit 2.2 — wallet + chain (Mantle Sepolia, chainId 5003)
- Tailwind v4 with `@theme inline` design tokens, `data-theme="dark"` for dark mode
- `@tanstack/react-query` for backend fetching and cache
- `openapi-typescript` regenerates BE types straight from `/openapi.json`

## Getting started

```bash
pnpm install

cp .env.example .env.local
# Fill in HELM_BE_URL and NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.

pnpm gen:api    # optional — regenerate src/lib/api-types.gen.ts from BE OpenAPI
pnpm dev        # http://localhost:3000
pnpm build      # production build with TypeScript check
```

The four env vars:

| Name | Visibility | What it does |
|---|---|---|
| `HELM_BE_URL` | server only | Backend origin used by the Next.js rewrite proxy. Never bundled to the client. |
| `NEXT_PUBLIC_API_URL` | client + server | Base path for API calls. Set to `/be` so the browser stays same-origin. |
| `NEXT_PUBLIC_CHAIN_ID` | client + server | Must equal `5003`. The wagmi config asserts this matches `addresses.json` at startup. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | client | WalletConnect Cloud dApp ID. Needed for mobile wallets to identify Helm via QR. |

## Routes

| Path | Notes |
|---|---|
| `/` | Marketplace — agent grid with phase / asset class / lockup filters and sort |
| `/agents/[id]` | Detail page. Hosts MintModal + RedeemModal, NAV history chart, decision log, benchmark vs sSPY and 60/40, and the wind-down progress card with the permissionless `progressWindDown` / `settle` cranks |
| `/agents/[id]/mint` | Permanent redirect to `/agents/[id]?action=mint` |
| `/agents/[id]/redeem` | Permanent redirect to `/agents/[id]?action=redeem` |
| `/portfolio` | Auto-redirects to the connected wallet's portfolio. Shows a connect prompt while disconnected. |
| `/portfolio/[address]` | Four tabs: Holdings, Dividends, Redemptions, Founder. Holdings rows have View / Mint more / Redeem. |
| `/register` | Three-step founder wizard: write mandate → parse + edit → stake seed and launch |
| `/admin` | Testnet console. Time advance, MockUSDC mint, manual rebalance/harvest/distribute/NFT-metadata triggers, Phase-2 qualify, slash, and a debug inspector that pulls each `/admin/debug/*` endpoint into a collapsible JSON viewer. |
| `/debug` | Quick connectivity probe for BE + chain RPC |

## How the pieces fit

### Same-origin BE proxy

The backend's CORS only whitelists `:3000` and `:8080`. Instead of touching CORS,
`next.config.ts` rewrites `/be/:path*` to `${HELM_BE_URL}/:path*`. The browser
only ever sees same-origin URLs (in dev or on Vercel), and the actual backend
host never gets bundled into the client.

### Mint (three signatures)

1. `USDC.approve(vault, amount)` — skipped if allowance is already enough
2. `PythPriceAdapter.updatePriceFeeds(updateData)` with `msg.value = pythFeeMntWei` — also skipped when every Pyth-priced position is already fresh (`priceStale === false` and updated within 20s)
3. `AgentVault.deposit(amount, receiver)` — pulls USDC via `transferFrom`, mints AGT to the receiver

Each step is idempotent. If the third tx fails, the retry button only re-runs
the third one — approve and Pyth aren't redone, so you don't pay the Pyth fee
twice.

### Redeem (two signatures + lockup + one claim)

1. `AgentToken.approve(redemptionQueue, shares)`
2. `RedemptionQueue.requestRedeem(agentId, shares, tier)` — tier is `instant`, `30d`, `60d`, or `90d`
3. After the lockup elapses, `RedemptionQueue.claim(requestId)`

The cancel button stays disabled inside the last 24 hours before unlock, matching
the on-chain `CancelWindowClosed` guard. No "submit and fail" round-trip.

### Founder actions

`FounderVault` exposes `withdraw`, `depositFounderShares`, `claimCarry`, and
`triggerWindDown`. The Portfolio "Founder" tab routes each through a modal:
withdraw and deposit share an amount-input modal that reads the AGT address from
the FounderVault and handles the AGT.approve step automatically. The wind-down
button requires typing `wind down` to confirm.

### Phase enums

The protocol has two of them:

- **`VaultPhase`** (4 values: Incubation, PublicLaunch, WindDown, Settled) — what the AgentVault tracks for its own modifiers
- **`RegistryPhase`** (5 values: same four plus Slashed) — what HelmRegistry reports, and what the BE serializes into `AgentSummary.phase`

These can disagree on-chain. If a vault auto-advances to PublicLaunch but the
registry transition tx never lands, the registry still reads Incubation while
the vault accepts public deposits. The FE uses what BE reports (which mirrors
the vault), so this is invisible to users — but the Detail page's mint guard
relies on the vault's modifier, not the registry, which is the authoritative
source for whether a deposit will succeed.

### Seed agents

Any agent with `agentId >= 9000` is a backend-only stub created by `seed.py`
for demo purposes. They show up in the marketplace but their on-chain vault
addresses are empty — calls revert. The FE detects this and disables Mint /
Redeem with a small "Seed agent" pill. The real test agent on Sepolia is `21`.

### BigInt serialization

BE uses Pydantic's `to_camel`. Numeric prefixes break naively: `apy_30d_bps`
becomes `apy30DBps` with a capital D. Same with `apy7DBps`. Stick to the
generated types and the linter will catch typos.

## File layout

```
src/
├── app/
│   ├── globals.css                Design tokens, @theme inline, animations
│   ├── layout.tsx                 Header + Providers + Inter / Geist Mono
│   ├── providers.tsx              ThemeProvider → WagmiProvider → QueryClient → RainbowKit → Toast
│   ├── page.tsx                   Marketplace
│   ├── agents/[id]/page.tsx       Agent detail (KPIs, NAV chart, narrator, mandate, positions, decisions, benchmark, wind-down, conditions)
│   ├── portfolio/[address]/page.tsx   Four-tab portfolio with founder actions
│   ├── register/page.tsx          Founder onboarding wizard
│   └── admin/page.tsx             Testnet console
├── components/
│   ├── Header.tsx                 Pill nav + mobile drawer + theme toggle + wallet pill
│   ├── AgentCard.tsx              Marketplace card with real /nav-history sparkline
│   ├── agent/
│   │   ├── MintModal.tsx          Three-step idempotent mint flow
│   │   ├── RedeemModal.tsx        Tier picker + queue.requestRedeem
│   │   ├── NavChart.tsx           Inline SVG NAV/share line chart, 24h/7d/30d/All toggle
│   │   ├── WindDownBanner.tsx
│   │   └── IncubationCard.tsx
│   └── ui/                        Button, Tag, PhaseBadge, ReputationBar, Card, Sparkline,
│                                  Modal, Stepper, EmptyState
└── lib/
    ├── theme.tsx                  ThemeProvider — persists data-theme="light|dark"
    ├── wagmi.ts                   mantleSepolia chain + RainbowKit config
    ├── api.ts                     Typed fetch wrapper that substitutes path params
    ├── api-types.gen.ts           openapi-typescript output (regenerate via pnpm gen:api)
    ├── addresses.json             All Mantle Sepolia contract addresses
    ├── contracts-constants.ts     LockupTier, VaultPhase, FEE_RATES, Pyth feed IDs
    ├── abis/*.json                15 contract ABIs
    ├── decodeError.ts             Maps viem revert data to friendly strings
    ├── format.ts                  formatUsdc, formatBps, formatPercent, …
    └── toast.tsx                  Bottom-right pill toasts with Mantlescan tx links
```

## Commands

```bash
pnpm dev          # Dev server (Turbopack)
pnpm build        # Production build + TypeScript check
pnpm gen:api      # Regenerate src/lib/api-types.gen.ts from BE OpenAPI
pnpm lint
```

## License

ISC.
