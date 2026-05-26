/**
 * Tiny className joiner — avoids the clsx dep.
 *
 * @example
 *   cn("base", isActive && "active", className)
 *   //   ↑ truthy strings only get joined.
 */
export function cn(
  ...classes: Array<string | false | null | undefined | 0>
): string {
  return classes.filter(Boolean).join(" ");
}
