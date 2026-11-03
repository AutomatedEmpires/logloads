import { Children, isValidElement, type ReactElement, type ReactNode } from "react"

type Props = Record<string, unknown> & { children?: ReactNode }

/** Visible text of rendered markup: tags removed, whitespace collapsed. */
export function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

/** The opening tag of the first element whose attributes match `pattern`, e.g. openingTag(html, /aria-label="One more"/). */
export function openingTag(html: string, pattern: RegExp): string {
  const tag = html.match(/<[a-z][^>]*>/g)?.find((candidate) => pattern.test(candidate))
  if (!tag) throw new Error(`no tag matching ${pattern} in ${html}`)
  return tag
}

/**
 * Depth-first search through the element tree returned by calling a hook-free component as a function. Lets a test
 * reach the handlers a component attaches (for example a stepper's onClick) without a DOM.
 */
export function findElement(node: ReactNode, match: (props: Props) => boolean): ReactElement<Props> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Props>(child)) continue
    if (match(child.props)) return child
    const found = findElement(child.props.children, match)
    if (found) return found
  }
  return undefined
}
