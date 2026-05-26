"use client";

/**
 * Portfolio landing page.
 *
 * Auto-redirects to /portfolio/{address} once a wallet is connected.
 * Renders a connect-prompt otherwise.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export default function PortfolioLandingPage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();

  useEffect(() => {
    if (isConnected && address) {
      router.replace(`/portfolio/${address}`);
    }
  }, [isConnected, address, router]);

  return (
    <main className="mx-auto max-w-[1440px] px-4 sm:px-8 py-16">
      <div className="mx-auto max-w-md text-center">
        <div className="eyebrow mb-2">Portfolio</div>
        <h1 className="font-display text-[40px] sm:text-[48px] font-light leading-[1.05] text-ink mb-3">
          Your positions
        </h1>
        <p className="text-[14.5px] text-shade-50 mb-6">
          Connect your wallet to view holdings, dividends and pending
          redemptions.
        </p>
        <div className="inline-block">
          <ConnectButton />
        </div>
      </div>
    </main>
  );
}
