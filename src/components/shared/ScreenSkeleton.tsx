import { Skeleton } from './Skeleton'
import { useI18n } from '../hooks/useI18n'

interface ScreenSkeletonProps {
  type?: 'dashboard' | 'dossier' | 'profile' | 'settings' | 'generic'
  className?: string
}

/**
 * Route-level loading skeleton that matches real content layout.
 * Prevents blank screens during navigation and slow data fetches.
 * Integrates with existing .screen-skeleton patterns.
 */
export function ScreenSkeleton({ type = 'generic', className = '' }: ScreenSkeletonProps) {
  const { tx } = useI18n()
  switch (type) {
    case 'dashboard':
      return <DashboardSkeleton className={className} label={tx('feedback.loading.dashboard', 'Loading dashboard')} />
    case 'dossier':
      return <DossierSkeleton className={className} label={tx('feedback.loading.application', 'Loading application')} />
    case 'profile':
      return <ProfileSkeleton className={className} label={tx('feedback.loading.profile', 'Loading profile')} />
    case 'settings':
      return <SettingsSkeleton className={className} label={tx('feedback.loading.settings', 'Loading settings')} />
    default:
      return <GenericSkeleton className={className} label={tx('feedback.loading.generic', 'Loading')} />
  }
}

interface LabeledSkeletonProps {
  className?: string
  label: string
}

function DashboardSkeleton({ className = '', label }: LabeledSkeletonProps) {
  return (
    <div className={`workspace-deferred-panel screen-skeleton ${className}`} role="status" aria-label={label}>
      <div className="screen-skeleton-hero">
        <div className="screen-skeleton-heading">
          <Skeleton height={28} width="60%" />
          <Skeleton height={14} width="40%" />
        </div>
        <div className="screen-skeleton-action" aria-hidden="true" />
      </div>

      <div className="screen-skeleton-stats">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="screen-skeleton-stat">
            <Skeleton height={11} width="50%" />
            <Skeleton height={20} width="35%" />
          </div>
        ))}
      </div>

      <div className="screen-skeleton-content">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="loading-skeleton-card">
            <Skeleton height={14} width="70%" />
            <Skeleton height={12} width="50%" />
            <Skeleton height={12} width="85%" />
          </div>
        ))}
      </div>
    </div>
  )
}

function DossierSkeleton({ className = '', label }: LabeledSkeletonProps) {
  return (
    <div className={`workspace-deferred-panel screen-skeleton ${className}`} role="status" aria-label={label}>
      <div className="screen-skeleton-hero">
        <div className="screen-skeleton-heading">
          <Skeleton height={26} width="55%" />
          <Skeleton height={13} width="35%" />
        </div>
        <div className="screen-skeleton-action" aria-hidden="true" />
      </div>

      <div className="screen-skeleton-tabs">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} aria-hidden="true" />
        ))}
      </div>

      <div className="screen-skeleton-content">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="loading-skeleton-card tall">
            <Skeleton height={14} width="60%" />
            <Skeleton height={12} width="100%" />
            <Skeleton height={12} width="95%" />
            <Skeleton height={12} width="70%" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ProfileSkeleton({ className = '', label }: LabeledSkeletonProps) {
  return (
    <div className={`workspace-deferred-panel screen-skeleton screen-skeleton-profile ${className}`} role="status" aria-label={label}>
      <div className="screen-skeleton-hero">
        <div className="screen-skeleton-heading">
          <Skeleton height={28} width="45%" />
          <Skeleton height={13} width="30%" />
        </div>
      </div>

      <div className="screen-skeleton-stats">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="screen-skeleton-stat">
            <Skeleton height={11} width="55%" />
            <Skeleton height={18} width="40%" />
          </div>
        ))}
      </div>

      <div className="screen-skeleton-content">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="loading-skeleton-card">
            <Skeleton height={14} width="65%" />
            <Skeleton height={12} width="90%" />
            <Skeleton height={12} width="60%" />
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsSkeleton({ className = '', label }: LabeledSkeletonProps) {
  return (
    <div className={`workspace-deferred-panel screen-skeleton ${className}`} role="status" aria-label={label}>
      <div className="screen-skeleton-hero">
        <div className="screen-skeleton-heading">
          <Skeleton height={28} width="40%" />
          <Skeleton height={13} width="50%" />
        </div>
      </div>

      <div className="screen-skeleton-settings">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="screen-skeleton-setting-row">
            <Skeleton height={13} width="35%" />
            <Skeleton height={13} width={90} />
          </div>
        ))}
      </div>
    </div>
  )
}

function GenericSkeleton({ className = '', label }: LabeledSkeletonProps) {
  return (
    <div className={`workspace-deferred-panel screen-skeleton ${className}`} role="status" aria-label={label}>
      <div className="screen-skeleton-hero">
        <div className="screen-skeleton-heading">
          <Skeleton height={26} width="50%" />
          <Skeleton height={13} width="35%" />
        </div>
      </div>

      <div className="screen-skeleton-content">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="loading-skeleton-card">
            <Skeleton height={14} width="60%" />
            <Skeleton height={12} width="85%" />
            <Skeleton height={12} width="75%" />
          </div>
        ))}
      </div>
    </div>
  )
}

interface PanelSkeletonProps {
  type?: 'applications' | 'inspector' | 'list'
  className?: string
}

/**
 * Sidebar/panel-level skeleton for ApplicationPane and Inspector.
 */
export function PanelSkeleton({ type = 'list', className = '' }: PanelSkeletonProps) {
  const { tx } = useI18n()
  const label = type === 'applications'
    ? tx('feedback.loading.applications', 'Loading applications')
    : type === 'inspector'
      ? tx('feedback.loading.details', 'Loading details')
      : tx('feedback.loading.generic', 'Loading')

  return (
    <div className={`workspace-deferred-panel pane-skeleton pane-skeleton-${type} ${className}`} role="status" aria-label={label}>
      <div className="pane-skeleton-heading">
        <Skeleton height={18} width="55%" />
        <Skeleton height={12} width="40%" />
      </div>

      {type !== 'inspector' ? (
        <>
          <div className="pane-skeleton-search" aria-hidden="true" />
          <div className="pane-skeleton-chips">
            {Array.from({ length: 3 }).map((_, i) => (
              <span key={i} aria-hidden="true" />
            ))}
          </div>
        </>
      ) : null}

      <div className={type === 'inspector' ? 'pane-skeleton-inspector-body' : 'pane-skeleton-list'}>
        {type === 'inspector' ? (
          <>
            <div className="pane-skeleton-ring" aria-hidden="true" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="loading-skeleton-card">
                <Skeleton height={12} width="60%" />
                <Skeleton height={11} width="80%" />
              </div>
            ))}
          </>
        ) : (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="pane-skeleton-row">
              <div className="pane-skeleton-avatar" aria-hidden="true" />
              <div>
                <Skeleton height={12} width="85%" />
                <Skeleton height={10} width="60%" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
