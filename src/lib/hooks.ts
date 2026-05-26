"use client";

import { useEffect, useState } from "react";

/**
 * Debounce a value. Returns the input value after `delay` ms of no change.
 *
 * @example
 *   const debouncedAmount = useDebounce(amount, 400);
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
