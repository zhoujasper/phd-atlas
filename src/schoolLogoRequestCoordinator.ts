const DEFAULT_MAX_SETTLED_AUTO_ATTEMPTS = 128

/**
 * Coalesces school-logo resolution across the list and Dossier owners. Auto
 * attempts retain their settled answer for this app session so remounting a
 * screen cannot repeat the same cached/negative network lookup. Explicit user
 * refreshes stay in-flight-only and always run again after settlement.
 */
export class SchoolLogoRequestCoordinator {
  private readonly inFlight = new Map<string, Promise<boolean>>()
  private readonly settledAutoAttempts = new Map<string, boolean>()
  private readonly maxSettledAutoAttempts: number

  constructor(maxSettledAutoAttempts = DEFAULT_MAX_SETTLED_AUTO_ATTEMPTS) {
    this.maxSettledAutoAttempts = maxSettledAutoAttempts
  }

  run(
    key: string,
    start: () => Promise<boolean>,
    options: { retainSettledResult?: boolean } = {},
  ): Promise<boolean> {
    if (options.retainSettledResult && this.settledAutoAttempts.has(key)) {
      return Promise.resolve(this.settledAutoAttempts.get(key) ?? false)
    }
    const current = this.inFlight.get(key)
    if (current) return current

    const promise = Promise.resolve().then(start).then((result) => {
      if (options.retainSettledResult) this.rememberSettledAutoAttempt(key, result)
      return result
    }).finally(() => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key)
    })
    this.inFlight.set(key, promise)
    return promise
  }

  private rememberSettledAutoAttempt(key: string, result: boolean) {
    this.settledAutoAttempts.delete(key)
    this.settledAutoAttempts.set(key, result)
    while (this.settledAutoAttempts.size > this.maxSettledAutoAttempts) {
      const oldestKey = this.settledAutoAttempts.keys().next().value
      if (oldestKey === undefined) break
      this.settledAutoAttempts.delete(oldestKey)
    }
  }
}
