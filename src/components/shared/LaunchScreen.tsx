import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { GraduationCap } from 'lucide-react'
import { inferLoadingVariant, type LoadingVariant, type ScreenSkeletonVariant } from './loadingVariant'

function SkeletonBar({ size = 'full' }: { size?: 'full' | 'medium' | 'short' | 'tiny' }) {
  return <span className={`loading-skeleton-bar loading-skeleton-bar-${size}`} />
}

function SkeletonCard({ tall = false, lines = 2 }: { tall?: boolean; lines?: number }) {
  return (
    <div className={`loading-skeleton-card${tall ? ' tall' : ''}`}>
      <SkeletonBar size="short" />
      {Array.from({ length: lines }).map((_, index) => (
        <SkeletonBar key={index} size={index === lines - 1 ? 'medium' : 'full'} />
      ))}
    </div>
  )
}

export function ScreenSkeleton({
  variant = 'dashboard',
  className = '',
  style,
}: {
  variant?: ScreenSkeletonVariant
  className?: string
  style?: CSSProperties
}) {
  const statCount = variant === 'profile' || variant === 'team' ? 3 : 4
  const cardCount = variant === 'settings' ? 3 : variant === 'workspace' ? 4 : 2

  return (
    <div
      className={`workspace-deferred-panel screen-skeleton screen-skeleton-${variant} ${className}`.trim()}
      style={style}
      aria-hidden="true"
    >
      <div className="screen-skeleton-hero">
        <div className="screen-skeleton-heading">
          <SkeletonBar size="tiny" />
          <SkeletonBar size="short" />
          <SkeletonBar size="medium" />
        </div>
        <span className="screen-skeleton-action" />
      </div>

      {variant === 'workspace' ? (
        <div className="screen-skeleton-tabs">
          {Array.from({ length: 6 }).map((_, index) => <span key={index} />)}
        </div>
      ) : null}

      <div className="screen-skeleton-stats">
        {Array.from({ length: statCount }).map((_, index) => (
          <div key={index} className="screen-skeleton-stat">
            <SkeletonBar size="tiny" />
            <SkeletonBar size="short" />
          </div>
        ))}
      </div>

      {variant === 'settings' ? (
        <div className="screen-skeleton-settings">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="screen-skeleton-setting-row">
              <SkeletonBar size={index % 3 === 0 ? 'medium' : 'short'} />
              <SkeletonBar size="tiny" />
            </div>
          ))}
        </div>
      ) : (
        <div className="screen-skeleton-content">
          {Array.from({ length: cardCount }).map((_, index) => (
            <SkeletonCard
              key={index}
              tall={variant === 'team' || (variant === 'dashboard' && index === 0) || (variant === 'workspace' && index === 0)}
              lines={variant === 'workspace' ? 3 : 2}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function PaneSkeleton({
  kind,
  className = '',
  style,
}: {
  kind: 'applications' | 'inspector'
  className?: string
  style?: CSSProperties
}) {
  return (
    <aside
      className={`workspace-deferred-panel pane-skeleton pane-skeleton-${kind} ${className}`.trim()}
      style={style}
      aria-hidden="true"
    >
      <div className="pane-skeleton-heading">
        <SkeletonBar size="tiny" />
        <SkeletonBar size="medium" />
      </div>
      {kind === 'applications' ? (
        <>
          <span className="pane-skeleton-search" />
          <div className="pane-skeleton-chips">
            <span /><span /><span />
          </div>
          <div className="pane-skeleton-list">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="pane-skeleton-row">
                <span className="pane-skeleton-avatar" />
                <div><SkeletonBar size="medium" /><SkeletonBar size="short" /></div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="pane-skeleton-inspector-body">
          <span className="pane-skeleton-ring" />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </div>
      )}
    </aside>
  )
}

function BrandMark({
  className,
  size = 22,
}: {
  className: string
  size?: number
}) {
  return (
    <span className={className} aria-hidden="true">
      <GraduationCap size={size} strokeWidth={2} />
    </span>
  )
}

function LaunchRail() {
  return (
    <aside className="launch-rail" aria-hidden="true">
      <BrandMark className="launch-rail-mark" size={22} />
      <div className="launch-rail-nav">
        {Array.from({ length: 5 }).map((_, index) => <span key={index} className={index === 0 ? 'active' : ''} />)}
      </div>
      <div className="launch-rail-bottom"><span /><span /></div>
    </aside>
  )
}

function AuthLaunchSkeleton() {
  return (
    <div className="launch-auth-shell" aria-hidden="true">
      <div className="launch-auth-hero">
        <BrandMark className="launch-auth-mark" size={26} />
        <SkeletonBar size="medium" />
        <SkeletonBar size="full" />
        <SkeletonBar size="medium" />
      </div>
      <div className="launch-auth-form">
        <SkeletonBar size="tiny" />
        <SkeletonBar size="medium" />
        <SkeletonBar size="full" />
        <span className="launch-auth-input" />
        <span className="launch-auth-input" />
        <span className="launch-auth-button" />
      </div>
    </div>
  )
}

function StandaloneLaunchSkeleton() {
  return (
    <div className="launch-standalone-shell" aria-hidden="true">
      <div className="launch-standalone-header">
        <BrandMark className="launch-standalone-mark" size={22} />
        <SkeletonBar size="short" />
        <SkeletonBar size="medium" />
      </div>
      <SkeletonCard tall lines={3} />
      <SkeletonCard lines={2} />
    </div>
  )
}

function AdminLaunchSkeleton() {
  return (
    <div className="launch-admin-shell" aria-hidden="true">
      <div className="launch-admin-topbar">
        <span className="launch-admin-brand" />
        <div className="launch-admin-tabs"><span /><span /><span /><span /></div>
        <span className="launch-admin-account" />
      </div>
      <div className="launch-admin-body">
        <div className="screen-skeleton-stats">
          {Array.from({ length: 4 }).map((_, index) => <SkeletonCard key={index} lines={1} />)}
        </div>
        <div className="screen-skeleton-content">
          <SkeletonCard tall lines={4} />
          <SkeletonCard tall lines={4} />
        </div>
      </div>
    </div>
  )
}

type LaunchScreenProps = {
  message?: string
  detail?: string
  variant?: LoadingVariant
  overlay?: boolean
  exiting?: boolean
  contentReady?: boolean
  className?: string
}

export function LaunchScreen({
  message,
  detail,
  variant = inferLoadingVariant(),
  overlay = false,
  exiting = false,
  contentReady = false,
  className = '',
}: LaunchScreenProps) {
  const screenVariant: ScreenSkeletonVariant | null = variant === 'auth' || variant === 'admin' || variant === 'standalone'
    ? null
    : variant

  return (
    <div
      className={[
        'launch-screen',
        `launch-variant-${variant}`,
        overlay ? 'is-overlay' : '',
        exiting ? 'is-exiting' : '',
        contentReady ? 'is-content-ready' : '',
        className,
      ].filter(Boolean).join(' ')}
      aria-busy={!contentReady}
      aria-hidden={contentReady || undefined}
      aria-live="polite"
    >
      {screenVariant ? (
        <div className={`launch-app-shell launch-app-shell-${variant}`}>
          <LaunchRail />
          {variant === 'workspace' ? <PaneSkeleton kind="applications" className="launch-application-pane" /> : null}
          <main className="launch-main-stage">
            <ScreenSkeleton variant={screenVariant} className="launch-screen-skeleton" />
          </main>
          {variant === 'workspace' ? <PaneSkeleton kind="inspector" className="launch-inspector-pane" /> : null}
        </div>
      ) : variant === 'auth' ? (
        <AuthLaunchSkeleton />
      ) : variant === 'admin' ? (
        <AdminLaunchSkeleton />
      ) : (
        <StandaloneLaunchSkeleton />
      )}

      {message || detail ? (
        <div className="launch-status" role="status">
          <BrandMark className="launch-status-mark" size={18} />
          <span className="launch-status-copy">
            <strong>{message ?? 'PhD Atlas'}</strong>
            {detail ? <small>{detail}</small> : null}
          </span>
          <span className="launch-status-track" aria-hidden="true"><i /></span>
        </div>
      ) : null}
    </div>
  )
}

export function LoadingCurtain({
  loading,
  message,
  detail,
  variant,
  /** Delay showing the curtain so instant handoffs never flash. */
  delayMs = 0,
  minimumVisibleMs = 220,
  exitDurationMs = 420,
}: {
  loading: boolean
  message?: string
  detail?: string
  variant?: LoadingVariant
  delayMs?: number
  minimumVisibleMs?: number
  exitDurationMs?: number
}) {
  const [visible, setVisible] = useState(() => loading && delayMs <= 0)
  const [exiting, setExiting] = useState(false)
  const shownAtRef = useRef(loading && delayMs <= 0 ? Date.now() : 0)

  useEffect(() => {
    let showTimer: number | undefined
    let exitTimer: number | undefined
    let hideTimer: number | undefined

    if (loading) {
      setExiting(false)
      if (delayMs <= 0) {
        shownAtRef.current = Date.now()
        setVisible(true)
        return undefined
      }
      // Delayed appearance: if loading clears before delay, never paint a flash.
      showTimer = window.setTimeout(() => {
        shownAtRef.current = Date.now()
        setVisible(true)
        setExiting(false)
      }, delayMs)
      return () => {
        if (showTimer !== undefined) window.clearTimeout(showTimer)
      }
    }

    if (showTimer !== undefined) window.clearTimeout(showTimer)

    if (!visible) return undefined

    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const minimum = reduceMotion ? 0 : minimumVisibleMs
    const exitDuration = reduceMotion ? 20 : exitDurationMs
    const wait = Math.max(0, minimum - (Date.now() - shownAtRef.current))

    exitTimer = window.setTimeout(() => setExiting(true), wait)
    hideTimer = window.setTimeout(() => {
      setVisible(false)
      setExiting(false)
    }, wait + exitDuration)

    return () => {
      if (showTimer !== undefined) window.clearTimeout(showTimer)
      if (exitTimer !== undefined) window.clearTimeout(exitTimer)
      if (hideTimer !== undefined) window.clearTimeout(hideTimer)
    }
  }, [delayMs, exitDurationMs, loading, minimumVisibleMs, visible])

  if (!loading && !visible) return null

  return (
    <LaunchScreen
      message={message}
      detail={detail}
      variant={variant}
      overlay
      exiting={exiting && !loading}
      contentReady={!loading}
    />
  )
}
