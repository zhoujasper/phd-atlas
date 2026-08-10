import '../../styles/marketing.css'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  HardDrive,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import englishUpgrade from '../../i18n/en/upgrade.json'
import chineseUpgrade from '../../i18n/zh/upgrade.json'
import { localeForLanguage, registerLanguage } from '../../i18n'
import { PUBLIC_EDITION } from '../../edition'
import { useI18n } from '../hooks/useI18n'
import { useMarketingReveal, usePointerTilt } from '../hooks/useMarketingMotion'
import { StandalonePreferences } from '../shared/StandalonePreferences'
import { MarketingWorkspaceDemo, type MarketingProFeature } from './MarketingWorkspaceDemo'

// This standalone route must render its access explanation immediately, including after a resize
// or hot reload, before the provider's background namespace request completes.
registerLanguage('en', englishUpgrade, 'upgrade')
registerLanguage('zh', chineseUpgrade, 'upgrade')

const FREE_APPLICATION_LIMIT = 3
const PRO_APPLICATION_LIMIT = 300
const ADMIN_MAILBOX = 'admin@phd-atlas.local'

function returnToSettings() {
  try {
    localStorage.setItem('phd-atlas-screen', 'settings')
  } catch {
    // Storage may be unavailable in private browsing modes.
  }
  window.location.assign('/')
}

export function UpgradeProScreen() {
  const { tx, format, lang } = useI18n()
  const pageRef = useRef<HTMLElement | null>(null)
  const capabilityStageRef = useRef<HTMLDivElement | null>(null)
  const [activeBenefit, setActiveBenefit] = useState(0)
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(localeForLanguage(lang), { maximumFractionDigits: 1 }),
    [lang],
  )
  const formatStorage = (value: number) => format(
    tx('upgrade.storageValue'),
    { size: numberFormatter.format(value) },
  )
  useMarketingReveal(pageRef)
  usePointerTilt(capabilityStageRef, 1.8)
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const requestedFeature = params.get('feature') ?? 'membership'
  const feature = PUBLIC_EDITION && requestedFeature === 'team' ? 'membership' : requestedFeature
  const requestedTier = params.get('requested')
  const currentLimit = params.get('limit') ?? String(FREE_APPLICATION_LIMIT)
  const frequencyLabels: Record<string, string> = {
    '1m': tx('upgrade.backupEvery1m'),
    '5m': tx('upgrade.backupEvery5m'),
    '15m': tx('upgrade.backupEvery15m'),
    '30m': tx('upgrade.backupEvery30m'),
    '1h': tx('upgrade.backupEvery1h'),
    '3h': tx('upgrade.backupEvery3h'),
    '6h': tx('upgrade.backupEvery6h'),
    '12h': tx('upgrade.backupEvery12h'),
    daily: tx('upgrade.backupEvery1d'),
    backup: tx('upgrade.manualBackupLabel'),
    'draft-mailbox': tx('upgrade.draftMailboxLabel'),
  }
  const requestedLabel = requestedTier ? (frequencyLabels[requestedTier] ?? requestedTier) : tx('upgrade.notSpecified')
  const requestSummary =
    feature === 'application-limit'
      ? format(tx('upgrade.applicationLimitSummary'), { limit: currentLimit, requested: requestedLabel })
      : feature === 'backup-frequency'
        ? format(tx('upgrade.backupFrequencySummary'), { requested: requestedLabel })
        : feature === 'manual-backup'
        ? tx('upgrade.manualBackupSummary')
        : feature === 'draft-mailbox'
          ? tx('upgrade.draftMailboxSummary')
        : feature === 'team'
            ? tx('upgrade.teamRequestSummary')
            : requestedTier
              ? format(tx('upgrade.requestSummary'), { requested: requestedLabel, limit: currentLimit })
              : tx('upgrade.requestSummaryGeneric')
  const mailSubject = tx('upgrade.mailSubject')
  const mailBody = format(tx('upgrade.mailBody'), {
    requested: requestedLabel,
    limit: currentLimit,
  })
  const mailto = `mailto:${ADMIN_MAILBOX}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`

  const metrics = [
    {
      label: tx('upgrade.benefitSeasonTitle'),
      current: format(tx('upgrade.applicationLimitValue'), { limit: currentLimit || FREE_APPLICATION_LIMIT }),
      unlocked: format(tx('upgrade.applicationLimitValue'), { limit: PRO_APPLICATION_LIMIT }),
    },
    {
      label: tx('upgrade.benefitBackupTitle'),
      current: tx('upgrade.offOnly'),
      unlocked: tx('upgrade.backupEvery1m'),
    },
    {
      label: tx('upgrade.benefitMemberTitle'),
      current: formatStorage(25),
      unlocked: formatStorage(100),
    },
  ]

  const plans = [
    {
      key: 'free',
      name: tx('upgrade.freePlan'),
      price: tx('upgrade.freePrice'),
      badge: tx('upgrade.currentPlan'),
      description: tx('upgrade.freeDesc'),
      action: tx('upgrade.currentPlanCta'),
      disabled: true,
      features: [
        tx('upgrade.freeFeatureBackup'),
        tx('upgrade.freeFeatureWorkspace'),
        tx('upgrade.freeFeatureShare'),
      ],
    },
    {
      key: 'pro',
      name: tx('upgrade.proPlan'),
      price: tx('upgrade.proPrice'),
      badge: tx('upgrade.recommended'),
      description: tx('upgrade.proDesc'),
      action: tx('upgrade.primaryCta'),
      featured: true,
      features: [
        tx('upgrade.proFeatureBackup'),
        tx('upgrade.proFeatureQuota'),
        tx('upgrade.proFeatureAutomation'),
      ],
    },
    ...(!PUBLIC_EDITION
      ? [{
          key: 'team',
          name: tx('upgrade.teamPlan'),
          price: tx('upgrade.teamPrice'),
          badge: '',
          description: tx('upgrade.teamDesc'),
          action: tx('upgrade.teamCta'),
          features: [
            tx('upgrade.teamFeatureSeats'),
            tx('upgrade.teamFeatureReview'),
            tx('upgrade.teamFeatureAdmin'),
          ],
        }]
      : []),
  ]

  const benefits = [
    { icon: Database, title: tx('upgrade.benefitSeasonTitle'), body: tx('upgrade.benefitSeasonBody') },
    { icon: Clock3, title: tx('upgrade.benefitBackupTitle'), body: tx('upgrade.benefitBackupBody') },
    { icon: ShieldCheck, title: tx('upgrade.benefitSafetyTitle'), body: tx('upgrade.benefitSafetyBody') },
    { icon: HardDrive, title: tx('upgrade.benefitMemberTitle'), body: tx('upgrade.benefitMemberBody') },
  ]
  const benefitFeatures: MarketingProFeature[] = ['capacity', 'backup', 'recovery', 'storage']

  const steps = [
    tx('upgrade.stepRequest'),
    tx('upgrade.stepReview'),
    tx('upgrade.stepActivate'),
  ]

  const comparisonRows = [
    {
      label: tx('upgrade.benefitSeasonTitle'),
      values: plans.map((plan) => plan.features[0]),
    },
    {
      label: tx('upgrade.benefitBackupTitle'),
      values: plans.map((plan) => plan.features[1]),
    },
    {
      label: tx('upgrade.benefitSafetyTitle'),
      values: plans.map((plan) => plan.features[2]),
    },
  ]

  return (
    <main className="upgrade-canvas upgrade-experience route-content-reveal" ref={pageRef}>
      <header className="upgrade-topbar" data-marketing-reveal data-marketing-visible="true">
        <a className="upgrade-brand" href="#upgrade-top" aria-label={tx('upgrade.membershipCenter')}>
          <span className="upgrade-brand-mark" aria-hidden="true">
            <Sparkles size={16} />
          </span>
          <strong>{tx('appTitle')} <em>{tx('upgrade.proPlan')}</em></strong>
        </a>
        <div className="upgrade-topbar-actions">
          <StandalonePreferences />
          <button type="button" className="upgrade-back-button" onClick={returnToSettings}>
            <ArrowLeft size={14} aria-hidden="true" />
            {tx('upgrade.backToSettings')}
          </button>
        </div>
      </header>

      <section className="upgrade-hero" id="upgrade-top" aria-labelledby="upgrade-title">
        <div className="upgrade-hero-copy" data-marketing-reveal data-marketing-visible="true">
          <h1 id="upgrade-title">{tx('upgrade.title')}</h1>
          <p>{tx('upgrade.subtitle')}</p>
          <div className="upgrade-actions">
            <a className="upgrade-primary-action" href={mailto}>
              <Mail size={14} aria-hidden="true" />
              {tx('upgrade.primaryCta')}
            </a>
            <button type="button" className="upgrade-secondary-action" onClick={returnToSettings}>
              {tx('upgrade.secondaryCta')}
            </button>
          </div>
        </div>

        <div
          className="upgrade-capability-stage"
          ref={capabilityStageRef}
          aria-label={tx('upgrade.limitPanelLabel')}
          data-marketing-reveal
          data-marketing-visible="true"
        >
          <div className="upgrade-capability-light" aria-hidden="true" />
          <MarketingWorkspaceDemo
            className="upgrade-real-workspace"
            mode="pro"
            feature="backup"
            activeTab="dossier"
          />
          <aside className="upgrade-limit-panel" aria-label={tx('upgrade.limitPanelLabel')}>
            <span className="upgrade-limit-icon" aria-hidden="true">
              <LockKeyhole size={17} />
            </span>
            <div className="upgrade-limit-copy">
              <h2>{tx('upgrade.limitPanelTitle')}</h2>
              <p>{requestSummary}</p>
            </div>
            <dl className="upgrade-limit-list">
              {metrics.map((metric) => (
                <div key={metric.label}>
                  <dt>{metric.label}</dt>
                  <dd>
                    <span>{metric.current}</span>
                    <ArrowRight size={11} aria-hidden="true" />
                    <strong>{metric.unlocked}</strong>
                  </dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      </section>

      <section className="upgrade-benefit-story" aria-labelledby="upgrade-benefits-title">
        <div className="upgrade-benefit-story-inner">
          <div className="upgrade-benefit-selector" data-marketing-reveal>
            <div className="upgrade-benefit-story-head">
              <h2 id="upgrade-benefits-title">{tx('upgrade.introTitle')}</h2>
              <p>{tx('upgrade.introDesc')}</p>
            </div>
            <div className="upgrade-benefit-buttons">
              {benefits.map((benefit, index) => {
                const Icon = benefit.icon
                return (
                  <button
                    key={benefit.title}
                    type="button"
                    className={activeBenefit === index ? 'is-active' : ''}
                    aria-pressed={activeBenefit === index}
                    onClick={() => setActiveBenefit(index)}
                  >
                    <span><Icon size={18} aria-hidden="true" /></span>
                    <span>
                      <strong>{benefit.title}</strong>
                      <small>{benefit.body}</small>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="upgrade-benefit-preview" data-benefit={activeBenefit} data-marketing-reveal aria-live="polite">
            <MarketingWorkspaceDemo
              className="upgrade-benefit-real-workspace"
              mode="pro"
              feature={benefitFeatures[activeBenefit] ?? 'capacity'}
              activeTab={activeBenefit === 0 ? 'dossier' : activeBenefit === 2 ? 'timeline' : 'materials'}
            />
          </div>
        </div>
      </section>

      <section className="upgrade-plan-comparison" aria-labelledby="upgrade-plans-title">
        <div className="upgrade-section-head" data-marketing-reveal>
          <h2 id="upgrade-plans-title">{tx('upgrade.plansTitle')}</h2>
          <p>{tx('upgrade.plansDesc')}</p>
        </div>
        <div className={`upgrade-comparison-grid plan-count-${plans.length}`} data-marketing-reveal>
          <div className="upgrade-comparison-corner" aria-hidden="true" />
          {plans.map((plan) => (
            <div key={plan.key} className={`upgrade-comparison-plan ${plan.featured ? 'featured' : ''}`}>
              <div>
                <h3>{plan.name}</h3>
                {plan.badge ? <span>{plan.badge}</span> : null}
              </div>
              <strong>{plan.price}</strong>
              <p>{plan.description}</p>
            </div>
          ))}
          {comparisonRows.map((row) => (
            <div className="upgrade-comparison-row" key={row.label}>
              <h4>{row.label}</h4>
              {row.values.map((value, index) => (
                <div className={plans[index]?.featured ? 'featured' : ''} key={`${plans[index]?.key}-${row.label}`}>
                  <CheckCircle2 size={13} aria-hidden="true" />
                  <span>{value}</span>
                </div>
              ))}
            </div>
          ))}
          <div className="upgrade-comparison-actions">
            <span aria-hidden="true" />
            {plans.map((plan) => (
              <div className={plan.featured ? 'featured' : ''} key={plan.key}>
                {plan.disabled ? (
                  <button type="button" className="upgrade-plan-action" disabled>{plan.action}</button>
                ) : (
                  <a className={`upgrade-plan-action ${plan.featured ? 'primary' : ''}`} href={mailto}>
                    {plan.action}
                    <ArrowRight size={13} aria-hidden="true" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="upgrade-flow" aria-labelledby="upgrade-flow-title">
        <div className="upgrade-flow-head" data-marketing-reveal>
          <h2 id="upgrade-flow-title">{tx('upgrade.flowTitle')}</h2>
          <p>{tx('upgrade.flowDesc')}</p>
        </div>
        <ol data-marketing-reveal>
          {steps.map((step, index) => (
            <li key={step}>
              <span>{index + 1}</span>
              <p>{step}</p>
            </li>
          ))}
        </ol>
        <div className="upgrade-final-cta" data-marketing-reveal>
          <h2>{tx('upgrade.title')}</h2>
          <a className="upgrade-primary-action" href={mailto}>
            <Mail size={14} aria-hidden="true" />
            {tx('upgrade.primaryCta')}
          </a>
          <button type="button" className="upgrade-secondary-action" onClick={returnToSettings}>
            <ArrowLeft size={13} aria-hidden="true" />
            {tx('upgrade.backToSettings')}
          </button>
        </div>
      </section>
    </main>
  )
}
