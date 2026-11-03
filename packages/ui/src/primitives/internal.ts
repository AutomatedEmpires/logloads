import type { Ref } from "react"

/** Joins class names, skipping empty values. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ")
}

/** Assigns a DOM node to a callback or object ref, so a component can keep its own ref and forward one. */
export function assignRef<T>(ref: Ref<T> | undefined, node: T | null): void {
  if (typeof ref === "function") {
    ref(node)
  } else if (ref) {
    const objectRef = ref as { current: T | null }
    objectRef.current = node
  }
}

/** True for aria-disabled={true} and aria-disabled="true". */
export function isTrue(value: boolean | "true" | "false" | undefined): boolean {
  return value === true || value === "true"
}
