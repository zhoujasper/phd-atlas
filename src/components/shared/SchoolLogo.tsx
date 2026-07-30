import clsx from 'clsx'
import {
  Building2,
  Check,
  Globe2,
  ImagePlus,
  Link2,
  LoaderCircle,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { ApplicationRecord } from '../../data/applications'
import { useI18n } from '../hooks/useI18n'
import { AnchoredPopover } from './AnchoredPopover'
import {
  SCHOOL_LOGO_ACCEPT,
  normalizeSchoolLogoLinkInput,
  schoolLogoInitials,
} from './schoolLogoModel'

type SchoolLogo = ApplicationRecord['school']['logo']
type ResolveInput = { website?: string; imageUrl?: string; auto?: true; refresh?: boolean }
type LogoActionStatus = 'idle' | 'working' | 'saved' | 'not-found' | 'error'
type LogoLinkMode = 'website' | 'image'

function compactSource(value?: string) {
  if (!value) return ''
  try {
    const url = new URL(value)
    return url.hostname.replace(/^www\./u, '')
  } catch {
    return value
  }
}

export function SchoolLogoMark({
  schoolName,
  logo,
  variant = 'list',
  busy = false,
}: {
  schoolName: string
  logo?: SchoolLogo
  variant?: 'list' | 'header' | 'preview'
  busy?: boolean
}) {
  return (
    <span
      className={clsx(
        'school-logo-mark',
        `school-logo-mark-${variant}`,
        logo && 'has-image',
        busy && 'is-busy',
      )}
      aria-hidden="true"
    >
      {logo ? (
        <img src={logo.dataUrl} alt="" draggable={false} />
      ) : (
        <span className="school-logo-initials">{schoolLogoInitials(schoolName)}</span>
      )}
      {busy ? <span className="school-logo-scan" /> : null}
    </span>
  )
}

export function SchoolLogoManager({
  schoolName,
  website,
  logo,
  autoDetectEnabled = true,
  onResolve,
  onUpload,
  onRemove,
}: {
  schoolName: string
  website: string
  logo?: SchoolLogo
  autoDetectEnabled?: boolean
  onResolve: (input: ResolveInput, options?: { silent?: boolean }) => Promise<boolean>
  onUpload: (file: File) => Promise<boolean>
  onRemove: () => Promise<boolean>
}) {
  const { tx } = useI18n()
  const [status, setStatus] = useState<LogoActionStatus>('idle')
  const [linkEditorOpen, setLinkEditorOpen] = useState(false)
  const [linkMode, setLinkMode] = useState<LogoLinkMode>('website')
  const [alternateWebsite, setAlternateWebsite] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const autoAttemptRef = useRef('')
  const working = status === 'working'

  const run = async (action: () => Promise<boolean>, silent = false) => {
    setStatus('working')
    try {
      const saved = await action()
      setStatus(saved ? 'saved' : 'not-found')
      return saved
    } catch {
      setStatus('error')
      return false
    } finally {
      if (silent) {
        window.setTimeout(() => setStatus((current) => current === 'working' ? 'idle' : current), 0)
      }
    }
  }

  useEffect(() => {
    const key = `${schoolName.trim()}::${website.trim()}::${autoDetectEnabled ? 'auto' : 'off'}`
    if (
      logo
      || !autoDetectEnabled
      || autoAttemptRef.current === key
      || typeof navigator !== 'undefined' && !navigator.onLine
    ) return
    autoAttemptRef.current = key
    void run(() => onResolve({
      auto: true,
      ...(website.trim() ? { website: website.trim() } : {}),
    }, { silent: true }), true)
  }, [autoDetectEnabled, logo, onResolve, schoolName, website])

  const uploadFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || working) return
    void run(() => onUpload(file))
  }

  const linkValue = linkMode === 'website' ? alternateWebsite : imageUrl
  const linkLabel = linkMode === 'website'
    ? tx('dossier.schoolLogoWebsiteLink')
    : tx('dossier.schoolLogoImageLink')
  const linkHint = linkMode === 'website'
    ? tx('dossier.schoolLogoWebsiteLinkHint')
    : tx('dossier.schoolLogoImageLinkHint')
  const linkPlaceholder = linkMode === 'website'
    ? tx('dossier.schoolLogoWebsiteLinkPlaceholder')
    : tx('dossier.schoolLogoLinkPlaceholder')
  const resolveLink = () => {
    const normalized = normalizeSchoolLogoLinkInput(linkValue)
    if (linkMode === 'website') {
      setAlternateWebsite(normalized)
      return onResolve({ website: normalized, refresh: true })
    }
    setImageUrl(normalized)
    return onResolve({ imageUrl: normalized })
  }

  const sourceLabel = logo
    ? tx(`dossier.schoolLogoSource.${logo.source}`)
    : tx('dossier.schoolLogoEmpty')
  const statusLabel = status === 'working'
    ? tx('dossier.schoolLogoWorking')
    : status === 'saved'
      ? tx('dossier.schoolLogoSaved')
      : status === 'not-found'
        ? tx('dossier.schoolLogoNotFound')
        : status === 'error'
          ? tx('dossier.schoolLogoFailed')
          : ''

  return (
    <AnchoredPopover
      trigger={(
        <>
          <SchoolLogoMark schoolName={schoolName} logo={logo} variant="header" busy={working} />
          <span className="school-logo-edit-indicator" aria-hidden="true">
            {working ? <LoaderCircle size={11} className="spin-icon" /> : <ImagePlus size={11} />}
          </span>
        </>
      )}
      triggerAriaLabel={tx('dossier.schoolLogoManage')}
      popoverAriaLabel={tx('dossier.schoolLogoManage')}
      triggerClassName={clsx('school-logo-trigger', logo && 'has-image', working && 'is-busy')}
      popoverClassName="school-logo-popover"
      width={344}
      estimatedHeight={430}
      align="start"
    >
      {() => (
        <div className="school-logo-editor">
          <div className="school-logo-editor-head">
            <SchoolLogoMark schoolName={schoolName} logo={logo} variant="preview" busy={working} />
            <span>
              <strong>{schoolName}</strong>
              <em>{sourceLabel}</em>
              {logo?.sourceUrl ? <small>{compactSource(logo.sourceUrl)}</small> : null}
            </span>
            {logo ? <Check size={14} className="school-logo-current-check" aria-hidden="true" /> : <Building2 size={14} aria-hidden="true" />}
          </div>

          <div className="school-logo-action-list">
            <button
              type="button"
              className="school-logo-action is-primary"
              disabled={working || !website.trim()}
              onClick={() => void run(() => onResolve({ website: website.trim(), refresh: true }))}
            >
              <span className="school-logo-action-icon" aria-hidden="true">
                {working ? <LoaderCircle size={15} className="spin-icon" /> : <RefreshCw size={15} />}
              </span>
              <span>
                <strong>{logo ? tx('dossier.schoolLogoRefresh') : tx('dossier.schoolLogoAuto')}</strong>
                <em>{website.trim() ? compactSource(website) : tx('dossier.schoolLogoWebsiteMissing')}</em>
              </span>
            </button>

            <button
              type="button"
              className={clsx('school-logo-action', linkEditorOpen && 'is-open')}
              disabled={working}
              aria-expanded={linkEditorOpen}
              onClick={() => setLinkEditorOpen((current) => !current)}
            >
              <span className="school-logo-action-icon" aria-hidden="true"><Link2 size={15} /></span>
              <span>
                <strong>{tx('dossier.schoolLogoLink')}</strong>
                <em>{tx('dossier.schoolLogoLinkHint')}</em>
              </span>
            </button>

            <div className={clsx('school-logo-link-editor', linkEditorOpen && 'open')} inert={!linkEditorOpen || undefined}>
              <div className="school-logo-link-editor-inner">
                <div
                  className="school-logo-link-modes"
                  role="tablist"
                  aria-label={tx('dossier.schoolLogoLink')}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={linkMode === 'website'}
                    className={clsx(linkMode === 'website' && 'active')}
                    disabled={working}
                    onClick={() => setLinkMode('website')}
                  >
                    <Globe2 size={12} aria-hidden="true" />
                    {tx('dossier.schoolLogoWebsiteLink')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={linkMode === 'image'}
                    className={clsx(linkMode === 'image' && 'active')}
                    disabled={working}
                    onClick={() => setLinkMode('image')}
                  >
                    <ImagePlus size={12} aria-hidden="true" />
                    {tx('dossier.schoolLogoImageLink')}
                  </button>
                </div>
                <p className="school-logo-link-hint">{linkHint}</p>
                <div className="school-logo-link-controls">
                  <input
                    type="url"
                    value={linkValue}
                    onChange={(event) => {
                      if (linkMode === 'website') setAlternateWebsite(event.target.value)
                      else setImageUrl(event.target.value)
                    }}
                    onBlur={() => {
                      const normalized = normalizeSchoolLogoLinkInput(linkValue)
                      if (linkMode === 'website') setAlternateWebsite(normalized)
                      else setImageUrl(normalized)
                    }}
                    placeholder={linkPlaceholder}
                    aria-label={linkLabel}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || !linkValue.trim() || working) return
                      event.preventDefault()
                      void run(resolveLink)
                    }}
                  />
                  <button
                    type="button"
                    className="school-logo-fetch-link"
                    disabled={working || !linkValue.trim()}
                    onClick={() => void run(resolveLink)}
                  >
                    {working ? <LoaderCircle size={13} className="spin-icon" /> : <RefreshCw size={13} />}
                    {tx('dossier.schoolLogoFetch')}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="school-logo-action"
              disabled={working}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="school-logo-action-icon" aria-hidden="true"><Upload size={15} /></span>
              <span>
                <strong>{tx('dossier.schoolLogoUpload')}</strong>
                <em>{tx('dossier.schoolLogoUploadHint')}</em>
              </span>
            </button>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept={SCHOOL_LOGO_ACCEPT}
              disabled={working}
              onChange={uploadFile}
            />
          </div>

          <div className="school-logo-editor-foot">
            <span className={clsx('school-logo-status', status !== 'idle' && `is-${status}`)} role="status" aria-live="polite">
              {statusLabel}
            </span>
            {logo ? (
              <button
                type="button"
                className="school-logo-remove"
                disabled={working}
                onClick={() => void run(onRemove)}
              >
                <Trash2 size={12} aria-hidden="true" />
                {tx('dossier.schoolLogoRemove')}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </AnchoredPopover>
  )
}
