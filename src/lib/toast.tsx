"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

const EXPLORER = "https://sepolia.mantlescan.xyz";

export type ToastInput = {
  msg: ReactNode;
  /** Optional 0x-prefixed tx hash; appends a Mantlescan link in the toast. */
  tx?: string;
  /** Custom dwell time in ms (default 4200). */
  duration?: number;
  variant?: "default" | "error";
};

type ToastItem = ToastInput & { id: string };

interface ToastCtx {
  push: (t: ToastInput) => void;
  dismiss: (id: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) {
    // Soft-fail (e.g. component tested in isolation) so render path doesn't crash.
    return {
      push: (t) =>
        // eslint-disable-next-line no-console
        console.warn("[toast] ToastProvider missing — message:", t),
      dismiss: () => {},
    };
  }
  return v;
}

/**
 * Bottom-right pill toasts. Inject once at the app root (inside Providers).
 * Pushes auto-dismiss after `duration` ms.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: ToastInput) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, ...t }]);
      const duration = t.duration ?? 4200;
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={{ push, dismiss }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastBubble key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastBubble({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  const isError = item.variant === "error";
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-3 rounded-full px-[18px] py-[14px] text-[13.5px] max-w-[380px]",
        isError ? "bg-red-helm text-white" : "bg-ink text-on-primary",
      )}
      style={{
        boxShadow: "var(--elev-4)",
        animation: "helm-toast-in 200ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onClick={onDismiss}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full flex-shrink-0",
          isError ? "bg-white" : "bg-aloe",
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="truncate">{item.msg}</div>
        {item.tx && (
          <a
            href={`${EXPLORER}/tx/${item.tx}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[11.5px] mt-0.5 opacity-80 hover:opacity-100 underline mono truncate"
            onClick={(e) => e.stopPropagation()}
          >
            tx {item.tx.slice(0, 10)}…
          </a>
        )}
      </div>
    </div>
  );
}
