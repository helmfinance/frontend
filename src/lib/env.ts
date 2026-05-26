/**
 * Typed access to public env vars.
 * Server-only env vars (e.g. private keys) must NOT be exposed here.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  apiUrl: required("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL),
  chainId: Number(
    required("NEXT_PUBLIC_CHAIN_ID", process.env.NEXT_PUBLIC_CHAIN_ID),
  ),
  walletConnectProjectId: required(
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  ),
} as const;
