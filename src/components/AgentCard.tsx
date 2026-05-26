"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { components } from "@/lib/api-types.gen";
import { api } from "@/lib/api";
import {
  formatUsdc,
  formatBps,
  formatPercent,
} from "@/lib/format";
import { PhaseBadge, AssetTag, ReputationBar, Sparkline } from "@/components/ui";
import { cn } from "@/lib/cn";

type Agent = components["schemas"]["AgentSummary"];
type NavHistory = components["schemas"]["NavHistoryResponse"];

interface AgentCardProps {
  agent: Agent;
  /** Aloe top stripe + slight overflow:hidden adjustment. */
  featured?: boolean;
}

export function AgentCard({ agent, featured }: AgentCardProps) {
  const totalReturn = agent.performance?.totalReturn ?? 0;
  const positive = totalReturn >= 0;
  const isZero = totalReturn === 0;

  // Real 7-day NAV history per card — staleTime keeps it cheap on repeat
  // renders; react-query parallelizes the initial fetch across the grid.
  const { data: navHistory } = useQuery({
    queryKey: ["nav-history", agent.agentId, "7d"],
    queryFn: () =>
      api.get("/agents/{agent_id}/nav-history", {
        path: { agent_id: agent.agentId },
        query: { period: "7d" },
      }) as Promise<NavHistory>,
    staleTime: 60_000,
    retry: false,
  });

  const sparkData = useSparkData(navHistory);
  const sparkColor = isZero
    ? "var(--shade-30)"
    : positive
      ? "var(--emerald)"
      : "var(--red)";

  return (
    <Link
      href={`/agents/${agent.agentId}`}
      className={cn(
        "group relative flex flex-col gap-5",
        "rounded-[12px] border border-hairline-light bg-canvas-light p-6",
        "transition-[border-color,box-shadow] duration-[180ms] ease-out",
        "hover:border-shade-30 hover:shadow-helm-halo",
        featured && "overflow-hidden",
      )}
    >
      {/* Featured top stripe (4px aloe) */}
      {featured && (
        <span
          aria-hidden
          className="absolute left-0 right-0 top-0 h-1 bg-aloe"
        />
      )}

      {/* Header: ticker (small) + name (display) + phase badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-1">
          <div className="mono text-[11.5px] font-medium uppercase tracking-[0.04em] text-shade-50">
            ${agent.ticker}
          </div>
          <div className="font-display text-[26px] font-light leading-[1.1] tracking-[-0.005em] text-ink truncate">
            {agent.name}
          </div>
        </div>
        <PhaseBadge phase={agent.phase} />
      </div>

      {/* Strategy / persona — clamped to keep card heights even */}
      <p className="min-h-[40px] line-clamp-2 text-[13.5px] leading-[1.5] text-shade-60">
        {agent.strategy || "—"}
      </p>

      {/* Stat row (3-up) */}
      <div className="grid grid-cols-3 gap-2 border-y border-hairline-soft py-4">
        <Stat
          label="NAV"
          value={formatUsdc(agent.navUsdc, {
            compact: true,
            withSymbol: true,
            decimals: 1,
          })}
        />
        <Stat
          label="APY 30d"
          value={
            agent.apy30DBps != null
              ? formatBps(agent.apy30DBps, { decimals: 2 })
              : "—"
          }
        />
        <Stat label="Holders" value={String(agent.holderCount ?? 0)} />
      </div>

      {/* Return + sparkline */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="mono text-[11.5px] text-shade-50">Return</span>
          <span
            className={cn(
              "mono text-[14px] font-medium",
              isZero
                ? "text-shade-50"
                : positive
                  ? "text-emerald-helm"
                  : "text-red-helm",
            )}
          >
            {isZero ? "—" : formatPercent(totalReturn, { signed: true })}
          </span>
        </div>
        {sparkData.length >= 2 ? (
          <Sparkline data={sparkData} color={sparkColor} />
        ) : (
          <span
            aria-hidden
            className="mono text-[11px] text-shade-50"
            title="Not enough NAV history yet"
          >
            no chart yet
          </span>
        )}
      </div>

      {/* Reputation bar */}
      <ReputationBar score={agent.reputation ?? 0} className="w-full" />

      {/* Footer: asset tags + lockups */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {(agent.assetClasses ?? []).slice(0, 3).map((cls) => (
            <AssetTag key={cls} kind={cls} />
          ))}
        </div>
        <div className="mono text-[11.5px] text-shade-50">
          {(agent.allowedLockups ?? []).length > 0
            ? agent.allowedLockups.join(" · ")
            : "—"}
        </div>
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-shade-50">
        {label}
      </div>
      <div className="mono text-[17px] font-medium tabular-nums text-ink">
        {value}
      </div>
    </div>
  );
}

/**
 * Convert a NavHistoryResponse into a numeric series for the sparkline.
 * We chart NAV-per-share (the share-price proxy) rather than raw NAV so
 * the trend reflects performance, not capital inflow/outflow.
 */
function useSparkData(history: NavHistory | undefined): number[] {
  if (!history?.points || history.points.length < 2) return [];
  return history.points.map((p) => {
    try {
      // navPerShareUsdc is BigIntString scaled to USDC (1e6). Convert
      // to a normal number — precision is plenty for a 96×28 chart.
      return Number(BigInt(p.navPerShareUsdc)) / 1e6;
    } catch {
      return 0;
    }
  });
}
