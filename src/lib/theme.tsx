"use client";

/**
 * Theme provider — persists user choice to localStorage and writes
 * `data-theme="light|dark"` onto the <html> element. Tailwind v4 + the
 * `@custom-variant dark` rule in globals.css key off that attribute.
 *
 * Default: respects prefers-color-scheme on first load, then user override.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const STORAGE_KEY = "helm-theme";

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) {
    // Soft fail outside provider (e.g. unit tests).
    return { theme: "light", toggle: () => {}, setTheme: () => {} };
  }
  return v;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Always render `light` on first paint (SSR-safe). The effect below
  // immediately corrects to the persisted/system choice on the client.
  const [theme, setThemeState] = useState<Theme>("light");

  // Hydrate from localStorage / system pref on mount.
  useEffect(() => {
    const stored = (typeof window !== "undefined"
      ? window.localStorage.getItem(STORAGE_KEY)
      : null) as Theme | null;
    if (stored === "light" || stored === "dark") {
      setThemeState(stored);
      return;
    }
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ) {
      setThemeState("dark");
    }
  }, []);

  // Sync <html data-theme=…> + localStorage whenever theme changes.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore storage errors (private mode)
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(
    () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  return (
    <Ctx.Provider value={{ theme, toggle, setTheme }}>{children}</Ctx.Provider>
  );
}
