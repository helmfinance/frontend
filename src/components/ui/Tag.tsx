import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TagVariant = "mint" | "shade" | "pistachio" | "outline";

const VARIANT_CLASSES: Record<TagVariant, string> = {
  mint:      "bg-aloe text-ink border-transparent",
  shade:     "bg-zinc-bg text-shade-60 border-transparent",
  pistachio: "bg-pistachio text-ink border-transparent",
  outline:   "bg-transparent border-hairline-light text-shade-60",
};

interface TagProps {
  variant?: TagVariant;
  children: ReactNode;
  className?: string;
}

/**
 * Small uppercase pill used for asset class, sponsor labels, eyebrow context.
 */
export function Tag({ variant = "shade", children, className }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
        "text-[11.5px] font-medium tracking-[0.06em] uppercase whitespace-nowrap border",
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
