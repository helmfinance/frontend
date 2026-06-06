"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useChainId } from "wagmi";
import { mantleSepolia } from "@/lib/wagmi";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

type NavItem = {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
};

const NAV: NavItem[] = [
  { href: "/", label: "Marketplace", match: (p) => p === "/" },
  { href: "/portfolio", label: "Portfolio", match: (p) => p.startsWith("/portfolio") },
  { href: "/register", label: "Launch agent", match: (p) => p.startsWith("/register") },
];

export function Header() {
  const pathname = usePathname();
  const chainId = useChainId();
  const onCorrectChain = chainId === mantleSepolia.id;

  const [drawerOpen, setDrawerOpen] = useState(false);

  // Lock body scroll while drawer is open; close on route change.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  return (
    <>
      <header
        className="sticky top-0 z-30 border-b border-hairline-light backdrop-blur-md"
        style={{
          background: "color-mix(in srgb, var(--canvas-cream) 86%, transparent)",
        }}
      >
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-8">
          {/* Left: logo + nav */}
          <div className="flex min-w-0 items-center gap-6 sm:gap-8">
            <Link href="/" className="flex items-center gap-2">
              <HelmMark />
              <span className="font-display text-[22px] font-light leading-none tracking-[-0.01em] text-ink">
                Helm
              </span>
            </Link>

            <nav className="hidden items-center gap-1 sm:flex">
              {NAV.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[14px] font-medium transition-colors duration-[120ms]",
                      active
                        ? "bg-canvas-soft text-ink"
                        : "text-shade-60 hover:text-ink",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right: chain indicator + theme + wallet + mobile menu */}
          <div className="flex items-center gap-2">
            <ChainIndicator onCorrectChain={onCorrectChain} />
            <ThemeToggle />
            <WalletPill />
            <button
              type="button"
              aria-label={drawerOpen ? "Close menu" : "Open menu"}
              onClick={() => setDrawerOpen((v) => !v)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-hairline-light bg-canvas-light text-ink transition-colors hover:border-shade-30 sm:hidden"
            >
              {drawerOpen ? <IconClose /> : <IconBurger />}
            </button>
          </div>
        </div>
      </header>

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        pathname={pathname}
      />
    </>
  );
}

/* ─────────── Mobile drawer ─────────── */

function MobileDrawer({
  open,
  onClose,
  pathname,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
}) {
  return (
    <>
      {/* backdrop */}
      <button
        type="button"
        aria-hidden={!open}
        tabIndex={-1}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm transition-opacity duration-200 sm:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      {/* panel */}
      <aside
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-40 w-[80vw] max-w-[320px] border-l border-hairline-light bg-canvas-cream shadow-2xl transition-transform duration-200 sm:hidden",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-hairline-light px-4">
          <span className="font-display text-[20px] font-light text-ink">
            Menu
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-shade-60 hover:bg-canvas-soft hover:text-ink"
          >
            <IconClose />
          </button>
        </div>
        <nav className="flex flex-col gap-1 px-3 py-4">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "rounded-[8px] px-4 py-3 text-[15px] font-medium transition-colors",
                  active
                    ? "bg-canvas-soft text-ink"
                    : "text-shade-60 hover:bg-canvas-soft hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

/* ─────────── sub-components ─────────── */

function HelmMark() {
  return (
    <Image
      src="/helm-logo.svg"
      alt="Helm"
      width={26}
      height={26}
      priority
      className="h-[26px] w-[26px] flex-shrink-0"
    />
  );
}

function ChainIndicator({ onCorrectChain }: { onCorrectChain: boolean }) {
  return (
    <span
      className="hidden items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] text-shade-60 md:inline-flex"
      title={
        onCorrectChain
          ? "Mantle Sepolia · chain id 5003"
          : "Switch to Mantle Sepolia (chain id 5003)"
      }
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          onCorrectChain ? "bg-emerald-helm" : "bg-amber-helm",
        )}
      />
      Mantle Sepolia
    </span>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-hairline-light bg-canvas-light text-shade-60 transition-colors hover:border-shade-30 hover:text-ink"
    >
      {isDark ? <IconSun /> : <IconMoon />}
    </button>
  );
}

function WalletPill() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        mounted,
      }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        const wrongChain = connected && chain.unsupported;

        if (!ready) {
          return (
            <div
              aria-hidden
              className="h-[34px] w-[140px]"
              style={{ opacity: 0 }}
            />
          );
        }

        if (!connected) {
          return (
            <Button variant="primary" size="sm" onClick={openConnectModal}>
              Connect wallet
            </Button>
          );
        }

        if (wrongChain) {
          return (
            <Button variant="danger" size="sm" onClick={openChainModal}>
              Wrong network
            </Button>
          );
        }

        return (
          <button
            type="button"
            onClick={openAccountModal}
            className="mono inline-flex items-center gap-2 rounded-full border border-hairline-light bg-canvas-light px-3 py-1.5 text-[13px] text-ink transition-colors duration-[120ms] hover:border-shade-30"
            title="Open account modal"
          >
            <span
              aria-hidden
              className="block h-[22px] w-[22px] flex-shrink-0 rounded-full"
              style={{
                background:
                  "linear-gradient(135deg, #c1fbd4 0%, #99b3ad 50%, #1e2c31 100%)",
              }}
            />
            <span className="hidden sm:inline">{account.displayName}</span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

/* ─────────── Icons ─────────── */

function IconBurger() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
