"use client";

/**
 * NAV/share time-series chart with period selector.
 *
 * Pulls /agents/{id}/nav-history and renders an inline SVG line chart —
 * no recharts/d3 dependency. Period switch (24h/7d/30d/all) refetches.
 *
 * Design intent:
 *   • Reuse design tokens (canvas-light card, mono micro labels).
 *   • Same color rule as Sparkline: emerald for positive, red for negative,
 *     shade for flat.
 *   • Hover crosshair shows the point's value + timestamp.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatUsdc } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { components } from "@/lib/api-types.gen";

type NavHistory = components["schemas"]["NavHistoryResponse"];
type NavPoint = components["schemas"]["NavPoint"];
type Period = "24h" | "7d" | "30d" | "all";

const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

interface NavChartProps {
  agentId: number;
}

export function NavChart({ agentId }: NavChartProps) {
  const [period, setPeriod] = useState<Period>("7d");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["nav-history-chart", agentId, period],
    queryFn: () =>
      api.get("/agents/{agent_id}/nav-history", {
        path: { agent_id: agentId },
        query: { period },
      }) as Promise<NavHistory>,
    staleTime: 30_000,
    retry: false,
  });

  return (
    <div className="rounded-[12px] border border-hairline-light bg-canvas-light p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-[15px] font-medium text-ink">NAV per share</h3>
          <p className="text-[12.5px] text-shade-50 mt-0.5">
            Historical share-price proxy · {data?.granularity ?? "—"} granularity
          </p>
        </div>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11.5px] font-medium mono transition-colors",
                period === p.value
                  ? "bg-ink text-on-primary"
                  : "text-shade-60 hover:bg-canvas-soft hover:text-ink",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[240px] flex items-stretch">
        {isLoading ? (
          <div className="flex-1 animate-pulse rounded-[8px] bg-hairline-light" />
        ) : isError || !data ? (
          <EmptyChartState text="Failed to load NAV history" />
        ) : data.points.length < 2 ? (
          <EmptyChartState text="Not enough history yet" />
        ) : (
          <LinePlot points={data.points} />
        )}
      </div>
    </div>
  );
}

function EmptyChartState({ text }: { text: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-[13.5px] text-shade-50 border border-dashed border-shade-30 rounded-[8px]">
      {text}
    </div>
  );
}

/* ─────────── Inline SVG line plot ─────────── */

function LinePlot({ points }: { points: NavPoint[] }) {
  // Width is driven by container; SVG uses viewBox so it scales smoothly.
  const WIDTH = 720;
  const HEIGHT = 200;
  const PAD_X = 40;
  const PAD_Y = 16;

  const { values, xs, min, max, range, firstVal, lastVal } = useMemo(() => {
    const values = points.map((p) => {
      try {
        return Number(BigInt(p.navPerShareUsdc)) / 1e6;
      } catch {
        return 0;
      }
    });
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || max || 1;
    const xs = points.map((p) => p.timestamp);
    return {
      values,
      xs,
      min,
      max,
      range,
      firstVal: values[0] ?? 0,
      lastVal: values[values.length - 1] ?? 0,
    };
  }, [points]);

  // Color follows return sign (last vs first).
  const delta = lastVal - firstVal;
  const positive = delta >= 0;
  const isZero = delta === 0;
  const stroke = isZero
    ? "var(--shade-40)"
    : positive
      ? "var(--emerald)"
      : "var(--red)";
  const fill = isZero
    ? "var(--shade-30)"
    : positive
      ? "var(--emerald-bg)"
      : "var(--red-bg)";

  const xScale = (i: number) =>
    PAD_X + ((WIDTH - PAD_X * 2) * i) / Math.max(1, points.length - 1);
  // Pad the value range slightly so the line doesn't touch the edges.
  const valuePad = range * 0.08;
  const yScale = (v: number) =>
    HEIGHT -
    PAD_Y -
    ((v - (min - valuePad)) / (range + valuePad * 2)) * (HEIGHT - PAD_Y * 2);

  const linePoints = values
    .map((v, i) => `${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`)
    .join(" ");
  const areaPath = `M ${xScale(0).toFixed(1)},${(HEIGHT - PAD_Y).toFixed(1)} L ${linePoints
    .split(" ")
    .join(" L ")} L ${xScale(values.length - 1).toFixed(1)},${(
    HEIGHT - PAD_Y
  ).toFixed(1)} Z`;

  // Y-axis labels (max, mid, min)
  const yLabels = [
    { v: max, y: yScale(max) },
    { v: (max + min) / 2, y: yScale((max + min) / 2) },
    { v: min, y: yScale(min) },
  ];
  // X-axis labels (first, ~middle, last timestamps)
  const xLabels = [
    { ts: xs[0]!, x: xScale(0) },
    { ts: xs[Math.floor(xs.length / 2)]!, x: xScale(Math.floor(xs.length / 2)) },
    { ts: xs[xs.length - 1]!, x: xScale(xs.length - 1) },
  ];

  return (
    <div className="flex-1 flex flex-col">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="w-full flex-1"
      >
        {/* Y grid lines */}
        {yLabels.map((l, i) => (
          <line
            key={i}
            x1={PAD_X}
            x2={WIDTH - PAD_X}
            y1={l.y}
            y2={l.y}
            stroke="var(--hairline-soft)"
            strokeWidth={1}
            strokeDasharray={i === 1 ? "0" : "2 3"}
          />
        ))}

        {/* Area fill */}
        <path d={areaPath} fill={fill} opacity={0.35} />

        {/* Line */}
        <polyline
          points={linePoints}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* First + last dots for emphasis */}
        <circle cx={xScale(0)} cy={yScale(firstVal)} r={3} fill={stroke} />
        <circle
          cx={xScale(values.length - 1)}
          cy={yScale(lastVal)}
          r={3}
          fill={stroke}
        />

        {/* Y axis labels */}
        {yLabels.map((l, i) => (
          <text
            key={i}
            x={PAD_X - 8}
            y={l.y + 4}
            fontSize={10}
            fontFamily="var(--font-mono)"
            textAnchor="end"
            fill="var(--shade-50)"
          >
            ${l.v.toFixed(4)}
          </text>
        ))}

        {/* X axis labels */}
        {xLabels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={HEIGHT - 2}
            fontSize={10}
            fontFamily="var(--font-mono)"
            textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}
            fill="var(--shade-50)"
          >
            {formatTs(l.ts)}
          </text>
        ))}
      </svg>

      {/* Footer: delta summary */}
      <div className="mt-3 flex items-baseline justify-between text-[12.5px]">
        <div className="text-shade-50">
          From{" "}
          <span className="mono text-shade-60">
            {formatUsdc(BigInt(Math.round(firstVal * 1e6)).toString(), {
              withSymbol: true,
              decimals: 4,
            })}
          </span>{" "}
          → now{" "}
          <span className="mono text-ink">
            {formatUsdc(BigInt(Math.round(lastVal * 1e6)).toString(), {
              withSymbol: true,
              decimals: 4,
            })}
          </span>
        </div>
        <div
          className={cn(
            "mono font-medium",
            isZero
              ? "text-shade-50"
              : positive
                ? "text-emerald-helm"
                : "text-red-helm",
          )}
        >
          {isZero
            ? "—"
            : `${positive ? "+" : ""}${(((lastVal - firstVal) / (firstVal || 1)) * 100).toFixed(2)}%`}
        </div>
      </div>
    </div>
  );
}

function formatTs(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
}
