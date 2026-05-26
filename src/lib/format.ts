/**
 * Display formatters for chain primitives.
 *
 * BE serializes big numbers as decimal strings (BigIntString). We parse to
 * BigInt to preserve precision and divide by the appropriate unit.
 */

import { USDC_DECIMALS, AGT_DECIMALS, BPS_SCALE } from "@/lib/contracts-constants";

/** Format a BigIntString (decimals = 6) as a human-readable USDC amount. */
export function formatUsdc(
  value: string | bigint | null | undefined,
  opts: { decimals?: number; compact?: boolean; withSymbol?: boolean } = {},
): string {
  if (value === null || value === undefined || value === "") return "—";
  const decimals = opts.decimals ?? 2;
  const n = Number(BigInt(value)) / 10 ** USDC_DECIMALS;
  const formatted = opts.compact
    ? new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: decimals,
      }).format(n)
    : new Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(n);
  return opts.withSymbol ? `$${formatted}` : formatted;
}

/** Format a BigIntString (decimals = 18) as a human-readable share count. */
export function formatShares(
  value: string | bigint | null | undefined,
  opts: { decimals?: number; compact?: boolean } = {},
): string {
  if (value === null || value === undefined || value === "") return "—";
  const decimals = opts.decimals ?? 2;
  const n = Number(BigInt(value)) / 10 ** AGT_DECIMALS;
  return opts.compact
    ? new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: decimals,
      }).format(n)
    : new Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(n);
}

/** Basis points → percent string. 250 → "2.50%". */
export function formatBps(
  bps: number | null | undefined,
  opts: { decimals?: number; signed?: boolean } = {},
): string {
  if (bps === null || bps === undefined) return "—";
  const decimals = opts.decimals ?? 2;
  const pct = (bps / BPS_SCALE) * 100;
  const sign = opts.signed && pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

/** Decimal fraction (0.184 = +18.4%) → percent string. */
export function formatPercent(
  fraction: number | null | undefined,
  opts: { decimals?: number; signed?: boolean } = {},
): string {
  if (fraction === null || fraction === undefined) return "—";
  const decimals = opts.decimals ?? 2;
  const pct = fraction * 100;
  const sign = opts.signed && pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

/** Truncate an Ethereum address: 0x12345678…abcdef. */
export function formatAddress(
  address: string | null | undefined,
  opts: { head?: number; tail?: number } = {},
): string {
  if (!address) return "—";
  const head = opts.head ?? 6;
  const tail = opts.tail ?? 4;
  if (address.length <= head + tail + 2) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** NAV per share (USDC 1e6, AGT 1e18). Returns dollar string. */
export function formatNavPerShare(
  navPerShare: string | bigint | null | undefined,
): string {
  if (navPerShare === null || navPerShare === undefined || navPerShare === "")
    return "—";
  // Contract stores nav-per-share scaled to USDC (1e6).
  return formatUsdc(navPerShare, { decimals: 4, withSymbol: true });
}

/** Sharpe ratio formatted to 2 dp; '—' on null. */
export function formatSharpe(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  return s.toFixed(2);
}

/** Convert unix seconds to relative time ("3d ago", "in 12h"). */
export function formatRelative(
  unixSeconds: number | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  if (unixSeconds === null || unixSeconds === undefined) return "—";
  const diff = unixSeconds - nowSeconds;
  const abs = Math.abs(diff);
  const past = diff < 0;
  let value: number;
  let unit: string;
  if (abs < 60) {
    value = abs;
    unit = "s";
  } else if (abs < 3600) {
    value = Math.floor(abs / 60);
    unit = "m";
  } else if (abs < 86400) {
    value = Math.floor(abs / 3600);
    unit = "h";
  } else {
    value = Math.floor(abs / 86400);
    unit = "d";
  }
  return past ? `${value}${unit} ago` : `in ${value}${unit}`;
}

/** Format a Date / unix-seconds timestamp as a short calendar date. */
export function formatDate(
  unixSeconds: number | null | undefined,
): string {
  if (unixSeconds === null || unixSeconds === undefined) return "—";
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Tailwind classes for a Phase badge. */
export function phaseBadgeClass(
  phase:
    | "Incubation"
    | "PublicLaunch"
    | "WindDown"
    | "Slashed"
    | "Settled"
    | string,
): string {
  switch (phase) {
    case "PublicLaunch":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "Incubation":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
    case "WindDown":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300";
    case "Slashed":
      return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
    case "Settled":
      return "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    default:
      return "bg-zinc-100 text-zinc-700";
  }
}

/** Human label for the LockupTier string returned by the BE. */
export function lockupTierLabel(t: string): string {
  switch (t) {
    case "instant":
      return "즉시";
    case "30d":
      return "30일";
    case "60d":
      return "60일";
    case "90d":
      return "90일";
    default:
      return t;
  }
}
