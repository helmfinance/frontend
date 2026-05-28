/**
 * Wait for a tx to confirm AND throw if it reverted on-chain.
 *
 * `publicClient.waitForTransactionReceipt` resolves with the receipt either
 * way — it does NOT throw when the tx fails. The receipt's `status` field is
 * `"success"` or `"reverted"`. Forgetting to inspect it leads to false
 * positives where the UI says "done ✓" but no state changed on-chain.
 *
 * Use this helper instead of calling `waitForTransactionReceipt` directly.
 *
 * @example
 *   const hash = await writeContractAsync({ ... });
 *   const receipt = await waitForTx(publicClient, hash);
 *   // unreachable on revert — code below assumes success
 */

import type { PublicClient, TransactionReceipt } from "viem";

export class TransactionRevertedError extends Error {
  constructor(public hash: `0x${string}`) {
    super(`Transaction reverted on-chain: ${hash}`);
    this.name = "TransactionRevertedError";
  }
}

interface WaitForTxOptions {
  /** ms before we stop polling and throw. Defaults to 90s. */
  timeout?: number;
  /** Polling interval. Defaults to 2s (Mantle Sepolia block time). */
  pollingInterval?: number;
}

export async function waitForTx(
  publicClient: PublicClient,
  hash: `0x${string}`,
  opts: WaitForTxOptions = {},
): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: opts.timeout ?? 90_000,
    pollingInterval: opts.pollingInterval ?? 2_000,
  });
  if (receipt.status === "reverted") {
    throw new TransactionRevertedError(hash);
  }
  return receipt;
}
