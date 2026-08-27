/**
 * Inline loading skeleton for DossierView tabs (correspondence, admissions, timeline).
 * Replaces blank panes during fetch with 3-4 skeleton rows matching real content layout.
 * Addresses audit finding: no loading state for slow API operations in tabs.
 */

import { useI18n } from '../hooks/useI18n'

interface TabLoadingSkeletonProps {
  rows?: number
  className?: string
}

export function TabLoadingSkeleton({ rows = 4, className = '' }: TabLoadingSkeletonProps) {
  const { tx } = useI18n()
  return (
    <div className={`tab-content-loading ${className}`} role="status" aria-busy="true" aria-label={tx('feedback.loading.content', 'Loading content')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="tab-skeleton-row">
          <div className="tab-skeleton-avatar" aria-hidden="true" />
          <div className="tab-skeleton-content">
            <div className="tab-skeleton-bar full" aria-hidden="true" />
            <div className="tab-skeleton-bar medium" aria-hidden="true" />
          </div>
        </div>
      ))}
    </div>
  )
}

interface CorrespondenceTabSkeletonProps {
  count?: number
}

export function CorrespondenceTabSkeleton({ count = 3 }: CorrespondenceTabSkeletonProps) {
  return <TabLoadingSkeleton rows={count} className="correspondence-skeleton" />
}

interface AdmissionsTabSkeletonProps {
  count?: number
}

export function AdmissionsTabSkeleton({ count = 4 }: AdmissionsTabSkeletonProps) {
  return <TabLoadingSkeleton rows={count} className="admissions-skeleton" />
}

interface TimelineTabSkeletonProps {
  count?: number
}

export function TimelineTabSkeleton({ count = 5 }: TimelineTabSkeletonProps) {
  return <TabLoadingSkeleton rows={count} className="timeline-skeleton" />
}
