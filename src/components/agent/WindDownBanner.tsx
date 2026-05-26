"use client";

import { Button } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import type { components } from "@/lib/api-types.gen";

type WindDownState = components["schemas"]["WindDownState"];

interface WindDownBannerProps {
  state: WindDownState;
  /** id of the element to scroll to when "View senior priority" is clicked. */
  scrollTargetId?: string;
}

/**
 * Full-width orange banner displayed at the top of /agents/[id] when the agent
 * is in wind-down. Communicates trigger reason, timing, and routes the user to
 * the senior-priority defense panel on the page.
 */
export function WindDownBanner({
  state,
  scrollTargetId = "structural-defense",
}: WindDownBannerProps) {
  const handleScroll = () => {
    document.getElementById(scrollTargetId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div
      className="mb-6 flex flex-col sm:flex-row sm:items-center gap-4 rounded-[12px] bg-orange-bg px-5 py-4 border"
      style={{ color: "var(--wd-text)", borderColor: "var(--wd-border)" }}
      role="alert"
    >
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-orange-helm text-white font-semibold text-[15px]">
        !
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14.5px] font-medium leading-tight">
          Wind-down active · senior holders redeem first
        </div>
        <div
          className="text-[13px] mt-1"
          style={{ color: "var(--wd-sub)" }}
        >
          Reason:{" "}
          <span className="mono">{state.reason}</span> · triggered{" "}
          {formatRelative(state.triggeredAt)} · est. completion{" "}
          {formatRelative(state.estimatedSettleAt)}
        </div>
      </div>
      <Button
        variant="outline-light"
        size="sm"
        onClick={handleScroll}
        className="flex-shrink-0"
      >
        View senior priority
      </Button>
    </div>
  );
}
