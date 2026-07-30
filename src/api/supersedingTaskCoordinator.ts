type ActiveTask = {
  key: string
  controller: AbortController
  promise: Promise<unknown>
}

/**
 * Owns "latest request wins" lifecycle semantics without coupling transport
 * cancellation to React renders. Tasks with the same scope/key share work;
 * a new key in that scope aborts the obsolete task. Separate scopes remain
 * independent so unrelated refresh surfaces cannot cancel one another.
 */
export class SupersedingTaskCoordinator<Scope extends string = string> {
  readonly #active = new Map<Scope, ActiveTask>()

  run<T>(
    scope: Scope,
    key: string,
    execute: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const current = this.#active.get(scope)
    if (current?.key === key) return current.promise as Promise<T>

    if (current) {
      this.#active.delete(scope)
      current.controller.abort()
    }

    const controller = new AbortController()
    let promise: Promise<T>
    try {
      promise = Promise.resolve(execute(controller.signal))
    } catch (error) {
      promise = Promise.reject(error)
    }
    this.#active.set(scope, { key, controller, promise })

    const finish = () => {
      if (this.#active.get(scope)?.promise === promise) {
        this.#active.delete(scope)
      }
    }
    void promise.then(finish, finish)
    return promise
  }

  cancel(scope?: Scope) {
    if (scope) {
      const current = this.#active.get(scope)
      this.#active.delete(scope)
      current?.controller.abort()
      return
    }

    const active = [...this.#active.values()]
    this.#active.clear()
    active.forEach(({ controller }) => controller.abort())
  }
}
