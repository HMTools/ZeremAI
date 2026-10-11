// Counts how many times in a row the same re-prompt was sent, so a feature can stop after a limit.
// Each framework feature creates its own limiter, so features do not share a count.
// The count lives in memory: it is lost on a module reload, which is fine.

export type RepromptLimiter = {
  /** Records one more re-prompt for `key` and returns how many times in a row it was sent. */
  record(key: string): number
  /** The agent has nothing to continue, or the user spoke: start counting again. */
  reset(): void
}

export function createRepromptLimiter(): RepromptLimiter {
  let last: { key: string; timesInARow: number } | undefined
  return {
    record(key) {
      const timesInARow = last?.key === key ? last.timesInARow + 1 : 1
      last = { key, timesInARow }
      return timesInARow
    },
    reset() { last = undefined },
  }
}
