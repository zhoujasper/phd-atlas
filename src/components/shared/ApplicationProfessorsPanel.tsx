import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Trash2, Users, X } from 'lucide-react'
import {
  applicationProfessors, emptyProfessor, createProfessorId, MAX_APPLICATION_PROFESSORS,
  professorAddresses, professorName, type ApplicationProfessor, type ProfessorApplication,
} from '../../../shared/applicationProfessors.js'
import { useI18n } from '../hooks/useI18n'
import { LazyMarkdownTextarea as MarkdownTextarea } from './LazyMarkdownTextarea'
import { ProfessorAvatar } from './ProfessorAvatar'
import { CopyButton } from './CopyButton'
import { ExternalLinkAction } from './ExternalLinkAction'
import { isValidCorrespondenceEmail, normalizeCorrespondenceEmail } from '../../correspondenceRecipients'

function ProfessorRemoveAction({ name, open, onOpen, onCancel, onConfirm }: {
  name: string
  open: boolean
  onOpen: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const { tx } = useI18n()
  const confirmationId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const focusOnOpen = useRef(false)

  useLayoutEffect(() => {
    const focused = document.activeElement
    if (open && focusOnOpen.current && (focused === triggerRef.current || focused === document.body)) {
      cancelRef.current?.focus({ preventScroll: true })
    }
    if (!open && wasOpen.current && (rootRef.current?.contains(focused) || focused === document.body)) {
      triggerRef.current?.focus({ preventScroll: true })
    }
    focusOnOpen.current = false
    wasOpen.current = open
  }, [open])

  return <div ref={rootRef} className="professor-card-actions" onKeyDown={(event) => {
    if (!open || event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onCancel()
  }}>
    <button ref={triggerRef} type="button" className="professor-card-remove"
      aria-label={`${tx('dossier.supervisors.remove')}: ${name}`} title={tx('dossier.supervisors.remove')}
      aria-expanded={open} aria-controls={confirmationId} aria-hidden={open}
      tabIndex={open ? -1 : 0} inert={open} onClick={() => {
        focusOnOpen.current = true
        onOpen()
      }}>
      <Trash2 size={14} aria-hidden="true" />
    </button>
    <div id={confirmationId} className="professor-card-confirm" role="group"
      aria-label={`${tx('dossier.supervisors.confirmRemove')}: ${name}`}
      aria-describedby={`${confirmationId}-hint`} aria-hidden={!open} inert={!open}>
      <span id={`${confirmationId}-hint`} className="sr-only">{tx('dossier.supervisors.removeHint')}</span>
      <button type="button" className="professor-card-confirm-delete" tabIndex={open ? 0 : -1}
        onClick={() => { if (open) onConfirm() }}>{tx('dossier.supervisors.confirmRemove')}</button>
      <button ref={cancelRef} type="button" className="professor-card-confirm-cancel" tabIndex={open ? 0 : -1}
        onClick={onCancel}>{tx('cancel')}</button>
    </div>
  </div>
}

export function ApplicationProfessorsPanel({ value, onChange, readOnly = false, onWrite, invalidField, createMode = false, deferHeavyContent = false }: {
  value: ProfessorApplication
  onChange: (value: ProfessorApplication) => void
  readOnly?: boolean
  invalidField?: string | null
  createMode?: boolean
  deferHeavyContent?: boolean
  onWrite?: (email: string) => void
}) {
  const { tx, lang } = useI18n()
  const panelId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const selectorRef = useRef<HTMLDivElement>(null)
  const choiceRefs = useRef(new Map<string, HTMLButtonElement>())
  const professors = applicationProfessors(value)
  const [selectedId, setSelectedId] = useState(professors[0].id)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [alias, setAlias] = useState('')
  const [error, setError] = useState('')
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false })
  const selected = professors.find((item) => item.id === selectedId) ?? professors[0]
  const index = professors.findIndex((item) => item.id === selected.id)
  const path = index === 0 ? 'professor' : `additionalProfessors.${index - 1}`
  const removalAvailable = !readOnly && professors.length > 1 && professors.some((item) => item.id === removingId)

  useEffect(() => {
    if (!removalAvailable) setRemovingId(null)
  }, [removalAvailable])

  useEffect(() => {
    const rail = selectorRef.current
    if (!rail) return undefined
    let frame = 0
    const measure = () => {
      frame = 0
      const bounds = rail.getBoundingClientRect()
      const cards = Array.from(rail.children, (card) => card.getBoundingClientRect())
      const left = cards.some((card) => card.left < bounds.left - 1)
      const right = cards.some((card) => card.right > bounds.right + 1)
      setScrollEdges((previous) => previous.left === left && previous.right === right ? previous : { left, right })
    }
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure) }
    schedule()
    rail.addEventListener('scroll', schedule, { passive: true })
    rail.addEventListener('animationend', schedule)
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(rail)
    return () => {
      window.cancelAnimationFrame(frame)
      rail.removeEventListener('scroll', schedule)
      rail.removeEventListener('animationend', schedule)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [professors.length])

  useEffect(() => {
    const rail = selectorRef.current
    const card = choiceRefs.current.get(selected.id)?.parentElement
    if (!rail || !card) return
    const bounds = rail.getBoundingClientRect()
    const target = card.getBoundingClientRect()
    const left = target.left < bounds.left ? target.left - bounds.left - 4
      : target.right > bounds.right ? target.right - bounds.right + 4 : 0
    // Scroll only this rail; focusing a newly added profile must not move the dialog.
    if (left) rail.scrollBy?.({ left, behavior: 'auto' })
  }, [selected.id, index, professors.length])

  const replace = (next: Array<ApplicationProfessor & { id: string }>) => {
    if (readOnly) return
    const [primary, ...additionalProfessors] = next
    onChange({ professor: primary ?? emptyProfessor(), additionalProfessors })
  }
  const update = (patch: Partial<ApplicationProfessor>) => {
    setError('')
    replace(professors.map((item) => item.id === selected.id ? { ...item, ...patch } : item))
  }
  const select = (id: string) => {
    setSelectedId(id)
    setRemovingId(null)
    setAlias('')
    setError('')
  }
  const add = () => {
    const professor = { ...emptyProfessor(), id: createProfessorId() }
    replace([...professors, professor])
    select(professor.id)
    // The same input stays mounted, so focus does not race a disclosure timer.
    nameRef.current?.focus()
  }
  const remove = (id: string) => {
    if (readOnly || professors.length <= 1 || removingId !== id) return
    const next = professors.filter((item) => item.id !== id)
    if (next.length === professors.length) return
    const nextSelected = selected.id === id ? next[Math.max(0, index - 1)] : selected
    replace(next)
    if (selected.id === id) select(nextSelected.id)
    else setRemovingId(null)
    choiceRefs.current.get(nextSelected.id)?.focus({ preventScroll: true })
  }
  const fieldPath = (key: string) => index === 0 && createMode
    ? ({ english: 'professor', chinese: 'professorChinese', email: 'professorEmail', homepage: 'professorHomepage' } as Record<string, string>)[key] || `professorProfile.${key}`
    : `${path}.${key}`
  const field = (key: 'english' | 'chinese' | 'email' | 'phone' | 'social' | 'homepage' | 'labUrl' | 'projectUrl', label: string, type = 'text') => (
    <label data-field-path={fieldPath(key)} className={invalidField === fieldPath(key) ? 'field-has-error' : undefined}>
      <span>{tx(label)}</span>
      <div className={type === 'url' ? 'dossier-link-field' : 'input-with-copy'}>
        <input ref={key === 'english' ? nameRef : undefined} type={type}
          value={selected[key] ?? ''} readOnly={readOnly}
          aria-label={tx(label)} aria-invalid={invalidField === fieldPath(key) || undefined} maxLength={key === 'english' || key === 'chinese' ? 200 : 2048}
          onChange={(event) => update({ [key]: event.target.value })} />
        {type === 'url' ? <ExternalLinkAction value={selected[key] ?? ''} label={tx('dossier.openLink')} /> : null}
        <CopyButton value={selected[key] ?? ''} label={tx(label)} className={type === 'url' ? undefined : 'copy-inside'} />
      </div>
    </label>
  )
  const duplicateAddress = professors.some((item) => item.id !== selected.id
    && professorAddresses(item).some((email) => professorAddresses(selected).includes(email)))

  return (
    <section className="application-professors" aria-label={tx('dossier.supervisors.title')}>
      <div className="professors-heading">
        <h3><Users size={16} aria-hidden="true" />{tx('dossier.supervisors.title')}</h3>
        <div className="professors-heading-actions">
          {professors.length > 1 && (scrollEdges.left || scrollEdges.right) ? <div className="professors-navigation">
            <button type="button" className="professors-scroll" disabled={!scrollEdges.left}
              aria-label={tx('dossier.supervisors.scrollLeft')} aria-controls={`${panelId}-selector`}
              onClick={() => selectorRef.current?.scrollBy({ left: -selectorRef.current.clientWidth * .8, behavior: 'auto' })}>
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <button type="button" className="professors-scroll" disabled={!scrollEdges.right}
              aria-label={tx('dossier.supervisors.scrollRight')} aria-controls={`${panelId}-selector`}
              onClick={() => selectorRef.current?.scrollBy({ left: selectorRef.current.clientWidth * .8, behavior: 'auto' })}>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div> : null}
          {!readOnly ? <button type="button" className="quiet-action" onClick={add}
            disabled={professors.length >= MAX_APPLICATION_PROFESSORS}>
            <Plus size={14} aria-hidden="true" />{tx('dossier.supervisors.add')}
          </button> : null}
        </div>
      </div>
      <p className="professors-hint">{tx('dossier.supervisors.hint')}</p>
      <div className="professors-selector-shell">
        <div ref={selectorRef} id={`${panelId}-selector`} className="professors-selector" role="group"
          aria-label={tx('dossier.supervisors.title')}>
          {professors.map((professor, professorIndex) => {
            const name = professorName(professor, lang) || tx('dossier.supervisors.unnamed')
            const confirming = !readOnly && professors.length > 1 && removingId === professor.id
            return <div key={professor.id} className="professor-card"
              data-selected={selected.id === professor.id} data-confirming={confirming}
              data-removable={!readOnly && professors.length > 1}>
              <button type="button" ref={(node) => {
                if (node) choiceRefs.current.set(professor.id, node)
                else choiceRefs.current.delete(professor.id)
              }} aria-pressed={selected.id === professor.id}
                aria-label={`${name} ${professor.email}`} aria-controls={panelId} className="professor-choice"
                title={[name, professor.email].filter(Boolean).join('\n')} onClick={() => select(professor.id)}
                onKeyDown={(event) => {
                  if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
                  const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1
                  const targetIndex = event.key === 'ArrowRight' ? professorIndex + direction
                    : event.key === 'ArrowLeft' ? professorIndex - direction
                      : event.key === 'Home' ? 0 : event.key === 'End' ? professors.length - 1 : null
                  if (targetIndex === null) return
                  event.preventDefault()
                  event.stopPropagation()
                  const target = professors[Math.max(0, Math.min(professors.length - 1, targetIndex))]
                  select(target.id)
                  choiceRefs.current.get(target.id)?.focus({ preventScroll: true })
                }}>
                <ProfessorAvatar professor={professor} />
                <span className="professor-choice-label"><strong>{name}</strong>
                  <small>{professor.email || tx('dossier.supervisors.emailOptional')}</small></span>
              </button>
              {!readOnly && professors.length > 1 ? <ProfessorRemoveAction name={name} open={confirming}
                onOpen={() => setRemovingId(professor.id)} onCancel={() => setRemovingId(null)}
                onConfirm={() => remove(professor.id)} /> : null}
            </div>
          })}
        </div>
      </div>
      <div className="professor-editor" id={panelId}>
        <div className="professor-editor-actions">
          <span>{index === 0 ? tx('dossier.supervisors.default') : tx('dossier.supervisors.contact')}</span>
          {onWrite && isValidCorrespondenceEmail(selected.email) ? <button type="button" className="quiet-action"
            onClick={() => onWrite(selected.email)}>{tx('dossier.supervisors.write')}</button> : null}
          {!readOnly && index > 0 ? <button type="button" className="quiet-action" onClick={() => {
            replace([selected, ...professors.filter((item) => item.id !== selected.id)])
          }}>{tx('dossier.supervisors.makeDefault')}</button> : null}
        </div>
        <div className="professor-fields">
          {field('english', 'dossier.professor')}
          {field('chinese', 'dossier.supervisors.chineseName')}
          {field('email', 'dossier.email', 'email')}
          {field('homepage', 'dossier.homepage', 'url')}
        </div>
        {duplicateAddress ? <p className="professor-error" role="alert">{tx('dossier.supervisors.duplicateEmail')}</p> : null}
        {!deferHeavyContent ? <div className="textarea-field dossier-research-direction-field">
          <span>{tx('dossier.researchDirection')}</span>
          <MarkdownTextarea value={selected.research} rows={3} readOnly={readOnly}
            aria-label={tx('dossier.researchDirection')} onChange={(event) => update({ research: event.target.value })} />
        </div> : null}
        <details className="professor-more" key={selected.id}>
          <summary>{tx('dossier.supervisors.more')}<ChevronDown size={14} aria-hidden="true" /></summary>
          <div className="professor-fields">
            {field('phone', 'dossier.phone', 'tel')}
            {field('social', 'dossier.social')}
            {field('labUrl', 'dossier.labLink', 'url')}
            {field('projectUrl', 'dossier.projectLink', 'url')}
          </div>
          {!deferHeavyContent ? <div className="textarea-field">
            <span>{tx('dossier.labGroup')}</span>
            <MarkdownTextarea value={selected.lab} rows={2} readOnly={readOnly}
              aria-label={tx('dossier.labGroup')} onChange={(event) => update({ lab: event.target.value })} />
          </div> : null}
          <div className="professor-aliases">
            <span>{tx('dossier.supervisors.aliases')}</span>
            {(selected.correspondenceEmails ?? []).map((email) => <span key={email} className="professor-alias">
              {email}{!readOnly ? <button type="button" aria-label={`${tx('dossier.supervisors.remove')} ${email}`}
                onClick={() => update({ correspondenceEmails: selected.correspondenceEmails?.filter((item) => item !== email) })}>
                <X size={12} aria-hidden="true" /></button> : null}
            </span>)}
            {!readOnly && (selected.correspondenceEmails?.length ?? 0) < 9 ? <div className="professor-alias-input">
              <input type="email" value={alias} aria-label={tx('dossier.supervisors.aliases')}
                onChange={(event) => { setAlias(event.target.value); setError('') }} />
              <button type="button" className="quiet-action" onClick={() => {
                const email = normalizeCorrespondenceEmail(alias)
                if (!isValidCorrespondenceEmail(email)) { setError(tx('dossier.recipientInvalid')); return }
                if (professors.some((item) => professorAddresses(item).includes(email))) {
                  setError(tx('dossier.supervisors.duplicateEmail')); return
                }
                update({ correspondenceEmails: [...(selected.correspondenceEmails ?? []), email] })
                setAlias('')
              }}>{tx('dossier.recipientAdd')}</button>
            </div> : null}
            {error ? <p className="professor-error" role="alert">{error}</p> : null}
          </div>
        </details>
      </div>
    </section>
  )
}
