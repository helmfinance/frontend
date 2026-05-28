"use client";

/**
 * Admin console — /admin.
 *
 * Hackathon demo/judging console. Three cards:
 *
 *   1. Time acceleration   — POST /admin/time/advance (BE owner relays to chain)
 *   2. Mint MockUSDC       — POST /admin/mint-usdc
 *   3. Manual triggers     — POST /admin/agents/{id}/{rebalance|harvest|distribute|nft-metadata}
 *
 * Live current-time is read directly from TimeProvider.currentTime() so the
 * card reflects the on-chain clock immediately after an advance.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseAbi } from "viem";
import { api, ApiError } from "@/lib/api";
import { CONTRACTS, mantleSepolia } from "@/lib/wagmi";
import { USDC_DECIMALS } from "@/lib/contracts-constants";
import { decodeContractError } from "@/lib/decodeError";
import { Button, Modal } from "@/components/ui";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import type { components } from "@/lib/api-types.gen";

type AgentSummary = components["schemas"]["AgentSummary"];
type AgentListResponse = components["schemas"]["Page_AgentSummary_"];
type QualificationResponse = components["schemas"]["QualificationResponse"];

const REGISTRY_SLASH_ABI = parseAbi([
  "function slash(uint256 agentId, string reason)",
]);

const TIME_PROVIDER_ABI = parseAbi([
  "function currentTime() view returns (uint256)",
]);

const SECONDS_PER_DAY = 86_400;

export default function AdminPage() {
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

      <h1 className="font-display text-[40px] sm:text-[48px] font-light leading-[1.05] text-ink mb-3">
        Admin · testnet demo
      </h1>
      <p className="text-[15px] text-shade-60 mb-8 max-w-[640px]">
        Hackathon judging console. Advance the clock, mint test capital, and
        trigger agent maintenance hooks. All endpoints require the BE owner key.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TimeAccelerationCard />
        <MintUsdcCard />
        <ManualTriggersCard />
        <QualifyCard />
        <DebugInspector />
        <DangerZoneCard />
      </div>
    </main>
  );
}

/* ─────────── Time acceleration ─────────── */

function TimeAccelerationCard() {
  const { push: toast } = useToast();
  const [busy, setBusy] = useState(false);

  const {
    data: currentTimeRaw,
    refetch,
  } = useReadContract({
    address: CONTRACTS.timeProvider as `0x${string}`,
    abi: TIME_PROVIDER_ABI,
    functionName: "currentTime",
    query: { refetchInterval: 10_000 },
  });

  const currentTime = currentTimeRaw ? Number(currentTimeRaw) : null;
  const realNow = Math.floor(Date.now() / 1000);
  const driftDays = currentTime
    ? Math.floor((currentTime - realNow) / SECONDS_PER_DAY)
    : null;

  async function advance(days: number) {
    setBusy(true);
    try {
      const seconds = days * SECONDS_PER_DAY;
      const r = await api.post("/admin/time/advance", { seconds });
      toast({
        msg: `+${days}d advanced · clock now ${new Date(
          r.newCurrentTime * 1000,
        ).toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}`,
        tx: r.txHash,
      });
      // refetch the on-chain clock immediately
      refetch();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.status}: ${JSON.stringify(e.detail)}`
          : ((e as Error)?.message ?? "Unknown error");
      toast({ msg: `Advance failed — ${msg}`, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!confirm("Reset TimeProvider offset to 0? This rolls back any +1d / +7d / +30d advances.")) {
      return;
    }
    setBusy(true);
    try {
      const r = (await api.post("/admin/time/reset", undefined)) as {
        txHash?: string;
        newCurrentTime?: number;
      };
      toast({
        msg: "TimeProvider offset reset",
        tx: r.txHash,
      });
      refetch();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.status}: ${JSON.stringify(e.detail)}`
          : ((e as Error)?.message ?? "Unknown error");
      toast({ msg: `Reset failed — ${msg}`, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminCard label="Time acceleration">
      <div className="mono text-[36px] font-medium leading-none tabular-nums text-ink">
        {currentTime ? (
          <>
            Day{" "}
            {Math.floor(currentTime / SECONDS_PER_DAY) -
              Math.floor(realNow / SECONDS_PER_DAY) >=
            0
              ? `+${Math.floor(currentTime / SECONDS_PER_DAY) - Math.floor(realNow / SECONDS_PER_DAY)}`
              : `${Math.floor(currentTime / SECONDS_PER_DAY) - Math.floor(realNow / SECONDS_PER_DAY)}`}
          </>
        ) : (
          "—"
        )}
      </div>
      <div className="text-[13px] text-shade-50 mt-2 mb-4">
        {currentTime ? (
          <>
            <span className="mono">
              {new Date(currentTime * 1000).toLocaleString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {driftDays !== null && (
              <>
                {" "}
                · {driftDays >= 0 ? `+${driftDays}` : driftDays}d from real
                time
              </>
            )}
          </>
        ) : (
          "loading TimeProvider…"
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline-light"
          size="sm"
          onClick={() => advance(1)}
          disabled={busy}
        >
          +1d
        </Button>
        <Button
          variant="outline-light"
          size="sm"
          onClick={() => advance(7)}
          disabled={busy}
        >
          +7d
        </Button>
        <Button
          variant="outline-light"
          size="sm"
          onClick={() => advance(30)}
          disabled={busy}
        >
          +30d
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={busy}
          className="ml-auto"
        >
          Reset
        </Button>
      </div>
    </AdminCard>
  );
}

/* ─────────── Mint MockUSDC ─────────── */

function MintUsdcCard() {
  const { address } = useAccount();
  const { push: toast } = useToast();
  const [amount, setAmount] = useState("10000");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  const targetAddress = to.trim() || address || "";
  const isValidTarget = /^0x[a-fA-F0-9]{40}$/.test(targetAddress);

  async function mint() {
    if (!isValidTarget) {
      toast({ msg: "Invalid recipient address", variant: "error" });
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ msg: "Invalid amount", variant: "error" });
      return;
    }
    setBusy(true);
    try {
      const amountUsdc = BigInt(
        Math.floor(amt * 10 ** USDC_DECIMALS),
      ).toString();
      const r = await api.post("/admin/mint-usdc", {
        to: targetAddress,
        amountUsdc,
      });
      toast({
        msg: `Minted ${amt.toLocaleString()} USDC to ${shortAddr(targetAddress)}`,
        tx: r.txHash,
      });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.status}: ${JSON.stringify(e.detail)}`
          : ((e as Error)?.message ?? "Unknown error");
      toast({ msg: `Mint failed — ${msg}`, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminCard label="Mint MockUSDC">
      <div className="flex items-center gap-3 rounded-[8px] px-4 py-3 bg-canvas-cream border border-hairline-light focus-within:border-ink transition-colors">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) =>
            setAmount(e.target.value.replace(/[^0-9.]/g, ""))
          }
          placeholder="10000"
          className="flex-1 min-w-0 bg-transparent border-0 outline-none mono tabular-nums text-[22px] font-medium leading-none placeholder:text-shade-40"
        />
        <span className="text-[13px] font-medium text-shade-50">USDC</span>
      </div>
      <div className="mt-3">
        <label className="block text-[11.5px] font-medium uppercase tracking-[0.06em] text-shade-50 mb-1.5">
          Recipient
        </label>
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={address ?? "0x…"}
          className={cn(
            "w-full rounded-[8px] border bg-canvas-cream px-3 py-2 mono text-[12.5px] outline-none focus:border-ink transition-colors",
            isValidTarget ? "border-hairline-light" : "border-red-helm/40",
          )}
        />
        <div className="mt-1.5 text-[12px] text-shade-50">
          {to.trim()
            ? isValidTarget
              ? "custom recipient"
              : "invalid address"
            : address
              ? "→ your connected wallet"
              : "connect a wallet or paste an address"}
        </div>
      </div>
      <div className="mt-4">
        <Button
          variant="primary"
          size="sm"
          onClick={mint}
          disabled={busy || !isValidTarget}
        >
          {busy ? "Minting…" : "Mint to wallet"}
        </Button>
      </div>
    </AdminCard>
  );
}

/* ─────────── Manual triggers ─────────── */

function ManualTriggersCard() {
  const { push: toast } = useToast();
  const [agentId, setAgentId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-agents-list"],
    queryFn: () =>
      api.get("/agents", {
        query: { limit: 100 },
      }) as Promise<AgentListResponse>,
    staleTime: 30_000,
  });

  const agents = useMemo<AgentSummary[]>(() => data?.items ?? [], [data]);

  // Default to the first agent in the list once we have data.
  if (agentId === null && agents.length > 0) {
    const first = agents[0];
    if (first) {
      setTimeout(() => setAgentId(first.agentId), 0);
    }
  }

  async function trigger(
    op:
      | "rebalance"
      | "harvest"
      | "distribute"
      | "nft-metadata"
      | "register-with-synthetics",
    label: string,
  ) {
    if (!agentId) {
      toast({ msg: "Select an agent first", variant: "error" });
      return;
    }
    setBusy(op);
    try {
      const r = (await api.post(
        `/admin/agents/{agent_id}/${op}` as
          | "/admin/agents/{agent_id}/rebalance"
          | "/admin/agents/{agent_id}/harvest"
          | "/admin/agents/{agent_id}/distribute"
          | "/admin/agents/{agent_id}/nft-metadata"
          | "/admin/agents/{agent_id}/register-with-synthetics",
        undefined,
        { path: { agent_id: agentId } },
      )) as { txHash?: string; distributeTxHash?: string | null };
      const txHash =
        ("distributeTxHash" in r && r.distributeTxHash) ||
        ("txHash" in r && r.txHash) ||
        undefined;
      toast({
        msg: `${label} triggered · agent #${agentId}`,
        tx: txHash ?? undefined,
      });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.status}: ${JSON.stringify(e.detail)}`
          : ((e as Error)?.message ?? "Unknown error");
      toast({ msg: `${label} failed — ${msg}`, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="lg:col-span-2 rounded-[12px] border border-hairline-light bg-canvas-light p-6">
      <div className="eyebrow mb-3">Manual agent triggers</div>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select
          className="flex-1 rounded-[8px] border border-hairline-light bg-canvas-cream px-3 py-2.5 text-[14px] outline-none focus:border-ink transition-colors"
          value={agentId ?? ""}
          onChange={(e) => setAgentId(Number(e.target.value))}
          disabled={isLoading || agents.length === 0}
        >
          {isLoading && <option value="">Loading agents…</option>}
          {!isLoading && agents.length === 0 && (
            <option value="">No agents found</option>
          )}
          {agents.map((a) => (
            <option key={a.agentId} value={a.agentId}>
              #{String(a.agentId).padStart(3, "0")} · {a.name} (${a.ticker}) · {a.phase}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline-light"
          size="sm"
          disabled={busy !== null || !agentId}
          onClick={() => trigger("rebalance", "Rebalance")}
        >
          {busy === "rebalance" ? "…" : "Trigger rebalance"}
        </Button>
        <Button
          variant="outline-light"
          size="sm"
          disabled={busy !== null || !agentId}
          onClick={() => trigger("harvest", "Harvest")}
        >
          {busy === "harvest" ? "…" : "Trigger harvest"}
        </Button>
        <Button
          variant="outline-light"
          size="sm"
          disabled={busy !== null || !agentId}
          onClick={() => trigger("distribute", "Distribute")}
        >
          {busy === "distribute" ? "…" : "Trigger distribute"}
        </Button>
        <Button
          variant="outline-light"
          size="sm"
          disabled={busy !== null || !agentId}
          onClick={() => trigger("nft-metadata", "NFT metadata")}
        >
          {busy === "nft-metadata" ? "…" : "Refresh NFT metadata"}
        </Button>
        <Button
          variant="outline-light"
          size="sm"
          disabled={busy !== null || !agentId}
          onClick={() =>
            trigger("register-with-synthetics", "Synthetic whitelist sync")
          }
        >
          {busy === "register-with-synthetics"
            ? "…"
            : "Sync synthetic whitelists"}
        </Button>
        <SlashAgentButton
          agentId={agentId}
          agentLabel={
            agents.find((a) => a.agentId === agentId)?.name ?? null
          }
        />
      </div>
      <p className="mt-4 text-[12px] text-shade-50 leading-[1.5]">
        Note: Rebalance computes new target weights and submits an
        executeRebalance tx. Harvest pulls yield to the agent vault.
        Distribute snapshots holders + transfers the holders&apos; share via
        DividendDistributor. NFT metadata regenerates and pins to IPFS.
        Sync synthetic whitelists adds this vault to each sNVDA/sSPY/sAAPL/sTSLA/sMSFT
        allow-list (only useful for agents registered before the auto-wire fix
        — new ones don&apos;t need it). Slash transitions the agent to Slashed
        phase + cascades wind-down.
      </p>
    </div>
  );
}

/* ─────────── Slash button (chain direct) ─────────── */

function SlashAgentButton({
  agentId,
  agentLabel,
}: {
  agentId: number | null;
  agentLabel: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { push: toast } = useToast();
  const onCorrectChain = chainId === mantleSepolia.id;
  const confirmPhrase = "slash";

  async function run() {
    if (!agentId || !publicClient || !onCorrectChain) return;
    if (!reason.trim()) {
      toast({ msg: "Provide a slash reason", variant: "error" });
      return;
    }
    if (confirmText.trim().toLowerCase() !== confirmPhrase) {
      toast({ msg: `Type "${confirmPhrase}" to confirm`, variant: "error" });
      return;
    }
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.registry as `0x${string}`,
        abi: REGISTRY_SLASH_ABI,
        functionName: "slash",
        args: [BigInt(agentId), reason.trim()],
      });
      await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 90_000,
        pollingInterval: 2_000,
      });
      toast({ msg: `Agent #${agentId} slashed`, tx: hash });
      setOpen(false);
      setReason("");
      setConfirmText("");
    } catch (e) {
      const { message } = decodeContractError(e);
      toast({ msg: `Slash failed — ${message}`, variant: "error" });
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
        disabled={!agentId}
      >
        Slash agent
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Slash agent"
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
                confirmText.trim().toLowerCase() !== confirmPhrase ||
                !onCorrectChain
              }
            >
              {busy ? "Slashing…" : "Confirm slash"}
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
            Slashes the agent NFT, marks the registry phase as Slashed,
            triggers wind-down, and zeroes the reputation score. Founder
            shares settle last.
            <br />
            Target ·{" "}
            <span className="mono">
              #{String(agentId ?? 0).padStart(3, "0")}
              {agentLabel ? ` · ${agentLabel}` : ""}
            </span>
          </div>

          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-shade-50 mb-2">
              Reason (recorded on-chain)
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. mandate violation, unauthorized leverage, oracle abuse"
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

/* ─────────── Qualify card ─────────── */

function QualifyCard() {
  const { push: toast } = useToast();
  const [agentId, setAgentId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: agentList } = useQuery({
    queryKey: ["admin-agents-list"],
    queryFn: () =>
      api.get("/agents", {
        query: { limit: 100, phase: ["Incubation"] },
      } as never) as Promise<AgentListResponse>,
    staleTime: 30_000,
  });
  const incubatingAgents: AgentSummary[] = useMemo(
    () => agentList?.items ?? [],
    [agentList],
  );

  if (
    agentId === null &&
    incubatingAgents.length > 0 &&
    incubatingAgents[0]
  ) {
    const first = incubatingAgents[0];
    setTimeout(() => setAgentId(first.agentId), 0);
  }

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["qualify-check", agentId],
    queryFn: () =>
      api.get("/admin/agents/{agent_id}/qualify", {
        path: { agent_id: agentId! },
      }) as Promise<QualificationResponse>,
    enabled: !!agentId,
    staleTime: 15_000,
  });

  async function advance() {
    if (!agentId) return;
    setBusy(true);
    try {
      const r = (await api.post(
        "/admin/agents/{agent_id}/qualify",
        undefined,
        { path: { agent_id: agentId } },
      )) as QualificationResponse;
      if (r.advanced) {
        toast({
          msg: `Agent #${agentId} advanced to ${r.newPhase ?? "PublicLaunch"}`,
          tx: r.txHash ?? undefined,
        });
      } else {
        toast({
          msg: `Agent #${agentId} did not qualify — see checks`,
          variant: "error",
        });
      }
      refetch();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.status}: ${JSON.stringify(e.detail)}`
          : ((e as Error)?.message ?? "Unknown error");
      toast({ msg: `Qualify failed — ${msg}`, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[12px] border border-hairline-light bg-canvas-light p-6">
      <div className="eyebrow mb-3">Phase 2 qualification</div>
      {incubatingAgents.length === 0 ? (
        <p className="text-[13.5px] text-shade-50">
          No incubating agents.
        </p>
      ) : (
        <>
          <select
            className="w-full rounded-[8px] border border-hairline-light bg-canvas-cream px-3 py-2.5 text-[14px] outline-none focus:border-ink"
            value={agentId ?? ""}
            onChange={(e) => setAgentId(Number(e.target.value))}
          >
            {incubatingAgents.map((a) => (
              <option key={a.agentId} value={a.agentId}>
                #{String(a.agentId).padStart(3, "0")} · {a.name} (${a.ticker})
              </option>
            ))}
          </select>

          <div className="mt-4 rounded-[8px] bg-canvas-cream p-4">
            {isLoading || !data ? (
              <p className="text-[13px] text-shade-50">Loading checks…</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between mb-3">
                  <span className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-shade-50">
                    Overall
                  </span>
                  <span
                    className={cn(
                      "mono text-[14px] font-medium",
                      data.overallPassed
                        ? "text-emerald-helm"
                        : "text-amber-helm",
                    )}
                  >
                    {data.overallPassed ? "PASS" : "PENDING"}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {data.checks.map((c) => (
                    <div
                      key={c.name}
                      className="flex justify-between items-baseline gap-3 text-[12.5px]"
                    >
                      <span className="text-shade-60">
                        <span
                          className={cn(
                            "inline-block w-2 h-2 rounded-full mr-2 align-middle",
                            c.passed ? "bg-emerald-helm" : "bg-shade-30",
                          )}
                        />
                        {c.name}
                      </span>
                      <span className="mono text-shade-60">
                        {c.actual}
                        <span className="text-shade-50"> / {c.threshold}</span>
                      </span>
                    </div>
                  ))}
                </div>
                {data.advanced && (
                  <div
                    className="mt-3 text-[12px] mono"
                    style={{ color: "var(--phase-public-text)" }}
                  >
                    ✓ Already advanced{data.newPhase ? ` → ${data.newPhase}` : ""}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mt-4">
            <Button
              variant="aloe"
              size="sm"
              onClick={advance}
              disabled={busy || !data?.overallPassed || data?.advanced}
            >
              {busy
                ? "Advancing…"
                : data?.advanced
                  ? "Already advanced"
                  : data?.overallPassed
                    ? "Advance to PublicLaunch →"
                    : "Not yet qualified"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────── Debug inspector ─────────── */

type DebugEndpoint =
  | "/admin/debug/indexer-state"
  | "/admin/debug/synthetic-prices"
  | "/admin/debug/adapters"
  | "/admin/debug/treasury";

const DEBUG_GLOBAL: { path: DebugEndpoint; label: string; blurb: string }[] = [
  {
    path: "/admin/debug/indexer-state",
    label: "Indexer state",
    blurb: "Last-indexed block vs chain head + lag",
  },
  {
    path: "/admin/debug/synthetic-prices",
    label: "Synthetic prices",
    blurb: "Pyth feed prices + freshness per synth",
  },
  {
    path: "/admin/debug/adapters",
    label: "Adapters",
    blurb: "mETH/USDY adapter health",
  },
  {
    path: "/admin/debug/treasury",
    label: "Treasury",
    blurb: "PlatformTreasury balances + fee accruals",
  },
];

type DebugPerAgent =
  | "compare"
  | "founder-vault"
  | "redemption-queue";

const DEBUG_PER_AGENT: { kind: DebugPerAgent; label: string; blurb: string }[] = [
  {
    kind: "compare",
    label: "BE ↔ chain compare",
    blurb: "DB state vs live chain state for the agent",
  },
  {
    kind: "founder-vault",
    label: "FounderVault inspector",
    blurb: "Live FV: shares, withdrawals, carry, subordination",
  },
  {
    kind: "redemption-queue",
    label: "RedemptionQueue inspector",
    blurb: "Per-agent queue: pending requests + unlocks",
  },
];

function DebugInspector() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<number | null>(null);

  const { data: agentList } = useQuery({
    queryKey: ["admin-agents-list"],
    queryFn: () =>
      api.get("/agents", {
        query: { limit: 100 },
      }) as Promise<AgentListResponse>,
    staleTime: 30_000,
  });
  const agents: AgentSummary[] = useMemo(
    () => agentList?.items ?? [],
    [agentList],
  );
  if (agentId === null && agents.length > 0 && agents[0]) {
    const first = agents[0];
    setTimeout(() => setAgentId(first.agentId), 0);
  }

  return (
    <div className="lg:col-span-2 rounded-[12px] border border-hairline-light bg-canvas-light p-6">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="eyebrow">Debug inspector</div>
        <select
          className="rounded-[8px] border border-hairline-light bg-canvas-cream px-3 py-1.5 text-[13px] outline-none focus:border-ink"
          value={agentId ?? ""}
          onChange={(e) => setAgentId(Number(e.target.value))}
        >
          {agents.map((a) => (
            <option key={a.agentId} value={a.agentId}>
              #{String(a.agentId).padStart(3, "0")} · {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {DEBUG_GLOBAL.map((d) => (
          <DebugAccordion
            key={d.path}
            label={d.label}
            blurb={d.blurb}
            id={d.path}
            openKey={openKey}
            setOpenKey={setOpenKey}
            fetcher={() => api.get(d.path)}
          />
        ))}
        {DEBUG_PER_AGENT.map((d) => (
          <DebugAccordion
            key={`agent-${d.kind}`}
            label={d.label}
            blurb={d.blurb}
            id={`agent-${d.kind}`}
            openKey={openKey}
            setOpenKey={setOpenKey}
            disabled={!agentId}
            fetcher={() => {
              if (!agentId) return Promise.reject(new Error("No agent"));
              if (d.kind === "compare")
                return api.get("/admin/debug/agents/{agent_id}/compare", {
                  path: { agent_id: agentId },
                });
              if (d.kind === "founder-vault")
                return api.get(
                  "/admin/debug/agents/{agent_id}/founder-vault",
                  { path: { agent_id: agentId } },
                );
              return api.get(
                "/admin/debug/agents/{agent_id}/redemption-queue",
                { path: { agent_id: agentId } },
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}

function DebugAccordion({
  label,
  blurb,
  id,
  openKey,
  setOpenKey,
  fetcher,
  disabled,
}: {
  label: string;
  blurb: string;
  id: string;
  openKey: string | null;
  setOpenKey: (k: string | null) => void;
  fetcher: () => Promise<unknown>;
  disabled?: boolean;
}) {
  const open = openKey === id;
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["debug", id],
    queryFn: fetcher,
    enabled: open && !disabled,
    retry: false,
    staleTime: 10_000,
  });

  return (
    <div className="rounded-[8px] border border-hairline-light bg-canvas-cream">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpenKey(open ? null : id)}
        className={cn(
          "w-full text-left px-4 py-3 flex items-center justify-between gap-3",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-ink">{label}</div>
          <div className="text-[11.5px] text-shade-50 truncate">{blurb}</div>
        </div>
        <span
          className={cn(
            "text-[11px] mono text-shade-50 transition-transform",
            open && "rotate-90",
          )}
        >
          ▸
        </span>
      </button>
      {open && (
        <div className="border-t border-hairline-light p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] mono text-shade-50">JSON</span>
            <button
              onClick={() => refetch()}
              className="text-[11px] underline text-shade-60 hover:text-ink"
            >
              refresh
            </button>
          </div>
          {isLoading && (
            <div className="h-20 animate-pulse bg-hairline-light rounded" />
          )}
          {isError && (
            <pre className="text-[11px] text-red-helm whitespace-pre-wrap">
              {error instanceof ApiError
                ? `${error.status}: ${JSON.stringify(error.detail, null, 2)}`
                : ((error as Error)?.message ?? "error")}
            </pre>
          )}
          {data !== undefined && data !== null && (
            <pre className="text-[11px] mono leading-[1.5] max-h-[260px] overflow-auto whitespace-pre-wrap">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────── Atoms ─────────── */

/* ─────────── Danger zone — wipe indexer ─────────── */

function DangerZoneCard() {
  const { push: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const phrase = "wipe all";

  async function run() {
    if (confirmText.trim().toLowerCase() !== phrase) {
      toast({ msg: `Type "${phrase}" to confirm`, variant: "error" });
      return;
    }
    setBusy(true);
    try {
      await api.post("/admin/wipe-all", undefined);
      toast({ msg: "Indexer state wiped — agents/decisions/dividends gone" });
      setConfirmText("");
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.status}: ${JSON.stringify(e.detail)}`
          : ((e as Error)?.message ?? "Unknown error");
      toast({ msg: `Wipe failed — ${msg}`, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lg:col-span-2 rounded-[12px] border border-red-helm/30 bg-red-bg/10 p-6">
      <div className="eyebrow mb-2" style={{ color: "var(--phase-slashed-text)" }}>
        Danger zone
      </div>
      <p className="text-[13px] mb-3" style={{ color: "var(--phase-slashed-text)" }}>
        Wipes all indexer state — agents, decisions, dividends, NAV history.
        On-chain contracts are untouched. Use after redeploying contracts so the
        BE re-indexes from a clean slate.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={`Type "${phrase}" to confirm`}
          className="rounded-[8px] border border-hairline-light bg-canvas-cream px-3 py-2 mono text-[13px] outline-none focus:border-ink min-w-[200px]"
        />
        <Button
          variant="danger"
          size="sm"
          onClick={run}
          disabled={busy || confirmText.trim().toLowerCase() !== phrase}
        >
          {busy ? "Wiping…" : "Wipe all indexer data"}
        </Button>
      </div>
    </div>
  );
}

function AdminCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[12px] border border-hairline-light bg-canvas-light p-6">
      <div className="eyebrow mb-3">{label}</div>
      {children}
    </div>
  );
}

function shortAddr(a: string): string {
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
