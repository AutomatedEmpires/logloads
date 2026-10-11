import {
  createInMemoryDatabase,
  createLaunchDatabase,
  OperatingStateUnavailableError,
  type LogLoadsDatabaseState
} from "@logloads/db"

import { shiftSeedDates } from "./seed-dates"

export type BootstrapData = "launch" | "sample"

interface BootstrapEnvironment {
  LOGLOADS_STATE_BOOTSTRAP_DATA?: string
  VERCEL_ENV?: string
}

/**
 * Which document a controlled bootstrap writes into an empty canonical row.
 *
 * - `launch` (the default): the empty launch document, with only the unclaimed
 *   platform admin and the plan catalog.
 * - `sample`: the fictional seed operation, dates moved to now. Meant for
 *   Preview deployments and isolated test stacks.
 *
 * Production never gets the sample. A Vercel Production deployment that asks
 * for it is refused, so a copied setting can't put fictional organizations
 * and loads in front of real users. An unrecognized value is refused, not
 * guessed at.
 */
export function resolveBootstrapData(environment: BootstrapEnvironment): BootstrapData {
  const requested = environment.LOGLOADS_STATE_BOOTSTRAP_DATA?.trim() || "launch"

  if (requested !== "launch" && requested !== "sample") {
    throw new OperatingStateUnavailableError(
      `LOGLOADS_STATE_BOOTSTRAP_DATA must be "launch" or "sample", not "${requested}"`
    )
  }

  if (requested === "sample" && environment.VERCEL_ENV === "production") {
    throw new OperatingStateUnavailableError(
      "Sample data is never written to production; unset LOGLOADS_STATE_BOOTSTRAP_DATA or set it to launch"
    )
  }

  return requested
}

/** The document a controlled bootstrap writes, chosen by `resolveBootstrapData`. */
export function bootstrapState(environment: BootstrapEnvironment): LogLoadsDatabaseState {
  return resolveBootstrapData(environment) === "sample"
    ? shiftSeedDates(createInMemoryDatabase())
    : createLaunchDatabase()
}
