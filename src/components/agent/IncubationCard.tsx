interface IncubationCardProps {
  /** unix seconds — agent.incubationStart from BE */
  incubationStart: number;
  /** 30 in production; lower for testnet demos via TimeProvider acceleration */
  periodDays?: number;
}

/**
 * Pistachio card shown above the narrator section while an agent is still in
 * its 30-day vetting window. Displays a big "Nd Hh" countdown and explains
 * what "Incubation" actually means to a viewer who's seeing the term first.
 */
export function IncubationCard({
  incubationStart,
  periodDays = 30,
}: IncubationCardProps) {
  const remainingText = formatRemaining(incubationStart, periodDays);

  return (
    <div className="rounded-[12px] bg-pistachio px-8 py-7 mb-8">
      <div
        className="text-[12px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--pistachio-text-medium)" }}
      >
        Incubation period
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-4">
        <span className="font-display text-[40px] sm:text-[48px] font-light leading-none mono tabular-nums text-ink">
          {remainingText}
        </span>
        <span
          className="text-[14px]"
          style={{ color: "var(--pistachio-text-medium)" }}
        >
          until public launch
        </span>
      </div>

      <p
        className="mt-3 text-[13.5px] leading-[1.55] max-w-[560px]"
        style={{ color: "var(--pistachio-text-strong)" }}
      >
        During the {periodDays}-day verification window only the founder may
        deposit. The agent flips to PublicLaunch automatically once its
        track-record passes the qualification check.
      </p>
    </div>
  );
}

function formatRemaining(startSec: number, periodDays: number): string {
  const endSec = startSec + periodDays * 86_400;
  const now = Math.floor(Date.now() / 1000);
  const remaining = endSec - now;
  if (remaining <= 0) return "0d 0h";
  const days = Math.floor(remaining / 86_400);
  const hours = Math.floor((remaining % 86_400) / 3600);
  return `${days}d ${hours}h`;
}
