import { Tag } from "./Tag";

export type AssetClass = "equity" | "crypto" | "treasury" | "cash" | "mixed";

const LABELS: Record<AssetClass, string> = {
  equity:   "Equity",
  crypto:   "Crypto",
  treasury: "Treasury",
  cash:     "Cash",
  mixed:    "Mixed",
};

interface AssetTagProps {
  kind: AssetClass | string;
  className?: string;
}

/**
 * Thin wrapper around <Tag variant="shade"> that maps asset-class identifiers
 * to display labels. Stays consistent if the design swaps variants later.
 */
export function AssetTag({ kind, className }: AssetTagProps) {
  const label = LABELS[kind as AssetClass] ?? kind;
  return (
    <Tag variant="shade" className={className}>
      {label}
    </Tag>
  );
}
