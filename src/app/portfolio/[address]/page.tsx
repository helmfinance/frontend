"use client";

/**
 * Portfolio detail page — /portfolio/{address}.
 *
 * 4 tabs:
 *   • Holdings    — AGT positions across all agents
 *   • Dividends   — claimable USDC dividends (epoch claims)
 *   • Redemptions — pending redemption requests + countdown
 *   • Founder     — founder-vault positions (lockup + carry)
 *
 * Chain actions covered:
 *   • DividendDistributor.claim(agentId, epochs[])
 *   • RedemptionQueue.claim(requestId)
 *   • RedemptionQueue.cancel(requestId)
 *   • FounderVault.withdraw(amount)
 *   • FounderVault.claimCarry()
 *
 * BE: GET /portfolio/{address}
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { erc20Abi, parseAbi, parseUnits } from "viem";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { api, ApiError } from "@/lib/api";
import { CONTRACTS, mantleSepolia } from "@/lib/wagmi";
import { decodeContractError } from "@/lib/decodeError";
import {
  formatAddress,
  formatRelative,
  formatShares,
  formatUsdc,
  lockupTierLabel,
} from "@/lib/format";
import { Button, EmptyState, Modal } from "@/components/ui";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { AGT_DECIMALS } from "@/lib/contracts-constants";
import type { components } from "@/lib/api-types.gen";

type PortfolioResponse = components["schemas"]["PortfolioResponse"];
type PortfolioPosition = components["schemas"]["PortfolioPosition"];
type DividendClaim = components["schemas"]["DividendClaim"];
type RedemptionRequest = components["schemas"]["RedemptionRequest"];
type FounderVaultPosition = components["schemas"]["FounderVaultPosition"];

type TabKey = "holdings" | "dividends" | "redemptions" | "founder";

const TABS: { key: TabKey; label: string }[] = [
  { key: "holdings", label: "Holdings" },
  { key: "dividends", label: "Dividends" },
  { key: "redemptions", label: "Redemptions" },
  { key: "founder", label: "Founder" },
];

const DISTRIBUTOR_ABI = parseAbi([
  "function claim(uint256 agentId, uint256[] epochs) returns (uint256 totalUSDC)",
]);

const QUEUE_ABI = parseAbi([
  "function claim(uint256 requestId) returns (uint256 usdcOut)",
  "function cancel(uint256 requestId)",
]);

const FOUNDER_VAULT_ABI = parseAbi([
  "function withdraw(uint256 amount)",
  "function claimCarry() returns (uint256 amount)",
  "function depositFounderShares(uint256 amount)",
  "function triggerWindDown(string reason)",
  "function sharesLocked() view returns (uint256)",
  "function cumulativeWithdrawnBps() view returns (uint256)",
]);

/** 40% withdrawal cap (basis points) — matches FounderVault.sol invariant. */
const FOUNDER_WITHDRAW_CAP_BPS = 4000;

export default function PortfolioDetailPage() {
  const params = useParams<{ address: string }>();
  const router = useRouter();
  const address = (params.address ?? "").toLowerCase();
  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(address);

  const { address: connectedAddress } = useAccount();
  const viewingSelf =
    !!connectedAddress &&
    connectedAddress.toLowerCase() === address.toLowerCase();
  /** Read-only mode: nobody connected yet. The page renders fine — only
   *  the action buttons are gated. Surface a connect prompt so the user
   *  understands why they can't claim/cancel/withdraw. */
  const readOnlyDisconnected = !connectedAddress;

  const [tab, setTab] = useState<TabKey>("holdings");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["portfolio", address],
    queryFn: () =>
      api.get("/portfolio/{address}", {
        path: { address },
      }) as Promise<PortfolioResponse>,
    enabled: isValidAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  if (!isValidAddress) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-[12px] border border-red-300 bg-red-50 p-5">
          <p className="font-medium text-red-800">Invalid address</p>
          <p className="mt-1 text-[13.5px] text-red-700">
            {`"${params.address}" is not a valid Ethereum address.`}
          </p>
        </div>
      </main>
    );
  }

  if (isLoading) return <PortfolioSkeleton />;

  if (isError) {
    const msg =
      error instanceof ApiError
        ? `${error.status}: ${JSON.stringify(error.detail)}`
        : ((error as Error)?.message ?? "Unknown error");
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-[12px] border border-red-300 bg-red-50 p-5">
          <p className="font-medium text-red-800">
            Failed to load portfolio
          </p>
          <p className="mt-1 text-[13.5px] text-red-700">{msg}</p>
        </div>
      </main>
    );
  }

  if (!data) return null;

  const holdings = data.positions ?? [];
  const dividends = data.pendingDividends ?? [];
  const redemptions = data.pendingRedemptions ?? [];
  const founderVaults = data.founderVaults ?? [];

  // Hero summary
  const totalUnclaimedDividendsUsdc = dividends.reduce(
    (sum, d) => sum + BigInt(d.claimableAmountUsdc || "0"),
    0n,
  );
  const epochsCount = dividends.reduce(
    (sum, d) => sum + d.claimableEpochs.length,
    0,
  );
  const pendingRedemptionsCount = redemptions.filter(
    (r) => r.status === "Pending" || r.status === "Claimable",
  ).length;
  const nextUnlockSeconds = (() => {
    const upcoming = redemptions
      .filter((r) => r.status === "Pending")
      .map((r) => r.unlockAt)
      .sort((a, b) => a - b);
    return upcoming[0] ?? null;
  })();

  return (
    <main className="mx-auto max-w-[1440px] px-4 sm:px-8 py-8 sm:py-12">
      {/* Hero */}
      <section className="pb-9">
        <div className="eyebrow mb-2">Portfolio</div>
        <h1 className="font-display text-[36px] sm:text-[48px] font-light leading-[1.05] text-ink">
          Your positions
        </h1>
        <div className="mono text-[13px] text-shade-50 mt-2">
          {formatAddress(address, { head: 6, tail: 4 })} · Mantle Sepolia
          {!viewingSelf && connectedAddress && (
            <>
              {" "}
              ·{" "}
              <button
                type="button"
                onClick={() =>
                  router.replace(`/portfolio/${connectedAddress}`)
                }
                className="underline underline-offset-2 hover:text-ink"
              >
                view your own ↗
              </button>
            </>
          )}
        </div>

        <SummaryStats
          totalValueUsdc={data.totalValueUsdc}
          unclaimedDividendsUsdc={totalUnclaimedDividendsUsdc.toString()}
          dividendAgents={dividends.length}
          dividendEpochs={epochsCount}
          pendingRedemptions={pendingRedemptionsCount}
          nextUnlockSeconds={nextUnlockSeconds}
          holdingsCount={holdings.length}
          founderCount={founderVaults.length}
        />

        {readOnlyDisconnected && <ReadOnlyConnectBanner />}
        {connectedAddress && !viewingSelf && (
          <DifferentWalletBanner
            connectedAddress={connectedAddress}
            onSwitch={() => router.replace(`/portfolio/${connectedAddress}`)}
          />
        )}
      </section>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-hairline-light">
        {TABS.map((t) => {
          const counts: Record<TabKey, number> = {
            holdings: holdings.length,
            dividends: dividends.length,
            redemptions: redemptions.length,
            founder: founderVaults.length,
          };
          return (
            <TabBtn
              key={t.key}
              label={t.label}
              count={counts[t.key]}
              active={tab === t.key}
              onClick={() => setTab(t.key)}
            />
          );
        })}
      </div>

      {/* Tab content */}
      <div className="pt-8 pb-20">
        {tab === "holdings" && (
          <HoldingsTab holdings={holdings} viewingSelf={viewingSelf} />
        )}
        {tab === "dividends" && (
          <DividendsTab
            dividends={dividends}
            viewingSelf={viewingSelf}
            onChange={refetch}
          />
        )}
        {tab === "redemptions" && (
          <RedemptionsTab
            redemptions={redemptions}
            viewingSelf={viewingSelf}
            onChange={refetch}
          />
        )}
        {tab === "founder" && (
          <FounderTab
            founderVaults={founderVaults}
            viewingSelf={viewingSelf}
            onChange={refetch}
          />
        )}
      </div>
    </main>
  );
}

/* ─────────── Summary stats ─────────── */

function SummaryStats({
  totalValueUsdc,
  unclaimedDividendsUsdc,
  dividendAgents,
  dividendEpochs,
  pendingRedemptions,
  nextUnlockSeconds,
  holdingsCount,
  founderCount,
}: {
  totalValueUsdc: string;
  unclaimedDividendsUsdc: string;
  dividendAgents: number;
  dividendEpochs: number;
  pendingRedemptions: number;
  nextUnlockSeconds: number | null;
  holdingsCount: number;
  founderCount: number;
}) {
  return (
    <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-y-5 rounded-[12px] border border-hairline-light bg-canvas-light p-6">
      <SumStat
        label="Total value"
        value={formatUsdc(totalValueUsdc, {
          withSymbol: true,
          decimals: 2,
        })}
        sub="across all agents"
      />
      <SumStat
        label="Unclaimed dividends"
        value={formatUsdc(unclaimedDividendsUsdc, {
          withSymbol: true,
          decimals: 2,
        })}
        sub={
          dividendEpochs > 0
            ? `across ${dividendAgents} agent${dividendAgents !== 1 ? "s" : ""} · ${dividendEpochs} epoch${dividendEpochs !== 1 ? "s" : ""}`
            : "no claimable epochs"
        }
      />
      <SumStat
        label="Pending redemptions"
        value={pendingRedemptions.toString()}
        sub={
          nextUnlockSeconds
            ? `next unlock ${formatRelative(nextUnlockSeconds)}`
            : "no pending requests"
        }
      />
      <SumStat
        label="Active holdings"
        value={holdingsCount.toString()}
        sub={
          founderCount > 0
            ? `+ ${founderCount} founder position${founderCount !== 1 ? "s" : ""}`
            : "in 0 founder agents"
        }
      />
    </div>
  );
}

function SumStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="px-4 sm:border-r sm:border-hairline-soft sm:last:border-r-0 sm:first:pl-0 sm:last:pr-0">
      <div className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-shade-50 mb-2">
        {label}
      </div>
      <div className="mono text-[24px] font-medium tabular-nums leading-none text-ink">
        {value}
      </div>
      <div className="mono text-[12.5px] text-shade-50 mt-1.5">{sub}</div>
    </div>
  );
}

/* ─────────── Connect banners ─────────── */

function ReadOnlyConnectBanner() {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-hairline-light bg-canvas-light px-5 py-4">
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-ink mb-0.5">
          Read-only view
        </div>
        <div className="text-[12.5px] text-shade-50">
          Connect a wallet to claim dividends, manage redemptions, or
          act on founder positions.
        </div>
      </div>
      <ConnectButton showBalance={false} />
    </div>
  );
}

function DifferentWalletBanner({
  connectedAddress,
  onSwitch,
}: {
  connectedAddress: string;
  onSwitch: () => void;
}) {
  return (
    <div
      className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border px-5 py-4"
      style={{
        borderColor: "var(--wd-border)",
        background: "var(--orange-bg)",
        color: "var(--wd-text)",
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium mb-0.5">
          Viewing someone else&apos;s portfolio
        </div>
        <div
          className="text-[12.5px]"
          style={{ color: "var(--wd-sub)" }}
        >
          Connected wallet is{" "}
          <span className="mono">
            {formatAddress(connectedAddress)}
          </span>{" "}
          — actions on this portfolio are disabled.
        </div>
      </div>
      <Button variant="outline-light" size="sm" onClick={onSwitch}>
        Switch to my portfolio
      </Button>
    </div>
  );
}

/* ─────────── Tab buttons ─────────── */

function TabBtn({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-[18px] py-2.5 text-[14.5px] font-medium",
        "border-b-2 -mb-px transition-colors duration-[120ms]",
        active
          ? "border-ink text-ink"
          : "border-transparent text-shade-50 hover:text-ink",
      )}
    >
      {label}
      <span
        className={cn(
          "mono rounded-full px-[7px] py-[2px] text-[11px] font-medium",
          active ? "bg-aloe-10 text-ink" : "bg-canvas-soft text-shade-60",
        )}
      >
        {count}
      </span>
    </button>
  );
}

/* ─────────── Holdings tab ─────────── */

function HoldingsTab({
  holdings,
  viewingSelf,
}: {
  holdings: PortfolioPosition[];
  viewingSelf: boolean;
}) {
  if (holdings.length === 0) {
    return (
      <EmptyState
        title="No holdings yet"
        body={
          viewingSelf ? (
            <>
              Mint your first AGT to start earning yield.{" "}
              <Link href="/" className="underline hover:text-ink">
                Browse agents →
              </Link>
            </>
          ) : (
            "This wallet holds no AGT positions."
          )
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {holdings.map((h) => (
        <HoldingRow key={h.agentId} h={h} />
      ))}
    </div>
  );
}

function HoldingRow({ h }: { h: PortfolioPosition }) {
  const pnl = h.unrealizedPnlUsdc ? BigInt(h.unrealizedPnlUsdc) : 0n;
  const positivePnl = pnl > 0n;
  const hasPnl = !!h.unrealizedPnlUsdc;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto] gap-4 items-center rounded-[12px] border border-hairline-light bg-canvas-light px-6 py-5">
      <div className="flex flex-col gap-0.5">
        <div className="font-display text-[22px] font-light leading-[1.1] text-ink">
          {h.agentName}
        </div>
        <div className="mono text-[11.5px] text-shade-50">
          ${h.ticker} · #{String(h.agentId).padStart(3, "0")}
        </div>
      </div>
      <MiniStat label="Shares" value={formatShares(h.shares)} />
      <MiniStat
        label="Value"
        value={formatUsdc(h.valueUsdc, { withSymbol: true })}
      />
      <MiniStat
        label="Weight"
        value={`${(h.weightBps / 100).toFixed(2)}%`}
        sub={
          hasPnl ? (
            <span
              className={cn(
                "mono text-[11.5px]",
                positivePnl
                  ? "text-emerald-helm"
                  : pnl < 0n
                    ? "text-red-helm"
                    : "text-shade-50",
              )}
            >
              {positivePnl ? "+" : ""}
              {formatUsdc(pnl.toString(), { withSymbol: true })}
            </span>
          ) : null
        }
      />
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <Link href={`/agents/${h.agentId}`}>
          <Button variant="outline-light" size="sm">
            View
          </Button>
        </Link>
        <Link href={`/agents/${h.agentId}?action=mint`}>
          <Button variant="aloe" size="sm">
            Mint more
          </Button>
        </Link>
        <Link href={`/agents/${h.agentId}?action=redeem`}>
          <Button variant="primary" size="sm">
            Redeem
          </Button>
        </Link>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-shade-50">
        {label}
      </div>
      <div className="mono text-[16px] font-medium tabular-nums text-ink">
        {value}
      </div>
      {sub && <div className="mt-0.5">{sub}</div>}
    </div>
  );
}

/* ─────────── Dividends tab ─────────── */

function DividendsTab({
  dividends,
  viewingSelf,
  onChange,
}: {
  dividends: DividendClaim[];
  viewingSelf: boolean;
  onChange: () => void;
}) {
  const total = dividends.reduce(
    (s, d) => s + BigInt(d.claimableAmountUsdc || "0"),
    0n,
  );

  if (dividends.length === 0) {
    return (
      <EmptyState
        title="No claimable dividends"
        body="When agents distribute yield, your share will show up here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between pb-2">
        <div className="text-[13.5px] text-shade-50">
          Total claimable ·{" "}
          <span className="mono text-ink font-medium">
            {formatUsdc(total.toString(), {
              withSymbol: true,
              decimals: 2,
            })}
          </span>
        </div>
        {viewingSelf && (
          <ClaimAllDividendsButton
            dividends={dividends}
            onChange={onChange}
          />
        )}
      </div>
      {dividends.map((d) => (
        <DividendRow
          key={d.agentId}
          d={d}
          viewingSelf={viewingSelf}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function DividendRow({
  d,
  viewingSelf,
  onChange,
}: {
  d: DividendClaim;
  viewingSelf: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[12px] border border-hairline-light bg-canvas-light px-6 py-5">
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="font-display text-[22px] font-light leading-[1.1] text-ink">
          {d.agentName}
        </div>
        <div className="mono text-[11px] text-shade-50">
          ${d.ticker} · {d.claimableEpochs.length} epoch
          {d.claimableEpochs.length !== 1 ? "s" : ""} (#
          {d.claimableEpochs.join(", #")})
        </div>
      </div>
      <div className="mono text-[22px] font-medium tabular-nums text-ink">
        {formatUsdc(d.claimableAmountUsdc, {
          withSymbol: true,
          decimals: 2,
        })}
      </div>
      {viewingSelf && (
        <DividendClaimButton d={d} onChange={onChange} />
      )}
    </div>
  );
}

function DividendClaimButton({
  d,
  onChange,
}: {
  d: DividendClaim;
  onChange: () => void;
}) {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { push: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const onCorrectChain = useOnCorrectChain();

  async function onClaim() {
    if (!publicClient || !onCorrectChain) return;
    setBusy(true);
    try {
      const epochs = d.claimableEpochs.map((e) => BigInt(e));
      const hash = await writeContractAsync({
        address: CONTRACTS.distributor as `0x${string}`,
        abi: DISTRIBUTOR_ABI,
        functionName: "claim",
        args: [BigInt(d.agentId), epochs],
      });
      await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 90_000,
        pollingInterval: 2_000,
      });
      toast({
        msg: `Claimed ${formatUsdc(d.claimableAmountUsdc, {
          withSymbol: true,
          decimals: 2,
        })} from $${d.ticker}`,
        tx: hash,
      });
      onChange();
    } catch (e) {
      const { message } = decodeContractError(e);
      toast({ msg: `Claim failed — ${message}`, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline-light"
      size="sm"
      onClick={onClaim}
      disabled={busy || !onCorrectChain}
    >
      {busy ? "Claiming…" : "Claim"}
    </Button>
  );
}

function ClaimAllDividendsButton({
  dividends,
  onChange,
}: {
  dividends: DividendClaim[];
  onChange: () => void;
}) {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { push: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const onCorrectChain = useOnCorrectChain();

  async function onClaimAll() {
    if (!publicClient || !onCorrectChain) return;
    setBusy(true);
    try {
      let lastHash: `0x${string}` | null = null;
      for (const d of dividends) {
        const epochs = d.claimableEpochs.map((e) => BigInt(e));
        const hash = await writeContractAsync({
          address: CONTRACTS.distributor as `0x${string}`,
          abi: DISTRIBUTOR_ABI,
          functionName: "claim",
          args: [BigInt(d.agentId), epochs],
        });
        lastHash = hash;
        await publicClient.waitForTransactionReceipt({
          hash,
          timeout: 90_000,
          pollingInterval: 2_000,
        });
      }
      const total = dividends.reduce(
        (s, d) => s + BigInt(d.claimableAmountUsdc || "0"),
        0n,
      );
      toast({
        msg: `Claimed ${formatUsdc(total.toString(), {
          withSymbol: true,
          decimals: 2,
        })} from ${dividends.length} agent${dividends.length !== 1 ? "s" : ""}`,
        tx: lastHash ?? undefined,
      });
      onChange();
    } catch (e) {
      const { message } = decodeContractError(e);
      toast({ msg: `Claim all failed — ${message}`, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="aloe"
      size="sm"
      onClick={onClaimAll}
      disabled={busy || !onCorrectChain || dividends.length === 0}
    >
      {busy ? "Claiming…" : "Claim all"}
    </Button>
  );
}

/* ─────────── Redemptions tab ─────────── */

function RedemptionsTab({
  redemptions,
  viewingSelf,
  onChange,
}: {
  redemptions: RedemptionRequest[];
  viewingSelf: boolean;
  onChange: () => void;
}) {
  if (redemptions.length === 0) {
    return (
      <EmptyState
        title="No redemption requests"
        body="When you queue a redemption, it'll show up here with a live countdown."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {redemptions.map((r) => (
        <RedemptionRow
          key={r.requestId}
          r={r}
          viewingSelf={viewingSelf}
          onChange={onChange}
        />
      ))}
      <p className="text-[12.5px] text-shade-50 text-center mt-3 leading-[1.5]">
        Claim becomes available when the countdown hits zero. Cancel is
        allowed up to 1 day before the unlock window.
      </p>
    </div>
  );
}

function RedemptionRow({
  r,
  viewingSelf,
  onChange,
}: {
  r: RedemptionRequest;
  viewingSelf: boolean;
  onChange: () => void;
}) {
  const remaining = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const diff = r.unlockAt - now;
    if (diff <= 0) return { d: 0, h: 0, m: 0 };
    return {
      d: Math.floor(diff / 86400),
      h: Math.floor((diff % 86400) / 3600),
      m: Math.floor((diff % 3600) / 60),
    };
  }, [r.unlockAt]);

  const isClaimable = r.status === "Claimable" || remaining.d + remaining.h + remaining.m === 0;
  const isClaimed = r.status === "Claimed";
  const isCancelled = r.status === "Cancelled";
  const isFinal = isClaimed || isCancelled;
  const tierLabel = r.tier === "instant" ? "instant" : `${lockupTierLabel(r.tier)} lockup`;

  // Cancel window closes 1 day before unlock — matches the on-chain
  // RedemptionQueue.cancel() guard. Disabling here prevents the user from
  // submitting a tx that we know will revert with CancelWindowClosed.
  const now = Math.floor(Date.now() / 1000);
  const cancelWindowClosed = r.unlockAt > 0 && now >= r.unlockAt - 86_400;
  const cancelDisabled = isClaimable || cancelWindowClosed;
  const cancelHint = cancelWindowClosed
    ? "Cancel window closed (<1 day to unlock) — just claim once it unlocks."
    : isClaimable
      ? "Already unlocked — claim instead."
      : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[12px] border border-hairline-light bg-canvas-light px-6 py-5">
      <div className="flex-1 min-w-[200px] flex flex-col gap-1">
        <div className="font-display text-[22px] font-light leading-[1.1] text-ink">
          {r.agentName}
        </div>
        <div className="mono text-[11px] text-shade-50">
          Request #{r.requestId} · {tierLabel} · queued ~{" "}
          {formatUsdc(r.estimatedUsdc, {
            withSymbol: true,
            decimals: 2,
          })}
          {isClaimed && " · claimed"}
          {isCancelled && " · cancelled"}
        </div>
      </div>

      {!isFinal && (
        <div className="flex gap-4 mono tabular-nums">
          <CountdownCell num={remaining.d} label="days" />
          <CountdownCell num={remaining.h} label="hrs" />
          <CountdownCell num={remaining.m} label="min" />
        </div>
      )}

      {viewingSelf && !isFinal && (
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <RedemptionCancelButton
              requestId={r.requestId}
              disabled={cancelDisabled}
              hint={cancelHint ?? undefined}
              onChange={onChange}
            />
            <RedemptionClaimButton
              requestId={r.requestId}
              disabled={!isClaimable}
              onChange={onChange}
            />
          </div>
          {cancelHint && (
            <span className="text-[11px] text-shade-50 max-w-[220px] text-right">
              {cancelHint}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CountdownCell({ num, label }: { num: number; label: string }) {
  return (
    <div className="flex flex-col items-center min-w-[36px]">
      <div className="text-[20px] font-medium leading-none text-ink">
        {String(num).padStart(2, "0")}
      </div>
      <div className="text-[9.5px] font-medium uppercase tracking-[0.06em] text-shade-50 mt-0.5">
        {label}
      </div>
    </div>
  );
}

function RedemptionCancelButton({
  requestId,
  disabled,
  hint,
  onChange,
}: {
  requestId: number;
  disabled: boolean;
  hint?: string;
  onChange: () => void;
}) {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { push: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const onCorrectChain = useOnCorrectChain();

  async function onCancel() {
    if (!publicClient || !onCorrectChain) return;
    if (!confirm(`Cancel redemption request #${requestId}?`)) return;
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.redemptionQueue as `0x${string}`,
        abi: QUEUE_ABI,
        functionName: "cancel",
        args: [BigInt(requestId)],
      });
      await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 90_000,
        pollingInterval: 2_000,
      });
      toast({ msg: `Redemption #${requestId} cancelled`, tx: hash });
      onChange();
    } catch (e) {
      const { message } = decodeContractError(e);
      toast({ msg: `Cancel failed — ${message}`, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline-light"
      size="sm"
      onClick={onCancel}
      disabled={disabled || busy || !onCorrectChain}
      title={hint}
    >
      {busy ? "…" : "Cancel"}
    </Button>
  );
}

function RedemptionClaimButton({
  requestId,
  disabled,
  onChange,
}: {
  requestId: number;
  disabled: boolean;
  onChange: () => void;
}) {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { push: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const onCorrectChain = useOnCorrectChain();

  async function onClaim() {
    if (!publicClient || !onCorrectChain) return;
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.redemptionQueue as `0x${string}`,
        abi: QUEUE_ABI,
        functionName: "claim",
        args: [BigInt(requestId)],
      });
      await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 90_000,
        pollingInterval: 2_000,
      });
      toast({ msg: `Redemption #${requestId} claimed`, tx: hash });
      onChange();
    } catch (e) {
      const { message } = decodeContractError(e);
      toast({ msg: `Claim failed — ${message}`, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="primary"
      size="sm"
      onClick={onClaim}
      disabled={disabled || busy || !onCorrectChain}
    >
      {busy ? "Claiming…" : "Claim"}
    </Button>
  );
}

/* ─────────── Founder tab ─────────── */

function FounderTab({
  founderVaults,
  viewingSelf,
  onChange,
}: {
  founderVaults: FounderVaultPosition[];
  viewingSelf: boolean;
  onChange: () => void;
}) {
  if (founderVaults.length === 0) {
    return (
      <EmptyState
        title="No founder positions"
        body={
          viewingSelf ? (
            <>
              You haven&apos;t launched an agent yet.{" "}
              <Link href="/register" className="underline hover:text-ink">
                Launch one →
              </Link>
            </>
          ) : (
            "This wallet has not launched any agents."
          )
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {founderVaults.map((fv) => (
        <FounderRow
          key={fv.agentId}
          fv={fv}
          viewingSelf={viewingSelf}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function FounderRow({
  fv,
  viewingSelf,
  onChange,
}: {
  fv: FounderVaultPosition;
  viewingSelf: boolean;
  onChange: () => void;
}) {
  const now = Math.floor(Date.now() / 1000);
  const lockupActive = fv.lockupEndsAt > now;
  const carryBalance = BigInt(fv.carryBalanceUsdc || "0");
  const hasCarry = carryBalance > 0n;
  const withdrawnPct = fv.cumulativeWithdrawnBps / 100;

  return (
    <div className="rounded-[12px] border border-hairline-light bg-canvas-light px-6 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <div>
          <div className="font-display text-[24px] font-light leading-[1.1] text-ink">
            {fv.agentName}
          </div>
          <div className="mono text-[11.5px] text-shade-50 mt-0.5">
            Agent #{String(fv.agentId).padStart(3, "0")} · vault{" "}
            {formatAddress(fv.vaultAddress)}
          </div>
        </div>
        <Link href={`/agents/${fv.agentId}`}>
          <Button variant="outline-light" size="sm">
            View agent
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-4 py-4 border-y border-hairline-soft">
        <MiniStat
          label="Locked shares"
          value={formatShares(fv.sharesLocked)}
        />
        <MiniStat
          label="Lockup ends"
          value={
            lockupActive
              ? formatRelative(fv.lockupEndsAt)
              : "expired"
          }
          sub={
            <span
              className={cn(
                "mono text-[11.5px]",
                lockupActive ? "text-amber-helm" : "text-emerald-helm",
              )}
            >
              {lockupActive ? "locked" : "unlocked"}
            </span>
          }
        />
        <MiniStat
          label="Carry balance"
          value={formatUsdc(fv.carryBalanceUsdc, {
            withSymbol: true,
            decimals: 2,
          })}
        />
        <MiniStat
          label="Withdrawn"
          value={`${withdrawnPct.toFixed(1)}%`}
          sub={
            <span className="mono text-[11.5px] text-shade-50">
              of 40.00% cap
            </span>
          }
        />
      </div>

      {viewingSelf && (
        <div className="flex flex-wrap gap-2 mt-4">
          <FounderWithdrawButton
            fv={fv}
            disabled={lockupActive}
            onChange={onChange}
          />
          <FounderDepositMoreButton
            fv={fv}
            tokenAddress={fv.vaultAddress /* AgentVault is AGT receiver */}
            onChange={onChange}
          />
          <FounderClaimCarryButton
            vaultAddress={fv.founderVaultAddress}
            disabled={!hasCarry}
            onChange={onChange}
          />
          <FounderTriggerWindDownButton
            vaultAddress={fv.founderVaultAddress}
            agentName={fv.agentName}
            onChange={onChange}
          />
          {lockupActive && (
            <span className="text-[12px] text-shade-50 self-center w-full sm:w-auto">
              · Withdrawals unlock {formatRelative(fv.lockupEndsAt)}
            </span>
          )}
        </div>
      )}

      {fv.isSubordinationActive && (
        <div
          className="mt-3 rounded-[8px] bg-pistachio px-3 py-2 text-[11.5px]"
          style={{ color: "var(--pistachio-text-strong)" }}
        >
          Subordination active — founder settles after senior holders during
          wind-down.
        </div>
      )}
    </div>
  );
}

function FounderWithdrawButton({
  fv,
  disabled,
  onChange,
}: {
  fv: FounderVaultPosition;
  disabled: boolean;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline-light"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        Withdraw shares
      </Button>
      <FounderShareModal
        mode="withdraw"
        fv={fv}
        open={open}
        onClose={() => setOpen(false)}
        onChange={onChange}
      />
    </>
  );
}

function FounderDepositMoreButton({
  fv,
  onChange,
}: {
  fv: FounderVaultPosition;
  tokenAddress: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline-light"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Deposit shares
      </Button>
      <FounderShareModal
        mode="deposit"
        fv={fv}
        open={open}
        onClose={() => setOpen(false)}
        onChange={onChange}
      />
    </>
  );
}

function FounderShareModal({
  mode,
  fv,
  open,
  onClose,
  onChange,
}: {
  mode: "withdraw" | "deposit";
  fv: FounderVaultPosition;
  open: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { push: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const onCorrectChain = useOnCorrectChain();

  // Look up the AgentToken address from the FounderVault.
  const { data: agentTokenAddress } = useReadContract({
    address: fv.founderVaultAddress as `0x${string}`,
    abi: parseAbi(["function agentToken() view returns (address)"]),
    functionName: "agentToken",
    query: { enabled: open },
  });

  // For deposit: founder's AGT balance + allowance (toward FounderVault).
  const { data: agtBalance } = useReadContract({
    address: agentTokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: open && mode === "deposit" && !!agentTokenAddress && !!address },
  });
  const { data: agtAllowance, refetch: refetchAllowance } = useReadContract({
    address: agentTokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args:
      address && agentTokenAddress
        ? [address, fv.founderVaultAddress as `0x${string}`]
        : undefined,
    query: { enabled: open && mode === "deposit" && !!agentTokenAddress && !!address },
  });

  const amount = useMemo(() => {
    const t = input.trim();
    if (!t) return null;
    try {
      const v = parseUnits(t, AGT_DECIMALS);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [input]);

  // Compute withdraw-cap headroom for "withdraw" mode.
  const lockedShares = BigInt(fv.sharesLocked || "0");
  const usedBps = fv.cumulativeWithdrawnBps;
  const remainingBps = Math.max(0, FOUNDER_WITHDRAW_CAP_BPS - usedBps);
  const remainingPct = remainingBps / 100;

  function close() {
    if (busy) return;
    onClose();
    setInput("");
  }

  async function run() {
    if (!amount || !publicClient || !onCorrectChain) return;
    setBusy(true);
    try {
      if (mode === "deposit") {
        if (!agentTokenAddress) {
          toast({ msg: "Agent token unresolved", variant: "error" });
          setBusy(false);
          return;
        }
        // 1. approve if needed
        if ((agtAllowance ?? 0n) < amount) {
          const approveHash = await writeContractAsync({
            address: agentTokenAddress,
            abi: erc20Abi,
            functionName: "approve",
            args: [fv.founderVaultAddress as `0x${string}`, amount],
          });
          await publicClient.waitForTransactionReceipt({
            hash: approveHash,
            timeout: 90_000,
            pollingInterval: 2_000,
          });
          refetchAllowance();
        }
        // 2. deposit
        const hash = await writeContractAsync({
          address: fv.founderVaultAddress as `0x${string}`,
          abi: FOUNDER_VAULT_ABI,
          functionName: "depositFounderShares",
          args: [amount],
        });
        await publicClient.waitForTransactionReceipt({
          hash,
          timeout: 90_000,
          pollingInterval: 2_000,
        });
        toast({ msg: `Deposited ${input.trim()} shares to FounderVault`, tx: hash });
      } else {
        // withdraw
        const hash = await writeContractAsync({
          address: fv.founderVaultAddress as `0x${string}`,
          abi: FOUNDER_VAULT_ABI,
          functionName: "withdraw",
          args: [amount],
        });
        await publicClient.waitForTransactionReceipt({
          hash,
          timeout: 90_000,
          pollingInterval: 2_000,
        });
        toast({ msg: `Withdrew ${input.trim()} shares`, tx: hash });
      }
      onChange();
      onClose();
      setInput("");
    } catch (e) {
      const { message } = decodeContractError(e);
      toast({
        msg: `${mode === "deposit" ? "Deposit" : "Withdraw"} failed — ${message}`,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const isDeposit = mode === "deposit";
  const title = isDeposit ? "Deposit founder shares" : "Withdraw founder shares";
  const validInput = !!amount;
  const balanceTooLow =
    isDeposit && agtBalance !== undefined && amount && amount > agtBalance;

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      dismissible={!busy}
      footer={
        <>
          <Button
            variant="outline-light"
            size="md"
            className="flex-1"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            className="flex-1"
            onClick={run}
            disabled={busy || !validInput || !!balanceTooLow || !onCorrectChain}
          >
            {busy
              ? "Submitting…"
              : balanceTooLow
                ? "Balance too low"
                : isDeposit
                  ? "Approve & deposit"
                  : "Withdraw"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] text-shade-60 leading-[1.5]">
          {isDeposit
            ? `Send additional AGT shares into the FounderVault. They become subject to the founder lockup + subordination invariants.`
            : `Withdraw shares from the FounderVault back to your wallet. Hard-capped at ${FOUNDER_WITHDRAW_CAP_BPS / 100}% cumulative.`}
        </p>

        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-shade-50 mb-2">
            Shares
          </div>
          <div className="flex items-center gap-3 rounded-[8px] px-4 py-4 bg-canvas-cream border border-hairline-light focus-within:border-ink transition-colors">
            <input
              type="text"
              inputMode="decimal"
              value={input}
              onChange={(e) =>
                setInput(e.target.value.replace(/[^0-9.]/g, ""))
              }
              placeholder="0.00"
              autoFocus
              className="flex-1 min-w-0 bg-transparent border-0 outline-none mono tabular-nums text-[24px] font-medium leading-none placeholder:text-shade-40"
            />
            <span className="text-[13px] font-medium text-shade-50">AGT</span>
          </div>
        </div>

        <div className="rounded-[8px] bg-canvas-cream p-4 flex flex-col gap-2 text-[13px]">
          {isDeposit ? (
            <>
              <Row
                label="Wallet AGT balance"
                value={
                  agtBalance !== undefined ? formatShares(agtBalance.toString()) : "—"
                }
              />
              <Row
                label="Currently locked"
                value={formatShares(lockedShares.toString())}
              />
              <Row
                label="Allowance"
                value={
                  agtAllowance !== undefined
                    ? formatShares(agtAllowance.toString())
                    : "—"
                }
                muted
              />
            </>
          ) : (
            <>
              <Row
                label="Currently locked"
                value={formatShares(lockedShares.toString())}
              />
              <Row
                label="Cumulative withdrawn"
                value={`${(usedBps / 100).toFixed(2)}%`}
              />
              <Row
                label="Remaining cap"
                value={`${remainingPct.toFixed(2)}%`}
                muted={remainingBps === 0}
              />
            </>
          )}
        </div>

        {!isDeposit && (
          <p
            className="rounded-[8px] bg-pistachio px-3 py-2 text-[11.5px]"
            style={{ color: "var(--pistachio-text-strong)" }}
          >
            Withdrawals above the cap revert. Subordination keeps your remaining
            stake settling last during wind-down.
          </p>
        )}
      </div>
    </Modal>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-shade-50">{label}</span>
      <span className={cn("mono tabular-nums", muted ? "text-shade-50" : "text-ink")}>
        {value}
      </span>
    </div>
  );
}

function FounderTriggerWindDownButton({
  vaultAddress,
  agentName,
  onChange,
}: {
  vaultAddress: string;
  agentName: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { push: toast } = useToast();
  const onCorrectChain = useOnCorrectChain();

  const confirmPhrase = "wind down";

  async function run() {
    if (!publicClient || !onCorrectChain) return;
    if (!reason.trim()) {
      toast({ msg: "Provide a reason", variant: "error" });
      return;
    }
    if (confirmText.trim().toLowerCase() !== confirmPhrase) {
      toast({ msg: `Type "${confirmPhrase}" to confirm`, variant: "error" });
      return;
    }
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: vaultAddress as `0x${string}`,
        abi: FOUNDER_VAULT_ABI,
        functionName: "triggerWindDown",
        args: [reason.trim()],
      });
      await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 90_000,
        pollingInterval: 2_000,
      });
      toast({ msg: `${agentName} wind-down triggered`, tx: hash });
      onChange();
      setOpen(false);
      setReason("");
      setConfirmText("");
    } catch (e) {
      const { message } = decodeContractError(e);
      toast({ msg: `Wind-down failed — ${message}`, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="danger"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Trigger wind-down
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Trigger wind-down"
        dismissible={!busy}
        footer={
          <>
            <Button
              variant="outline-light"
              size="md"
              className="flex-1"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              className="flex-1"
              onClick={run}
              disabled={
                busy ||
                !reason.trim() ||
                confirmText.trim().toLowerCase() !== confirmPhrase
              }
            >
              {busy ? "Triggering…" : "Confirm wind-down"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div
            className="rounded-[8px] border border-red-helm/30 bg-red-bg/10 p-3 text-[13px]"
            style={{ color: "var(--phase-slashed-text)" }}
          >
            <strong className="block mb-1">Irreversible.</strong>
            This stops accepting new deposits, enters senior-priority redemption
            mode, and starts the {SENIOR_WINDOW_DAYS}-day settlement window.
            Founder shares settle last.
          </div>

          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-shade-50 mb-2">
              Reason (recorded on-chain)
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. mandate drift, market shock, founder exit"
              className="w-full min-h-[90px] rounded-[8px] border border-hairline-light bg-canvas-cream px-3 py-2 text-[14px] leading-[1.5] outline-none focus:border-ink resize-y"
            />
          </div>

          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-shade-50 mb-2">
              Type &quot;{confirmPhrase}&quot; to confirm
            </div>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmPhrase}
              className="w-full rounded-[8px] border border-hairline-light bg-canvas-cream px-3 py-2 mono text-[14px] outline-none focus:border-ink"
            />
          </div>
        </div>
      </Modal>
    </>
  );
}

const SENIOR_WINDOW_DAYS = 90;

function FounderClaimCarryButton({
  vaultAddress,
  disabled,
  onChange,
}: {
  vaultAddress: string;
  disabled: boolean;
  onChange: () => void;
}) {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { push: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const onCorrectChain = useOnCorrectChain();

  async function onClaim() {
    if (!publicClient || !onCorrectChain) return;
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: vaultAddress as `0x${string}`,
        abi: FOUNDER_VAULT_ABI,
        functionName: "claimCarry",
        args: [],
      });
      await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 90_000,
        pollingInterval: 2_000,
      });
      toast({ msg: "Carry claimed", tx: hash });
      onChange();
    } catch (e) {
      const { message } = decodeContractError(e);
      toast({ msg: `Carry claim failed — ${message}`, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="aloe"
      size="sm"
      onClick={onClaim}
      disabled={disabled || busy || !onCorrectChain}
    >
      {busy ? "…" : "Claim carry"}
    </Button>
  );
}

/* ─────────── Shared atoms ─────────── */

function PortfolioSkeleton() {
  return (
    <main className="mx-auto max-w-[1440px] px-4 sm:px-8 py-12">
      <div className="h-5 w-24 animate-pulse rounded bg-hairline-light" />
      <div className="mt-3 h-12 w-2/3 animate-pulse rounded bg-hairline-light" />
      <div className="mt-3 h-4 w-1/3 animate-pulse rounded bg-hairline-light" />
      <div className="mt-8 h-32 animate-pulse rounded-[12px] bg-hairline-light" />
      <div className="mt-10 h-8 w-2/3 animate-pulse rounded bg-hairline-light" />
      <div className="mt-6 grid gap-2">
        <div className="h-24 animate-pulse rounded-[12px] bg-hairline-light" />
        <div className="h-24 animate-pulse rounded-[12px] bg-hairline-light" />
        <div className="h-24 animate-pulse rounded-[12px] bg-hairline-light" />
      </div>
    </main>
  );
}

/* ─────────── Hooks ─────────── */

function useOnCorrectChain(): boolean {
  const chainId = useChainId();
  return chainId === mantleSepolia.id;
}
