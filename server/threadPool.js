export const DEFAULT_UV_THREADPOOL_SIZE = 4
export const PASSWORD_WORK_MEMORY_BYTES = 19_456 * 1024

function positiveThreadPoolSize(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 128
    ? parsed
    : null
}

/**
 * Returns the effective libuv worker thread count. The env value must be set
 * before process startup; callers use this only for admission decisions.
 */
export function configuredThreadPoolSize(value = process.env.UV_THREADPOOL_SIZE) {
  return positiveThreadPoolSize(value) ?? DEFAULT_UV_THREADPOOL_SIZE
}

/**
 * Keeps password work aligned with the native thread pool and the process
 * memory budget. Leave two threads for fs/zlib work and cap the Argon2 work
 * set at 25% of the runtime memory budget.
 */
export function passwordAdmissionMaxActive({
  maxActive = 2,
  budgetBytes = null,
  threadPoolSize = configuredThreadPoolSize(),
  memoryBytesPerWork = PASSWORD_WORK_MEMORY_BYTES,
  memoryBudgetRatio = 0.25,
} = {}) {
  const requested = Number.isSafeInteger(Number(maxActive)) && Number(maxActive) > 0
    ? Number(maxActive)
    : 2
  const poolCap = Math.max(1, threadPoolSize - 2)
  let memoryCap = Number.POSITIVE_INFINITY
  if (Number.isSafeInteger(Number(budgetBytes)) && Number(budgetBytes) > 0) {
    const budgetBytesValue = Number(budgetBytes)
    const ratio = Number(memoryBudgetRatio)
    if (Number.isFinite(ratio) && ratio > 0 && ratio < 1) {
      memoryCap = Math.max(
        1,
        Math.floor((budgetBytesValue * ratio) / memoryBytesPerWork),
      )
    }
  }
  return Math.max(1, Math.min(requested, poolCap, memoryCap))
}
