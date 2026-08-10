import '../../styles/ai.css'
import { Bot, ChevronDown, CircleCheck, Clock3, KeyRound, LoaderCircle, Plus, RotateCcw, Save, ShieldCheck, Trash2, Wifi, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { AiKey, AiKeyInput, AiKeyRequestMode, AiProvider } from '../../api/phdApi'
import { AI_KEY_MAX_CONCURRENCY } from '../../../shared/aiConcurrency.js'
import { AI_KEY_MAX_WEIGHT, AI_KEY_MIN_WEIGHT } from '../../../shared/aiKeyRouting.js'
import { normalizeErrorMessage } from '../../errorMessages'
import { localeForLanguage } from '../../i18n'
import { useI18n } from '../hooks/useI18n'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { CollapsiblePanel } from './CollapsiblePanel'
import { InfoTooltip } from './InfoTooltip'
import { InlineConfirm } from './InlineConfirm'
import { Select } from './Select'
import { SwitchControl } from './SwitchControl'

type NotifyTone = 'success' | 'error' | 'info' | 'warning'

type KeyTestResult = {
  keyId: string
  ok: boolean
  message: string
}

type KeyForm = {
  provider: AiProvider
  label: string
  model: string
  baseUrl: string
  apiKey: string
  maxConcurrency: number
  requestMode: AiKeyRequestMode
  weight: number
  enabled: boolean
}

const providerDefaults: Record<AiProvider, Pick<KeyForm, 'label' | 'model' | 'baseUrl'>> = {
  openai: { label: 'OpenAI', model: 'gpt-4.1-mini', baseUrl: '' },
  deepseek: { label: 'DeepSeek', model: 'deepseek-chat', baseUrl: '' },
  anthropic: { label: 'Claude', model: 'claude-sonnet-4-20250514', baseUrl: '' },
  gemini: { label: 'Gemini', model: 'gemini-2.5-flash', baseUrl: '' },
}

const providerOptions = Object.entries(providerDefaults).map(([value, item]) => ({ value, label: item.label }))

function freshForm(): KeyForm {
  return {
    provider: 'openai',
    ...providerDefaults.openai,
    apiKey: '',
    maxConcurrency: 4,
    requestMode: 'auto',
    weight: 50,
    enabled: true,
  }
}

function formatTimestamp(value: string | null, lang: string, fallback: string) {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return new Intl.DateTimeFormat(localeForLanguage(lang), { month: 'short', day: 'numeric' }).format(date)
}

export function AiKeyManager({
  keys,
  scope,
  teamId = null,
  canManage = true,
  autoOpenAdd = false,
  copyPrefix,
  onCreate,
  onUpdate,
  onDelete,
  onTest,
  onResetUsage,
  onNotify,
}: {
  keys: AiKey[]
  scope: 'personal' | 'team'
  teamId?: string | null
  canManage?: boolean
  /** Lets a contextual handoff (for example Discover → Settings) land directly in the add flow. */
  autoOpenAdd?: boolean
  copyPrefix: 'settings' | 'team'
  onCreate?: (input: AiKeyInput) => Promise<void> | void
  onUpdate?: (id: string, input: Partial<Pick<AiKeyInput, 'label' | 'model' | 'baseUrl' | 'apiKey' | 'maxConcurrency' | 'requestMode' | 'weight' | 'enabled'>>) => Promise<void> | void
  onDelete?: (id: string) => Promise<void> | void
  /** Live provider probe for a saved key. Returns latency ms on success; throws on failure. */
  onTest?: (id: string) => Promise<{ latencyMs: number; model?: string }>
  onResetUsage?: (id: string) => Promise<void> | void
  /** Prefer top toast for operational feedback (errors, test results). */
  onNotify?: (message: string, tone?: NotifyTone) => void
}) {
  const { tx, lang, format } = useI18n()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<KeyForm>(freshForm)
  const [busy, setBusy] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<KeyTestResult | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [closingDeleteId, setClosingDeleteId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [pendingUsageResetId, setPendingUsageResetId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const deleteCloseTimerRef = useRef<number | null>(null)
  const autoOpenHandledRef = useRef(false)
  const apiKeyInputRef = useRef<HTMLInputElement | null>(null)
  const copy = (key: string, fallback?: string) => tx(`${copyPrefix}.ai.${key}`, fallback)
  const notify = (message: string, tone: NotifyTone = 'error') => onNotify?.(message, tone)
  const requestModeOptions = [
    { value: 'auto', label: copy('requestModeAuto', 'Auto') },
    { value: 'responses', label: copy('requestModeResponses', 'Responses API') },
    { value: 'chat_completions', label: copy('requestModeChatCompletions', 'Chat Completions') },
  ]
  const scopedKeys = useMemo(
    () => keys.filter((key) => key.scope === scope && (scope === 'personal' || key.teamId === teamId)),
    [keys, scope, teamId],
  )

  const openAdd = () => {
    setExpandedId(null)
    setPendingDeleteId(null)
    setClosingDeleteId(null)
    setPendingUsageResetId(null)
    setFormError(null)
    setEditing(freshForm())
    setAdding(true)
  }

  useEffect(() => {
    if (!autoOpenAdd || autoOpenHandledRef.current || !canManage || !onCreate) return
    autoOpenHandledRef.current = true
    openAdd()
    const frame = window.requestAnimationFrame(() => apiKeyInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
    // `openAdd` is intentionally local state setup; rerunning this only when the
    // handoff intent changes prevents a user-cancelled form from reopening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenAdd, canManage, onCreate])

  useEffect(() => {
    if (!autoOpenAdd) autoOpenHandledRef.current = false
  }, [autoOpenAdd])

  const openEdit = (key: AiKey) => {
    setAdding(false)
    setPendingDeleteId(null)
    setClosingDeleteId(null)
    setPendingUsageResetId(null)
    setExpandedId(key.id)
    setEditing({
      provider: key.provider,
      label: key.label,
      model: key.model,
      baseUrl: key.baseUrl,
      apiKey: '',
      maxConcurrency: key.maxConcurrency ?? 4,
      requestMode: key.requestMode ?? 'auto',
      weight: key.weight ?? 50,
      enabled: key.enabled !== false,
    })
  }

  const updateProvider = (nextProvider: string) => {
    const provider = nextProvider as AiProvider
    const defaults = providerDefaults[provider]
    setEditing((current) => ({
      ...current,
      provider,
      label: current.label || defaults.label,
      model: defaults.model,
      baseUrl: '',
      requestMode: 'auto',
    }))
  }

  const submitAdd = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing.apiKey.trim() || !onCreate) {
      const message = copy('keyRequired')
      setFormError(message)
      notify(message, 'warning')
      return
    }
    setBusy(true)
    try {
      await onCreate({
        scope,
        teamId: scope === 'team' ? teamId : null,
        provider: editing.provider,
        label: editing.label.trim() || providerDefaults[editing.provider].label,
        model: editing.model.trim() || providerDefaults[editing.provider].model,
        baseUrl: editing.baseUrl.trim(),
        apiKey: editing.apiKey.trim(),
        maxConcurrency: editing.maxConcurrency || 4,
        requestMode: editing.requestMode,
        weight: editing.weight || 50,
        enabled: editing.enabled,
      })
      setAdding(false)
      setFormError(null)
      setEditing(freshForm())
    } catch (cause) {
      const message = normalizeErrorMessage(cause, lang, copy('saveError'))
      setFormError(message)
      notify(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const submitEdit = async (event: FormEvent, key: AiKey) => {
    event.preventDefault()
    if (!onUpdate) return
    setBusy(true)
    try {
      await onUpdate(key.id, {
        label: editing.label.trim() || key.label,
        model: editing.model.trim() || key.model,
        baseUrl: editing.baseUrl.trim(),
        maxConcurrency: editing.maxConcurrency || 4,
        requestMode: editing.requestMode,
        weight: editing.weight || 50,
        enabled: editing.enabled,
        ...(editing.apiKey.trim() ? { apiKey: editing.apiKey.trim() } : {}),
      })
      setExpandedId(null)
      setEditing(freshForm())
    } catch (cause) {
      const message = normalizeErrorMessage(cause, lang, copy('saveError'))
      setFormError(message)
      notify(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const deleteKey = async (id: string) => {
    if (!onDelete) return
    setBusy(true)
    setClosingDeleteId(null)
    setRemovingId(id)
    try {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, getMotionDelay(380))
      })
      await onDelete(id)
      setPendingDeleteId(null)
      setPendingUsageResetId(null)
      setExpandedId(null)
      setTestResult(null)
    } catch (cause) {
      notify(normalizeErrorMessage(cause, lang, copy('saveError')), 'error')
      throw cause
    } finally {
      setRemovingId(null)
      setBusy(false)
    }
  }

  const closeDeleteConfirm = (id: string) => {
    if (deleteCloseTimerRef.current) window.clearTimeout(deleteCloseTimerRef.current)
    setClosingDeleteId(id)
    deleteCloseTimerRef.current = window.setTimeout(() => {
      setPendingDeleteId(null)
      setClosingDeleteId(null)
      deleteCloseTimerRef.current = null
    }, getMotionDelay(320))
  }

  useEffect(() => () => {
    if (deleteCloseTimerRef.current) window.clearTimeout(deleteCloseTimerRef.current)
  }, [])

  const resetUsage = async (id: string) => {
    if (!onResetUsage) return
    setBusy(true)
    try {
      await onResetUsage(id)
      setPendingUsageResetId(null)
    } catch (cause) {
      notify(normalizeErrorMessage(cause, lang, copy('saveError')), 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleKeyEnabled = async (key: AiKey, enabled: boolean) => {
    if (!onUpdate || busy) return
    const previous = editing.enabled
    setEditing((current) => ({ ...current, enabled }))
    setBusy(true)
    try {
      await onUpdate(key.id, { enabled })
    } catch (cause) {
      setEditing((current) => ({ ...current, enabled: previous }))
      notify(normalizeErrorMessage(cause, lang, copy('saveError')), 'error')
    } finally {
      setBusy(false)
    }
  }

  const testKey = async (key: AiKey) => {
    if (!onTest || testingId) return
    setTestingId(key.id)
    setTestResult(null)
    try {
      const result = await onTest(key.id)
      const okMessage = format(copy('testOk'), { ms: String(result.latencyMs) })
      setTestResult({
        keyId: key.id,
        ok: true,
        message: okMessage,
      })
      notify(okMessage, 'success')
    } catch (cause) {
      const message = normalizeErrorMessage(cause, lang, copy('testFailed'))
      setTestResult({
        keyId: key.id,
        ok: false,
        message: copy('testFailedChip'),
      })
      notify(message, 'error')
    } finally {
      setTestingId(null)
    }
  }

  const form = (mode: 'add' | 'edit', key?: AiKey) => {
    const formErrorId = `ai-key-${mode}-${key?.id ?? 'new'}-error`
    const supportsRequestMode = editing.provider === 'openai' || editing.provider === 'deepseek'
    const enabledLabel = editing.enabled ? copy('enabled', 'Enabled') : copy('disabled', 'Disabled')
    return (
    <form className="ai-key-form" onSubmit={(event) => mode === 'add' ? void submitAdd(event) : key && void submitEdit(event, key)}>
      <div className="ai-key-form-grid ai-key-identity-grid">
        <label className="ai-key-provider-field" data-tour={mode === 'add' ? 'ai-key-provider-field' : undefined}>
          <span className="ai-key-field-label">{copy('provider')}</span>
          <Select
            size="small"
            value={editing.provider}
            options={providerOptions}
            onChange={updateProvider}
            ariaLabel={copy('provider')}
            disabled={mode === 'edit'}
          />
        </label>
        <label className="ai-key-name-field">
          <span className="ai-key-field-label">{copy('label')}</span>
          <input value={editing.label} onChange={(event) => setEditing((current) => ({ ...current, label: event.target.value }))} maxLength={80} placeholder={providerDefaults[editing.provider].label} />
        </label>
        <label className="ai-key-model-field">
          <span className="ai-key-field-label">{copy('model')}</span>
          <input value={editing.model} onChange={(event) => setEditing((current) => ({ ...current, model: event.target.value }))} maxLength={160} placeholder={providerDefaults[editing.provider].model} />
        </label>
      </div>
      <div className="ai-key-form-grid ai-key-routing-grid">
        <label className="ai-key-base-url-field">
          <span className="ai-key-field-label">{copy('baseUrl')}</span>
          <input value={editing.baseUrl} onChange={(event) => setEditing((current) => ({ ...current, baseUrl: event.target.value }))} maxLength={500} placeholder={copy('baseUrlPlaceholder')} inputMode="url" />
        </label>
        <div className="ai-key-field ai-key-request-mode-field">
          <span className="ai-key-field-label">
            {copy('requestMode', 'Request mode')}
            <InfoTooltip
              className="ai-key-field-info"
              content={copy('requestModeHint', 'Auto follows the provider default. Choose Responses or Chat Completions only when the endpoint supports that protocol.')}
              label={copy('requestModeInfo', 'About request modes')}
            />
          </span>
          <Select
            size="small"
            value={supportsRequestMode ? editing.requestMode : 'auto'}
            options={supportsRequestMode
              ? requestModeOptions
              : [{ value: 'auto', label: copy('requestModeNative', 'Provider native') }]}
            onChange={(value) => setEditing((current) => ({ ...current, requestMode: value as AiKeyRequestMode }))}
            ariaLabel={copy('requestMode', 'Request mode')}
            disabled={!supportsRequestMode}
          />
        </div>
        <div className="ai-key-field ai-key-concurrency-field">
          <span className="ai-key-field-label">
            {copy('maxConcurrency')}
            <InfoTooltip
              className="ai-key-field-info"
              content={copy('maxConcurrencyHint')}
              label={copy('maxConcurrencyInfo', 'About concurrency limits')}
            />
          </span>
          <input
            type="number"
            min={1}
            max={AI_KEY_MAX_CONCURRENCY}
            step={1}
            value={editing.maxConcurrency || ''}
            aria-label={copy('maxConcurrency')}
            onChange={(event) => setEditing((current) => ({
              ...current,
              maxConcurrency: event.target.value === ''
                ? 0
                : Math.min(AI_KEY_MAX_CONCURRENCY, Math.max(1, Math.floor(event.target.valueAsNumber || 1))),
            }))}
          />
        </div>
        <div className="ai-key-field ai-key-weight-field">
          <span className="ai-key-field-label">
            {copy('weight', 'Weight')}
            <InfoTooltip
              className="ai-key-field-info"
              content={copy('weightHint', 'Higher weights receive a larger share of requests when several enabled keys are selected.')}
              label={copy('weightInfo', 'About key weights')}
            />
          </span>
          <input
            type="number"
            min={AI_KEY_MIN_WEIGHT}
            max={AI_KEY_MAX_WEIGHT}
            step={1}
            value={editing.weight || ''}
            aria-label={copy('weight', 'Weight')}
            onChange={(event) => setEditing((current) => ({
              ...current,
              weight: event.target.value === ''
                ? 0
                : Math.min(AI_KEY_MAX_WEIGHT, Math.max(AI_KEY_MIN_WEIGHT, Math.floor(event.target.valueAsNumber || AI_KEY_MIN_WEIGHT))),
            }))}
          />
        </div>
      </div>
      <label className="ai-key-secret-field">
        <span className="ai-key-field-label">{mode === 'edit' ? copy('replaceKey') : copy('apiKey')}</span>
        <input ref={mode === 'add' ? apiKeyInputRef : undefined} type="password" autoComplete="new-password" value={editing.apiKey} onChange={(event) => { setFormError(null); setEditing((current) => ({ ...current, apiKey: event.target.value })) }} placeholder={mode === 'edit' ? copy('replaceKeyPlaceholder') : copy('apiKeyPlaceholder')} aria-label={mode === 'edit' ? copy('replaceKey') : copy('apiKey')} aria-required={mode === 'add' || undefined} aria-invalid={Boolean(formError) || undefined} aria-describedby={formError ? formErrorId : undefined} />
        <small>{mode === 'edit' ? copy('replaceKeyHint') : copy('keyEncryptionHint')}</small>
        {formError ? <small id={formErrorId} className="ai-key-form-error" role="alert">{formError}</small> : null}
      </label>
      <div className="ai-key-form-footer">
        <div className="ai-key-form-actions">
          <button type="submit" className="primary-action ai-key-save-action" disabled={busy || Boolean(testingId)}>
            {busy ? <LoaderCircle className="ai-spin" size={13} aria-hidden="true" /> : mode === 'edit' ? <Save size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
            {mode === 'edit' ? copy('save') : copy('add')}
          </button>
          {mode === 'edit' && key && onTest ? (
            <button
              type="button"
              className="secondary-action ai-key-test-action"
              disabled={busy || testingId === key.id || !editing.enabled}
              onClick={() => void testKey(key)}
            >
              {testingId === key.id
                ? <LoaderCircle className="ai-spin" size={13} aria-hidden="true" />
                : <Wifi size={13} aria-hidden="true" />}
              {testingId === key.id ? copy('testing') : copy('test')}
            </button>
          ) : null}
          <button type="button" className="quiet-action" disabled={busy || Boolean(testingId)} onClick={() => { setAdding(false); setExpandedId(null); setTestResult(null); setFormError(null); setEditing(freshForm()) }}>
            <X size={13} aria-hidden="true" /> {copy('cancel')}
          </button>
          {mode === 'edit' && key && onDelete ? (
            <InlineConfirm
              className="ai-key-delete-inline"
              open={pendingDeleteId === key.id && closingDeleteId !== key.id}
              busy={busy}
              disabled={busy}
              confirmTone="danger"
              confirmLabel={copy('remove')}
              idleTitle={copy('remove')}
              idleAriaLabel={copy('remove')}
              idleClassName="ai-key-delete-button"
              onOpen={() => {
                if (deleteCloseTimerRef.current) window.clearTimeout(deleteCloseTimerRef.current)
                setClosingDeleteId(null)
                setPendingUsageResetId(null)
                setPendingDeleteId(key.id)
              }}
              onCancel={() => closeDeleteConfirm(key.id)}
              onConfirm={() => deleteKey(key.id)}
            >
              <Trash2 size={13} aria-hidden="true" />
              <span>{copy('remove')}</span>
            </InlineConfirm>
          ) : null}
        </div>
        <div className={`ai-key-enabled-control${editing.enabled ? ' is-enabled' : ''}`}>
          <span>
            <strong>{enabledLabel}</strong>
            <small>{editing.enabled ? copy('enabledHint', 'Available for requests') : copy('disabledHint', 'Excluded from requests')}</small>
          </span>
          <SwitchControl
            checked={editing.enabled}
            disabled={busy || Boolean(testingId)}
            label={copy('enabledToggle', 'Enable this AI key')}
            onChange={(enabled) => {
              if (mode === 'edit' && key) void toggleKeyEnabled(key, enabled)
              else setEditing((current) => ({ ...current, enabled }))
            }}
          />
        </div>
      </div>
    </form>
    )
  }

  return (
    <section className={`ai-key-manager ai-key-manager-${scope}`} aria-label={copy(scope === 'team' ? 'teamTitle' : 'title')}>
      <div className="section-title ai-key-section-title">
        <h4><KeyRound size={14} aria-hidden="true" /> {copy(scope === 'team' ? 'teamTitle' : 'title')}</h4>
        <div className="ai-key-manager-actions">
          <span className="ai-key-count" title={String(scopedKeys.length)}><KeyRound size={12} aria-hidden="true" /> {scopedKeys.length}</span>
          {canManage ? (
            <button type="button" className="primary-action ai-key-add-button" onClick={openAdd} disabled={adding || busy} data-tour="ai-key-add">
              <Plus size={14} aria-hidden="true" /> {copy('add')}
            </button>
          ) : null}
        </div>
      </div>

      {!canManage ? (
        <div className="ai-key-readonly-note"><ShieldCheck size={14} aria-hidden="true" /> {copy('teamReadOnly')}</div>
      ) : null}

      <CollapsiblePanel open={adding} className="ai-key-add-collapse" innerClassName="ai-key-add-inner" collapseMs={260} keepMounted>
        {form('add')}
      </CollapsiblePanel>

      {scopedKeys.length === 0 ? (
        <div className="ai-key-empty">
          <span className="empty-state-icon" aria-hidden="true"><Bot size={17} /></span>
          <div><strong>{copy('emptyTitle')}</strong><p>{copy(scope === 'team' ? 'teamEmptyHint' : 'emptyHint')}</p></div>
        </div>
      ) : (
        <div className="ai-key-list">
          {scopedKeys.map((key) => {
            const open = expandedId === key.id
            const usage = key.usage ?? { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, resetAt: null }
            const number = new Intl.NumberFormat(localeForLanguage(lang))
            const requestModeLabel = key.provider === 'openai' || key.provider === 'deepseek'
              ? requestModeOptions.find((option) => option.value === (key.requestMode ?? 'auto'))?.label
                ?? copy('requestModeAuto', 'Auto')
              : copy('requestModeNative', 'Provider native')
            return (
              <article key={key.id} className={`ai-key-item ${open ? 'expanded' : ''}${key.enabled === false ? ' is-disabled' : ''}${pendingDeleteId === key.id || closingDeleteId === key.id ? ' is-deleting' : ''}${closingDeleteId === key.id ? ' is-delete-closing' : ''}${removingId === key.id ? ' is-removing' : ''}`} aria-busy={removingId === key.id || undefined}>
                <div className="ai-key-summary-row">
                  <button
                    type="button"
                    className="ai-key-summary"
                    aria-label={`${key.label} · ${providerDefaults[key.provider].label} · ${key.model} · ${key.enabled === false ? copy('disabled', 'Disabled') : copy('connected')}`}
                    aria-expanded={open}
                    aria-controls={`ai-key-detail-${key.id}`}
                    onClick={() => {
                      if (open) {
                        setPendingDeleteId(null)
                        setPendingUsageResetId(null)
                        setExpandedId(null)
                      } else {
                        openEdit(key)
                      }
                    }}
                  >
                    <span className="ai-key-provider-icon" aria-hidden="true"><KeyRound size={15} /></span>
                    <span className="ai-key-summary-copy">
                      <small className="ai-key-provider-label">
                        {providerDefaults[key.provider].label}
                        <span>{format(copy('weightSummary', 'Weight {count}'), { count: String(key.weight ?? 50) })}</span>
                      </small>
                      <strong>{key.label}</strong>
                      <span className="ai-key-summary-model">
                        {key.model} · {requestModeLabel} · {format(copy('concurrencySummary'), { count: String(key.maxConcurrency ?? 4) })}
                      </span>
                    </span>
                    <span className="ai-key-summary-meta">
                      {key.enabled === false ? (
                        <span className="ai-key-ready ai-key-paused">{copy('disabled', 'Disabled')}</span>
                      ) : testResult?.keyId === key.id && testResult.ok ? (
                        <span className="ai-key-ready ai-key-tested"><CircleCheck size={11} aria-hidden="true" /> {copy('testPassed')}</span>
                      ) : testResult?.keyId === key.id && !testResult.ok ? (
                        <span className="ai-key-ready ai-key-test-failed">{copy('testFailedChip')}</span>
                      ) : (
                        <span className="ai-key-ready"><CircleCheck size={11} aria-hidden="true" /> {copy('connected')}</span>
                      )}
                      <ChevronDown size={15} aria-hidden="true" />
                    </span>
                  </button>
                </div>
                <CollapsiblePanel open={open} id={`ai-key-detail-${key.id}`} className="ai-key-detail" innerClassName="ai-key-detail-inner" collapseMs={260} keepMounted>
                  <div className="ai-key-detail-meta">
                    <span className="ai-key-meta-chip">
                      <Clock3 size={11} aria-hidden="true" />
                      {copy('lastUsed')}: {formatTimestamp(key.lastUsedAt, lang, copy('neverUsed'))}
                    </span>
                    <span className="ai-key-meta-chip">
                      {format(copy('usageCalls'), { count: number.format(usage.calls) })}
                    </span>
                    <span
                      className="ai-key-meta-chip"
                      title={format(copy('usageBreakdown'), {
                        input: number.format(usage.inputTokens),
                        output: number.format(usage.outputTokens),
                      })}
                    >
                      {format(copy('usageTokens'), { count: number.format(usage.totalTokens) })}
                    </span>
                    {canManage && onResetUsage ? (
                      <InlineConfirm
                        className="ai-key-usage-inline"
                        open={pendingUsageResetId === key.id}
                        busy={busy}
                        disabled={busy}
                        confirmLabel={copy('usageReset')}
                        idleTitle={copy('usageReset')}
                        idleAriaLabel={copy('usageReset')}
                        idleClassName="ai-key-usage-reset"
                        onOpen={() => {
                          setPendingDeleteId(null)
                          setPendingUsageResetId(key.id)
                        }}
                        onCancel={() => setPendingUsageResetId(null)}
                        onConfirm={() => resetUsage(key.id)}
                      >
                        <RotateCcw size={11} aria-hidden="true" />
                        <span>{copy('usageReset')}</span>
                      </InlineConfirm>
                    ) : null}
                  </div>
                  {canManage ? form('edit', key) : null}
                </CollapsiblePanel>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
