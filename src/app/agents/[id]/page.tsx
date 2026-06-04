"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import { parseAbi } from "viem";
import { mantleSepolia } from "@/lib/wagmi";
import { decodeContractError } from "@/lib/decodeError";
import { waitForTx } from "@/lib/waitForTx";
import { writeWithNonce } from "@/lib/tx";
import { useToast } from "@/lib/toast";
import { api, ApiError } from "@/lib/api";
import {
  AssetTag,
  Button,
  DecisionTag,
  PhaseBadge,
  ReputationBar,
  Tag,
} from "@/components/ui";
import { WindDownBanner } from "@/components/agent/WindDownBanner";
import { IncubationCard } from "@/components/agent/IncubationCard";
import { MintModal } from "@/components/agent/MintModal";
import { RedeemModal } from "@/components/agent/RedeemModal";
import { NavChart } from "@/components/agent/NavChart";
import { cn } from "@/lib/cn";
import {
  formatAddress,
  formatBps,
  formatDate,
  formatPercent,
  formatRelative,
  formatSharpe,
  formatUsdc,
} from "@/lib/format";
import type { components } from "@/lib/api-types.gen";

type AgentDetail = components["schemas"]["AgentDetail"];
type Position = components["schemas"]["Position"];
type Decision = components["schemas"]["Decision"];
type DecisionPage = components["schemas"]["Page_Decision_"];
type MandateSchema = components["schemas"]["MandateSchema"];
type NarratorNote = components["schemas"]["NarratorNote"];
type WindDownState = components["schemas"]["WindDownState"];
type BenchmarkResponse = components["schemas"]["BenchmarkResponse"];
type NavHistoryResponse = components["schemas"]["NavHistoryResponse"];
type ConditionCheckResponse = components["schemas"]["ConditionCheckResponse"];

const EXPLORER = "https://sepolia.mantlescan.xyz";
const SENIOR_WINDOW_DAYS = 90;
const DECISIONS_PAGE_SIZE = 10;

/** Permissionless wind-down progression / settlement cranks. */
const VAULT_WINDDOWN_ABI = parseAbi([
  "function progressWindDown() returns (uint256 remainingPositions)",
  "function settle()",
]);

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const isValidId = Number.isFinite(id) && id > 0;
  const { address } = useAccount();
  const action = searchParams.get("action");
  const initialAction =
    action === "mint" || action === "redeem" ? action : null;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["agent", id],
    queryFn: () =>
      api.get("/agents/{agent_id}", {
        path: { agent_id: id },
      }) as Promise<AgentDetail>,
    enabled: isValidId,
    staleTime: 10_000,
  });

  // 24h NAV-per-share delta — fetched in parallel for the ActionCard
  // header. null when the agent has fewer than 2 data points yet.
  const { data: navHistory24h } = useQuery({
    queryKey: ["nav-history", id, "24h"],
    queryFn: () =>
      api.get("/agents/{agent_id}/nav-history", {
        path: { agent_id: id },
        query: { period: "24h" },
      }) as Promise<NavHistoryResponse>,
    enabled: isValidId,
    staleTime: 60_000,
    retry: false,
  });

  if (!isValidId) {
    return (
      <Center>
        <ErrorBox
          title="Invalid agent id"
          body={`"${params.id}" is not a valid id.`}
        />
      </Center>
    );
  }

  if (isLoading) return <DetailSkeleton />;

  if (isError) {
    const msg =
      error instanceof ApiError
        ? error.status === 404
          ? `Agent #${id} not found`
          : `${error.status}: ${JSON.stringify(error.detail)}`
        : ((error as Error)?.message ?? "Unknown error");
    return (
      <Center>
        <ErrorBox title="Failed to load agent" body={msg} />
        <Link
          href="/"
          className="mt-4 inline-block text-[13.5px] text-shade-60 underline underline-offset-2 hover:text-ink"
        >
          ← All agents
        </Link>
      </Center>
    );
  }

  if (!data) return null;

  const isFounder =
    !!address &&
    data.founderAddress?.toLowerCase() === address.toLowerCase();
  const totalReturn = data.performance?.totalReturn ?? 0;
  const isZeroReturn = totalReturn === 0;
  const positive = totalReturn >= 0;
  // Real 24h delta from /nav-history; null when we have <2 data points
  // (newly-launched agents). UI renders "—" in that case.
  const dailyDelta = compute24hDelta(navHistory24h);

  return (
    <main className="mx-auto max-w-[1440px] px-4 sm:px-8 py-8 sm:py-12">
      {/* Back nav */}
      <div className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13.5px] font-medium text-shade-60 hover:bg-canvas-soft hover:text-ink transition-colors"
        >
          ← All agents
        </Link>
      </div>

      {data.windDown && (
        <>
          <WindDownBanner state={data.windDown} />
          <WindDownProgress
            state={data.windDown}
            vaultAddress={data.vaultAddress as `0x${string}`}
            onChange={() => refetch()}
          />
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-8 items-start">
        {/* ─── LEFT COLUMN ─── */}
        <div>
          {/* Header */}
          <header className="border-b border-hairline-light pb-8 mb-8">
            <div className="flex flex-wrap items-center gap-3">
              <PhaseBadge phase={data.phase} />
              <span className="mono text-[13px] text-shade-50">
                Agent #{String(data.agentId).padStart(3, "0")}
                {data.createdAt
                  ? ` · ${ageDays(data.createdAt)}d on-chain`
                  : ""}
              </span>
              <span className="mono text-[13px] text-shade-50">
                · vault{" "}
                <a
                  href={`${EXPLORER}/address/${data.vaultAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-ink"
                >
                  {formatAddress(data.vaultAddress)}
                </a>
              </span>
              {isFounder && <Tag variant="mint">You are founder</Tag>}
            </div>

            <h1 className="font-display text-[40px] sm:text-[56px] font-light leading-[1.05] tracking-[-0.01em] text-ink mt-3">
              {data.name}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-[15px] text-ink">${data.ticker}</span>
              <span className="text-shade-50">·</span>
              <ReputationBar score={data.reputation ?? 0} />
              <span className="text-shade-50">·</span>
              <div className="flex flex-wrap gap-1">
                {(data.assetClasses ?? []).map((c) => (
                  <AssetTag key={c} kind={c} />
                ))}
              </div>
            </div>

            {/* KPI row */}
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-4">
              <Kpi
                label="NAV"
                value={formatUsdc(data.navUsdc, {
                  compact: true,
                  withSymbol: true,
                  decimals: 2,
                })}
                delta={`/ share ${formatUsdc(data.navPerShareUsdc, {
                  decimals: 4,
                  withSymbol: true,
                })}`}
              />
              <Kpi
                label="APY 30d"
                value={
                  data.apy30DBps != null
                    ? formatBps(data.apy30DBps, { decimals: 2 })
                    : "—"
                }
                delta="yield basis"
              />
              <Kpi
                label="Total return"
                value={
                  isZeroReturn
                    ? "—"
                    : formatPercent(totalReturn, { signed: true })
                }
                tone={
                  isZeroReturn ? "neutral" : positive ? "pos" : "neg"
                }
                delta="since inception"
              />
              <Kpi
                label="Sharpe"
                value={formatSharpe(data.performance?.sharpeRatio)}
                delta={`${data.holderCount ?? 0} holders`}
              />
            </div>
          </header>

          {data.phase === "Incubation" && data.incubationStart && (
            <IncubationCard incubationStart={data.incubationStart} />
          )}

          {/* NAV time series */}
          <Section title="NAV history">
            <NavChart agentId={data.agentId} />
          </Section>

          {/* Narrator */}
          {data.latestNarratorNote && (
            <Section title="Narrator note">
              <NarratorCard note={data.latestNarratorNote} />
            </Section>
          )}

          {/* Mandate */}
          {data.mandate && (
            <Section title="Mandate">
              <MandateCard
                mandate={data.mandate}
                mandateUri={data.mandateUri}
              />
            </Section>
          )}

          {/* Positions */}
          <Section title="Positions">
            <PositionsTable
              positions={data.positions ?? []}
              cashUsdc={data.cashUsdc}
              yieldPool={data.yieldPool}
              navUsdc={data.navUsdc}
            />
          </Section>

          {/* Benchmark */}
          <Section title="Benchmark">
            <BenchmarkCard agentId={data.agentId} />
          </Section>

          {/* Decisions (paginated) */}
          <Section title="Decision log">
            <PaginatedDecisionList
              agentId={data.agentId}
              fallback={data.recentDecisions ?? []}
            />
          </Section>
        </div>

        {/* ─── RIGHT COLUMN (sidebar) ─── */}
        <aside className="lg:sticky lg:top-20 flex flex-col gap-5">
          <ActionCard
            agent={data}
            dailyDelta={dailyDelta}
            initialAction={initialAction}
          />
          <StructuralDefenseCard data={data} />
          <EmergencyConditionsCard agentId={data.agentId} />
          <ManagerIdentityCard data={data} />
        </aside>
      </div>
    </main>
  );
}

/* ─────────── Layout atoms ─────────── */

function Kpi({
  label,
  value,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "neutral" | "pos" | "neg";
}) {
  const toneClass =
    tone === "pos"
      ? "text-emerald-helm"
      : tone === "neg"
        ? "text-red-helm"
        : "text-ink";
  return (
    <div className="px-5 first:pl-0 last:pr-0 last:border-r-0 sm:border-r sm:border-hairline-light py-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-shade-50 mb-2">
        {label}
      </div>
      <div
        className={cn(
          "mono text-[28px] font-medium tabular-nums leading-[1.1]",
          toneClass,
        )}
      >
        {value}
      </div>
      {delta && (
        <div className="mt-1.5 mono text-[12.5px] font-medium text-shade-50">
          {delta}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12">
      <h2 className="text-[20px] font-medium tracking-[0.015em] mb-5 text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/* ─────────── Narrator ─────────── */

function NarratorCard({ note }: { note: NarratorNote }) {
  const ret = note.performance?.returnBps ?? 0;
  const lines = note.bodyMarkdown
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const headline = lines[0] ?? "";
  const body = lines.slice(1).join("\n\n");

  return (
    <div className="rounded-[12px] border border-hairline-light bg-canvas-light px-8 py-7">
      <div className="mono text-[11.5px] tracking-[0.04em] uppercase text-shade-50 mb-3">
        {formatDate(note.weekStart)} → {formatDate(note.weekEnd)} · weekly memo
      </div>
      {headline && (
        <div className="font-display text-[26px] font-light leading-[1.15] mb-4 text-ink">
          {headline}
        </div>
      )}
      {body && (
        <div className="text-[15.5px] leading-[1.65] text-shade-60 whitespace-pre-wrap">
          {body}
        </div>
      )}
      <div className="mt-5 pt-5 border-t border-hairline-soft flex flex-wrap gap-6 mono text-[13px] text-shade-60">
        <span>
          Week return{" "}
          <strong
            className={cn(
              "font-medium",
              ret >= 0 ? "text-emerald-helm" : "text-red-helm",
            )}
          >
            {formatBps(ret, { signed: true })}
          </strong>
        </span>
        <span>
          Author{" "}
          <strong className="text-ink font-medium">narrator-llm</strong>
        </span>
      </div>
    </div>
  );
}

/* ─────────── Mandate (pistachio) ─────────── */

function MandateCard({
  mandate,
  mandateUri,
}: {
  mandate: MandateSchema;
  mandateUri: string;
}) {
  const rows: Array<[string, React.ReactNode]> = [
    [
      "Strategy",
      <span key="s" className="text-right max-w-[60%]">
        {mandate.description}
      </span>,
    ],
    [
      "Eligible assets",
      <span key="a">
        {(mandate.targetUniverse ?? []).join(", ") || "—"}
      </span>,
    ],
    ["Rebalance", mandate.rebalanceFrequency],
    ["Carry (locked)", formatBps(mandate.carryBps)],
    ["Founder lockup", `${mandate.founderLockupDays}d`],
    [
      "Subordination cap",
      formatBps(mandate.subordinationThresholdBps),
    ],
    [
      "Max single position",
      formatBps(mandate.maxSinglePositionBps),
    ],
    [
      "Allowed lockups",
      (mandate.allowedLockups ?? []).join(", ") || "—",
    ],
    [
      "Min deposit",
      formatUsdc(mandate.minimumDepositUsdc, { withSymbol: true }),
    ],
  ];

  return (
    <div className="rounded-[12px] bg-pistachio px-8 py-7">
      {rows.map(([label, val], i) => (
        <div
          key={i}
          className="flex justify-between items-baseline gap-4 py-2.5"
          style={
            i < rows.length - 1
              ? {
                  borderBottom:
                    "1px dashed var(--pistachio-divider)",
                }
              : undefined
          }
        >
          <span
            className="text-[13px]"
            style={{ color: "var(--pistachio-text-medium)" }}
          >
            {label}
          </span>
          <span className="mono text-[14px] font-medium text-ink">
            {val}
          </span>
        </div>
      ))}
      {mandateUri && (
        <div
          className="mt-4 mono text-[11px] truncate"
          style={{ color: "var(--pistachio-text-soft)" }}
        >
          URI: {mandateUri}
        </div>
      )}
    </div>
  );
}

/* ─────────── Positions table ─────────── */

function PositionsTable({
  positions,
  cashUsdc,
  yieldPool,
  navUsdc,
}: {
  positions: Position[];
  cashUsdc: string;
  yieldPool: string;
  navUsdc: string;
}) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-hairline-light bg-canvas-light">
      <table className="w-full">
        <thead>
          <tr>
            <Th>Asset</Th>
            <Th>Class</Th>
            <Th align="right">Amount</Th>
            <Th align="right">Value</Th>
            <Th align="right" width="200px">
              Weight
            </Th>
          </tr>
        </thead>
        <tbody>
          {positions.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="py-10 text-center text-shade-50 text-[13.5px]"
              >
                No active positions
              </td>
            </tr>
          )}
          {positions.map((p) => (
            <tr key={p.asset} className="border-t border-hairline-soft">
              <Td>
                <span className="mono font-medium">{p.symbol}</span>
                <PythFreshness
                  updatedAt={p.priceUpdatedAt}
                  stale={p.priceStale}
                />
              </Td>
              <Td>
                <AssetTag kind={p.assetClass} />
              </Td>
              <Td align="right" mono>
                {Number(p.amount) > 0
                  ? (Number(BigInt(p.amount)) / 1e18).toFixed(4)
                  : "—"}
              </Td>
              <Td align="right" mono>
                {formatUsdc(p.valueUsdc, { withSymbol: true })}
              </Td>
              <Td align="right" mono>
                <span className="inline-block w-[60px] h-[4px] bg-canvas-soft rounded-[2px] mr-2 align-middle overflow-hidden">
                  <span
                    className="block h-full bg-ink"
                    style={{ width: `${p.weightBps / 100}%` }}
                  />
                </span>
                {(p.weightBps / 100).toFixed(2)}%
              </Td>
            </tr>
          ))}
          <tr className="border-t border-hairline-soft">
            <Td>
              <span className="mono text-shade-50">USDC (cash)</span>
            </Td>
            <Td>
              <span className="text-shade-50 text-[12.5px]">cash</span>
            </Td>
            <Td />
            <Td align="right" mono>
              <span className="text-shade-50">
                {formatUsdc(cashUsdc, { withSymbol: true })}
              </span>
            </Td>
            <Td />
          </tr>
          <tr className="border-t border-hairline-soft">
            <Td>
              <span className="mono text-shade-50">Yield pool</span>
            </Td>
            <Td>
              <span className="text-shade-50 text-[12.5px]">
                pending
              </span>
            </Td>
            <Td />
            <Td align="right" mono>
              <span className="text-shade-50">
                {formatUsdc(yieldPool, { withSymbol: true })}
              </span>
            </Td>
            <Td />
          </tr>
          <tr className="border-t border-hairline-light bg-canvas-cream">
            <Td>
              <span className="font-medium">Total NAV</span>
            </Td>
            <Td />
            <Td />
            <Td align="right" mono>
              <span className="font-medium">
                {formatUsdc(navUsdc, { withSymbol: true })}
              </span>
            </Td>
            <Td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  align = "left",
  width,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  width?: string;
}) {
  return (
    <th
      style={width ? { width } : undefined}
      className={cn(
        "px-5 py-3.5 text-[11px] font-medium uppercase tracking-[0.08em] text-shade-50",
        "bg-canvas-cream border-b border-hairline-light",
        align === "right" ? "text-right mono" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-5 py-3.5 text-[14px]",
        align === "right" && "text-right tabular-nums",
        mono && "mono",
      )}
    >
      {children}
    </td>
  );
}

/* ─────────── Pyth freshness ─────────── */

function PythFreshness({
  updatedAt,
  stale,
}: {
  updatedAt: number | null | undefined;
  stale: boolean | null | undefined;
}) {
  if (!updatedAt) return null;
  const now = Math.floor(Date.now() / 1000);
  const ageSec = Math.max(0, now - updatedAt);
  const isStale = !!stale;
  const tone = isStale
    ? "text-amber-helm"
    : ageSec < 60
      ? "text-emerald-helm"
      : "text-shade-50";
  const label =
    ageSec < 60
      ? `${ageSec}s ago`
      : ageSec < 3600
        ? `${Math.floor(ageSec / 60)}m ago`
        : `${Math.floor(ageSec / 3600)}h ago`;
  return (
    <span
      className={cn("ml-2 mono text-[10.5px]", tone)}
      title={
        isStale
          ? "Price feed is stale — rebalance/mint may revert until updatePriceFeeds is called"
          : `Pyth price updated ${label}`
      }
    >
      · {isStale ? "stale " : ""}
      {label}
    </span>
  );
}

/* ─────────── Wind-down progress ─────────── */

function WindDownProgress({
  state,
  vaultAddress,
  onChange,
}: {
  state: WindDownState;
  vaultAddress: `0x${string}`;
  onChange: () => void;
}) {
  const now = Math.floor(Date.now() / 1000);
  const elapsedSec = Math.max(0, now - state.triggeredAt);
  const seniorWindowSec = SENIOR_WINDOW_DAYS * 86_400;
  const seniorPct = Math.min(100, (elapsedSec / seniorWindowSec) * 100);
  const remainingSec = Math.max(0, state.estimatedSettleAt - now);
  const remDays = Math.floor(remainingSec / 86_400);
  const remHours = Math.floor((remainingSec % 86_400) / 3600);

  // Crank availability:
  //   • progressWindDown: liquidates the next non-empty position. Callable
  //     anytime during wind-down while positions remain.
  //   • settle: final pro-rata distribution. Only callable when all positions
  //     are liquidated AND the senior window (90d) has elapsed.
  const canProgress = state.positionsRemaining > 0;
  const canSettle =
    state.positionsRemaining === 0 && now >= state.estimatedSettleAt;

  return (
    <div className="mb-6 rounded-[12px] border border-hairline-light bg-canvas-light p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <div className="text-[12.5px] font-medium uppercase tracking-[0.06em] text-shade-50">
          Wind-down progress
        </div>
        <div className="mono text-[12.5px] text-shade-50">
          triggered {formatRelative(state.triggeredAt)}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div>
          <div className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-shade-50 mb-1.5">
            Positions remaining
          </div>
          <div className="mono text-[22px] font-medium tabular-nums text-ink leading-none">
            {state.positionsRemaining}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-shade-50 mb-1.5">
            Est. settlement
          </div>
          <div className="mono text-[22px] font-medium tabular-nums text-ink leading-none">
            {remainingSec > 0
              ? remDays > 0
                ? `${remDays}d ${remHours}h`
                : `${remHours}h`
              : "ready"}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-shade-50 mb-1.5">
            Senior window
          </div>
          <div className="flex items-center gap-2.5">
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-[3px] bg-canvas-soft">
              <span
                className="absolute top-0 left-0 bottom-0 bg-orange-helm"
                style={{ width: `${seniorPct}%` }}
              />
            </span>
            <span className="mono text-[12.5px] text-shade-60 tabular-nums">
              {Math.floor(elapsedSec / 86_400)}d / {SENIOR_WINDOW_DAYS}d
            </span>
          </div>
        </div>
      </div>

      {/* Permissionless cranks — anyone can call these to nudge the
          wind-down state machine forward. Critical for demos and for
          stuck wind-downs. */}
      <div className="mt-5 pt-4 border-t border-hairline-soft flex flex-wrap items-center gap-2">
        <span className="mono text-[11.5px] text-shade-50">Crank ·</span>
        <WindDownCrankButton
          vaultAddress={vaultAddress}
          functionName="progressWindDown"
          label="Progress wind-down"
          variant="outline-light"
          disabled={!canProgress}
          hint={
            canProgress
              ? "Liquidates the next non-empty position to USDC."
              : state.positionsRemaining === 0
                ? "All positions already liquidated."
                : "Wind-down inactive."
          }
          onChange={onChange}
        />
        <WindDownCrankButton
          vaultAddress={vaultAddress}
          functionName="settle"
          label="Settle"
          variant="primary"
          disabled={!canSettle}
          hint={
            canSettle
              ? "Final pro-rata distribution. Senior holders pay first, founder absorbs residual."
              : state.positionsRemaining > 0
                ? `Liquidate ${state.positionsRemaining} more position(s) first.`
                : "Senior window still open."
          }
          onChange={onChange}
        />
      </div>
    </div>
  );
}

function WindDownCrankButton({
  vaultAddress,
  functionName,
  label,
  variant,
  disabled,
  hint,
  onChange,
}: {
  vaultAddress: `0x${string}`;
  functionName: "progressWindDown" | "settle";
  label: string;
  variant: "outline-light" | "primary";
  disabled: boolean;
  hint: string;
  onChange: () => void;
}) {
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { push: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const onCorrectChain = chainId === mantleSepolia.id;

  async function run() {
    if (!publicClient || !onCorrectChain || !address) return;
    setBusy(true);
    try {
      const hash = await writeWithNonce(publicClient, address, (nonce) =>
        writeContractAsync({
          address: vaultAddress,
          abi: VAULT_WINDDOWN_ABI,
          functionName,
          args: [],
          nonce,
        }),
      );
      await waitForTx(publicClient!, hash);
      toast({
        msg:
          functionName === "settle"
            ? "Vault settled · final distribution complete"
            : "Wind-down progressed · next position liquidated",
        tx: hash,
      });
      onChange();
    } catch (e) {
      const { message } = decodeContractError(e);
      toast({ msg: `${label} failed — ${message}`, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant={variant}
      size="sm"
      disabled={disabled || busy || !onCorrectChain}
      onClick={run}
      title={hint}
    >
      {busy ? "…" : label}
    </Button>
  );
}

/* ─────────── Emergency exit conditions ─────────── */

function EmergencyConditionsCard({ agentId }: { agentId: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["conditions", agentId],
    queryFn: () =>
      api.get("/agents/{agent_id}/conditions", {
        path: { agent_id: agentId },
      }) as Promise<ConditionCheckResponse>,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="h-32 animate-pulse rounded-[12px] bg-hairline-light" />
    );
  }
  if (isError || !data || !data.conditions || data.conditions.length === 0) {
    return null; // hide card entirely when mandate has no exit conditions
  }

  const triggered = data.anyTriggered;
  const cardClass = triggered
    ? "border border-amber-helm/40 bg-amber-bg"
    : "border border-hairline-light bg-canvas-light";
  const eyebrowColor = triggered
    ? "var(--phase-incubation-text)"
    : undefined;

  return (
    <div className={cn("rounded-[12px] p-6", cardClass)}>
      <div className="flex items-baseline justify-between mb-1">
        <h3
          className="text-[15px] font-medium text-ink"
          style={triggered ? { color: eyebrowColor } : undefined}
        >
          Emergency exit conditions
        </h3>
        {triggered && (
          <Tag variant="outline">⚠ triggered</Tag>
        )}
      </div>
      <p className="text-[12.5px] text-shade-50 mb-4">
        Live evaluation of the mandate&apos;s exit triggers · refreshes every
        60s.
      </p>

      <div className="flex flex-col gap-3">
        {data.conditions.map((c, i) => (
          <ConditionRow key={i} c={c} />
        ))}
      </div>
    </div>
  );
}

function ConditionRow({
  c,
}: {
  c: components["schemas"]["ConditionResult"];
}) {
  const tone = c.triggered
    ? "text-amber-helm"
    : c.parsed
      ? "text-emerald-helm"
      : "text-shade-50";
  return (
    <div className="border-t border-hairline-soft pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[13px] text-ink flex-1 min-w-0 break-words">
          {c.condition}
        </span>
        <span className={cn("mono text-[11.5px] font-medium", tone)}>
          {c.triggered
            ? "TRIGGERED"
            : c.parsed
              ? "OK"
              : "unparseable"}
        </span>
      </div>
      {c.parsed && c.currentValue !== null && c.currentValue !== undefined && (
        <div className="mono text-[11.5px] text-shade-50">
          current {c.currentValue.toLocaleString()} · threshold{" "}
          {c.threshold?.toLocaleString() ?? "—"}
        </div>
      )}
      {c.note && (
        <div className="text-[11.5px] text-shade-50 mt-1">{c.note}</div>
      )}
    </div>
  );
}

/* ─────────── Benchmark card ─────────── */

function BenchmarkCard({ agentId }: { agentId: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["benchmark", agentId],
    queryFn: () =>
      api.get("/agents/{agent_id}/benchmark", {
        path: { agent_id: agentId },
      }) as Promise<BenchmarkResponse>,
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="h-32 animate-pulse rounded-[12px] bg-hairline-light" />
    );
  }
  if (isError || !data) {
    return (
      <p className="text-[13.5px] text-shade-50">
        No benchmark data yet.
      </p>
    );
  }
  const summary = data.summary;
  if (!summary || data.sampleCount === 0) {
    return (
      <p className="text-[13.5px] text-shade-50">
        Not enough history yet (samples · {data.sampleCount}).
      </p>
    );
  }

  return (
    <div className="rounded-[12px] border border-hairline-light bg-canvas-light p-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-y-5">
        <BenchKpi
          label="Agent return"
          value={formatPercent(summary.agentReturn, { signed: true })}
          tone={summary.agentReturn >= 0 ? "pos" : "neg"}
          sub={`${data.sampleCount} samples`}
        />
        <BenchKpi
          label="vs sSPY"
          value={formatPercent(summary.alphaVsSspy, { signed: true })}
          tone={summary.alphaVsSspy >= 0 ? "pos" : "neg"}
          sub={`sSPY · ${formatPercent(summary.sspyReturn, { signed: true })}`}
        />
        <BenchKpi
          label="vs 60/40"
          value={formatPercent(summary.alphaVsSixtyForty, { signed: true })}
          tone={summary.alphaVsSixtyForty >= 0 ? "pos" : "neg"}
          sub={`60/40 · ${formatPercent(summary.sixtyFortyReturn, { signed: true })}`}
        />
      </div>
      {data.periodStart && data.periodEnd && (
        <div className="mt-4 pt-4 border-t border-hairline-soft mono text-[12px] text-shade-50">
          {formatDate(data.periodStart)} → {formatDate(data.periodEnd)}
        </div>
      )}
    </div>
  );
}

function BenchKpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "pos" | "neg";
}) {
  return (
    <div className="px-4 first:pl-0 last:pr-0 sm:border-r sm:border-hairline-soft sm:last:border-r-0">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-shade-50 mb-1.5">
        {label}
      </div>
      <div
        className={cn(
          "mono text-[22px] font-medium tabular-nums leading-none",
          tone === "pos" ? "text-emerald-helm" : "text-red-helm",
        )}
      >
        {value}
      </div>
      <div className="mono text-[11.5px] text-shade-50 mt-1.5">{sub}</div>
    </div>
  );
}

/* ─────────── Decision log (paginated) ─────────── */

function PaginatedDecisionList({
  agentId,
  fallback,
}: {
  agentId: number;
  /** recentDecisions from the agent detail — shown only if the paginated
   *  endpoint has a transient failure, so the section never goes blank. */
  fallback: Decision[];
}) {
  const [offset, setOffset] = useState(0);

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["decisions", agentId, offset],
    queryFn: () =>
      api.get("/agents/{agent_id}/decisions", {
        path: { agent_id: agentId },
        query: { limit: DECISIONS_PAGE_SIZE, offset },
      }) as Promise<DecisionPage>,
    staleTime: 15_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-[8px] bg-hairline-light"
          />
        ))}
      </div>
    );
  }

  // Defensive fallback: if the paginated query errors transiently, show the
  // recentDecisions slice embedded in the agent detail rather than a blank
  // error. The endpoint itself is live, so this is rare.
  if (isError || !data) {
    if (fallback.length === 0) {
      return (
        <p className="text-[13.5px] text-shade-50">
          Couldn&apos;t load decision history — try refreshing.
        </p>
      );
    }
    return (
      <>
        <p className="text-[12px] text-shade-50 mb-3">
          Showing the most recent {fallback.length} decision
          {fallback.length === 1 ? "" : "s"} (history temporarily unavailable).
        </p>
        <DecisionRows decisions={fallback} />
      </>
    );
  }

  if (data.items.length === 0) {
    return (
      <p className="text-[13.5px] text-shade-50">
        No recorded decisions yet.
      </p>
    );
  }

  const page = Math.floor(offset / DECISIONS_PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(data.total / DECISIONS_PAGE_SIZE));
  const hasPrev = offset > 0;
  const hasNext = offset + DECISIONS_PAGE_SIZE < data.total;

  return (
    <>
      <DecisionRows decisions={data.items} />
      {data.total > DECISIONS_PAGE_SIZE && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            disabled={!hasPrev || isFetching}
            onClick={() => setOffset(Math.max(0, offset - DECISIONS_PAGE_SIZE))}
            className="rounded-full border border-hairline-light px-3.5 py-1.5 text-[12.5px] text-shade-60 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="mono tabular-nums text-[12.5px] text-shade-50">
            Page {page} / {totalPages} · {data.total} total
          </span>
          <button
            disabled={!hasNext || isFetching}
            onClick={() => setOffset(offset + DECISIONS_PAGE_SIZE)}
            className="rounded-full border border-hairline-light px-3.5 py-1.5 text-[12.5px] text-shade-60 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}

function DecisionRows({ decisions }: { decisions: Decision[] }) {
  return (
    <div className="flex flex-col">
      {decisions.map((d) => (
        <div
          key={d.id}
          className="grid grid-cols-[100px_1fr_auto] gap-4 items-start py-4 border-b border-hairline-soft last:border-b-0"
        >
          <span className="mono text-[12px] text-shade-50">
            {formatRelative(d.timestamp)}
          </span>
          <div className="text-[14.5px] min-w-0">
            <span className="inline-flex items-center gap-2.5 flex-wrap">
              <DecisionTag type={d.type} />
              <span className="text-ink">{d.summary || d.type}</span>
            </span>
          </div>
          <a
            href={`${EXPLORER}/tx/${d.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mono text-[12px] text-shade-50 underline underline-offset-2 hover:text-ink whitespace-nowrap"
          >
            {d.txHash.slice(0, 10)}… ↗
          </a>
        </div>
      ))}
    </div>
  );
}

/* ─────────── Sidebar cards ─────────── */

function ActionCard({
  agent,
  dailyDelta,
  initialAction,
}: {
  agent: AgentDetail;
  /** Real 24h NAV-per-share delta from /nav-history. null = <2 data points. */
  dailyDelta: number | null;
  initialAction: "mint" | "redeem" | null;
}) {
  const { address: connectedAddress } = useAccount();
  const isFounder =
    !!connectedAddress &&
    agent.founderAddress?.toLowerCase() === connectedAddress.toLowerCase();
  const isWindDown = agent.phase === "WindDown";
  const isIncubation = agent.phase === "Incubation";
  // Incubation only lets the founder deposit; everyone else hits
  // OnlyFounderDuringIncubation() on-chain. Gate it client-side.
  const blockedByIncubation = isIncubation && !isFounder;
  const canMint =
    !isWindDown && agent.phase !== "Settled" && !blockedByIncubation;
  const canRedeem = agent.phase !== "Settled";
  const noData = dailyDelta === null;
  const positive = !noData && dailyDelta >= 0;
  const isZero = !noData && dailyDelta === 0;

  const [mintOpen, setMintOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);

  // Auto-open from deep link (e.g. ?action=redeem from Portfolio page).
  useEffect(() => {
    if (initialAction === "mint" && canMint) setMintOpen(true);
    if (initialAction === "redeem" && canRedeem) setRedeemOpen(true);
  }, [initialAction, canMint, canRedeem]);

  return (
    <>
      <div className="rounded-[12px] border border-hairline-light bg-canvas-light p-6">
        {/* Price block */}
        <div className="flex justify-between items-end pb-4 border-b border-hairline-soft mb-4">
          <div>
            <div className="text-[12px] text-shade-50 mb-1.5">
              NAV / share
            </div>
            <div className="mono text-[32px] font-medium leading-none tabular-nums">
              {formatUsdc(agent.navPerShareUsdc, {
                decimals: 4,
                withSymbol: true,
              })}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[12px] text-shade-50 mb-1.5">24h</div>
            <div
              className={cn(
                "mono text-[13px] font-medium",
                noData || isZero
                  ? "text-shade-50"
                  : positive
                    ? "text-emerald-helm"
                    : "text-red-helm",
              )}
            >
              {noData || isZero
                ? "—"
                : formatPercent(dailyDelta, { signed: true })}
            </div>
          </div>
        </div>

        {/* KV list */}
        <div className="flex flex-col gap-2.5">
          <Kv
            label="Min deposit"
            value={formatUsdc(agent.mandate?.minimumDepositUsdc ?? "0", {
              withSymbol: true,
            })}
          />
          <Kv label="Mint fee" value="0.50%" />
          <Kv label="Pyth fee" value="~0.002 MNT" />
          <Kv label="Settlement" value="~3 tx · 30s" muted />
        </div>

        {/* CTAs */}
        <div className="flex flex-col gap-2 mt-5">
          {canMint ? (
            <Button
              variant="aloe"
              size="md"
              className="w-full"
              onClick={() => setMintOpen(true)}
            >
              Mint shares
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              disabled
              className="w-full"
            >
              {blockedByIncubation
                ? "Founder-only · incubation"
                : isWindDown
                  ? "Mint disabled · wind-down"
                  : "Mint disabled"}
            </Button>
          )}
          {canRedeem ? (
            <Button
              variant="outline-light"
              size="md"
              className="w-full"
              onClick={() => setRedeemOpen(true)}
            >
              Redeem
            </Button>
          ) : (
            <Button
              variant="outline-light"
              size="md"
              disabled
              className="w-full"
            >
              Redeem disabled
            </Button>
          )}
        </div>

      </div>

      <MintModal
        agent={agent}
        open={mintOpen}
        onClose={() => setMintOpen(false)}
      />
      <RedeemModal
        agent={agent}
        open={redeemOpen}
        onClose={() => setRedeemOpen(false)}
      />
    </>
  );
}

function StructuralDefenseCard({ data }: { data: AgentDetail }) {
  const fv = data.founderVault;
  const cumPct = fv?.cumulativeWithdrawnBps ?? 0;
  const cap = data.mandate?.subordinationThresholdBps ?? 4000;
  const pctOfCap = cap > 0 ? (cumPct / cap) * 100 : 0;
  const danger = pctOfCap >= 80;

  const queuePending = data.redemptionQueue?.pendingShares
    ? Number(BigInt(data.redemptionQueue.pendingShares)) / 1e18
    : 0;
  const queueCount = data.redemptionQueue?.requestCount ?? 0;
  const queueUnlock = data.redemptionQueue?.nextUnlockAt;
  // Real denominator: pending shares as % of circulating total supply.
  // 0-supply guard (incubation, brand-new agents) → 0% bar instead of NaN.
  const totalSharesAgt = data.totalShares
    ? Number(BigInt(data.totalShares)) / 1e18
    : 0;
  const queuePct =
    totalSharesAgt > 0
      ? Math.min(100, (queuePending / totalSharesAgt) * 100)
      : 0;

  const ageDaysVal = ageDays(data.createdAt);
  const incubationDone =
    ageDaysVal >= 30 && data.phase !== "Incubation";

  return (
    <div
      id="structural-defense"
      className="rounded-[12px] border border-hairline-light bg-canvas-light p-6 scroll-mt-20"
    >
      <h3 className="text-[15px] font-medium mb-1 text-ink">
        Structural defense
      </h3>
      <p className="text-[12.5px] text-shade-50 mb-4">
        Founder vault is subordinated · senior holders always settle first.
      </p>

      <RiskBlock
        label="Founder withdrawn"
        value={`${(cumPct / 100).toFixed(1)}% / ${(cap / 100).toFixed(0)}% cap`}
        pct={Math.min(100, pctOfCap)}
        tone={danger ? "danger" : "default"}
        desc="Withdrawals above the cap revert. The founder's remaining stake settles after external holders during wind-down."
      />

      <RiskBlock
        label="Redemption queue"
        value={
          totalSharesAgt > 0
            ? `${queueCount} pending · ${queuePct.toFixed(2)}% of supply`
            : `${queueCount} pending · ${queuePending.toFixed(2)} AGT`
        }
        pct={queuePct}
        desc={
          queueUnlock
            ? `Next unlock ${formatRelative(queueUnlock)}`
            : "No active requests"
        }
      />

      <RiskBlock
        label={incubationDone ? "Incubation passed" : "Incubation period"}
        value={
          incubationDone
            ? `✓ ${ageDaysVal}d`
            : `${ageDaysVal}d / 30d`
        }
        pct={Math.min(100, (ageDaysVal / 30) * 100)}
        tone={incubationDone ? "success" : "default"}
        desc={
          incubationDone
            ? "Passed the 30-day on-chain track record. Auto-transitioned to PublicLaunch."
            : "Founder-only deposits until the 30-day verification window completes."
        }
      />
    </div>
  );
}

function RiskBlock({
  label,
  value,
  pct,
  desc,
  tone = "default",
}: {
  label: string;
  value: string;
  pct: number;
  desc: string;
  tone?: "default" | "danger" | "success";
}) {
  const fillClass =
    tone === "danger"
      ? "bg-red-helm"
      : tone === "success"
        ? "bg-emerald-helm"
        : "bg-ink";
  return (
    <div className="py-3.5 border-t border-hairline-soft first:border-t-0 first:pt-0">
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-shade-50">
          {label}
        </span>
        <span className="mono text-[13px] font-medium text-ink">
          {value}
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-[3px] bg-canvas-soft">
        <div
          className={cn("absolute top-0 left-0 bottom-0", fillClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[12px] leading-[1.5] text-shade-50">
        {desc}
      </p>
    </div>
  );
}

function ManagerIdentityCard({ data }: { data: AgentDetail }) {
  return (
    <div className="rounded-[12px] border border-hairline-light bg-canvas-cream p-6">
      <h3 className="text-[15px] font-medium mb-1 text-ink">
        Manager identity
      </h3>
      <p className="text-[12.5px] text-shade-50 mb-4">
        ERC-8004 NFT · portable + slashable reputation.
      </p>

      <div className="flex flex-col gap-2.5 mt-3">
        <Kv
          label="Founder"
          value={
            <a
              href={`${EXPLORER}/address/${data.founderAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-ink"
            >
              {formatAddress(data.founderAddress)} ↗
            </a>
          }
        />
        <Kv
          label="Identity NFT"
          value={`#${String(data.agentId).padStart(4, "0")}`}
        />
        <Kv
          label="Reputation"
          value={`${data.reputation ?? 0} / 10,000`}
        />
        <Kv
          label="Vault"
          value={
            <a
              href={`${EXPLORER}/address/${data.vaultAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-ink"
            >
              {formatAddress(data.vaultAddress)} ↗
            </a>
          }
        />
        <Kv
          label="Token"
          value={
            <a
              href={`${EXPLORER}/address/${data.tokenAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-ink"
            >
              {formatAddress(data.tokenAddress)} ↗
            </a>
          }
        />
      </div>
    </div>
  );
}

function Kv({
  label,
  value,
  muted,
}: {
  label: string;
  value: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline gap-3 text-[13.5px]">
      <span className="text-shade-50">{label}</span>
      <span
        className={cn(
          "mono tabular-nums",
          muted ? "text-shade-50" : "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ─────────── Misc ─────────── */

function Center({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      {children}
    </main>
  );
}

function ErrorBox({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[12px] border border-red-300 bg-red-50 p-5">
      <p className="font-medium text-red-800">{title}</p>
      <p className="mt-1 text-[13.5px] text-red-700">{body}</p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <main className="mx-auto max-w-[1440px] px-4 sm:px-8 py-10">
      <div className="h-5 w-32 animate-pulse rounded bg-hairline-light" />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-8 mt-6">
        <div>
          <div className="h-16 w-2/3 animate-pulse rounded bg-hairline-light" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-hairline-light mt-3" />
          <div className="grid grid-cols-4 gap-6 mt-8 pt-8 border-t border-hairline-light">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded bg-hairline-light"
              />
            ))}
          </div>
          <div className="mt-12 h-48 animate-pulse rounded-[12px] bg-hairline-light" />
          <div className="mt-6 h-64 animate-pulse rounded-[12px] bg-hairline-light" />
        </div>
        <div className="flex flex-col gap-5">
          <div className="h-72 animate-pulse rounded-[12px] bg-hairline-light" />
          <div className="h-56 animate-pulse rounded-[12px] bg-hairline-light" />
          <div className="h-56 animate-pulse rounded-[12px] bg-hairline-light" />
        </div>
      </div>
    </main>
  );
}

/**
 * Compute the 24h NAV-per-share delta (fraction, e.g. +0.012 = +1.2%).
 * Returns null when the history series has fewer than 2 usable points —
 * caller renders that as "—".
 */
function compute24hDelta(
  history: NavHistoryResponse | undefined,
): number | null {
  const points = history?.points;
  if (!points || points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  try {
    const firstN = Number(BigInt(first.navPerShareUsdc)) / 1e6;
    const lastN = Number(BigInt(last.navPerShareUsdc)) / 1e6;
    if (firstN === 0) return null;
    return (lastN - firstN) / firstN;
  } catch {
    return null;
  }
}

function ageDays(unixSeconds: number | null | undefined): number {
  if (!unixSeconds) return 0;
  return Math.floor(
    (Math.floor(Date.now() / 1000) - unixSeconds) / 86400,
  );
}
