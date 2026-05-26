"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { AgentCard } from "@/components/AgentCard";
import { EmptyState, Tag } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { components } from "@/lib/api-types.gen";

type AgentSummary = components["schemas"]["AgentSummary"];
type Page = {
  items: AgentSummary[];
  total: number;
  limit: number;
  offset: number;
};

const PAGE_SIZE = 12;
const PHASES = ["all", "PublicLaunch", "Incubation", "WindDown", "Settled"] as const;
type PhaseKey = (typeof PHASES)[number];
const PHASE_LABELS: Record<PhaseKey, string> = {
  all: "All",
  PublicLaunch: "Public Launch",
  Incubation: "Incubation",
  WindDown: "Wind-down",
  Settled: "Settled",
};

const ASSET_CLASSES = ["crypto", "equity", "treasury", "cash", "mixed"] as const;
type AssetClassKey = (typeof ASSET_CLASSES)[number];
const ASSET_CLASS_LABELS: Record<AssetClassKey, string> = {
  crypto: "Crypto",
  equity: "Equity",
  treasury: "Treasury",
  cash: "Cash",
  mixed: "Mixed",
};

const LOCKUP_TIERS = ["instant", "30d", "60d", "90d"] as const;
type LockupKey = (typeof LOCKUP_TIERS)[number];
const LOCKUP_LABELS: Record<LockupKey, string> = {
  instant: "Instant",
  "30d": "30d",
  "60d": "60d",
  "90d": "90d",
};

const SORTS = [
  { value: "apy_30d", label: "APY 30d" },
  { value: "total_return", label: "Total return" },
  { value: "sharpe", label: "Sharpe" },
  { value: "reputation", label: "Reputation" },
  { value: "nav", label: "AUM" },
  { value: "holders", label: "Holders" },
  { value: "newest", label: "Newest" },
] as const;

/** Toggle a value in a comma-separated URLSearchParams list. */
function toggleListParam(
  current: string | null,
  value: string,
): string | null {
  const set = new Set(
    (current ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  if (set.has(value)) set.delete(value);
  else set.add(value);
  const joined = Array.from(set).join(",");
  return joined.length > 0 ? joined : null;
}

function parseListParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export default function MarketplacePage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <MarketplaceContent />
    </Suspense>
  );
}

function MarketplaceContent() {
  const router = useRouter();
  const sp = useSearchParams();

  const phase = (sp.get("phase") as PhaseKey) ?? "all";
  const sort = sp.get("sort") ?? "apy_30d";
  const offset = Number(sp.get("offset") ?? "0");
  const assetClasses = parseListParam(sp.get("assetClass")) as AssetClassKey[];
  const lockups = parseListParam(sp.get("lockup")) as LockupKey[];
  const anyFilterActive =
    phase !== "all" || assetClasses.length > 0 || lockups.length > 0;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    if (key !== "offset") next.delete("offset");
    router.push(`/?${next.toString()}`, { scroll: false });
  };

  /* List query (filtered, paginated) */
  const queryParams: Record<string, string | string[] | number | undefined> = {
    sort,
    order: "desc",
    limit: PAGE_SIZE,
    offset,
  };
  if (phase !== "all") queryParams.phase = [phase];
  if (assetClasses.length > 0) queryParams.assetClass = assetClasses;
  if (lockups.length > 0) queryParams.lockup = lockups;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["agents", phase, sort, offset, assetClasses.join(","), lockups.join(",")],
    queryFn: () =>
      api.get("/agents", {
        query: queryParams,
      } as never) as Promise<Page>,
    staleTime: 15_000,
  });

  /* Stats query (unfiltered, large limit — global aggregates) */
  const { data: statsData } = useQuery({
    queryKey: ["agents-stats"],
    queryFn: () =>
      api.get("/agents", {
        query: { sort: "newest", order: "desc", limit: 100, offset: 0 },
      } as never) as Promise<Page>,
    staleTime: 60_000,
  });

  const heroStats = useMemo(() => {
    if (!statsData) return null;
    const items = statsData.items;
    const totalNav = items.reduce(
      (s, a) => s + Number(BigInt(a.navUsdc)) / 1e6,
      0,
    );
    const totalHolders = items.reduce(
      (s, a) => s + (a.holderCount ?? 0),
      0,
    );
    const active = items.filter((a) => a.phase === "PublicLaunch").length;
    const incubating = items.filter((a) => a.phase === "Incubation").length;
    return { totalNav, totalHolders, active, incubating };
  }, [statsData]);

  return (
    <main>
      <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
        {/* Hero */}
        <section className="py-14 sm:py-20">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <Tag variant="mint">AI × RWA × Agentic Wallets</Tag>
            <span className="spec-eyebrow">Mantle Turing Test 2026</span>
          </div>

          <h1 className="font-display text-[44px] sm:text-[70px] font-light leading-none tracking-[-0.01em] text-ink max-w-[14ch]">
            Tokenized ETFs
            <br />
            run by AI managers.
          </h1>

          <p className="mt-6 max-w-[540px] text-[16.5px] leading-[1.55] text-shade-60">
            Only agents that pass a 30-day on-chain track record go public. The
            founder&apos;s own stake is automatically subordinated — external
            holders settle first when an agent winds down. Rug-pulls are
            structurally blocked.
          </p>

          {/* Hero stats */}
          <div className="mt-12 grid grid-cols-2 gap-6 border-t border-hairline-light pt-8 sm:grid-cols-4">
            <HeroStat
              label="Total NAV"
              value={heroStats ? formatHeroNav(heroStats.totalNav) : "—"}
              loading={!heroStats}
            />
            <HeroStat
              label="Active agents"
              value={heroStats ? String(heroStats.active) : "—"}
              loading={!heroStats}
            />
            <HeroStat
              label="Incubating"
              value={heroStats ? String(heroStats.incubating) : "—"}
              loading={!heroStats}
            />
            <HeroStat
              label="Total holders"
              value={heroStats ? heroStats.totalHolders.toLocaleString() : "—"}
              loading={!heroStats}
            />
          </div>
        </section>

        {/* Filter bar */}
        <div className="mb-8 border-y border-hairline-light py-4">
          {/* Row 1: phase + sort */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-1.5">
              {PHASES.map((p) => {
                const active = phase === p;
                return (
                  <button
                    key={p}
                    onClick={() => setParam("phase", p === "all" ? null : p)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5",
                      "text-[13px] font-medium transition-all duration-[120ms]",
                      active
                        ? "border-hairline-light bg-canvas-light text-ink"
                        : "border-transparent bg-transparent text-shade-60 hover:text-ink",
                    )}
                  >
                    {PHASE_LABELS[p]}
                  </button>
                );
              })}
            </div>

            <select
              value={sort}
              onChange={(e) => setParam("sort", e.target.value)}
              className="rounded-full border border-hairline-light bg-canvas-light px-3 py-1.5 text-[13px] text-ink"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  Sort · {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Row 2: asset class chips */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-shade-50 mr-1">
              Asset class
            </span>
            {ASSET_CLASSES.map((c) => {
              const active = assetClasses.includes(c);
              return (
                <button
                  key={c}
                  onClick={() =>
                    setParam(
                      "assetClass",
                      toggleListParam(sp.get("assetClass"), c),
                    )
                  }
                  className={cn(
                    "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors duration-[120ms]",
                    active
                      ? "border-ink bg-ink text-on-primary"
                      : "border-hairline-light bg-canvas-light text-shade-60 hover:border-ink hover:text-ink",
                  )}
                >
                  {ASSET_CLASS_LABELS[c]}
                </button>
              );
            })}
          </div>

          {/* Row 3: lockup chips */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-shade-50 mr-1">
              Lockup
            </span>
            {LOCKUP_TIERS.map((l) => {
              const active = lockups.includes(l);
              return (
                <button
                  key={l}
                  onClick={() =>
                    setParam("lockup", toggleListParam(sp.get("lockup"), l))
                  }
                  className={cn(
                    "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors duration-[120ms]",
                    active
                      ? "border-ink bg-ink text-on-primary"
                      : "border-hairline-light bg-canvas-light text-shade-60 hover:border-ink hover:text-ink",
                  )}
                >
                  {LOCKUP_LABELS[l]}
                </button>
              );
            })}
            {anyFilterActive && (
              <button
                onClick={() => {
                  setParam("phase", null);
                  setParam("assetClass", null);
                  setParam("lockup", null);
                }}
                className="ml-auto rounded-full px-3 py-1 text-[12px] font-medium text-shade-60 underline underline-offset-2 hover:text-ink"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="pb-20">
          {isLoading && <MarketplaceSkeleton />}

          {isError && (
            <div className="rounded-[12px] border border-red-300 bg-red-50 p-5">
              <p className="font-medium text-red-800">
                Failed to load marketplace
              </p>
              <p className="mt-1 text-sm text-red-700">
                {error instanceof ApiError
                  ? `${error.status}: ${JSON.stringify(error.detail)}`
                  : (error as Error)?.message ?? "Unknown error"}
              </p>
              <button
                onClick={() => refetch()}
                className="mt-3 rounded-full border border-red-300 px-3.5 py-1.5 text-[12.5px] font-medium text-red-700 hover:bg-red-100"
              >
                Retry
              </button>
            </div>
          )}

          {data && data.items.length === 0 && (
            <EmptyState
              variant="dashed"
              title="No agents"
              body={
                anyFilterActive
                  ? "No agents match these filters."
                  : "No agents registered yet."
              }
              action={
                anyFilterActive ? (
                  <button
                    onClick={() => {
                      setParam("phase", null);
                      setParam("assetClass", null);
                      setParam("lockup", null);
                    }}
                    className="text-[13px] text-shade-60 underline underline-offset-2 hover:text-ink"
                  >
                    Clear filters
                  </button>
                ) : null
              }
            />
          )}

          {data && data.items.length > 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((agent, i) => (
                <AgentCard
                  key={agent.agentId}
                  agent={agent}
                  featured={
                    i === 0 && offset === 0 && phase === "all" && sort === "apy_30d"
                  }
                />
              ))}
            </div>
          )}

          {data && data.total > PAGE_SIZE && (
            <Pagination
              offset={offset}
              limit={PAGE_SIZE}
              total={data.total}
              isFetching={isFetching}
              onChange={(o) => setParam("offset", String(o))}
            />
          )}
        </div>
      </div>
    </main>
  );
}

/* ─── Sub-components ─────────────────────────── */

function HeroStat({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-shade-50">
        {label}
      </div>
      <div
        className={cn(
          "mono text-[28px] font-medium tabular-nums",
          loading ? "text-shade-30" : "text-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Pagination({
  offset,
  limit,
  total,
  isFetching,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  isFetching: boolean;
  onChange: (offset: number) => void;
}) {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <div className="mt-10 flex items-center justify-center gap-3">
      <button
        disabled={!hasPrev || isFetching}
        onClick={() => onChange(Math.max(0, offset - limit))}
        className="rounded-full border border-hairline-light px-3.5 py-1.5 text-[12.5px] text-shade-60 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        ← Prev
      </button>
      <span className="mono tabular-nums text-[12.5px] text-shade-50">
        Page {page} / {totalPages}
      </span>
      <button
        disabled={!hasNext || isFetching}
        onClick={() => onChange(offset + limit)}
        className="rounded-full border border-hairline-light px-3.5 py-1.5 text-[12.5px] text-shade-60 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );
}

function MarketplaceSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-[300px] animate-pulse rounded-[12px] border border-hairline-light bg-canvas-light"
        />
      ))}
    </div>
  );
}

function PageFallback() {
  return (
    <main>
      <div className="mx-auto max-w-[1440px] px-4 sm:px-8 py-14 sm:py-20">
        <div className="h-8 w-64 animate-pulse rounded bg-hairline-light" />
        <div className="mt-4 h-16 w-3/4 animate-pulse rounded bg-hairline-light" />
        <div className="mt-12 grid grid-cols-4 gap-6 pt-8 border-t border-hairline-light">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded bg-hairline-light"
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function formatHeroNav(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(2)}K`;
  return `$${usd.toFixed(2)}`;
}
