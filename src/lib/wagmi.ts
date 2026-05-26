/**
 * Wagmi v2 + viem config for Mantle Sepolia.
 *
 * RainbowKit is wired in src/app/providers.tsx — this module only defines the
 * chain + config so it can be imported on the server (e.g. for typed contract
 * helpers).
 */

import { defineChain } from "viem";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import addresses from "@/lib/addresses.json";
import { env } from "@/lib/env";

export const mantleSepolia = defineChain({
  id: addresses.chain.id,
  name: addresses.chain.name,
  nativeCurrency: addresses.chain.nativeCurrency,
  rpcUrls: { default: { http: [addresses.chain.rpcUrl] } },
  blockExplorers: {
    default: {
      name: "Mantlescan",
      url: addresses.chain.explorerUrl,
    },
  },
  testnet: true,
});

if (mantleSepolia.id !== env.chainId) {
  throw new Error(
    `Chain mismatch: addresses.json id=${mantleSepolia.id} vs NEXT_PUBLIC_CHAIN_ID=${env.chainId}`,
  );
}

export const wagmiConfig = getDefaultConfig({
  appName: "Helm",
  projectId: env.walletConnectProjectId,
  chains: [mantleSepolia],
  ssr: true,
});

/** Quick-access typed contract addresses. */
export const CONTRACTS = addresses.contracts;
export const SYNTHETIC_ASSETS = addresses.syntheticAssets;
export const EXTERNAL_CONTRACTS = addresses.externalContracts;
