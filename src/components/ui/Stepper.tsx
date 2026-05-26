import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const EXPLORER = "https://sepolia.mantlescan.xyz";

export type StepStatus =
  | "idle"
  | "active"
  | "spinning"
  | "done"
  | "skipped"
  | "error";

interface StepperProps {
  children: ReactNode;
  className?: string;
}

/**
 * Vertical multi-step stepper for transaction flows (Mint / Redeem / Register).
 * Renders bordered rows; the indicator on the left shows status with color +
 * shape, the body shows label + optional sub-text, the right slot shows the
 * tx hash link once available.
 */
export function Stepper({ children, className }: StepperProps) {
  return <div className={cn("flex flex-col", className)}>{children}</div>;
}

interface StepRowProps {
  status: StepStatus;
  /** Step number shown in the indicator when idle/active/error. */
  number?: number;
  label: ReactNode;
  sub?: ReactNode;
  txHash?: string;
}

export function StepRow({ status, number, label, sub, txHash }: StepRowProps) {
  return (
    <div className="grid grid-cols-[36px_1fr_auto] gap-3.5 items-center py-3.5 border-b border-hairline-soft last:border-b-0">
      <StepIndicator status={status} number={number} />
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-ink">{label}</div>
        {sub && (
          <div className="mono text-[12.5px] text-shade-50 mt-0.5 truncate">
            {sub}
          </div>
        )}
      </div>
      <div className="min-w-0">
        {txHash && (
          <a
            href={`${EXPLORER}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mono text-[12px] text-shade-50 underline underline-offset-2 hover:text-ink whitespace-nowrap"
          >
            {txHash.slice(0, 10)}… ↗
          </a>
        )}
      </div>
    </div>
  );
}

function StepIndicator({
  status,
  number,
}: {
  status: StepStatus;
  number?: number;
}) {
  const base =
    "w-[30px] h-[30px] rounded-full border flex items-center justify-center mono text-[12px] font-medium";

  if (status === "spinning") {
    return (
      <div
        className={cn(base, "bg-canvas-light")}
        style={{ borderColor: "var(--ink)" }}
      >
        <span
          className="block w-3 h-3 rounded-full border-2"
          style={{
            borderColor: "var(--canvas-soft)",
            borderTopColor: "var(--ink)",
            animation: "helm-spin 800ms linear infinite",
          }}
        />
      </div>
    );
  }

  if (status === "done") {
    return (
      <div
        className={cn(base, "bg-aloe text-ink")}
        style={{ borderColor: "transparent" }}
      >
        ✓
      </div>
    );
  }

  if (status === "skipped") {
    return (
      <div
        className={cn(base, "bg-canvas-soft text-shade-50")}
        style={{ borderColor: "var(--hairline-light)" }}
        title="Skipped (already done)"
      >
        ↷
      </div>
    );
  }

  if (status === "active") {
    return (
      <div
        className={cn(base, "bg-ink text-on-primary")}
        style={{ borderColor: "var(--ink)" }}
      >
        {number}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        className={cn(base, "bg-red-helm text-white")}
        style={{ borderColor: "transparent" }}
      >
        ✗
      </div>
    );
  }

  // idle
  return (
    <div
      className={cn(base, "bg-canvas-soft text-shade-50")}
      style={{ borderColor: "var(--hairline-light)" }}
    >
      {number}
    </div>
  );
}
