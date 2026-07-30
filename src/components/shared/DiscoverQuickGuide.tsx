import {
  ArrowRight,
  BookmarkCheck,
  Info,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import { AnchoredPopover } from './AnchoredPopover'

export function DiscoverQuickGuide({
  onOpenResearch,
}: {
  onOpenResearch: () => void
}) {
  const { tx } = useI18n()
  const guideLabel = tx('discover.flowTitle', 'Discover workflow')
  const steps = [
    {
      id: 'direction',
      icon: SlidersHorizontal,
      title: tx('discover.flowDirection', 'Set direction'),
      body: tx('discover.nextActionCriteria', 'Set your field, regions and funding floor so the ranking reflects your priorities.'),
    },
    {
      id: 'research',
      icon: ShieldCheck,
      title: tx('discover.flowResearch', 'Research and verify'),
      body: tx('discover.nextActionResearch', 'Run the research flow once to refresh program, advisor and funding evidence.'),
    },
    {
      id: 'shortlist',
      icon: BookmarkCheck,
      title: tx('discover.flowShortlist', 'Build shortlist'),
      body: tx('discover.nextActionWatch', 'Review the top matches and watch 3–5 serious candidates before starting applications.'),
    },
    {
      id: 'import',
      icon: Plus,
      title: tx('discover.flowImport', 'Add to applications'),
      body: tx('discover.nextActionImport', 'Your shortlist is ready. Add a program to the application workspace and begin the checklist.'),
    },
  ]

  return (
    <AnchoredPopover
      trigger={<Info size={14} aria-hidden="true" />}
      triggerAriaLabel={guideLabel}
      popoverAriaLabel={guideLabel}
      triggerClassName="discover-guide-trigger"
      popoverClassName="discover-guide-popover"
      width={356}
      estimatedHeight={340}
    >
      {(close) => (
        <>
          <header className="discover-guide-head">
            <span className="discover-guide-mark" aria-hidden="true">
              <Info size={15} />
            </span>
            <span>
              <strong>{guideLabel}</strong>
              <small>{tx('discover.subtitle')}</small>
            </span>
            <button
              type="button"
              className="discover-guide-close"
              onClick={close}
              aria-label={tx('close', 'Close')}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </header>

          <ol className="discover-guide-steps">
            {steps.map((step) => {
              const Icon = step.icon
              return (
                <li key={step.id}>
                  <span className="discover-guide-step-icon" aria-hidden="true">
                    <Icon size={14} />
                  </span>
                  <span>
                    <strong>{step.title}</strong>
                    <small>{step.body}</small>
                  </span>
                </li>
              )
            })}
          </ol>

          <footer className="discover-guide-footer">
            <button
              type="button"
              className="primary-action discover-guide-action"
              data-popover-autofocus
              onClick={() => {
                close()
                onOpenResearch()
              }}
            >
              {tx('discover.configureNow', 'Set criteria')}
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          </footer>
        </>
      )}
    </AnchoredPopover>
  )
}
