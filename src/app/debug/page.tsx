"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { api, ApiError } from "@/lib/api";
import { mantleSepolia } from "@/lib/wagmi";
import type { components } from "@/lib/api-types.gen";
import { env } from "@/lib/env";

type SystemInfo = components["schemas"]["SystemInfo"];
type Health = { ok: boolean; db: boolean; chain: boolean };

export default function DebugPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const onCorrectChain = chainId === mantleSepolia.id;

  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [info, h] = await Promise.all([
          api.get("/system/info"),
          fetch(`${env.apiUrl}/health`).then((r) => r.json()) as Promise<Health>,
        ]);
        if (cancelled) return;
        setSystemInfo(info);
        setHealth(h);
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof ApiError
            ? `API ${e.status}: ${JSON.stringify(e.detail)}`
            : e instanceof Error
              ? e.message
              : String(e);
        setError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="px-6 sm:px-12 py-8 max-w-4xl mx-auto space-y-8 font-sans">
      <section>
        <h1 className="text-xl font-semibold tracking-tight">Setup checks</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Wallet + chain + backend wiring verification. Safe to remove once the
          marketplace is loading.
        </p>
        <ul className="space-y-1 text-sm mt-4">
          <Check
            label="Wallet connected"
            ok={isConnected}
            value={isConnected ? address : "—"}
          />
          <Check
            label="Chain"
            ok={onCorrectChain}
            value={
              chainId
                ? `${chainId}${onCorrectChain ? " (Mantle Sepolia ✓)" : " (wrong chain)"}`
                : "—"
            }
          />
          <Check
            label="Backend /health"
            ok={!!health?.ok}
            value={
              health
                ? `db=${health.db ? "✓" : "✗"} chain=${health.chain ? "✓" : "✗"}`
                : "loading…"
            }
          />
          <Check
            label="Backend /system/info"
            ok={!!systemInfo}
            value={
              systemInfo
                ? `chainId=${systemInfo.chainId} · ${systemInfo.syntheticAssets?.length ?? 0} synths`
                : (error ?? "loading…")
            }
          />
        </ul>
      </section>

      {systemInfo && (
        <section>
          <h2 className="text-sm font-medium uppercase text-zinc-500 mb-2">
            Deployed contracts
          </h2>
          <pre className="text-xs bg-zinc-50 dark:bg-zinc-900 p-3 rounded border overflow-x-auto">
            {JSON.stringify(systemInfo.contracts, null, 2)}
          </pre>
        </section>
      )}

      {systemInfo && (
        <section>
          <h2 className="text-sm font-medium uppercase text-zinc-500 mb-2">
            Synthetic assets ({systemInfo.syntheticAssets?.length ?? 0})
          </h2>
          <table className="text-xs w-full">
            <thead className="text-zinc-500">
              <tr>
                <th className="text-left py-1">Symbol</th>
                <th className="text-left">Underlying</th>
                <th className="text-left">Address</th>
              </tr>
            </thead>
            <tbody>
              {systemInfo.syntheticAssets?.map((s) => (
                <tr key={s.address} className="border-t">
                  <td className="py-1 font-mono">{s.symbol}</td>
                  <td>{s.underlying}</td>
                  <td className="font-mono text-zinc-500 truncate max-w-[24ch]">
                    {s.address}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {error && (
        <section className="text-red-700 text-sm">
          <strong>Error:</strong> {error}
        </section>
      )}
    </main>
  );
}

function Check({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value?: string | null;
}) {
  return (
    <li className="flex justify-between gap-4 py-1 border-b border-zinc-100 dark:border-zinc-800">
      <span className="text-zinc-700 dark:text-zinc-300">
        <span className={ok ? "text-green-600" : "text-zinc-400"}>
          {ok ? "✓" : "○"}
        </span>{" "}
        {label}
      </span>
      <span className="font-mono text-xs text-zinc-500 truncate max-w-[50ch]">
        {value}
      </span>
    </li>
  );
}
