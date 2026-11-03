/** Joins class names, skipping empty parts (CSS Module lookups are `string | undefined` here). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}
