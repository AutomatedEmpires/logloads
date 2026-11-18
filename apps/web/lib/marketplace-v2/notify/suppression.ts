/**
 * Addresses that opted out or bounced, stored as hashes. This list lives in the process: a click stops the next
 * send in this process. A durable table is not in the schema yet, so a restart forgets it. The send path still
 * checks the list it is given, including this one.
 */

const hashes = new Set<string>()

export function rememberSuppression(hash: string): void {
  if (/^[0-9a-f]{64}$/.test(hash)) hashes.add(hash)
}

export function suppressionHashes(): readonly string[] {
  return [...hashes]
}

export function resetSuppressions(): void {
  hashes.clear()
}
