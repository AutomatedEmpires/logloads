const INTERNAL_ORIGIN = "https://logloads.internal"

function hasUnsafeCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)

    return character === "\\" || code <= 0x1f || code === 0x7f
  })
}

/**
 * Accepts only same-origin paths. This keeps post-auth return destinations useful
 * without letting query parameters become open redirects.
 */
export function safeInternalPath(value: string | null | undefined, fallback = "/workspace"): string {
  if (!value || value !== value.trim() || !value.startsWith("/") || hasUnsafeCharacter(value)) {
    return fallback
  }

  try {
    const decoded = decodeURIComponent(value)

    if (decoded.startsWith("//") || decoded.startsWith("/\\") || hasUnsafeCharacter(decoded)) {
      return fallback
    }

    const parsed = new URL(value, INTERNAL_ORIGIN)

    if (parsed.origin !== INTERNAL_ORIGIN) {
      return fallback
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}
