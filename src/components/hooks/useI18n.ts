import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ContentLanguagePair } from '../../contentLanguages'
import {
  type I18nNamespace,
  type Language,
  getDict,
  getDictForNamespaces,
  hasLanguageNamespaces,
  loadLanguage,
  preloadLanguage,
  t,
  tpl,
} from '../../i18n'

/** Namespaces needed to render content-language copy (insert phrases, built-in presets). */
export const CONTENT_LANGUAGE_NAMESPACES: I18nNamespace[] = ['core', 'shared', 'profile', 'dossier']

export type I18nDict = Record<string, unknown>

function resolvePath(dict: Record<string, unknown>, path: string, fallback?: string): string {
  const keys = path.split('.')
  let value: unknown = dict
  for (const key of keys) {
    if (value && typeof value === 'object') {
      value = (value as Record<string, unknown>)[key]
    } else {
      return fallback ?? path
    }
  }
  return typeof value === 'string' ? value : (fallback ?? path)
}

export interface I18nContextValue {
  lang: Language
  t: I18nDict
  /** True once every namespace requested by the current surface is registered.
   * Optional for lightweight provider adapters; useI18nValue always supplies it.
   */
  ready?: boolean
  format: (template: string, values: Record<string, string | number>) => string
  /** Get a nested translation by dot-path, e.g. "status.Draft" */
  tx: (path: string, fallback?: string) => string
}

const defaultDict = getDict('en')
const defaultTx = (path: string, fallback?: string) => resolvePath(getDict('en') as Record<string, unknown>, path, fallback)

export const I18nContext = createContext<I18nContextValue>({
  lang: 'en',
  t: defaultDict,
  ready: true,
  format: tpl,
  tx: defaultTx,
})

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}

export function useI18nValue(lang: Language, namespaces: I18nNamespace[] = ['core']): I18nContextValue {
  const namespaceKey = useMemo(() => Array.from(new Set(['core', ...namespaces])).sort().join('|'), [namespaces])
  const [, setVersion] = useState(0)
  const requestKey = `${lang}:${namespaceKey}`
  const [failedRequestKey, setFailedRequestKey] = useState<string | null>(null)
  const ready = hasLanguageNamespaces(lang, namespaceKey.split('|')) || failedRequestKey === requestKey

  useEffect(() => {
    const namespacesToLoad = namespaceKey.split('|')
    if (hasLanguageNamespaces(lang, namespacesToLoad)) return undefined

    let cancelled = false
    void loadLanguage(lang, namespacesToLoad)
      .then(() => {
        if (!cancelled) setVersion((current) => current + 1)
      })
      .catch(() => {
        // Fail open with the canonical English/path fallbacks rather than leave
        // a screen or click-open overlay trapped behind a loading indicator.
        if (!cancelled) setFailedRequestKey(requestKey)
      })
    return () => {
      cancelled = true
    }
  }, [lang, namespaceKey, requestKey])

  const dict = getDictForNamespaces(lang, namespaceKey.split('|'))

  return useMemo(() => ({
    lang,
    t: dict,
    ready,
    format: tpl,
    tx: (path: string, fallback?: string) => t(lang, path, fallback),
  }), [dict, lang, ready])
}

/**
 * Ensure both content languages have the packs needed for insert-phrase previews
 * and built-in preset copy. Returns a version that bumps after packs load so
 * previews re-render with the correct language instead of English fallbacks.
 */
export function useContentLanguagePacks(
  pair: ContentLanguagePair | null | undefined,
  namespaces: I18nNamespace[] = CONTENT_LANGUAGE_NAMESPACES,
): number {
  const [version, setVersion] = useState(0)
  const primary = pair?.primary ?? 'en'
  const secondary = pair?.secondary ?? 'zh'
  const namespaceKey = useMemo(
    () => Array.from(new Set(['core', ...namespaces])).sort().join('|'),
    [namespaces],
  )

  useEffect(() => {
    const namespacesToLoad = namespaceKey.split('|') as I18nNamespace[]
    const ready = [primary, secondary].every((lang) => hasLanguageNamespaces(lang, namespacesToLoad))
    if (ready) return undefined

    let cancelled = false
    void Promise.all([
      preloadLanguage(primary, namespacesToLoad),
      preloadLanguage(secondary, namespacesToLoad),
    ]).finally(() => {
      if (!cancelled) setVersion((current) => current + 1)
    })
    return () => {
      cancelled = true
    }
  }, [primary, secondary, namespaceKey])

  return version
}

export { getDict }
