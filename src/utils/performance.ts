// Frontend Performance Optimization Utilities
// 这些工具函数可以立即用于优化前端性能

/**
 * 防抖函数 - 用于优化保存等高频操作
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  options: { leading?: boolean; trailing?: boolean; maxWait?: number } = {}
): (...args: Parameters<T>) => void {
  const { leading = false, trailing = true, maxWait } = options
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastCallTime = 0
  let lastInvokeTime = 0
  let lastArgs: Parameters<T> | null = null

  function invokeFunc() {
    if (lastArgs) {
      lastInvokeTime = Date.now()
      func(...lastArgs)
      lastArgs = null
    }
  }

  function startTimer() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      if (trailing) {
        invokeFunc()
      }
      timeoutId = null
    }, wait)
  }

  return function debounced(...args: Parameters<T>) {
    const now = Date.now()
    const timeSinceLastCall = now - lastCallTime
    const timeSinceLastInvoke = now - lastInvokeTime

    lastCallTime = now
    lastArgs = args

    // Leading edge
    if (leading && timeSinceLastCall >= wait) {
      invokeFunc()
      startTimer()
      return
    }

    // MaxWait edge
    if (maxWait !== undefined && timeSinceLastInvoke >= maxWait) {
      invokeFunc()
      startTimer()
      return
    }

    // Trailing edge
    startTimer()
  }
}

/**
 * 节流函数 - 用于优化滚动等连续事件
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): (...args: Parameters<T>) => void {
  const { leading = true, trailing = true } = options
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastInvokeTime = 0
  let lastArgs: Parameters<T> | null = null

  function invokeFunc() {
    if (lastArgs) {
      lastInvokeTime = Date.now()
      func(...lastArgs)
      lastArgs = null
    }
  }

  return function throttled(...args: Parameters<T>) {
    const now = Date.now()
    const timeSinceLastInvoke = now - lastInvokeTime

    lastArgs = args

    if (timeSinceLastInvoke >= wait) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (leading) {
        invokeFunc()
      }
    } else if (timeoutId === null && trailing) {
      timeoutId = setTimeout(() => {
        invokeFunc()
        timeoutId = null
      }, wait - timeSinceLastInvoke)
    }
  }
}

/**
 * 批量处理函数 - 用于合并多个相似请求
 */
export function batchRequests<T, R>(
  processor: (items: T[]) => Promise<R[]>,
  options: { maxBatchSize?: number; maxWaitMs?: number } = {}
): (item: T) => Promise<R> {
  const { maxBatchSize = 10, maxWaitMs = 50 } = options
  let batch: Array<{ item: T; resolve: (value: R) => void; reject: (error: any) => void }> = []
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  async function flush() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }

    if (batch.length === 0) return

    const currentBatch = batch
    batch = []

    try {
      const items = currentBatch.map((b) => b.item)
      const results = await processor(items)

      currentBatch.forEach((b, index) => {
        b.resolve(results[index])
      })
    } catch (error) {
      currentBatch.forEach((b) => {
        b.reject(error)
      })
    }
  }

  function scheduleBatch() {
    if (timeoutId === null) {
      timeoutId = setTimeout(() => {
        flush()
      }, maxWaitMs)
    }
  }

  return function batchedRequest(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      batch.push({ item, resolve, reject })

      if (batch.length >= maxBatchSize) {
        flush()
      } else {
        scheduleBatch()
      }
    })
  }
}

/**
 * 请求去重 - 防止相同请求并发执行
 */
export function dedupeRequests<T extends (...args: any[]) => Promise<any>>(
  func: T,
  keyFn?: (...args: Parameters<T>) => string
): T {
  const pending = new Map<string, Promise<any>>()

  return (async (...args: Parameters<T>) => {
    const key = keyFn ? keyFn(...args) : JSON.stringify(args)

    if (pending.has(key)) {
      return pending.get(key)
    }

    const promise = func(...args).finally(() => {
      pending.delete(key)
    })

    pending.set(key, promise)
    return promise
  }) as T
}

/**
 * 带重试的请求包装器
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    retryDelays?: number[]
    shouldRetry?: (error: any, attempt: number) => boolean
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    retryDelays = [600, 1400, 2800],
    shouldRetry = (error) => {
      // 默认只重试网络错误和SERVER_BUSY
      return (
        error?.code === 'SERVER_BUSY' ||
        error?.code === 'NETWORK_ERROR' ||
        error?.message?.includes('fetch')
      )
    },
  } = options

  let lastError: any

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt < maxRetries && shouldRetry(error, attempt)) {
        const delay = retryDelays[attempt] ?? retryDelays[retryDelays.length - 1]
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      throw error
    }
  }

  throw lastError
}

/**
 * 智能缓存 - 带过期时间的内存缓存
 */
export class SmartCache<K, V> {
  private cache = new Map<K, { value: V; expiresAt: number }>()
  private defaultTTL: number

  constructor(defaultTTL = 60000) {
    this.defaultTTL = defaultTTL
  }

  set(key: K, value: V, ttl = this.defaultTTL): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    })
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }

    return entry.value
  }

  has(key: K): boolean {
    return this.get(key) !== undefined
  }

  delete(key: K): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  prune(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
      }
    }
  }
}

/**
 * 性能监控工具
 */
export class PerformanceMonitor {
  private measurements = new Map<string, number[]>()

  start(label: string): () => void {
    const startTime = performance.now()

    return () => {
      const duration = performance.now() - startTime
      this.record(label, duration)
    }
  }

  async measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const stop = this.start(label)
    try {
      return await fn()
    } finally {
      stop()
    }
  }

  record(label: string, duration: number): void {
    if (!this.measurements.has(label)) {
      this.measurements.set(label, [])
    }
    this.measurements.get(label)!.push(duration)
  }

  getStats(label: string): { count: number; avg: number; p50: number; p95: number; p99: number } | null {
    const measurements = this.measurements.get(label)
    if (!measurements || measurements.length === 0) return null

    const sorted = [...measurements].sort((a, b) => a - b)
    const count = sorted.length

    return {
      count,
      avg: sorted.reduce((sum, val) => sum + val, 0) / count,
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
    }
  }

  report(): void {
    console.group('📊 Performance Report')
    for (const [label] of this.measurements.entries()) {
      const stats = this.getStats(label)
      if (stats) {
        console.log(
          `${label}: ${stats.count} calls, avg ${stats.avg.toFixed(2)}ms, p95 ${stats.p95.toFixed(2)}ms`
        )
      }
    }
    console.groupEnd()
  }

  clear(): void {
    this.measurements.clear()
  }
}

// 全局性能监控实例
export const perfMonitor = new PerformanceMonitor()

// 在开发环境下自动输出性能报告
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  setInterval(() => {
    perfMonitor.report()
  }, 60000) // 每分钟输出一次
}
