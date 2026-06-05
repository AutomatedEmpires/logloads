import type { LogLoadsDatabaseState, LogLoadsTableName } from "./types"
import { seedDatabaseState } from "./seed-data"

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function createInMemoryDatabase(seed: LogLoadsDatabaseState = seedDatabaseState): LogLoadsDatabaseState {
  return deepClone(seed)
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