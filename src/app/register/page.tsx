"use client";

/**
 * Register page — /register.
 *
 * Three-stage founder onboarding wizard:
 *
 *   1. Mandate    — write strategy in natural language → POST /mandate/parse
 *   2. Parsed     — review the LLM-extracted MandateSchema in a pistachio card
 *   3. Seed       — stake seed USDC + agree to 180-day lockup + subordination
 *
 * Chain calls in stage 3:
 *   • USDC.approve(registry, seed)
 *   • HelmRegistry.registerAgent(mandateHash, mandateUri, seed, assets, weights)
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { decodeEventLog, erc20Abi, parseAbi } from "viem";
import { api, ApiError } from "@/lib/api";
import { CONTRACTS, mantleSepolia, SYNTHETIC_ASSETS } from "@/lib/wagmi";
import {
  BPS_SCALE,
  USDC_DECIMALS,
  MIN_SEED_USDC,
  DEFAULT_LOCKUP_DAYS,
} from "@/lib/contracts-constants";
import addresses from "@/lib/addresses.json";
import { decodeContractError } from "@/lib/decodeError";
import { waitForTx } from "@/lib/waitForTx";
import { writeWithNonce } from "@/lib/tx";
import { formatBps, formatUsdc } from "@/lib/format";
import { Button, Stepper, StepRow } from "@/components/ui";
import type { StepStatus } from "@/components/ui";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import type { components } from "@/lib/api-types.gen";

type MandateSchema = components["schemas"]["MandateSchema"];
type MandateParseResponse = components["schemas"]["MandateParseResponse"];
type MandateValidateResponse = components["schemas"]["MandateValidateResponse"];
type LockupTier = components["schemas"]["LockupTier"];

const REBALANCE_FREQUENCIES: MandateSchema["rebalanceFrequency"][] = [
  "daily",
  "weekly",
  "monthly",
  "event-driven",
];
const ALL_LOCKUPS: LockupTier[] = ["instant", "30d", "60d", "90d"];

const REGISTRY_ABI = parseAbi([
  "function registerAgent(bytes32 mandateHash, string mandateURI, uint256 seedUSDC, (address asset, uint8 kind)[] assets, (address asset, uint16 minBps, uint16 maxBps)[] weightConstraints) returns (uint256 agentId)",
  "event AgentRegistered(uint256 indexed agentId, address indexed founder, address indexed vault, address token, bytes32 mandateHash, string mandateURI)",
]);

/** AssetKind enum order from IAgentVault.sol: Synthetic=0, METHAdapter=1, USDYAdapter=2. */
const ASSET_KIND_SYNTHETIC = 0;
const ASSET_KIND_METH = 1;
const ASSET_KIND_USDY = 2;

/** Symbol → on-chain address + AssetKind (mirrors backend/app/services/rebalance.py). */
function resolveSymbol(symbol: string): { address: `0x${string}`; kind: number } | null {
  switch (symbol) {
    case "sNVDA":
      return { address: SYNTHETIC_ASSETS.sNVDA as `0x${string}`, kind: ASSET_KIND_SYNTHETIC };
    case "sSPY":
      return { address: SYNTHETIC_ASSETS.sSPY as `0x${string}`, kind: ASSET_KIND_SYNTHETIC };
    case "sAAPL":
      return { address: SYNTHETIC_ASSETS.sAAPL as `0x${string}`, kind: ASSET_KIND_SYNTHETIC };
    case "sTSLA":
      return { address: SYNTHETIC_ASSETS.sTSLA as `0x${string}`, kind: ASSET_KIND_SYNTHETIC };
    case "sMSFT":
      return { address: SYNTHETIC_ASSETS.sMSFT as `0x${string}`, kind: ASSET_KIND_SYNTHETIC };
    case "mETH":
      return { address: addresses.contracts.mEthAdapter as `0x${string}`, kind: ASSET_KIND_METH };
    case "USDY":
      return { address: addresses.contracts.usdyAdapter as `0x${string}`, kind: ASSET_KIND_USDY };
    default:
      return null;
  }
}

/** Optional example mandate — exposed via "Load example" button so the
 *  textarea starts empty in production but demos remain one click away. */
const EXAMPLE_MANDATE = `AI mega-cap tech with weekly rebalancing. Moderate aggression, equity 60-80% / treasury 10-30%. Redemption queues at 30/60/90 days, USDY 30% safety leg. Carry 10%.`;

type Stage = "mandate" | "parsed" | "seed" | "running" | "done";

type StepInfo = {
  status: StepStatus;
  txHash?: `0x${string}`;
  errorMsg?: string;
};
const INITIAL_STEPS: Record<"approve" | "register", StepInfo> = {
  approve: { status: "idle" },
  register: { status: "idle" },
};

export default function RegisterPage() {
  const router = useRouter();
  const { address: walletAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const onCorrectChain = chainId === mantleSepolia.id;
  const { switchChain, isPending: switching } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { push: toast } = useToast();

  const [stage, setStage] = useState<Stage>("mandate");
  const [mandateText, setMandateText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<MandateParseResponse | null>(null);

  // Editing state — Stage 2 lets the founder tweak parsed fields.
  const [editedMandate, setEditedMandate] = useState<MandateSchema | null>(null);
  const [editedHash, setEditedHash] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validateErrors, setValidateErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  // Seed state
  const [seedInput, setSeedInput] = useState("1000");
  const [agree, setAgree] = useState(false);

  // Tx state
  const [steps, setSteps] = useState<typeof INITIAL_STEPS>(INITIAL_STEPS);
  const [resultAgentId, setResultAgentId] = useState<bigint | null>(null);

  const seedUsdc = useMemo(() => {
    try {
      const v = Number(seedInput);
      if (!Number.isFinite(v) || v <= 0) return 0n;
      return BigInt(Math.floor(v * 10 ** USDC_DECIMALS));
    } catch {
      return 0n;
    }
  }, [seedInput]);

  /* USDC balance + allowance (only after stage 3 reached) */
  const { data: usdcBalance } = useReadContract({
    address: CONTRACTS.usdc as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: walletAddress ? [walletAddress] : undefined,
    query: {
      enabled: !!walletAddress && (stage === "seed" || stage === "running"),
    },
  });
  const { data: usdcAllowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.usdc as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args: walletAddress
      ? [walletAddress, CONTRACTS.registry as `0x${string}`]
      : undefined,
    query: {
      enabled: !!walletAddress && (stage === "seed" || stage === "running"),
    },
  });

  /* ─── Parse mandate ─── */
  async function onParse() {
    if (parsing) return;
    setParsing(true);
    try {
      const r = (await api.post("/mandate/parse", {
        naturalLanguageMandate: mandateText,
      })) as MandateParseResponse;
      setParsed(r);
      setEditedMandate(r.mandate);
      setEditedHash(r.mandateHash);
      setValidateErrors([]);
      setDirty(false);
      setStage("parsed");
      if (r.warnings.length > 0) {
        toast({ msg: `Parsed with ${r.warnings.length} warning(s)` });
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.status}: ${JSON.stringify(e.detail)}`
          : ((e as Error)?.message ?? "Unknown error");
      toast({ msg: `Parse failed — ${msg}`, variant: "error" });
    } finally {
      setParsing(false);
    }
  }

  /* ─── Validate edited mandate ─── */
  async function onValidate() {
    if (!editedMandate || validating) return;
    setValidating(true);
    try {
      const r = (await api.post("/mandate/validate", {
        mandate: editedMandate,
      })) as MandateValidateResponse;
      setValidateErrors(r.errors ?? []);
      if (r.valid && r.hash) {
        setEditedHash(r.hash);
        setDirty(false);
        toast({ msg: "Mandate validated" });
      } else if (!r.valid) {
        toast({
          msg: `Validation failed — ${r.errors.length} error(s)`,
          variant: "error",
        });
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.status}: ${JSON.stringify(e.detail)}`
          : ((e as Error)?.message ?? "Unknown error");
      toast({ msg: `Validate failed — ${msg}`, variant: "error" });
    } finally {
      setValidating(false);
    }
  }

  /** Patch helper for partial mandate edits — marks the form as dirty. */
  function patchMandate(p: Partial<MandateSchema>) {
    if (!editedMandate) return;
    setEditedMandate({ ...editedMandate, ...p });
    setDirty(true);
    setValidateErrors([]);
  }

  /* ─── Launch agent (2 tx) ─── */
  async function onLaunch() {
    if (!parsed || !editedMandate || !editedHash || !walletAddress || !publicClient)
      return;
    if (dirty) {
      toast({
        msg: "Re-validate the edited mandate before launching",
        variant: "error",
      });
      return;
    }
    if (seedUsdc < MIN_SEED_USDC) {
      toast({
        msg: `Seed must be ≥ ${formatUsdc(MIN_SEED_USDC.toString(), { withSymbol: true })}`,
        variant: "error",
      });
      return;
    }
    if (usdcBalance !== undefined && usdcBalance < seedUsdc) {
      toast({
        msg: `USDC balance too low (need ${formatUsdc(seedUsdc.toString(), { withSymbol: true })})`,
        variant: "error",
      });
      return;
    }

    // Resolve mandate target universe → on-chain tuples (use editedMandate).
    const resolvedTargets = editedMandate.targetUniverse
      .map((s) => ({ symbol: s, resolved: resolveSymbol(s) }))
      .filter((x) => x.resolved !== null) as Array<{
      symbol: string;
      resolved: { address: `0x${string}`; kind: number };
    }>;
    if (resolvedTargets.length === 0) {
      toast({
        msg: "Mandate has no resolvable target assets",
        variant: "error",
      });
      return;
    }
    const assets = resolvedTargets.map(({ resolved }) => ({
      asset: resolved.address,
      kind: resolved.kind,
    }));

    // Build weight constraints. The BE now returns per-symbol entries
    // ({asset: "sNVDA", minBps, maxBps}), so these match by symbol directly.
    // We also accept address-form entries and keep an equal-weight ±200bps
    // fallback purely as a safety net for any unexpected/legacy shape — in
    // the normal path nothing falls back and the confirm below never fires.
    const fallbackWeightBps = Math.floor(BPS_SCALE / resolvedTargets.length);
    const unmatched: string[] = [];
    const weightConstraints = resolvedTargets.map(({ symbol, resolved }) => {
      const wc = editedMandate.weightConstraints.find((w) => {
        const a = (w.asset ?? "").toString();
        if (a === symbol) return true;
        if (a.toLowerCase() === resolved.address.toLowerCase()) return true;
        return false;
      });
      if (wc) {
        return { asset: resolved.address, minBps: wc.minBps, maxBps: wc.maxBps };
      }
      unmatched.push(symbol);
      return {
        asset: resolved.address,
        minBps: Math.max(0, fallbackWeightBps - 200),
        maxBps: Math.min(BPS_SCALE, fallbackWeightBps + 200),
      };
    });

    // If we silently fell back for any asset, ask the user to confirm —
    // these are the weights that lock in on-chain.
    if (unmatched.length > 0) {
      const ok = confirm(
        `${unmatched.length} target(s) had no matching weight constraint in the mandate ` +
          `(${unmatched.join(", ")}). They'll launch with a fallback ±200bps band around ` +
          `${(fallbackWeightBps / 100).toFixed(2)}%. Continue?`,
      );
      if (!ok) {
        toast({
          msg: "Launch cancelled — adjust weightConstraints in the mandate.",
          variant: "error",
        });
        return;
      }
    }

    setStage("running");
    setSteps(INITIAL_STEPS);

    // Step 1: approve
    try {
      if ((usdcAllowance ?? 0n) >= seedUsdc) {
        setSteps((s) => ({ ...s, approve: { status: "skipped" } }));
      } else {
        setSteps((s) => ({ ...s, approve: { status: "spinning" } }));
        const hash = await writeWithNonce(publicClient!, walletAddress!, (nonce) =>
          writeContractAsync({
            address: CONTRACTS.usdc as `0x${string}`,
            abi: erc20Abi,
            functionName: "approve",
            args: [CONTRACTS.registry as `0x${string}`, seedUsdc],
            nonce,
          }),
        );
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
      toast({ msg: `Approve failed — ${message}`, variant: "error" });
      return;
    }

    // Step 2: registerAgent
    try {
      setSteps((s) => ({ ...s, register: { status: "spinning" } }));
      const mandateHash = editedHash.startsWith("0x")
        ? (editedHash as `0x${string}`)
        : (`0x${editedHash}` as `0x${string}`);
      const hash = await writeWithNonce(publicClient!, walletAddress!, (nonce) =>
        writeContractAsync({
          address: CONTRACTS.registry as `0x${string}`,
          abi: REGISTRY_ABI,
          functionName: "registerAgent",
          args: [
            mandateHash,
            parsed.mandateUri,
            seedUsdc,
            assets,
            weightConstraints,
          ],
          nonce,
        }),
      );
      setSteps((s) => ({
        ...s,
        register: { status: "spinning", txHash: hash },
      }));
      const receipt = await waitForTx(publicClient, hash);
      setSteps((s) => ({
        ...s,
        register: { status: "done", txHash: hash },
      }));

      // Find AgentRegistered event for agentId.
      let agentId: bigint | null = null;
      for (const log of receipt.logs) {
        if (
          log.address.toLowerCase() !==
          (CONTRACTS.registry as string).toLowerCase()
        )
          continue;
        try {
          const decoded = decodeEventLog({
            abi: REGISTRY_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "AgentRegistered") {
            agentId = (decoded.args as unknown as { agentId: bigint }).agentId;
            break;
          }
        } catch {
          // not an AgentRegistered log
        }
      }
      setResultAgentId(agentId);
      setStage("done");
      toast({
        msg: agentId
          ? `Agent #${agentId} launched`
          : "Agent launched",
        tx: hash,
      });
    } catch (e) {
      const { message } = decodeContractError(e);
      setSteps((s) => ({
        ...s,
        register: { ...s.register, status: "error", errorMsg: message },
      }));
      toast({ msg: `Launch failed — ${message}`, variant: "error" });
    }
  }

  /* ─── Validation flags for the seed stage ─── */
  const enoughSeed = seedUsdc >= MIN_SEED_USDC;
  const enoughBalance =
    usdcBalance !== undefined ? usdcBalance >= seedUsdc : true;
  const canLaunch =
    isConnected &&
    onCorrectChain &&
    !!parsed &&
    enoughSeed &&
    agree &&
    enoughBalance;

  /* ─── Stage labels ─── */
  const stageNumber =
    stage === "mandate"
      ? 1
      : stage === "parsed"
        ? 2
        : 3;
  const stageTitle =
    stage === "mandate"
      ? "Write your mandate"
      : stage === "parsed"
        ? "Confirm parsed strategy"
        : stage === "done"
          ? "Agent launched"
          : "Stake your seed capital";
  const stageBlurb =
    stage === "mandate"
      ? "Write your strategy in natural language. The LLM will translate it into contract parameters."
      : stage === "parsed"
        ? "These are the parameters the LLM extracted. Review or step back to edit."
        : stage === "done"
          ? "Your agent is live on-chain. Incubation runs for 30 days before public mints open."
          : "Your capital is locked for 180 days with a 40% withdrawal cap. Skin in the game.";

  return (
    <main className="mx-auto max-w-[1440px] px-4 sm:px-8 py-8 sm:py-12">
      <div className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13.5px] font-medium text-shade-60 hover:bg-canvas-soft hover:text-ink transition-colors"
        >
          ← All agents
        </Link>
      </div>

      <div className="mx-auto max-w-[720px]">
        {stage !== "done" && (
          <div className="eyebrow mb-3">
            Step {stageNumber} of 3 · Launch agent
          </div>
        )}
        <h1 className="font-display text-[40px] sm:text-[48px] font-light leading-[1.05] text-ink mb-3">
          {stageTitle}
        </h1>
        <p className="text-[15px] text-shade-60 mb-8">{stageBlurb}</p>

        {/* Connect prompt if needed */}
        {!isConnected && (
          <PromptBox tone="info">
            <p className="mb-3 text-[14px]">
              Connect a wallet to register an agent.
            </p>
            <ConnectButton />
          </PromptBox>
        )}
        {isConnected && !onCorrectChain && (
          <PromptBox tone="warn">
            <p className="mb-3 text-[14px]">
              Switch to Mantle Sepolia (chain id 5003).
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => switchChain({ chainId: mantleSepolia.id })}
              disabled={switching}
            >
              {switching ? "Switching…" : "Switch network"}
            </Button>
          </PromptBox>
        )}

        {/* Stage 1: mandate */}
        {stage === "mandate" && (
          <div className="rounded-[12px] border border-hairline-light bg-canvas-light p-6">
            <div className="flex justify-between items-center mb-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-shade-50">
                Strategy mandate
              </div>
              {!mandateText && (
                <button
                  type="button"
                  onClick={() => setMandateText(EXAMPLE_MANDATE)}
                  className="text-[12px] text-shade-60 underline underline-offset-2 hover:text-ink"
                >
                  Load example
                </button>
              )}
            </div>
            <textarea
              value={mandateText}
              onChange={(e) => setMandateText(e.target.value)}
              className="w-full min-h-[220px] rounded-[8px] border border-hairline-light bg-canvas-cream px-4 py-3 text-[15px] leading-[1.6] outline-none focus:border-ink resize-y"
              placeholder="Describe the strategy in plain English…"
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12.5px] text-shade-50">
                ~5s LLM parse · retry on MandateParseFailed
              </p>
              <Button
                variant="primary"
                size="md"
                disabled={!mandateText.trim() || parsing}
                onClick={onParse}
              >
                {parsing ? "Parsing…" : "Parse with AI →"}
              </Button>
            </div>
          </div>
        )}

        {/* Stage 2: parsed + editable */}
        {stage === "parsed" && parsed && editedMandate && (
          <>
            <MandateEditor
              mandate={editedMandate}
              mandateUri={parsed.mandateUri}
              dirty={dirty}
              hash={editedHash}
              onChange={patchMandate}
            />
            {parsed.warnings.length > 0 && (
              <div
                className="mt-3 rounded-[8px] border border-amber-helm/30 bg-amber-bg px-4 py-3 text-[13px]"
                style={{ color: "var(--phase-incubation-text)" }}
              >
                <div className="font-medium mb-1">Parse warnings</div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {parsed.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {validateErrors.length > 0 && (
              <div
                className="mt-3 rounded-[8px] border border-red-helm/30 bg-red-bg/10 px-4 py-3 text-[13px]"
                style={{ color: "var(--phase-slashed-text)" }}
              >
                <div className="font-medium mb-1">Validation errors</div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {validateErrors.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="outline-light"
                size="md"
                onClick={() => setStage("mandate")}
              >
                ← Edit mandate text
              </Button>
              <div className="flex gap-2">
                {dirty && (
                  <Button
                    variant="outline-light"
                    size="md"
                    onClick={onValidate}
                    disabled={validating}
                  >
                    {validating ? "Validating…" : "Re-validate"}
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setStage("seed")}
                  disabled={dirty || validateErrors.length > 0}
                  title={
                    dirty
                      ? "Re-validate before continuing"
                      : validateErrors.length > 0
                        ? "Fix validation errors"
                        : undefined
                  }
                >
                  Continue · seed capital →
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Stage 3: seed */}
        {stage === "seed" && parsed && (
          <>
            <div className="rounded-[12px] border border-hairline-light bg-canvas-light p-6">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-shade-50 mb-2">
                Seed amount
              </div>
              <div className="flex items-center gap-3 rounded-[8px] px-4 py-4 bg-canvas-cream border border-hairline-light focus-within:border-ink transition-colors">
                <input
                  type="text"
                  inputMode="decimal"
                  value={seedInput}
                  onChange={(e) =>
                    setSeedInput(e.target.value.replace(/[^0-9.]/g, ""))
                  }
                  className="flex-1 min-w-0 bg-transparent border-0 outline-none mono tabular-nums text-[28px] font-medium leading-none placeholder:text-shade-40"
                  placeholder="1000"
                />
                <span className="text-[14px] font-medium text-shade-50">
                  USDC
                </span>
              </div>
              <div className="mt-2 text-[12px] text-shade-50">
                Minimum{" "}
                <span className="mono">
                  {formatUsdc(MIN_SEED_USDC.toString(), {
                    withSymbol: true,
                    decimals: 0,
                  })}
                </span>{" "}
                · balance{" "}
                <span className="mono">
                  {usdcBalance !== undefined
                    ? formatUsdc(usdcBalance.toString(), {
                        withSymbol: true,
                      })
                    : "—"}
                </span>
              </div>

              {/* Preview */}
              <div className="mt-6 rounded-[8px] bg-canvas-cream p-4 flex flex-col gap-2.5">
                <PreviewRow
                  label="Founder lockup"
                  value={`${(editedMandate ?? parsed.mandate).founderLockupDays ?? DEFAULT_LOCKUP_DAYS} days`}
                />
                <PreviewRow
                  label="Subordination cap"
                  value={formatBps((editedMandate ?? parsed.mandate).subordinationThresholdBps)}
                  hint="withdrawal max"
                />
                <PreviewRow
                  label="Carry (you earn)"
                  value={`${formatBps((editedMandate ?? parsed.mandate).carryBps)} of yield`}
                />
                <PreviewRow
                  label="Incubation"
                  value="30 days · founder-only deposits"
                />
              </div>

              {/* Agreement */}
              <label className="mt-5 flex items-start gap-3 cursor-pointer text-[13.5px] leading-[1.5] text-shade-60">
                <input
                  type="checkbox"
                  checked={agree}
                  onChange={(e) => setAgree(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-ink"
                />
                <span>
                  I agree my capital is locked for{" "}
                  {(editedMandate ?? parsed.mandate).founderLockupDays ?? DEFAULT_LOCKUP_DAYS}{" "}
                  days and subordinated — external holders settle first.
                  When wind-down triggers, I can recover residual capital
                  only after senior settlement completes.
                </span>
              </label>
            </div>
            <div className="mt-5 flex flex-wrap justify-between gap-2">
              <Button
                variant="outline-light"
                size="md"
                onClick={() => setStage("parsed")}
              >
                ← Back
              </Button>
              <Button
                variant="aloe"
                size="md"
                disabled={!canLaunch}
                onClick={onLaunch}
              >
                {!isConnected
                  ? "Connect wallet first"
                  : !onCorrectChain
                    ? "Switch network"
                    : !enoughSeed
                      ? `Need ≥ ${formatUsdc(MIN_SEED_USDC.toString(), { withSymbol: true, decimals: 0 })}`
                      : !enoughBalance
                        ? "Balance too low"
                        : !agree
                          ? "Agree to terms first"
                          : "Approve & launch agent"}
              </Button>
            </div>
          </>
        )}

        {/* Stage running / done */}
        {(stage === "running" || stage === "done") && parsed && (
          <div className="rounded-[12px] border border-hairline-light bg-canvas-light p-6">
            <Stepper>
              <StepRow
                status={steps.approve.status}
                number={1}
                label="Approve USDC"
                sub={
                  steps.approve.errorMsg ??
                  `Authorize the registry to escrow your seed of ${formatUsdc(seedUsdc.toString(), { withSymbol: true })}`
                }
                txHash={steps.approve.txHash}
              />
              <StepRow
                status={steps.register.status}
                number={2}
                label="Register agent"
                sub={
                  steps.register.errorMsg ??
                  `Deploy AgentVault + AgentToken + FounderVault and lock your seed`
                }
                txHash={steps.register.txHash}
              />
            </Stepper>

            {stage === "done" && (
              <div className="mt-7 rounded-[12px] bg-pistachio px-6 py-7 text-center">
                <div
                  className="eyebrow mb-2"
                  style={{ color: "var(--pistachio-text-medium)" }}
                >
                  Your agent is live
                </div>
                <div className="font-display text-[28px] font-light leading-none text-ink">
                  {(editedMandate ?? parsed.mandate).name}{" "}
                  <span className="text-shade-50">${(editedMandate ?? parsed.mandate).ticker}</span>
                </div>
                {resultAgentId !== null && (
                  <div
                    className="mt-3 mono text-[13px]"
                    style={{ color: "var(--pistachio-text-medium)" }}
                  >
                    Agent #{resultAgentId.toString().padStart(3, "0")} ·
                    incubating 30d
                  </div>
                )}
                <div className="mt-5 flex justify-center gap-2">
                  {resultAgentId !== null && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() =>
                        router.push(`/agents/${resultAgentId}`)
                      }
                    >
                      View agent →
                    </Button>
                  )}
                  {walletAddress && (
                    <Button
                      variant="outline-light"
                      size="sm"
                      onClick={() =>
                        router.push(`/portfolio/${walletAddress}`)
                      }
                    >
                      View portfolio
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/* ─────────── Sub-components ─────────── */

/**
 * Editable mandate panel — Stage 2.
 *
 * Renders the parsed MandateSchema as inline editable inputs inside the
 * pistachio card. Any change marks the form dirty and prompts the user to
 * re-validate via /mandate/validate before continuing.
 */
function MandateEditor({
  mandate,
  mandateUri,
  dirty,
  hash,
  onChange,
}: {
  mandate: MandateSchema;
  mandateUri: string;
  dirty: boolean;
  hash: string | null;
  onChange: (p: Partial<MandateSchema>) => void;
}) {
  function toggleLockup(t: LockupTier) {
    const next = mandate.allowedLockups.includes(t)
      ? mandate.allowedLockups.filter((x) => x !== t)
      : [...mandate.allowedLockups, t];
    onChange({ allowedLockups: next });
  }

  // BE returns minimumDepositUsdc as a BigIntString (1e6). Convert for display.
  const minDepositHuman = (() => {
    try {
      return (Number(BigInt(mandate.minimumDepositUsdc)) / 1e6).toString();
    } catch {
      return mandate.minimumDepositUsdc;
    }
  })();

  function setMinDeposit(raw: string) {
    const clean = raw.replace(/[^0-9.]/g, "");
    const n = Number(clean);
    if (!Number.isFinite(n) || n < 0) return;
    onChange({
      minimumDepositUsdc: BigInt(Math.floor(n * 1e6)).toString(),
    });
  }

  return (
    <div className="rounded-[12px] bg-pistachio px-6 py-6">
      <Field label="Name">
        <PistachioInput
          value={mandate.name}
          onChange={(v) => onChange({ name: v })}
        />
      </Field>
      <Field label="Ticker">
        <PistachioInput
          value={mandate.ticker}
          onChange={(v) => onChange({ ticker: v.toUpperCase().slice(0, 12) })}
          className="mono"
        />
      </Field>
      <Field label="Strategy">
        <PistachioTextarea
          value={mandate.description}
          onChange={(v) => onChange({ description: v })}
        />
      </Field>
      <Field label="Eligible assets" hint={`${mandate.targetUniverse.length} symbols`}>
        <span className="mono text-[12.5px] text-right text-ink max-w-[60%]">
          {mandate.targetUniverse.join(", ") || "—"}
        </span>
      </Field>
      <Field label="Asset classes">
        <span className="mono text-[12.5px] text-right text-ink max-w-[60%]">
          {mandate.assetClasses.join(", ")}
        </span>
      </Field>
      <Field label="Rebalance">
        <select
          value={mandate.rebalanceFrequency}
          onChange={(e) =>
            onChange({
              rebalanceFrequency: e.target
                .value as MandateSchema["rebalanceFrequency"],
            })
          }
          className="rounded-[6px] bg-canvas-cream/40 border border-pistachio-12 px-2 py-1 mono text-[13px] text-ink outline-none focus:border-ink disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {REBALANCE_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Allowed lockups">
        <div className="flex flex-wrap gap-1.5 justify-end">
          {ALL_LOCKUPS.map((t) => {
            const active = mandate.allowedLockups.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleLockup(t)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium mono transition-colors",
                  active
                    ? "border-ink bg-ink text-on-primary"
                    : "border-pistachio-12 bg-transparent text-ink hover:border-ink",
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Carry (bps)">
        <PistachioBpsInput
          value={mandate.carryBps}
          onChange={(v) => onChange({ carryBps: v })}
        />
      </Field>
      <Field label="Founder share (bps)">
        <PistachioBpsInput
          value={mandate.founderShareBps}
          onChange={(v) => onChange({ founderShareBps: v })}
        />
      </Field>
      <Field label="Founder lockup (days)">
        <PistachioIntInput
          value={mandate.founderLockupDays}
          onChange={(v) => onChange({ founderLockupDays: v })}
          suffix="d"
        />
      </Field>
      <Field label="Subordination cap (bps)">
        <PistachioBpsInput
          value={mandate.subordinationThresholdBps}
          onChange={(v) => onChange({ subordinationThresholdBps: v })}
        />
      </Field>
      <Field label="Max single position (bps)">
        <PistachioBpsInput
          value={mandate.maxSinglePositionBps}
          onChange={(v) => onChange({ maxSinglePositionBps: v })}
        />
      </Field>
      <Field label="Min deposit (USDC)" isLast>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            inputMode="decimal"
            value={minDepositHuman}
            onChange={(e) => setMinDeposit(e.target.value)}
            className="w-24 rounded-[6px] bg-canvas-cream/40 border border-pistachio-12 px-2 py-1 mono text-[13px] text-right text-ink outline-none focus:border-ink disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <span
            className="mono text-[11.5px]"
            style={{ color: "var(--pistachio-text-medium)" }}
          >
            USDC
          </span>
        </div>
      </Field>

      <div
        className="mt-4 mono text-[11px] flex flex-col gap-1"
        style={{ color: "var(--pistachio-text-soft)" }}
      >
        <div className="truncate">URI: {mandateUri || "—"}</div>
        <div className="truncate">
          Hash:{" "}
          <span
            className={cn(
              dirty ? "" : "underline",
              dirty && "italic",
            )}
            style={{
              color: dirty
                ? "var(--phase-incubation-text)"
                : "var(--pistachio-text-medium)",
            }}
          >
            {dirty ? "stale — re-validate to refresh" : hash ?? "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
  isLast,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  isLast?: boolean;
}) {
  return (
    <div
      className="flex justify-between items-center gap-4 py-2.5"
      style={
        isLast
          ? undefined
          : { borderBottom: "1px dashed var(--pistachio-divider)" }
      }
    >
      <div className="flex flex-col">
        <span
          className="text-[13px]"
          style={{ color: "var(--pistachio-text-medium)" }}
        >
          {label}
        </span>
        {hint && (
          <span
            className="text-[10.5px] mono"
            style={{ color: "var(--pistachio-text-soft)" }}
          >
            {hint}
          </span>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

const PISTACHIO_INPUT_BASE =
  "rounded-[6px] bg-canvas-cream/40 border border-pistachio-12 px-2 py-1 text-[13px] text-ink outline-none focus:border-ink disabled:opacity-60 disabled:cursor-not-allowed";

function PistachioInput({
  value,
  onChange,
  className,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        "w-48 sm:w-60 text-right",
        PISTACHIO_INPUT_BASE,
        className,
      )}
    />
  );
}

function PistachioTextarea({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        "w-72 min-h-[60px] leading-[1.5] resize-y",
        PISTACHIO_INPUT_BASE,
      )}
    />
  );
}

function PistachioBpsInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={10000}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0 && v <= 10000) onChange(v);
        }}
        disabled={disabled}
        className={cn("w-20 mono text-right", PISTACHIO_INPUT_BASE)}
      />
      <span
        className="mono text-[11.5px]"
        style={{ color: "var(--pistachio-text-medium)" }}
      >
        bps · {(value / 100).toFixed(2)}%
      </span>
    </div>
  );
}

function PistachioIntInput({
  value,
  onChange,
  suffix,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0) onChange(v);
        }}
        disabled={disabled}
        className={cn("w-20 mono text-right", PISTACHIO_INPUT_BASE)}
      />
      {suffix && (
        <span
          className="mono text-[11.5px]"
          style={{ color: "var(--pistachio-text-medium)" }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}

function PreviewRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex justify-between items-baseline text-[13.5px]">
      <span className="text-shade-50">{label}</span>
      <span className="mono text-ink">
        {value}
        {hint && <span className="ml-1 text-shade-50">· {hint}</span>}
      </span>
    </div>
  );
}

function PromptBox({
  tone,
  children,
}: {
  tone: "info" | "warn";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[8px] border p-4 mb-6 text-[13.5px]",
        tone === "warn"
          ? "border-amber-helm/30 bg-amber-bg"
          : "border-hairline-light bg-canvas-light",
      )}
      style={
        tone === "warn"
          ? { color: "var(--phase-incubation-text)" }
          : undefined
      }
    >
      {children}
    </div>
  );
}
