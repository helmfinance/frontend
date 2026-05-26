import { cn } from "@/lib/cn";

export type DecisionType =
  | "Rebalance"
  | "Harvest"
  | "Distribute"
  | "WindDown"
  // Lower-case aliases (BE may serialize either form)
  | "rebalance"
  | "harvest"
  | "distribute"
  | "winddown";

type Meta = { label: string; bgClass: string; textClass: string };

const META: Record<string, Meta> = {
  rebalance:  { label: "Rebalance",  bgClass: "bg-blue-bg",     textClass: "text-dec-rebalance" },
  harvest:    { label: "Harvest",    bgClass: "bg-emerald-bg",  textClass: "text-dec-harvest" },
  distribute: { label: "Distribute", bgClass: "bg-violet-bg",   textClass: "text-dec-distribute" },
  winddown:   { label: "Wind-down",  bgClass: "bg-orange-bg",   textClass: "text-dec-winddown" },
};

interface DecisionTagProps {
  type: DecisionType | string;
  className?: string;
}

/**
 * Color-coded badge for decision logs.
 * Tolerates both `Rebalance` (BE schema) and `rebalance` (prototype data).
 */
export function DecisionTag({ type, className }: DecisionTagProps) {
  const key = String(type).toLowerCase();
  const meta = META[key] ?? META.rebalance;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5",
        "text-[10.5px] font-medium tracking-[0.06em] uppercase",
        meta.bgClass,
        meta.textClass,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
