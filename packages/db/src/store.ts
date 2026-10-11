import type { LogLoadsDatabaseState, LogLoadsTableName } from "./types"
import { seedDatabaseState } from "./seed-data"

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function createInMemoryDatabase(seed: LogLoadsDatabaseState = seedDatabaseState): LogLoadsDatabaseState {
  return deepClone(seed)
}

/**
 * The document a real deployment starts from. It holds no organizations, people,
 * equipment, places, loads or history, only what the product needs to run:
 *
 * - the one unclaimed platform-admin profile, because `/admin/bootstrap` binds the
 *   founder to that exact record and refuses to create an admin from nothing; and
 * - the subscription plan catalog, which is product configuration, not sample data.
 *
 * Every other collection is derived from the seed's keys and starts empty, so a
 * collection added later is empty here too. `seedDatabaseState` is the fictional
 * operation used by local development, tests and Preview deployments.
 */
export function createLaunchDatabase(): LogLoadsDatabaseState {
  const empty = Object.fromEntries(
    Object.keys(seedDatabaseState).map((table) => [table, []])
  ) as unknown as LogLoadsDatabaseState

  return deepClone({
    ...empty,
    billingPlanDefinitions: seedDatabaseState.billingPlanDefinitions,
    profiles: seedDatabaseState.profiles.filter((profile) => profile.role === "admin")
  })
}

export function getTableSnapshot<TableName extends LogLoadsTableName>(
  state: LogLoadsDatabaseState,
  tableName: TableName
): LogLoadsDatabaseState[TableName] {
  return state[tableName]
}

export function replaceTable<TableName extends LogLoadsTableName>(
  state: LogLoadsDatabaseState,
  tableName: TableName,
  rows: LogLoadsDatabaseState[TableName]
): void {
  state[tableName] = rows
}