import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant =
  | "primary"
  | "outline-light"
  | "outline-dark"
  | "aloe"
  | "ghost"
  | "danger";
export type ButtonSize = "md" | "sm" | "xs";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-on-primary border-transparent hover:bg-shade-70",
  "outline-light":
    "bg-canvas-light border-ink text-ink hover:bg-canvas-soft",
  "outline-dark":
    "bg-transparent border-on-primary border-2 text-on-primary",
  aloe:
    "bg-aloe text-ink border-transparent hover:bg-aloe-hover",
  ghost:
    "bg-transparent border-transparent text-shade-60 hover:bg-canvas-soft hover:text-ink",
  danger:
    "bg-red-helm text-white border-transparent hover:bg-[#b91c1c]",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "px-6 py-3 text-[15px]",
  sm: "px-4 py-2 text-[13.5px]",
  xs: "px-3 py-1.5 text-[12.5px]",
};

const GHOST_SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "px-3 py-2 text-[14px]",
  sm: "px-3 py-1.5 text-[13px]",
  xs: "px-2 py-1 text-[12px]",
};

/**
 * Pill button — single source of truth across the app.
 *
 * Design language: every CTA is pill-shaped (radius 9999), Inter 500, light
 * tracking. Variants encode role; sizes encode density.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, type = "button", children, ...props },
  ref,
) {
  const sizeClass =
    variant === "ghost" ? GHOST_SIZE_CLASSES[size] : SIZE_CLASSES[size];

  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-[0.01em] border whitespace-nowrap",
        "transition-[background-color,color,border-color,transform] duration-[120ms] ease-out",
        "active:translate-y-[0.5px] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-y-0",
        "select-none",
        VARIANT_CLASSES[variant],
        sizeClass,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
