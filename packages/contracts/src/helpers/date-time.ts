export interface TimeRange {
  startAt: string
  endAt: string
}

export function isValidTimeRange(range: TimeRange): boolean {
  return new Date(range.startAt).getTime() < new Date(range.endAt).getTime()
}

export function rangesOverlap(left: TimeRange, right: TimeRange): boolean {
  const leftStart = new Date(left.startAt).getTime()
  const leftEnd = new Date(left.endAt).getTime()
  const rightStart = new Date(right.startAt).getTime()
  const rightEnd = new Date(right.endAt).getTime()

  return leftStart < rightEnd && rightStart < leftEnd
}

export function toDateKey(value: string): string {
  return new Date(value).toISOString().slice(0, 10)
}