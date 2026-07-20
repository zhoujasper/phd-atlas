import { X } from 'lucide-react'
import type { AiKey } from '../../api/phdApi'
import type { ApplicationRecord } from '../../data/applications'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { useModalA11y } from '../hooks/useModalA11y'
import { DiscoverApplicationEnrichment } from './DiscoverApplicationEnrichment'
import { ModalPortal } from './ModalPortal'

export function DiscoverApplicationEnrichmentDialog({
  open,
  token,
  application,
  aiKeys,
  preferredKeyId,
  onApplied,
  onNotify,
  onClose,
}: {
  open: boolean
  token: string
  application: ApplicationRecord
  aiKeys: AiKey[]
  preferredKeyId?: string
  onApplied: (application: ApplicationRecord) => void
  onNotify: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
  onClose: () => void
}) {
  const { tx } = useI18n()
  const { exiting, requestClose } = useAnimatedClose(open, onClose, 180)
  const dialogRef = useModalA11y<HTMLElement>({ open, onClose: requestClose })

  return (
    <ModalPortal>
      <div
        className={`discover-sheet-backdrop${exiting ? ' is-exiting' : ''}`}
        role="presentation"
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) requestClose()
        }}
      >
        <aside
          ref={dialogRef}
          className={`discover-side-sheet discover-enrichment-sheet${exiting ? ' is-exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dossier-enrichment-title"
        >
          <header className="discover-side-sheet-header">
            <div>
              <h3 id="dossier-enrichment-title">{tx('discover.enrichExisting', 'Enrich existing application')}</h3>
              <p>{tx('discover.enrichSheetSubtitle', 'Review additions and replacements before anything is saved.')}</p>
            </div>
            <button type="button" className="discover-icon-btn" onClick={requestClose} aria-label={tx('discover.close', 'Close')}>
              <X size={17} />
            </button>
          </header>
          <div className="discover-side-sheet-scroll">
            <DiscoverApplicationEnrichment
              token={token}
              applications={[application]}
              aiKeys={aiKeys}
              preferredKeyId={preferredKeyId}
              onApplied={(updated) => {
                onApplied(updated)
                requestClose()
              }}
              onNotify={onNotify}
            />
          </div>
        </aside>
      </div>
    </ModalPortal>
  )
}
