import { cn } from "@/lib/cn";

export type Phase =
  | "Incubation"
  | "PublicLaunch"
  | "WindDown"
  | "Slashed"
  | "Settled";

type PhaseMeta = {
  label: string;
  bgClass: string;
  textClass: string;
  dotClass: string;
};

const PHASE_META: Record<Phase, PhaseMeta> = {
  Incubation:   { label: "Incubation",    bgClass: "bg-amber-bg",   textClass: "text-phase-incubation", dotClass: "bg-amber-helm" },
  PublicLaunch: { label: "Public Launch", bgClass: "bg-emerald-bg", textClass: "text-phase-public",     dotClass: "bg-emerald-helm" },
  WindDown:     { label: "Wind-down",     bgClass: "bg-orange-bg",  textClass: "text-phase-winddown",   dotClass: "bg-orange-helm" },
  Slashed:      { label: "Slashed",       bgClass: "bg-red-bg",     textClass: "text-phase-slashed",    dotClass: "bg-red-helm" },
  Settled:      { label: "Settled",       bgClass: "bg-zinc-bg",    textClass: "text-phase-settled",    dotClass: "bg-zinc-helm" },
};

interface PhaseBadgeProps {
  phase: Phase | string;
  className?: string;
}

/**
 * Phase pill with colored dot + uppercase label.
 * Falls back to PublicLaunch styling for unknown values.
 */
export function PhaseBadge({ phase, className }: PhaseBadgeProps) {
  const meta = PHASE_META[phase as Phase] ?? PHASE_META.PublicLaunch;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
        "text-[11.5px] font-medium tracking-[0.06em] uppercase",
        meta.bgClass,
        meta.textClass,
        className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full inline-block", meta.dotClass)} />
      {meta.label}
    </span>
  );
}
