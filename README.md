# Helm — Frontend

Next.js 16 frontend for **Helm**, an AI Agent ETF marketplace on Mantle (REIT model). Pairs with [`helmfinance/contracts`](https://github.com/helmfinance/contracts) and [`helmfinance/backend`](https://github.com/helmfinance/backend).

## Project model (recap)

- Each agent = ERC-20 share token + ERC-8004 NFT identity + ERC-4626-style vault holding USDC, mETH, USDY, and Pyth-priced synthetic equities.
- Yield → 90% holders dividend (USDC) / 10% founder carry. Capital gains stay in NAV.
- Founder shares are subordinated — external holders settle first on wind-down.
- Redemptions go through a lockup queue (instant/30d/60d/90d).

## Stack

- **Next.js 16.2** (App Router · Turbopack) · React 19.2 · TypeScript
- **wagmi v2 + viem 2.51 + RainbowKit 2.2** for wallet/chain (Mantle Sepolia, chainId 5003)
- **Tailwind v4** (`@theme inline` design tokens, `data-theme="dark"` for dark mode)
- **@tanstack/react-query** for BE data fetching
- **openapi-typescript** for auto-generated BE types

## Getting started

```bash
# 1. install deps (pnpm preferred — there's a pnpm-lock.yaml)
pnpm install

# 2. env vars
cp .env.example .env.local
# fill in HELM_BE_URL + NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

# 3. (optional) regenerate BE types from current OpenAPI
pnpm gen:api

# 4. dev
pnpm dev          # http://localhost:3000

# 5. prod build (TypeScript + Turbopack verify)
pnpm build
```

## Routes

| Path | Purpose |
|---|---|
| `/` | Marketplace · agent grid + filters (phase, asset class, lockup, sort) |
| `/agents/[id]` | Detail · KPI / narrator / mandate / positions / decisions / benchmark · MintModal + RedeemModal |
| `/agents/[id]/mint` | Redirect → `/agents/[id]?action=mint` |
| `/agents/[id]/redeem` | Redirect → `/agents/[id]?action=redeem` |
| `/portfolio` | Redirect to `/portfolio/{connectedAddress}` (or connect prompt) |
| `/portfolio/[address]` | 4-tab portfolio · Holdings / Dividends / Redemptions / Founder |
| `/register` | 3-stage founder wizard · mandate → parsed (editable) → seed |
| `/admin` | Testnet console · time advance / mint USDC / manual triggers / qualify / slash / debug inspector |
| `/debug` | BE / chain connectivity probe |

## Architecture notes

- **CORS** — BE doesn't whitelist localhost beyond 3000/8080, so we proxy via Next.js rewrites: `/be/:path*` → `${HELM_BE_URL}/:path*`. Browser only ever sees same-origin URLs. Works in dev and on Vercel.
- **Mint flow** — 3 txs: `USDC.approve` → `PythPriceAdapter.updatePriceFeeds {value: feeMntWei}` → `AgentVault.deposit`. Pyth fee is real-MNT, paid via `msg.value`.
- **Redeem flow** — 2 txs + lockup + 1 claim: `AgentToken.approve(queue)` → `queue.requestRedeem(agentId, shares, tier)` → wait → `queue.claim(requestId)`. Cancel window closes 1 day before unlock (UI guards this).
- **Founder actions** — `FounderVault.{withdraw, depositFounderShares, claimCarry, triggerWindDown}`. The 40% withdrawal cap is enforced on-chain; UI surfaces cumulative draw vs cap.
- **Seed agents** — `agentId >= 9000` are BE-only stubs; chain calls revert. Real test agent on Mantle Sepolia: 21.
- **Phase enums** — BE returns `RegistryPhase` strings (5-valued: Incubation/PublicLaunch/WindDown/Slashed/Settled). `VaultPhase` on-chain is 4-valued (no Slashed). Don't confuse them.
- **BigInt serialization quirk** — Pydantic `to_camel` + digit-prefix fields → `apy_30d_bps` becomes `apy30DBps` (D uppercase). Same for `apy7DBps`.

## Files of interest

```
src/
├── app/
│   ├── globals.css              design tokens (CSS vars, @theme inline, keyframes)
│   ├── layout.tsx               Header + Providers + Inter/Geist Mono fonts
│   ├── providers.tsx            Theme + Wagmi + Query + RainbowKit + Toast
│   ├── page.tsx                 Marketplace
│   ├── agents/[id]/page.tsx     Agent detail
│   ├── portfolio/[address]/page.tsx   4-tab portfolio
│   ├── register/page.tsx        Founder onboarding wizard
│   └── admin/page.tsx           Testnet/judging console
├── components/
│   ├── Header.tsx               Pill nav + mobile drawer + dark toggle + wallet pill
│   ├── AgentCard.tsx            Marketplace card · real /nav-history sparkline
│   ├── agent/
│   │   ├── MintModal.tsx        3-tx modal w/ Stepper
│   │   ├── RedeemModal.tsx      Tier picker + 2-tx modal
│   │   ├── WindDownBanner.tsx
│   │   └── IncubationCard.tsx
│   └── ui/                      Button · Tag · PhaseBadge · ReputationBar · Card · Sparkline ·
│                                Modal · Stepper · EmptyState
└── lib/
    ├── theme.tsx                ThemeProvider (data-theme="light|dark")
    ├── wagmi.ts                 mantleSepolia + RainbowKit config
    ├── api.ts                   Typed fetch wrapper
    ├── api-types.gen.ts         openapi-typescript output
    ├── addresses.json           All contract addresses
    ├── contracts-constants.ts   LockupTier, VaultPhase, FEE_RATES, Pyth feeds
    ├── abis/*.json              15 contract ABIs
    ├── decodeError.ts           viem revert → friendly messages
    ├── format.ts                formatUsdc, formatBps, formatPercent, …
    └── toast.tsx                Bottom-right pill toasts (with tx hash links)
```

## Commands

```bash
pnpm dev          # dev server (Turbopack)
pnpm build        # prod build + TS check
pnpm gen:api      # regenerate src/lib/api-types.gen.ts from BE OpenAPI
pnpm lint
```

## License

ISC.
