/**
 * jobs (#247): job lifecycle rules (edit, pause, resume, close, expire, duplicate), over the views in
 * `packages/contracts/src/v2/jobs/`. Port v3 (#244) entry module; `packages/services/src/index.ts` re-exports it.
 */

export * from "./lifecycle"
export * from "./terms"
