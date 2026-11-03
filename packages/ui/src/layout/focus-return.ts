/** Anything focus can be moved back to. DOM elements satisfy this; tests use plain objects. */
export interface FocusTarget {
  focus(options?: FocusOptions): void
  readonly isConnected?: boolean
}

export interface FocusReturn {
  /** Records a newly focused node as the opener unless it is inside the panel or ignorable (e.g. <body>). */
  note(node: unknown): void
  /** Moves focus back to the opener if it is still in the document. Returns whether it did. */
  restore(): boolean
  readonly opener: FocusTarget | null
}

function isFocusTarget(node: unknown): node is FocusTarget {
  return typeof node === "object" && node !== null && typeof (node as FocusTarget).focus === "function"
}

/**
 * Tracks the control a panel was opened from, i.e. the last element focused outside the panel, so closing
 * the panel can return focus there instead of dropping it on <body>.
 */
export function createFocusReturn(
  isInsidePanel: (node: FocusTarget) => boolean,
  isIgnorable: (node: FocusTarget) => boolean = () => false
): FocusReturn {
  let opener: FocusTarget | null = null

  return {
    note(node) {
      if (isFocusTarget(node) && !isIgnorable(node) && !isInsidePanel(node)) {
        opener = node
      }
    },
    restore() {
      if (!opener || opener.isConnected === false) return false
      opener.focus({ preventScroll: true })
      return true
    },
    get opener() {
      return opener
    }
  }
}
