/**
 * Submit a wallet write while bypassing MetaMask's stale nonce cache.
 *
 * Background (see docs/fe-nonce-fix.html):
 * MetaMask does not re-query the chain for a nonce on every tx — it keeps an
 * internal optimistic cache. On a young L2 like Mantle Sepolia the RPC's
 * confirmation view lags, so the cache drifts ahead of / behind chain state and
 * the next tx fails with `nonce too low` or `replacement transaction
 * underpriced`. The only layer we control is the FE, so we:
 *
 *   1. read the next nonce straight from the chain RPC with
 *      `getTransactionCount({ blockTag: "pending" })` and pass it explicitly to
 *      the wallet — overriding MetaMask's cached value, and
 *   2. on a nonce-class error (rare race), re-read a fresh nonce after a short
 *      backoff and retry once.
 *
 * The `submit` callback receives the resolved nonce and is expected to forward
 * it into `writeContractAsync({ ..., nonce })`. Keeping the write at the call
 * site means viem/wagmi types stay intact (no `any`).
 *
 * @example
 *   const hash = await writeWithNonce(publicClient, userAddress, (nonce) =>
 *     writeContractAsync({
 *       address: CONTRACTS.usdc as `0x${string}`,
 *       abi: erc20Abi,
 *       functionName: "approve",
 *       args: [spender, amount],
 *       nonce,
 *     }),
 *   );
 */

import type { PublicClient } from "viem";

/** Flatten an error and its `cause` chain (incl. viem fields) into one string. */
function errorText(err: unknown): string {
  let text = "";
  let cur: unknown = err;
  for (let depth = 0; cur instanceof Error && depth < 6; depth++) {
    text += ` ${cur.message}`;
    const viemish = cur as {
      details?: unknown;
      shortMessage?: unknown;
      cause?: unknown;
    };
    if (typeof viemish.details === "string") text += ` ${viemish.details}`;
    if (typeof viemish.shortMessage === "string") {
      text += ` ${viemish.shortMessage}`;
    }
    cur = viemish.cause;
  }
  if (!(err instanceof Error)) text += ` ${String(err)}`;
  return text.toLowerCase();
}

/** True for nonce-collision / replacement errors we can recover from by retry. */
export function isNonceError(err: unknown): boolean {
  const msg = errorText(err);
  return (
    msg.includes("nonce too low") ||
    msg.includes("nonce has already been used") ||
    msg.includes("replacement transaction underpriced") ||
    msg.includes("already known")
  );
}

export async function writeWithNonce(
  publicClient: PublicClient,
  userAddress: `0x${string}`,
  submit: (nonce: number) => Promise<`0x${string}`>,
): Promise<`0x${string}`> {
  const run = async () => {
    const nonce = await publicClient.getTransactionCount({
      address: userAddress,
      blockTag: "pending",
    });
    return submit(nonce);
  };

  try {
    return await run();
  } catch (err) {
    if (!isNonceError(err)) throw err;
    // Give the sequencer / RPC a moment to reconcile, then retry with a fresh nonce.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return run();
  }
}
