import { createContext, useContext, useEffect, useState, useCallback } from 'react'

export type Theme = 'light' | 'dark'

export interface ThemeColors {
  name: string
  nameZh: string
  accent: string
  hover: string
  pressed: string
  soft: string
  softHover: string
  ring: string
  /* Dark mode — per-accent rgba values tuned for luminance */
  darkSoft: string
  darkSoftHover: string
  darkRing: string
  darkAccentHover: string
}

export const DEFAULT_THEME_ACCENT = '#0071e3'

let accentTransitionTimer: number | null = null

export const THEME_PRESETS: Record<string, ThemeColors> = {
  '#0071e3': { name: 'Arctic Blue', nameZh: '极光蓝', accent: '#0071e3', hover: '#0077ed', pressed: '#0060c0', soft: '#f1f7ff', softHover: '#dcecff', ring: 'rgba(0,113,227,0.24)', darkSoft: 'rgba(0,122,255,0.14)', darkSoftHover: 'rgba(0,122,255,0.20)', darkRing: 'rgba(0,122,255,0.34)', darkAccentHover: '#0a84ff' },
  '#a855f7': { name: 'Twilight Violet', nameZh: '暮光紫', accent: '#a855f7', hover: '#b366f8', pressed: '#9333ea', soft: '#faf5ff', softHover: '#ead5ff', ring: 'rgba(168,85,247,0.24)', darkSoft: 'rgba(168,85,247,0.14)', darkSoftHover: 'rgba(168,85,247,0.20)', darkRing: 'rgba(168,85,247,0.34)', darkAccentHover: '#b76ef9' },
  '#f43f5e': { name: 'Rose Bloom', nameZh: '蔷薇粉', accent: '#f43f5e', hover: '#f55270', pressed: '#e11d48', soft: '#fff1f2', softHover: '#ffd4d8', ring: 'rgba(244,63,94,0.24)', darkSoft: 'rgba(244,63,94,0.13)', darkSoftHover: 'rgba(244,63,94,0.19)', darkRing: 'rgba(244,63,94,0.32)', darkAccentHover: '#f55a73' },
  '#f97316': { name: 'Autumn Ember', nameZh: '秋叶橙', accent: '#f97316', hover: '#f98030', pressed: '#ea580c', soft: '#fff7ed', softHover: '#ffe2c0', ring: 'rgba(249,115,22,0.24)', darkSoft: 'rgba(249,115,22,0.14)', darkSoftHover: 'rgba(249,115,22,0.20)', darkRing: 'rgba(249,115,22,0.34)', darkAccentHover: '#fa8430' },
  '#22c55e': { name: 'Forest Verdure', nameZh: '森林绿', accent: '#22c55e', hover: '#2dd46b', pressed: '#16a34a', soft: '#f0fdf4', softHover: '#caf7d8', ring: 'rgba(34,197,94,0.24)', darkSoft: 'rgba(34,197,94,0.16)', darkSoftHover: 'rgba(34,197,94,0.22)', darkRing: 'rgba(34,197,94,0.36)', darkAccentHover: '#34d36e' },
  '#14b8a6': { name: 'Ocean Teal', nameZh: '海洋青', accent: '#14b8a6', hover: '#2ccab9', pressed: '#0d9488', soft: '#f0fdfa', softHover: '#b5f7e6', ring: 'rgba(20,184,166,0.24)', darkSoft: 'rgba(20,184,166,0.15)', darkSoftHover: 'rgba(20,184,166,0.21)', darkRing: 'rgba(20,184,166,0.35)', darkAccentHover: '#24cabb' },
}

export function normalizeThemeAccent(accent?: string | null) {
  return accent && THEME_PRESETS[accent] ? accent : DEFAULT_THEME_ACCENT
}

export function applyThemePreset(accent?: string | null, options: { animate?: boolean } = {}) {
  const colors = THEME_PRESETS[normalizeThemeAccent(accent)]
  const root = document.documentElement
  const isDark = root.getAttribute('data-theme') === 'dark'

  if (options.animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('accent-transitioning')
    if (accentTransitionTimer !== null) window.clearTimeout(accentTransitionTimer)
    accentTransitionTimer = window.setTimeout(() => {
      root.classList.remove('accent-transitioning')
      accentTransitionTimer = null
    }, 320)
  }

  root.style.setProperty('--accent', colors.accent)
  root.style.setProperty('--accent-hover', isDark ? colors.darkAccentHover : colors.hover)
  root.style.setProperty('--accent-pressed', colors.pressed)
  root.style.setProperty('--accent-soft', isDark ? colors.darkSoft : colors.soft)
  root.style.setProperty('--accent-soft-hover', isDark ? colors.darkSoftHover : colors.softHover)
  root.style.setProperty('--accent-ring', isDark ? colors.darkRing : colors.ring)

  /* Store both light and dark variants so theme toggle can pick up without re-calling */
  root.style.setProperty('--accent-soft-light', colors.soft)
  root.style.setProperty('--accent-soft-hover-light', colors.softHover)
  root.style.setProperty('--accent-ring-light', colors.ring)
  root.style.setProperty('--accent-hover-light', colors.hover)
  root.style.setProperty('--accent-soft-dark', colors.darkSoft)
  root.style.setProperty('--accent-soft-hover-dark', colors.darkSoftHover)
  root.style.setProperty('--accent-ring-dark', colors.darkRing)
  root.style.setProperty('--accent-hover-dark', colors.darkAccentHover)
}

export interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
})

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

export function useThemeProvider(defaultTheme: Theme = 'light') {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem('phd-atlas-theme') as Theme | null
    return stored ?? defaultTheme
  })

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    localStorage.setItem('phd-atlas-theme', t)
    document.documentElement.setAttribute('data-theme', t)
    /* Re-apply accent preset with correct dark/light variants */
    applyThemePreset(localStorage.getItem('phd-atlas-accent'))
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }, [theme, setTheme])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    applyThemePreset(localStorage.getItem('phd-atlas-accent'))
  }, [])

  return { theme, setTheme, toggleTheme }
}
