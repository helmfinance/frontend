"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { erc20Abi, formatUnits, parseAbi, parseUnits } from "viem";
import { api, ApiError } from "@/lib/api";
import { mantleSepolia, CONTRACTS } from "@/lib/wagmi";
import { AGT_DECIMALS, USDC_DECIMALS } from "@/lib/contracts-constants";
import { useDebounce } from "@/lib/hooks";
import { decodeContractError } from "@/lib/decodeError";
import { formatUsdc } from "@/lib/format";
import { Button, Modal, Stepper, StepRow } from "@/components/ui";
import type { StepStatus } from "@/components/ui";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import type { components } from "@/lib/api-types.gen";

type AgentDetail = components["schemas"]["AgentDetail"];
type MintPreview = components["schemas"]["MintPreviewResponse"];
type PythBundle = components["schemas"]["PythUpdateBytesResponse"];

const VAULT_ABI = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
]);
const PYTH_ABI = parseAbi([
  "function updatePriceFeeds(bytes[] updateData) payable",
]);

/**
 * Margin under which we treat a Pyth feed as "still fresh enough to deposit
 * without a fresh push". Pyth's adapter staleness threshold on Mantle Sepolia
 * is ~60s; we use a tighter 20s buffer so the deposit tx still has runway by
 * the time it confirms.
 */
const PYTH_FRESH_BUFFER_SEC = 20;

type Stage = "input" | "running" | "done";

type StepInfo = {
  status: StepStatus;
  txHash?: `0x${string}`;
  errorMsg?: string;
};

const INITIAL_STEPS: Record<"approve" | "pyth" | "deposit", StepInfo> = {
  approve: { status: "idle" },
  pyth: { status: "idle" },
  deposit: { status: "idle" },
};

interface MintModalProps {
  agent: AgentDetail;
  open: boolean;
  onClose: () => void;
}

export function MintModal({ agent, open, onClose }: MintModalProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const onCorrectChain = chainId === mantleSepolia.id;
  const { switchChain, isPending: switching } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { push: toast } = useToast();

  const vaultAddress = agent.vaultAddress as `0x${string}`;
  const isSeed = agent.agentId >= 9000;

  /* ─── Balances + allowance ─── */
  const { data: usdcBalance, refetch: refetchUsdc } = useReadContract({
    address: CONTRACTS.usdc as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: open && !!address, refetchInterval: 15_000 },
  });
  const { data: mntBalance } = useBalance({
    address,
    query: { enabled: open && !!address, refetchInterval: 15_000 },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.usdc as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, vaultAddress] : undefined,
    query: { enabled: open && !!address },
  });

  /* ─── Form ─── */
  const [amountInput, setAmountInput] = useState("");
  const amountUsdc = useMemo(() => {
    const s = amountInput.trim();
    if (!s) return null;
    try {
      const v = parseUnits(s, USDC_DECIMALS);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [amountInput]);
  const debouncedAmount = useDebounce(amountUsdc, 400);

  /* ─── Preview ─── */
  const {
    data: preview,
    isFetching: previewLoading,
    error: previewError,
  } = useQuery({
    queryKey: ["mintPreview", agent.agentId, debouncedAmount?.toString()],
    queryFn: () =>
      api.post(
        "/agents/{agent_id}/mint-preview",
        { amountUsdc: debouncedAmount!.toString() },
        { path: { agent_id: agent.agentId } },
      ) as Promise<MintPreview>,
    enabled: open && !!debouncedAmount,
    retry: false,
    staleTime: 30_000,
  });

  /* ─── Tx state ─── */
  const [stage, setStage] = useState<Stage>("input");
  const [steps, setSteps] = useState(INITIAL_STEPS);
  const [resultShares, setResultShares] = useState<bigint | null>(null);

  /* ─── Reset on close/open ─── */
  useEffect(() => {
    if (open) {
      setStage("input");
      setSteps(INITIAL_STEPS);
      setResultShares(null);
    }
  }, [open]);

  /* ─── Validation ─── */
  const usdcBal = usdcBalance ?? 0n;
  const mntBal = mntBalance?.value ?? 0n;
  const minDeposit = BigInt(agent.mandate?.minimumDepositUsdc ?? "0");
  const pythFeeMnt = preview?.pythFeeMntWei ? BigInt(preview.pythFeeMntWei) : 0n;

  const validation = useMemo(() => {
    if (!amountUsdc) return { ok: false as const, msg: null };
    if (amountUsdc < minDeposit)
      return {
        ok: false as const,
        msg: `Min ${formatUsdc(minDeposit.toString(), { withSymbol: true })}`,
      };
    if (amountUsdc > usdcBal)
      return {
        ok: false as const,
        msg: `Insufficient USDC (have ${formatUsdc(usdcBal.toString(), {
          withSymbol: true,
        })})`,
      };
    if (pythFeeMnt > 0n && pythFeeMnt > mntBal)
      return {
        ok: false as const,
        msg: `Insufficient MNT for Pyth fee (need ${formatUnits(
          pythFeeMnt,
          18,
        )})`,
      };
    return { ok: true as const, msg: null };
  }, [amountUsdc, minDeposit, usdcBal, mntBal, pythFeeMnt]);

  /* ─── Execute ─── */
  /**
   * Run individual mint steps idempotently. Each runStepX checks if the step
   * is already done/skipped and bails out early — so on retry we only redo
   * what's needed. Callers chain them via executeMint.
   */
  async function runApprove(): Promise<boolean> {
    if (steps.approve.status === "done" || steps.approve.status === "skipped") {
      return true;
    }
    try {
      if ((allowance ?? 0n) >= amountUsdc!) {
        setSteps((s) => ({ ...s, approve: { status: "skipped" } }));
        return true;
      }
      setSteps((s) => ({ ...s, approve: { status: "spinning" } }));
      const hash = await writeContractAsync({
        address: CONTRACTS.usdc as `0x${string}`,
        abi: erc20Abi,
        functionName: "approve",
        args: [vaultAddress, amountUsdc!],
      });
      setSteps((s) => ({
        ...s,
        approve: { status: "spinning", txHash: hash },
      }));
      await publicClient!.waitForTransactionReceipt({
        hash,
        timeout: 90_000,
        pollingInterval: 2_000,
      });
      setSteps((s) => ({
        ...s,
        approve: { status: "done", txHash: hash },
      }));
      refetchAllowance();
      return true;
    } catch (e) {
      const { message } = decodeContractError(e);
      setSteps((s) => ({
        ...s,
        approve: { ...s.approve, status: "error", errorMsg: message },
      }));
      toast({ msg: `Mint failed at approval — ${message}`, variant: "error" });
      return false;
    }
  }

  /**
   * Decide whether the Pyth update tx is needed at all.
   *
   * Returns true when ALL position prices that drive valuation are still
   * fresh per BE's evaluation (`priceStale === false`) AND their on-chain
   * publish timestamps are within `PYTH_FRESH_BUFFER_SEC` of now.
   *
   * When true we skip step 2 → no MetaMask popup, no MNT spent.
   *
   * Conservative by design: any uncertainty (missing fields, only stale
   * positions, agent has zero Pyth-priced assets) falls through and we just
   * run the update.
   */
  function pythAlreadyFresh(): boolean {
    const positions = agent.positions ?? [];
    // Only synthetic equity positions need Pyth updates; mETH and USDY
    // are priced via adapters with their own freshness sources.
    const pythPositions = positions.filter(
      (p) => p.priceUpdatedAt != null && p.assetClass === "equity",
    );
    if (pythPositions.length === 0) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    return pythPositions.every((p) => {
      if (p.priceStale) return false;
      const updatedAt = p.priceUpdatedAt ?? 0;
      return updatedAt > 0 && nowSec - updatedAt <= PYTH_FRESH_BUFFER_SEC;
    });
  }

  async function runPyth(): Promise<boolean> {
    if (steps.pyth.status === "done" || steps.pyth.status === "skipped") {
      return true;
    }
    // Pre-flight: if all Pyth-priced positions are already fresh, skip the
    // on-chain update tx. Saves ~0.001 MNT/feed + one wallet popup.
    if (pythAlreadyFresh()) {
      setSteps((s) => ({ ...s, pyth: { status: "skipped" } }));
      return true;
    }
    try {
      setSteps((s) => ({ ...s, pyth: { status: "spinning" } }));
      const pyth: PythBundle = await api.get(
        "/agents/{agent_id}/pyth-update-bytes",
        { path: { agent_id: agent.agentId } },
      );
      // Defensive second check: if BE returned an empty bundle, also skip.
      if (
        !pyth.updateData ||
        pyth.updateData.length === 0 ||
        pyth.feeMntWei === "0"
      ) {
        setSteps((s) => ({ ...s, pyth: { status: "skipped" } }));
        return true;
      }
      const hash = await writeContractAsync({
        address: CONTRACTS.pythAdapter as `0x${string}`,
        abi: PYTH_ABI,
        functionName: "updatePriceFeeds",
        args: [pyth.updateData as `0x${string}`[]],
        value: BigInt(pyth.feeMntWei),
      });
      setSteps((s) => ({
        ...s,
        pyth: { status: "spinning", txHash: hash },
      }));
      await publicClient!.waitForTransactionReceipt({
        hash,
        timeout: 90_000,
        pollingInterval: 2_000,
      });
      setSteps((s) => ({
        ...s,
        pyth: { status: "done", txHash: hash },
      }));
      return true;
    } catch (e) {
      const { message } = decodeContractError(e);
      setSteps((s) => ({
        ...s,
        pyth: { ...s.pyth, status: "error", errorMsg: message },
      }));
      toast({ msg: `Mint failed at Pyth — ${message}`, variant: "error" });
      return false;
    }
  }

  /**
   * Reset the step that errored back to idle and re-run executeMint. Steps
   * with status "done" or "skipped" stay as-is and are short-circuited in
   * each runStep helper.
   */
  function retryFromError() {
    setSteps((s) => {
      const reset = <T extends StepInfo>(x: T): T =>
        x.status === "error" ? ({ status: "idle" } as T) : x;
      return {
        approve: reset(s.approve),
        pyth: reset(s.pyth),
        deposit: reset(s.deposit),
      };
    });
    // executeMint reads from state on next tick — wrap with setTimeout(0)
    // so React commits the reset before we re-enter the flow.
    setTimeout(() => {
      executeMint();
    }, 0);
  }

  async function executeMint() {
    if (!amountUsdc || !address || !publicClient) return;
    setStage("running");

    // Step 1: approve (idempotent)
    if (!(await runApprove())) return;

    // Step 2: Pyth (idempotent)
    if (!(await runPyth())) return;

    // Step 3: deposit
    try {
      // If a prior deposit attempt already succeeded, don't re-mint.
      if (steps.deposit.status === "done") {
        setStage("done");
        return;
      }
      setSteps((s) => ({ ...s, deposit: { status: "spinning" } }));
      const hash = await writeContractAsync({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "deposit",
        args: [amountUsdc, address],
      });
      setSteps((s) => ({
        ...s,
        deposit: { status: "spinning", txHash: hash },
      }));
      await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 90_000,
        pollingInterval: 2_000,
      });
      setSteps((s) => ({
        ...s,
        deposit: { status: "done", txHash: hash },
      }));
      const shares = BigInt(preview?.shares ?? "0");
      setResultShares(shares);
      refetchUsdc();
      setStage("done");
      toast({
        msg: `${(Number(shares) / 10 ** AGT_DECIMALS).toFixed(4)} ${agent.ticker} minted`,
        tx: hash,
      });
    } catch (e) {
      const { message } = decodeContractError(e);
      setSteps((s) => ({
        ...s,
        deposit: { ...s.deposit, status: "error", errorMsg: message },
      }));
      toast({ msg: `Mint failed — ${message}`, variant: "error" });
    }
  }

  /* ─── Render ─── */

  const title =
    stage === "done"
      ? "Mint complete"
      : stage === "running"
        ? "Minting…"
        : `Mint $${agent.ticker}`;

  const dismissible = stage !== "running";
  const sharesOut = preview?.shares ?? "0";

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
              isSeed
            }
            onClick={executeMint}
          >
            {validation.msg ?? "Confirm mint"}
          </Button>
        </>
      );
    }
    if (stage === "done") {
      return (
        <>
          <Button
            variant="outline-light"
            size="md"
            className="flex-1"
            onClick={onClose}
          >
            Back to agent
          </Button>
          {address && (
            <Link href={`/portfolio/${address}`} className="flex-1">
              <Button variant="aloe" size="md" className="w-full">
                View portfolio
              </Button>
            </Link>
          )}
        </>
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
      {/* Pre-flight inline warnings */}
      {isSeed && (
        <InlineBox variant="warn">
          Seed agent — chain calls revert. Use a real on-chain agent for tx demos.
        </InlineBox>
      )}
      {!isConnected && (
        <InlineBox variant="info">
          <p className="mb-2 text-[13.5px]">
            Connect a wallet to mint.
          </p>
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

      {stage === "input" && (
        <InputBody
          ticker={agent.ticker}
          navPerShareUsdc={agent.navPerShareUsdc}
          amountInput={amountInput}
          setAmountInput={setAmountInput}
          usdcBal={usdcBal}
          sharesOut={sharesOut}
          mntBal={mntBal}
          preview={preview}
          previewLoading={previewLoading}
          previewError={previewError}
        />
      )}

      {(stage === "running" || stage === "done") && (
        <TxBody
          steps={steps}
          stage={stage}
          ticker={agent.ticker}
          resultShares={resultShares}
          onRetry={retryFromError}
        />
      )}
    </Modal>
  );
}

/* ─────────── Sub-components ─────────── */

function InputBody({
  ticker,
  navPerShareUsdc,
  amountInput,
  setAmountInput,
  usdcBal,
  sharesOut,
  mntBal,
  preview,
  previewLoading,
  previewError,
}: {
  ticker: string;
  navPerShareUsdc: string;
  amountInput: string;
  setAmountInput: (v: string) => void;
  usdcBal: bigint;
  sharesOut: string;
  mntBal: bigint;
  preview: MintPreview | undefined;
  previewLoading: boolean;
  previewError: unknown;
}) {
  return (
    <div className="space-y-2">
      {/* You pay */}
      <div className="eyebrow mb-2">You pay</div>
      <AmountInputWrap>
        <input
          type="text"
          inputMode="decimal"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0.00"
          autoFocus
          className="flex-1 min-w-0 bg-transparent border-0 outline-none mono tabular-nums text-[28px] font-medium leading-none placeholder:text-shade-40"
        />
        <span className="text-[14px] font-medium text-shade-50">USDC</span>
        <button
          type="button"
          onClick={() => setAmountInput(formatUnits(usdcBal, USDC_DECIMALS))}
          className="rounded-full bg-canvas-soft px-2.5 py-1 text-[11px] mono text-shade-60 border border-transparent hover:border-hairline-light hover:text-ink transition-colors"
        >
          MAX
        </button>
      </AmountInputWrap>
      <div className="flex justify-between text-[12px] text-shade-50">
        <span>
          Balance ·{" "}
          <span className="mono">
            {formatUsdc(usdcBal.toString(), { withSymbol: true })}
          </span>
        </span>
      </div>

      {/* Arrow */}
      <div className="flex justify-center text-shade-40 py-2">↓</div>

      {/* You receive */}
      <div className="eyebrow mb-2">You receive</div>
      <AmountInputWrap muted>
        <input
          type="text"
          readOnly
          value={
            sharesOut !== "0"
              ? (Number(BigInt(sharesOut)) / 10 ** AGT_DECIMALS).toFixed(4)
              : "0.0000"
          }
          className="flex-1 min-w-0 bg-transparent border-0 outline-none mono tabular-nums text-[28px] font-medium leading-none text-ink"
        />
        <span className="text-[14px] font-medium text-shade-50">{ticker}</span>
      </AmountInputWrap>

      {/* Preview error — moved out of the preview box so it's hard to miss. */}
      {!!previewError && !preview && (
        <div
          className="mt-5 rounded-[8px] border border-amber-helm/30 bg-amber-bg px-4 py-3 text-[13px]"
          style={{ color: "var(--phase-incubation-text)" }}
        >
          <div className="font-medium mb-1">Preview unavailable</div>
          <div className="text-[12.5px] leading-[1.5]">
            {previewError instanceof ApiError
              ? `${previewError.status}: ${
                  typeof previewError.detail === "object" &&
                  previewError.detail !== null &&
                  "message" in previewError.detail
                    ? String((previewError.detail as { message: string }).message)
                    : "BE rejected the quote request."
                }`
              : "Couldn't fetch a fresh quote from the backend."}
            {" "}You can still mint — the contract enforces all invariants — but
            you won&apos;t see expected shares/fees until the quote returns.
          </div>
        </div>
      )}

      {/* Preview */}
      <div className="mt-5 rounded-[8px] bg-canvas-cream p-4 flex flex-col gap-2.5">
        {previewLoading && !preview && (
          <p className="text-[13px] text-shade-50">Quoting…</p>
        )}
        {preview && (
          <>
            <Row
              label="NAV per share"
              value={formatUsdc(navPerShareUsdc, {
                withSymbol: true,
                decimals: 4,
              })}
            />
            <Row
              label="Mint fee (0.50%)"
              value={formatUsdc(preview.platformFeeUsdc, {
                withSymbol: true,
              })}
            />
            <Row
              label="Pyth update fee"
              value={`${formatUnits(BigInt(preview.pythFeeMntWei), 18)} MNT`}
            />
            <Row
              label="MNT balance"
              value={`${formatUnits(mntBal, 18)} MNT`}
              muted
            />
            <div className="border-t border-hairline-soft pt-2.5 mt-1 flex justify-between text-[13.5px] font-medium">
              <span className="text-shade-50">Shares received</span>
              <span className="mono text-ink">
                {sharesOut !== "0"
                  ? (Number(BigInt(sharesOut)) / 10 ** AGT_DECIMALS).toFixed(4)
                  : "0.0000"}{" "}
                {ticker}
              </span>
            </div>
          </>
        )}
      </div>

      <p className="mt-4 text-[12px] text-shade-50 leading-[1.5]">
        This action runs as three transactions: USDC approve → Pyth price update → vault deposit. Each step requires a wallet signature.
      </p>
    </div>
  );
}

function TxBody({
  steps,
  stage,
  ticker,
  resultShares,
  onRetry,
}: {
  steps: typeof INITIAL_STEPS;
  stage: Stage;
  ticker: string;
  resultShares: bigint | null;
  onRetry: () => void;
}) {
  // Derive which step is currently running (= "active" in the banner).
  const activeStepNumber =
    steps.approve.status === "spinning"
      ? 1
      : steps.pyth.status === "spinning"
        ? 2
        : steps.deposit.status === "spinning"
          ? 3
          : null;
  return (
    <>
      {stage === "running" && (
        <div className="mb-4 rounded-[8px] border border-hairline-light bg-canvas-cream px-4 py-3 text-[12.5px] text-shade-60 leading-[1.5]">
          <strong className="text-ink">
            Step {activeStepNumber ?? "—"} of 3 — please confirm in your wallet.
          </strong>{" "}
          Don&apos;t close this dialog. If you cancel a step, you can retry it
          without redoing the previous ones.
        </div>
      )}
      <Stepper>
        <StepRow
          status={steps.approve.status}
          number={1}
          label="Approve USDC"
          eta="~10s"
          sub={
            steps.approve.errorMsg ?? "Authorize the vault to pull your USDC"
          }
          txHash={steps.approve.txHash}
          action={
            steps.approve.status === "error" ? (
              <RetryBtn onClick={onRetry} label="Retry" />
            ) : undefined
          }
        />
        <StepRow
          status={steps.pyth.status}
          number={2}
          label="Update Pyth price"
          eta="~10s · 0.001+ MNT"
          sub={
            steps.pyth.errorMsg ??
            (steps.pyth.status === "skipped"
              ? "Prices already fresh — no on-chain update needed"
              : "Fresh oracle quote · pay MNT fee")
          }
          txHash={steps.pyth.txHash}
          action={
            steps.pyth.status === "error" ? (
              <RetryBtn onClick={onRetry} label="Retry" />
            ) : undefined
          }
        />
        <StepRow
          status={steps.deposit.status}
          number={3}
          label="Deposit to vault"
          eta="~10s"
          sub={
            steps.deposit.errorMsg ??
            `Mint ${ticker} shares from your USDC`
          }
          txHash={steps.deposit.txHash}
          action={
            steps.deposit.status === "error" ? (
              <RetryBtn onClick={onRetry} label="Retry" />
            ) : undefined
          }
        />
      </Stepper>

      {stage === "done" && resultShares !== null && (
        <div className="mt-7 rounded-[12px] bg-aloe px-6 py-7 text-center">
          <div
            className="eyebrow mb-2"
            style={{ color: "var(--pistachio-text-medium)" }}
          >
            You received
          </div>
          <div className="font-display text-[40px] font-light mono tabular-nums leading-none text-ink">
            {(Number(resultShares) / 10 ** AGT_DECIMALS).toFixed(2)}
          </div>
          <div
            className="mono text-[13px] mt-2"
            style={{ color: "var(--pistachio-text-medium)" }}
          >
            {ticker} shares
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────── Layout atoms ─────────── */

function RetryBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mono text-[11.5px] font-medium rounded-full bg-ink text-on-primary px-2.5 py-1 hover:bg-shade-70 transition-colors"
    >
      ↻ {label}
    </button>
  );
}

function AmountInputWrap({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[8px] px-[18px] py-4",
        muted
          ? "bg-canvas-cream border border-transparent"
          : "bg-canvas-light border border-hairline-light focus-within:border-ink transition-colors",
      )}
    >
      {children}
    </div>
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
    <div className="flex justify-between items-baseline text-[13.5px]">
      <span className="text-shade-50">{label}</span>
      <span className={cn("mono", muted ? "text-shade-50" : "text-ink")}>
        {value}
      </span>
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
