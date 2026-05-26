import { type ReactNode, type HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export type CardVariant =
  | "default"   // white bg, hairline border (the workhorse)
  | "halo"      // white bg, paper-halo shadow stack (hover-elevated cards)
  | "aloe"      // aloe mint bg, no border (featured / success state)
  | "pistachio" // pistachio bg, no border (mandate / incubation block)
  | "cream";    // cream bg, no border (sub-band)

export type CardPadding = "none" | "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<CardVariant, string> = {
  default:    "bg-canvas-light border border-hairline-light",
  halo:       "bg-canvas-light shadow-helm-halo",
  aloe:       "bg-aloe",
  pistachio:  "bg-pistachio",
  cream:      "bg-canvas-cream",
};

const PADDING_CLASSES: Record<CardPadding, string> = {
  none: "p-0",
  sm:   "p-4",
  md:   "p-6",
  lg:   "p-8",
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  children?: ReactNode;
}

/**
 * Card primitive — 12px radius across all variants. Picks one of:
 *   - default   (most common: hairline-bordered surface)
 *   - halo      (elevated hover / hero cards)
 *   - aloe      (featured / "you received" success block)
 *   - pistachio (mandate panel, incubation period card)
 *   - cream     (recessed sub-band on the same page)
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "default", padding = "lg", className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-[12px]",
        VARIANT_CLASSES[variant],
        PADDING_CLASSES[padding],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});
