/**
 * LogLoads design tokens: TypeScript companion to tokens.css.
 * Exported as "@logloads/ui/tokens"; the stylesheet is "@logloads/ui/tokens.css" (source: docs/product/ux-v2/design-system, e794cbe).
 *
 * tokens.css is the single source for values. This module only names them, so components, tests and
 * layout code can reference tokens without string typos, and it holds the breakpoints that CSS cannot
 * express as custom properties inside media or container queries.
 */

/** Container-query breakpoints, in CSS pixels. Used on the AppShell container ("ll-app") and on lists ("ll-list"). */
export const BREAKPOINTS = Object.freeze({
  sm: 600, // two-column form pairs; gallery to 3 up
  md: 768, // composite SearchToolbar; tablet gutters (24 px); dialogs centred
  lg: 960, // top navigation replaces bottom navigation; PageHeader actions align right
  xl: 1200, // DetailPanel opens beside lists; ContentGrid "main-aside" gains its aside column; 32 px gutters
  xxl: 1400 // DetailPanel widens to 432 px
} as const)

export type Breakpoint = keyof typeof BREAKPOINTS

/** Widths the product is reviewed and regression-tested at. */
export const REVIEW_WIDTHS = Object.freeze([1440, 1280, 1024, 768, 390] as const)

/** Result-list breakpoints (container "ll-list"), measured on the list itself rather than the viewport. */
export const LIST_BREAKPOINTS = Object.freeze({
  rowColumns: 620, // pay gets its own column
  factsInline: 740, // four facts in one row
  compactTable: 720 // below this, compact density falls back to the comfortable layout
} as const)

export const DENSITIES = Object.freeze(["comfortable", "compact"] as const)
export type Density = (typeof DENSITIES)[number]

/** Semantic colour tokens components may use. Primitive (--ll-p-*) tokens are intentionally absent. */
export const COLOR_TOKENS = Object.freeze([
  "--ll-color-page", "--ll-color-surface", "--ll-color-surface-subtle", "--ll-color-surface-sunken",
  "--ll-color-border", "--ll-color-border-strong", "--ll-color-control-border", "--ll-color-rule",
  "--ll-color-text", "--ll-color-text-secondary", "--ll-color-text-muted", "--ll-color-text-inverse",
  "--ll-color-brand", "--ll-color-brand-pith",
  "--ll-color-action", "--ll-color-action-hover", "--ll-color-on-action", "--ll-color-action-subtle", "--ll-color-action-subtle-border",
  "--ll-color-selected-bg", "--ll-color-selected-indicator", "--ll-color-nav-active",
  "--ll-color-accent", "--ll-color-sponsored-bg", "--ll-color-sponsored-text",
  "--ll-color-status-positive", "--ll-color-status-positive-bg", "--ll-color-status-warning", "--ll-color-status-warning-bg",
  "--ll-color-status-critical", "--ll-color-status-critical-bg", "--ll-color-status-neutral", "--ll-color-status-neutral-bg",
  "--ll-color-backdrop", "--ll-color-caption-bg"
] as const)
export type ColorToken = (typeof COLOR_TOKENS)[number]

/**
 * Text/background pairs that must meet WCAG 2.2 AA (4.5:1). A unit test resolves each token from
 * tokens.css and computes the ratio, so a palette edit that breaks contrast fails CI.
 */
export const CONTRAST_PAIRS: ReadonlyArray<readonly [ColorToken, ColorToken]> = Object.freeze([
  ["--ll-color-text", "--ll-color-page"],
  ["--ll-color-text-secondary", "--ll-color-surface"],
  ["--ll-color-text-muted", "--ll-color-surface"],
  ["--ll-color-text-muted", "--ll-color-page"],
  ["--ll-color-text-muted", "--ll-color-sponsored-bg"],
  ["--ll-color-text-muted", "--ll-color-selected-bg"],
  ["--ll-color-on-action", "--ll-color-action"],
  ["--ll-color-on-action", "--ll-color-action-hover"],
  ["--ll-color-sponsored-text", "--ll-color-sponsored-bg"],
  ["--ll-color-status-positive", "--ll-color-surface"],
  ["--ll-color-status-warning", "--ll-color-surface"],
  ["--ll-color-status-warning", "--ll-color-sponsored-bg"],
  ["--ll-color-status-critical", "--ll-color-surface"],
  ["--ll-color-text-inverse", "--ll-color-text"]
] as const)

/** Non-text pairs that must meet 3:1 (WCAG 1.4.11): focus ring, selection indicator, control borders. */
export const NON_TEXT_PAIRS: ReadonlyArray<readonly [string, ColorToken]> = Object.freeze([
  ["--ll-focus-color", "--ll-color-surface"],
  ["--ll-focus-color", "--ll-color-page"],
  ["--ll-color-selected-indicator", "--ll-color-selected-bg"],
  ["--ll-color-control-border", "--ll-color-surface"],
  ["--ll-color-control-border", "--ll-color-page"]
] as const)
