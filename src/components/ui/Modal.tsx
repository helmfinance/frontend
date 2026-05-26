"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  /** Backdrop click + ESC close. Defaults to true. Set false during in-flight tx. */
  dismissible?: boolean;
  /** Max content width in px (480 by default). */
  maxWidth?: number;
}

/**
 * Modal — rises 10px on open, 4px-blur backdrop, fixed inset.
 * Body overflow:hidden while open so the page doesn't double-scroll.
 */
export function Modal({
  open,
  onClose,
  title,
  footer,
  children,
  dismissible = true,
  maxWidth = 480,
}: ModalProps) {
  /* ESC to close */
  useEffect(() => {
    if (!open || !dismissible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, dismissible, onClose]);

  /* Lock background scroll */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      style={{
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        animation: "helm-fade-in 160ms ease",
      }}
      onClick={() => dismissible && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-[12px] bg-canvas-light",
        )}
        style={{
          maxWidth: `${maxWidth}px`,
          boxShadow: "var(--elev-4)",
          animation: "helm-modal-rise 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 border-b border-hairline-light px-6 py-5">
            <div className="text-[16.5px] font-medium text-ink">{title}</div>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-full text-shade-50 transition-colors hover:bg-canvas-soft hover:text-ink"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M2 2L12 12M12 2L2 12"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-7">{children}</div>
        {footer && (
          <div className="flex gap-2 border-t border-hairline-light px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
