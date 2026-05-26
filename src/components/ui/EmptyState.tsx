import { cn } from "@/lib/cn";

interface EmptyStateProps {
  title: string;
  body?: React.ReactNode;
  /** Optional CTA (button or link) rendered below body. */
  action?: React.ReactNode;
  /** Visual density. `default` = section-sized; `compact` = inline empty rows. */
  size?: "default" | "compact";
  /** `card` (default) = bordered cream card. `dashed` = dashed outline only. */
  variant?: "card" | "dashed";
  className?: string;
}

/**
 * Canonical empty-state for Helm. Use everywhere a list/section can be empty
 * (Marketplace, Portfolio tabs, Decision log, etc.) so the language and
 * styling stays consistent.
 */
export function EmptyState({
  title,
  body,
  action,
  size = "default",
  variant = "card",
  className,
}: EmptyStateProps) {
  const wrapperClass =
    variant === "dashed"
      ? "border border-dashed border-shade-30"
      : "border border-hairline-light bg-canvas-light";
  const paddingClass = size === "compact" ? "py-10 px-5" : "py-20 px-6";
  const titleClass =
    size === "compact"
      ? "text-[20px] mb-1.5"
      : "text-[28px] mb-2";
  return (
    <div
      className={cn(
        "rounded-[12px] text-center",
        wrapperClass,
        paddingClass,
        className,
      )}
    >
      <div
        className={cn(
          "font-display font-light text-ink",
          titleClass,
        )}
      >
        {title}
      </div>
      {body && (
        <div
          className={cn(
            "text-shade-50",
            size === "compact" ? "text-[13px]" : "text-[14.5px]",
          )}
        >
          {body}
        </div>
      )}
      {action && <div className="mt-4 inline-block">{action}</div>}
    </div>
  );
}
