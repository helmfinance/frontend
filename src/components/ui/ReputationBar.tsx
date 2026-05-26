import { cn } from "@/lib/cn";

interface ReputationBarProps {
  /** 0..max bps. Helm uses 0-10000 (basis points). */
  score: number;
  max?: number;
  /** Hide the "REP" prefix when used inline in tight rows. */
  hideLabel?: boolean;
  className?: string;
}

/**
 * Inline reputation indicator: "REP {score} ────────────────"
 * The fill is solid ink in light theme; auto-inverts in dark via tokens.
 */
export function ReputationBar({
  score,
  max = 10000,
  hideLabel,
  className,
}: ReputationBarProps) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 mono text-[11px] text-shade-50",
        className,
      )}
    >
      {!hideLabel && <span>REP</span>}
      <span className="text-ink">{score.toLocaleString()}</span>
      <span className="flex-1 h-[3px] min-w-[48px] rounded-[2px] bg-canvas-soft overflow-hidden inline-block align-middle">
        <span
          className="block h-full bg-ink"
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}
