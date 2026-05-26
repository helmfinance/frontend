import { cn } from "@/lib/cn";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** CSS color (var() or hex). Defaults to currentColor so parent can style. */
  color?: string;
  strokeWidth?: number;
  className?: string;
}

/**
 * Tiny inline SVG line. Renders nothing if `data.length < 2`.
 * Use for at-a-glance perf indicators on cards / table rows.
 */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  color = "currentColor",
  strokeWidth = 1.25,
  className,
}: SparklineProps) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      style={{ overflow: "visible" }}
      className={cn("inline-block", className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
