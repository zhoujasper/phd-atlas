// Enhanced Error Handling and Recovery
// 改进的错误处理和自动恢复机制

import { ApiError } from '../api/phdApi'
import { t, type Language } from '../i18n'
import { normalizeErrorMessage } from '../errorMessages'

/**
 * 可重试的错误代码
 */
const RETRYABLE_ERROR_CODES = new Set([
  'SERVER_BUSY',
  'MEMORY_PRESSURE_SOFT',
  'MEMORY_PRESSURE_HARD',
  'NETWORK_ERROR',
  'REQUEST_TIMEOUT',
  'AI_REQUEST_TIMEOUT',
  'WORKSPACE_STREAM_RETRY_REQUIRED',
  'TEAM_PROFILE_RECOMMENDER_VERSION_CHANGED',
  'TEAM_PROFILE_RECOMMENDER_VERSION_CONFLICT',
  'TEAM_PROFILE_RECOMMENDER_READ_BUSY',
  'UPLOAD_VAULT_BUSY',
])

/**
 * 可自动rebase的冲突错误
 */
const REBASEABLE_CONFLICT_CODES = new Set([
  'APPLICATION_VERSION_CONFLICT',
  'APPLICATION_MUTATION_BASELINE_MISMATCH',
])

/**
 * 需要用户干预的错误（不应自动重试）
 */
const USER_ACTION_REQUIRED_CODES = new Set([
  'INVALID_CREDENTIALS',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'PRO_REQUIRED',
  'SEAT_LIMIT_REACHED',
  'APPLICATION_LIMIT_REACHED',
  'STORAGE_QUOTA_EXCEEDED',
])

export interface RetryConfig {
  maxRetries: number
  delays: number[]
  shouldRetry?: (error: unknown, attempt: number) => boolean
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  delays: [600, 1400, 2800],
  shouldRetry: (error) => {
    if (error instanceof ApiError) {
      return RETRYABLE_ERROR_CODES.has(error.code)
    }
    // 网络错误默认重试
    if (error instanceof Error) {
      return /network|fetch|timeout/i.test(error.message)
    }
    return false
  },
}

export const AGGRESSIVE_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  delays: [300, 600, 1200, 2400, 4800],
  shouldRetry: (error) => {
    if (error instanceof ApiError) {
      // 不重试需要用户操作的错误
      if (USER_ACTION_REQUIRED_CODES.has(error.code)) {
        return false
      }
      // 重试所有临时性错误
      return RETRYABLE_ERROR_CODES.has(error.code) || error.code.includes('BUSY')
    }
    return true
  },
}

/**
 * 判断错误是否可重试
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return RETRYABLE_ERROR_CODES.has(error.code) && !USER_ACTION_REQUIRED_CODES.has(error.code)
  }
  if (error instanceof Error) {
    return /network|fetch|timeout|refused|reset/i.test(error.message)
  }
  return false
}

/**
 * 判断错误是否可通过rebase解决
 */
export function isRebaseableConflict(error: unknown): boolean {
  if (error instanceof ApiError) {
    return REBASEABLE_CONFLICT_CODES.has(error.code)
  }
  return false
}

/**
 * 获取错误的重试延迟
 */
export function getRetryDelay(error: unknown, attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  // 从Retry-After头获取延迟（如果有）
  if (error instanceof ApiError && error.retryAfterMs) {
    return error.retryAfterMs
  }

  // 使用配置的延迟
  const delay = config.delays[attempt] ?? config.delays[config.delays.length - 1]

  // 添加抖动以避免雷鸣群效应
  const jitter = Math.random() * 200 - 100
  return Math.max(0, delay + jitter)
}

/**
 * 带智能重试的请求包装器
 */
export async function withSmartRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config }
  let lastError: unknown

  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // 检查是否应该重试
      const shouldRetry = finalConfig.shouldRetry
        ? finalConfig.shouldRetry(error, attempt)
        : isRetryableError(error)

      if (attempt < finalConfig.maxRetries && shouldRetry) {
        const delay = getRetryDelay(error, attempt, finalConfig)

        // 在开发环境下记录重试
        if (import.meta.env.DEV) {
          console.warn(`🔄 Retrying after ${delay}ms (attempt ${attempt + 1}/${finalConfig.maxRetries})`, error)
        }

        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      // 不应重试或达到最大重试次数
      throw error
    }
  }

  throw lastError
}

/**
 * 错误恢复策略
 */
export interface RecoveryStrategy<T> {
  name: string
  canRecover: (error: unknown) => boolean
  recover: (error: unknown, originalFn: () => Promise<T>) => Promise<T>
}

/**
 * 冲突自动rebase恢复策略
 */
export function createConflictRebaseStrategy<T>(
  rebaseAndRetry: (error: unknown) => Promise<T>
): RecoveryStrategy<T> {
  return {
    name: 'conflict-rebase',
    canRecover: isRebaseableConflict,
    recover: async (error) => {
      if (import.meta.env.DEV) {
        console.log('🔄 Auto-rebasing conflicted save...', error)
      }
      return rebaseAndRetry(error)
    },
  }
}

/**
 * 带恢复策略的请求执行器
 */
export async function withRecovery<T>(
  fn: () => Promise<T>,
  strategies: RecoveryStrategy<T>[] = []
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    // 尝试每个恢复策略
    for (const strategy of strategies) {
      if (strategy.canRecover(error)) {
        try {
          if (import.meta.env.DEV) {
            console.log(`🔧 Attempting recovery with strategy: ${strategy.name}`)
          }
          return await strategy.recover(error, fn)
        } catch (recoveryError) {
          // 恢复失败，继续尝试下一个策略
          if (import.meta.env.DEV) {
            console.warn(`❌ Recovery strategy "${strategy.name}" failed:`, recoveryError)
          }
        }
      }
    }

    // 所有恢复策略都失败，抛出原始错误
    throw error
  }
}

/**
 * 用户友好的错误消息增强
 */
export interface EnhancedErrorInfo {
  title: string
  message: string
  actionable: boolean
  actions?: Array<{
    label: string
    action: 'retry' | 'reload' | 'dismiss' | 'contact'
  }>
  category: 'network' | 'conflict' | 'quota' | 'permission' | 'validation' | 'system'
  autoRetrying?: boolean
}

export function enhanceErrorInfo(error: unknown, lang: Language = 'zh', autoRetrying = false): EnhancedErrorInfo {
  const message = normalizeErrorMessage(error, lang)
  const retryAction = { label: t(lang, 'feedback.retry'), action: 'retry' as const }
  const dismissAction = { label: t(lang, 'close'), action: 'dismiss' as const }

  if (error instanceof ApiError) {
    switch (error.code) {
      case 'SERVER_BUSY':
      case 'MEMORY_PRESSURE_SOFT':
      case 'MEMORY_PRESSURE_HARD':
        return {
          title: t(lang, 'feedback.serverTitle'),
          message,
          actionable: true,
          actions: autoRetrying ? [] : [retryAction, dismissAction],
          category: 'system',
          autoRetrying,
        }

      case 'APPLICATION_VERSION_CONFLICT':
      case 'APPLICATION_MUTATION_BASELINE_MISMATCH':
        return {
          title: t(lang, 'feedback.conflictTitle'),
          message,
          actionable: false,
          category: 'conflict',
        }

      case 'NETWORK_ERROR':
      case 'REQUEST_TIMEOUT':
        return {
          title: t(lang, 'feedback.networkTitle'),
          message,
          actionable: true,
          actions: [
            retryAction,
            { label: t(lang, 'appRecovery.reload'), action: 'reload' },
          ],
          category: 'network',
        }

      case 'STORAGE_QUOTA_EXCEEDED':
      case 'APPLICATION_LIMIT_REACHED':
        return {
          title: t(lang, 'feedback.quotaTitle'),
          message,
          actionable: true,
          actions: [{ label: t(lang, 'feedback.contactSupport'), action: 'contact' }],
          category: 'quota',
        }

      case 'VALIDATION_ERROR':
        return {
          title: t(lang, 'feedback.validationTitle'),
          message,
          actionable: true,
          actions: [dismissAction],
          category: 'validation',
        }

      default:
        return {
          title: t(lang, 'feedback.genericTitle'),
          message,
          actionable: true,
          actions: [retryAction, dismissAction],
          category: 'system',
        }
    }
  }

  // 通用错误
  return {
    title: t(lang, 'feedback.genericTitle'),
    message,
    actionable: true,
    actions: [retryAction, dismissAction],
    category: 'system',
  }
}

/**
 * 错误追踪器 - 用于分析错误模式
 */
export class ErrorTracker {
  private errors: Array<{ error: unknown; timestamp: number; context?: string }> = []
  private maxSize = 100

  track(error: unknown, context?: string): void {
    this.errors.push({
      error,
      timestamp: Date.now(),
      context,
    })

    // 保持固定大小
    if (this.errors.length > this.maxSize) {
      this.errors.shift()
    }

    // 在开发环境下检测错误模式
    if (import.meta.env.DEV) {
      this.detectPatterns()
    }
  }

  private detectPatterns(): void {
    const recentErrors = this.errors.filter((e) => Date.now() - e.timestamp < 60000)

    if (recentErrors.length >= 5) {
      const errorCodes = recentErrors
        .map((e) => (e.error instanceof ApiError ? e.error.code : 'UNKNOWN'))
        .slice(-5)

      // 检测重复错误
      const uniqueCodes = new Set(errorCodes)
      if (uniqueCodes.size === 1) {
        console.warn(`⚠️ Detected repeated error pattern: ${Array.from(uniqueCodes)[0]} (5 times in 1 min)`)
      }
    }
  }

  getRecentErrors(maxAge = 300000): typeof this.errors {
    const cutoff = Date.now() - maxAge
    return this.errors.filter((e) => e.timestamp > cutoff)
  }

  clear(): void {
    this.errors = []
  }
}

// 全局错误追踪器
export const errorTracker = new ErrorTracker()

/**
 * 将增强的错误信息转换为Toast配置，用于在UI中显示
 */
export function enhancedErrorToToast(
  enhanced: EnhancedErrorInfo,
  onRetry?: () => void,
  onReload?: () => void,
  onContact?: () => void
): {
  message: string
  tone: 'error' | 'warning' | 'info'
  title?: string
  category?: 'network' | 'conflict' | 'quota' | 'permission' | 'validation' | 'system'
  actions?: Array<{ label: string; onClick: () => void }>
} {
  const tone = enhanced.category === 'conflict' || enhanced.autoRetrying ? 'info' :
                enhanced.category === 'validation' ? 'warning' : 'error'

  const actions = enhanced.actions?.map((action) => ({
    label: action.label,
    onClick: () => {
      switch (action.action) {
        case 'retry':
          onRetry?.()
          break
        case 'reload':
          onReload?.()
          break
        case 'contact':
          onContact?.()
          break
        case 'dismiss':
          break
      }
    },
  }))

  return {
    message: enhanced.message,
    tone,
    title: enhanced.title,
    category: enhanced.category,
    actions,
  }
}
