"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  decodeEventLog,
  erc20Abi,
  formatUnits,
  parseAbi,
  parseUnits,
} from "viem";
import { mantleSepolia, CONTRACTS } from "@/lib/wagmi";
import {
  AGT_DECIMALS,
  BPS_SCALE,
  FEE_RATES,
  LockupTier,
} from "@/lib/contracts-constants";
import { decodeContractError } from "@/lib/decodeError";
import { waitForTx } from "@/lib/waitForTx";
import { formatDate, formatRelative, formatUsdc } from "@/lib/format";
import { Button, Modal, Stepper, StepRow } from "@/components/ui";
import type { StepStatus } from "@/components/ui";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import type { components } from "@/lib/api-types.gen";

type AgentDetail = components["schemas"]["AgentDetail"];

const QUEUE_ABI = parseAbi([
  "function requestRedeem(uint256 agentId, uint256 shares, uint8 tier) returns (uint256 requestId)",
  "event RedeemRequested(uint256 indexed requestId, uint256 indexed agentId, address indexed holder, uint256 shares, uint8 tier, uint64 unlockAt)",
]);

type TierDef = {
  enum: LockupTier;
  beValue: "instant" | "30d" | "60d" | "90d";
  days: number;
  label: string;
  blurb: string;
};

const TIERS: TierDef[] = [
  { enum: LockupTier.Instant, beValue: "instant", days: 0,  label: "Instant", blurb: "No lockup, lowest yield" },
  { enum: LockupTier.Day30,   beValue: "30d",     days: 30, label: "30 days", blurb: "Balanced" },
  { enum: LockupTier.Day60,   beValue: "60d",     days: 60, label: "60 days", blurb: "Premium tier" },
  { enum: LockupTier.Day90,   beValue: "90d",     days: 90, label: "90 days", blurb: "Highest reputation premium" },
];

type Stage = "input" | "running" | "done";

type StepInfo = {
  status: StepStatus;
  txHash?: `0x${string}`;
  errorMsg?: string;
};

const INITIAL_STEPS: Record<"approve" | "request", StepInfo> = {
  approve: { status: "idle" },
  request: { status: "idle" },
};

interface RedeemModalProps {
  agent: AgentDetail;
  open: boolean;
  onClose: () => void;
}

export function RedeemModal({ agent, open, onClose }: RedeemModalProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const onCorrectChain = chainId === mantleSepolia.id;
  const { switchChain, isPending: switching } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { push: toast } = useToast();

  const tokenAddress = agent.tokenAddress as `0x${string}`;
  const navPerShare = agent.navPerShareUsdc ? BigInt(agent.navPerShareUsdc) : 0n;

  /* ─── Balance + allowance ─── */
  const { data: agtBalance, refetch: refetchAgt } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: open && !!address, refetchInterval: 15_000 },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: address
      ? [address, CONTRACTS.redemptionQueue as `0x${string}`]
      : undefined,
    query: { enabled: open && !!address },
  });

  /* ─── Form ─── */
  const defaultTier = useMemo(
    () =>
      TIERS.find((t) => agent.allowedLockups?.includes(t.beValue)) ?? null,
    [agent.allowedLockups],
  );
  const [tier, setTier] = useState<TierDef | null>(defaultTier);
  const [sharesInput, setSharesInput] = useState("");
  const sharesAmount = useMemo(() => {
    const s = sharesInput.trim();
    if (!s) return null;
    try {
      const v = parseUnits(s, AGT_DECIMALS);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [sharesInput]);

  /* ─── Computed preview ─── */
  const preview = useMemo(() => {
    if (!sharesAmount || navPerShare === 0n) return null;
    const gross = (sharesAmount * navPerShare) / 10n ** 18n;
    const fee = (gross * BigInt(FEE_RATES.redeem)) / BigInt(BPS_SCALE);
    const usdcOut = gross - fee;
    return { gross, fee, usdcOut };
  }, [sharesAmount, navPerShare]);

  /* ─── Tx state ─── */
  const [stage, setStage] = useState<Stage>("input");
  const [steps, setSteps] = useState(INITIAL_STEPS);
  const [resultRequestId, setResultRequestId] = useState<bigint | null>(null);
  const [resultUnlockAt, setResultUnlockAt] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setStage("input");
      setSteps(INITIAL_STEPS);
      setResultRequestId(null);
      setResultUnlockAt(null);
      setTier(defaultTier);
    }
  }, [open, defaultTier]);

  /* ─── Validation ─── */
  const agtBal = agtBalance ?? 0n;

  const validation = useMemo(() => {
    if (!tier) return { ok: false as const, msg: "Select a lockup tier" };
    if (!agent.allowedLockups?.includes(tier.beValue))
      return { ok: false as const, msg: "Tier not allowed" };
    if (!sharesAmount) return { ok: false as const, msg: null };
    if (sharesAmount > agtBal)
      return {
        ok: false as const,
        msg: `Insufficient shares (have ${formatAgt(agtBal)})`,
      };
    return { ok: true as const, msg: null };
  }, [tier, sharesAmount, agtBal, agent.allowedLockups]);

  /* ─── Execute ─── */
  async function executeRedeem() {
    if (!sharesAmount || !address || !tier || !publicClient) return;
    setStage("running");

    /* Step 1: approve */
    try {
      if ((allowance ?? 0n) >= sharesAmount) {
        setSteps((s) => ({ ...s, approve: { status: "skipped" } }));
      } else {
        setSteps((s) => ({ ...s, approve: { status: "spinning" } }));
        const hash = await writeContractAsync({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [CONTRACTS.redemptionQueue as `0x${string}`, sharesAmount],
        });
        setSteps((s) => ({
          ...s,
          approve: { status: "spinning", txHash: hash },
        }));
        await waitForTx(publicClient!, hash);
        setSteps((s) => ({
          ...s,
          approve: { status: "done", txHash: hash },
        }));
        refetchAllowance();
      }
    } catch (e) {
      const { message } = decodeContractError(e);
      setSteps((s) => ({
        ...s,
        approve: { ...s.approve, status: "error", errorMsg: message },
      }));
      toast({ msg: `Redeem failed at approval — ${message}`, variant: "error" });
      return;
    }

    /* Step 2: requestRedeem */
    try {
      setSteps((s) => ({ ...s, request: { status: "spinning" } }));
      const hash = await writeContractAsync({
        address: CONTRACTS.redemptionQueue as `0x${string}`,
        abi: QUEUE_ABI,
        functionName: "requestRedeem",
        args: [BigInt(agent.agentId), sharesAmount, tier.enum],
      });
      setSteps((s) => ({
        ...s,
        request: { status: "spinning", txHash: hash },
      }));
      const receipt = await waitForTx(publicClient, hash);
      setSteps((s) => ({
        ...s,
        request: { status: "done", txHash: hash },
      }));

      // Parse event for request id + unlock
      for (const log of receipt.logs) {
        if (
          log.address.toLowerCase() !==
          (CONTRACTS.redemptionQueue as string).toLowerCase()
        )
          continue;
        try {
          const decoded = decodeEventLog({
            abi: QUEUE_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "RedeemRequested") {
            const args = decoded.args as unknown as {
              requestId: bigint;
              unlockAt: bigint;
            };
            setResultRequestId(args.requestId);
            setResultUnlockAt(Number(args.unlockAt));
            break;
          }
        } catch {
          // not a RedeemRequested log
        }
      }
      refetchAgt();
      setStage("done");
      toast({
        msg: `Redemption queued · ${formatAgt(sharesAmount)} ${agent.ticker} locked`,
        tx: hash,
      });
    } catch (e) {
      const { message } = decodeContractError(e);
      setSteps((s) => ({
        ...s,
        request: { ...s.request, status: "error", errorMsg: message },
      }));
      toast({ msg: `Redeem failed — ${message}`, variant: "error" });
    }
  }

  /* ─── Render ─── */
  const title =
    stage === "done"
      ? "Redemption queued"
      : stage === "running"
        ? "Requesting…"
        : `Redeem $${agent.ticker}`;
  const dismissible = stage !== "running";

  const footer = (() => {
    if (stage === "input") {
      return (
        <>
          <Button
            variant="outline-light"
            size="md"
            className="flex-1"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            className="flex-1"
            disabled={
              !validation.ok ||
              !preview ||
              !isConnected ||
              !onCorrectChain ||
              agtBal === 0n
            }
            onClick={executeRedeem}
          >
            {validation.msg ?? "Request redemption"}
          </Button>
        </>
      );
    }
    if (stage === "done") {
      return (
        <Button
          variant="primary"
          size="md"
          className="flex-1"
          onClick={onClose}
        >
          Back to portfolio
        </Button>
      );
    }
    return null;
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={footer}
      dismissible={dismissible}
    >
      {/* Pre-flight inline */}
      {!isConnected && (
        <InlineBox variant="info">
          <p className="mb-2 text-[13.5px]">Connect a wallet to redeem.</p>
          <ConnectButton />
        </InlineBox>
      )}
      {isConnected && !onCorrectChain && (
        <InlineBox variant="warn">
          <p className="mb-2 text-[13.5px]">Switch to Mantle Sepolia.</p>
          <Button
            variant="primary"
            size="sm"
            onClick={() => switchChain({ chainId: mantleSepolia.id })}
            disabled={switching}
          >
            {switching ? "Switching…" : "Switch network"}
          </Button>
        </InlineBox>
      )}
      {isConnected && onCorrectChain && agtBal === 0n && (
        <InlineBox variant="info">
          <p className="text-[13.5px]">
            You don&apos;t hold any {agent.ticker} shares yet.
          </p>
          <Link
            href={`/agents/${agent.agentId}`}
            onClick={onClose}
            className="mt-1 inline-block text-[13px] underline"
          >
            ← Back to agent
          </Link>
        </InlineBox>
      )}

      {stage === "input" && (
        <InputBody
          ticker={agent.ticker}
          allowedLockups={agent.allowedLockups ?? []}
          tier={tier}
          setTier={setTier}
          sharesInput={sharesInput}
          setSharesInput={setSharesInput}
          agtBal={agtBal}
          navPerShareUsdc={agent.navPerShareUsdc}
          preview={preview}
        />
      )}

      {(stage === "running" || stage === "done") && (
        <TxBody
          steps={steps}
          stage={stage}
          ticker={agent.ticker}
          tier={tier}
          resultRequestId={resultRequestId}
          resultUnlockAt={resultUnlockAt}
          preview={preview}
        />
      )}
    </Modal>
  );
}

/* ─────────── Sub-components ─────────── */

function InputBody({
  ticker,
  allowedLockups,
  tier,
  setTier,
  sharesInput,
  setSharesInput,
  agtBal,
  navPerShareUsdc,
  preview,
}: {
  ticker: string;
  allowedLockups: string[];
  tier: TierDef | null;
  setTier: (t: TierDef) => void;
  sharesInput: string;
  setSharesInput: (v: string) => void;
  agtBal: bigint;
  navPerShareUsdc: string;
  preview: { gross: bigint; fee: bigint; usdcOut: bigint } | null;
}) {
  return (
    <div className="space-y-5">
      {/* Tier picker */}
      <div>
        <div className="eyebrow mb-2">Lockup tier</div>
        <div className="grid grid-cols-2 gap-2">
          {TIERS.map((t) => {
            const allowed = allowedLockups.includes(t.beValue);
            const selected = tier?.enum === t.enum;
            return (
              <button
                key={t.enum}
                type="button"
                disabled={!allowed}
                onClick={() => allowed && setTier(t)}
                className={cn(
                  "rounded-[8px] border p-4 text-left flex flex-col gap-1 transition-all",
                  selected
                    ? "border-ink bg-canvas-soft"
                    : allowed
                      ? "border-hairline-light bg-canvas-light hover:border-ink"
                      : "border-hairline-light bg-canvas-light opacity-40 cursor-not-allowed",
                )}
              >
                <div className="mono tabular-nums text-[20px] font-medium leading-none">
                  {t.label}
                </div>
                <div className="text-[11.5px] text-shade-50">
                  {allowed ? t.blurb : "Not allowed"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Shares input */}
      <div>
        <div className="eyebrow mb-2">Shares to redeem</div>
        <div className="flex items-center gap-3 rounded-[8px] px-[18px] py-4 bg-canvas-light border border-hairline-light focus-within:border-ink transition-colors">
          <input
            type="text"
            inputMode="decimal"
            value={sharesInput}
            onChange={(e) =>
              setSharesInput(e.target.value.replace(/[^0-9.]/g, ""))
            }
            placeholder="0.00"
            autoFocus
            className="flex-1 min-w-0 bg-transparent border-0 outline-none mono tabular-nums text-[28px] font-medium leading-none placeholder:text-shade-40"
          />
          <span className="text-[14px] font-medium text-shade-50">
            {ticker}
          </span>
          <button
            type="button"
            onClick={() =>
              setSharesInput(formatUnits(agtBal, AGT_DECIMALS))
            }
            className="rounded-full bg-canvas-soft px-2.5 py-1 text-[11px] mono text-shade-60 border border-transparent hover:border-hairline-light hover:text-ink transition-colors"
          >
            MAX
          </button>
        </div>
        <div className="mt-2 text-[12px] text-shade-50">
          Balance ·{" "}
          <span className="mono">{formatAgt(agtBal)} {ticker}</span>
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div className="rounded-[8px] bg-canvas-cream p-4 flex flex-col gap-2.5">
          <Row
            label="NAV per share"
            value={formatUsdc(navPerShareUsdc, {
              withSymbol: true,
              decimals: 4,
            })}
          />
          <Row
            label="Redeem fee (0.50%)"
            value={`-${formatUsdc(preview.fee.toString(), {
              withSymbol: true,
              decimals: 4,
            })}`}
          />
          <Row
            label="Lockup ends"
            value={
              tier && tier.days > 0
                ? formatDate(
                    Math.floor(Date.now() / 1000) + tier.days * 86400,
                  )
                : "instant"
            }
          />
          <div className="border-t border-hairline-soft pt-2.5 mt-1 flex justify-between text-[13.5px] font-medium">
            <span className="text-shade-50">USDC claimable</span>
            <span className="mono text-ink">
              {formatUsdc(preview.usdcOut.toString(), {
                withSymbol: true,
                decimals: 4,
              })}
            </span>
          </div>
        </div>
      )}

      <p className="text-[12px] text-shade-50 leading-[1.5]">
        Two transactions: AGT approve → queue.requestRedeem. NAV at claim time
        is final; the preview above is an estimate at request time.
      </p>
    </div>
  );
}

function TxBody({
  steps,
  stage,
  ticker,
  tier,
  resultRequestId,
  resultUnlockAt,
  preview,
}: {
  steps: typeof INITIAL_STEPS;
  stage: Stage;
  ticker: string;
  tier: TierDef | null;
  resultRequestId: bigint | null;
  resultUnlockAt: number | null;
  preview: { usdcOut: bigint } | null;
}) {
  const unlockDate = resultUnlockAt
    ? new Date(resultUnlockAt * 1000)
    : tier
      ? new Date(Date.now() + tier.days * 86_400_000)
      : null;

  return (
    <>
      <Stepper>
        <StepRow
          status={steps.approve.status}
          number={1}
          label="Approve shares"
          sub={
            steps.approve.errorMsg ??
            `Authorize the queue to lock your ${ticker}`
          }
          txHash={steps.approve.txHash}
        />
        <StepRow
          status={steps.request.status}
          number={2}
          label="Request redemption"
          sub={
            steps.request.errorMsg ??
            (tier
              ? `Queue your shares with a ${tier.label.toLowerCase()} lockup`
              : "Queue your shares")
          }
          txHash={steps.request.txHash}
        />
      </Stepper>

      {stage === "done" && (
        <div className="mt-7 rounded-[12px] bg-pistachio px-6 py-7 text-center">
          <div
            className="eyebrow mb-2"
            style={{ color: "var(--pistachio-text-medium)" }}
          >
            Locked until
          </div>
          <div className="font-display text-[28px] font-light mono leading-none text-ink">
            {unlockDate
              ? unlockDate.toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })
              : "—"}
          </div>
          {tier && tier.days > 0 && resultUnlockAt && (
            <div
              className="mono text-[13px] mt-2"
              style={{ color: "var(--pistachio-text-medium)" }}
            >
              {formatRelative(resultUnlockAt)}
            </div>
          )}
          {preview && (
            <div
              className="mt-3 text-[13.5px]"
              style={{ color: "var(--pistachio-text-strong)" }}
            >
              ~{formatUsdc(preview.usdcOut.toString(), {
                withSymbol: true,
                decimals: 2,
              })}{" "}
              claimable
            </div>
          )}
          {resultRequestId !== null && (
            <div
              className="mt-3 mono text-[11.5px]"
              style={{ color: "var(--pistachio-text-medium)" }}
            >
              Request #{resultRequestId.toString()}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* ─────────── Atoms ─────────── */

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-baseline text-[13.5px]">
      <span className="text-shade-50">{label}</span>
      <span className="mono text-ink">{value}</span>
    </div>
  );
}

function InlineBox({
  variant,
  children,
}: {
  variant: "info" | "warn";
  children: React.ReactNode;
}) {
  const variantClass =
    variant === "warn"
      ? "border-amber-helm/30 bg-amber-bg"
      : "border-blue-helm/20 bg-blue-bg";
  return (
    <div
      className={cn(
        "rounded-[8px] border p-3 mb-4 text-[13px]",
        variantClass,
      )}
      style={{
        color:
          variant === "warn"
            ? "var(--phase-incubation-text)"
            : "var(--dec-rebalance-text)",
      }}
    >
      {children}
    </div>
  );
}

function formatAgt(n: bigint): string {
  const x = Number(n) / 10 ** AGT_DECIMALS;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(x);
}
