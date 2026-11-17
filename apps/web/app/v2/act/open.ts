import { inspectOneTap, productionRuntime } from "./perform"
import { oneTapPressPath } from "./token"
import { oneTapModel, oneTapNotice } from "./view"

/** A read of a signed link. The store is not called. The press lives at `.../press`. */
export function openOneTapPage(token: string, notice: string | string[] | undefined) {
  const model = oneTapModel(inspectOneTap(token, productionRuntime()), oneTapNotice(notice))

  return {
    model,
    pressHref: model.kind === "ready" ? oneTapPressPath(token) : ""
  }
}
