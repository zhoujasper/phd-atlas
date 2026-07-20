import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Database,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { useMemo } from 'react'
import englishUpgrade from '../../i18n/en/upgrade.json'
import chineseUpgrade from '../../i18n/zh/upgrade.json'
import { registerLanguage } from '../../i18n'
import { PUBLIC_EDITION } from '../../edition'
import { useI18n } from '../hooks/useI18n'

// This standalone route must render its access explanation immediately, including after a resize
// or hot reload, before the provider's background namespace request completes.
registerLanguage('en', englishUpgrade, 'upgrade')
registerLanguage('zh', chineseUpgrade, 'upgrade')

const PRO_BACKUP_LIMIT = 20
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
  const { tx, format } = useI18n()
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const requestedFeature = params.get('feature') ?? 'membership'
  const feature = PUBLIC_EDITION && requestedFeature === 'team' ? 'membership' : requestedFeature
  const requestedTier = params.get('requested')
  const currentLimit = params.get('limit') ?? '5'
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

  const metrics = feature === 'application-limit'
    ? [
        { label: tx('upgrade.currentLimitLabel'), value: format(tx('upgrade.applicationLimitValue'), { limit: currentLimit || FREE_APPLICATION_LIMIT }) },
        { label: tx('upgrade.requestedTierLabel'), value: requestedLabel },
        { label: tx('upgrade.proLimitLabel'), value: format(tx('upgrade.applicationLimitValue'), { limit: PRO_APPLICATION_LIMIT }) },
      ]
    : feature === 'backup-frequency'
      ? [
          { label: tx('upgrade.currentLimitLabel'), value: tx('upgrade.offOnly') },
          { label: tx('upgrade.requestedTierLabel'), value: requestedLabel },
          { label: tx('upgrade.proLimitLabel'), value: tx('upgrade.allFrequencies') },
        ]
      : feature === 'manual-backup'
        ? [
            { label: tx('upgrade.currentLimitLabel'), value: tx('upgrade.proOnly') },
            { label: tx('upgrade.requestedTierLabel'), value: tx('upgrade.manualBackupLabel') },
            { label: tx('upgrade.proLimitLabel'), value: tx('upgrade.unlimitedBackups') },
          ]
        : feature === 'draft-mailbox'
          ? [
              { label: tx('upgrade.currentLimitLabel'), value: tx('upgrade.draftMailboxFreeValue') },
              { label: tx('upgrade.requestedTierLabel'), value: tx('upgrade.draftMailboxLabel') },
              { label: tx('upgrade.proLimitLabel'), value: tx('upgrade.draftMailboxProValue') },
            ]
        : feature === 'team'
          ? [
              { label: tx('upgrade.requestedTierLabel'), value: tx('upgrade.teamPlan') },
              { label: tx('upgrade.proLimitLabel'), value: tx('upgrade.teamFeatureSeats') },
            ]
          : [
            { label: tx('upgrade.currentLimitLabel'), value: format(tx('upgrade.backupLimitValue'), { limit: currentLimit }) },
            { label: tx('upgrade.requestedTierLabel'), value: requestedTier ? format(tx('upgrade.backupLimitValue'), { limit: requestedTier }) : tx('upgrade.notSpecified') },
            { label: tx('upgrade.proLimitLabel'), value: format(tx('upgrade.backupLimitValue'), { limit: PRO_BACKUP_LIMIT }) },
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
    { icon: Database, title: tx('upgrade.benefitBackupTitle'), body: tx('upgrade.benefitBackupBody') },
    { icon: ShieldCheck, title: tx('upgrade.benefitSafetyTitle'), body: tx('upgrade.benefitSafetyBody') },
    { icon: Clock3, title: tx('upgrade.benefitSeasonTitle'), body: tx('upgrade.benefitSeasonBody') },
    { icon: Users, title: tx('upgrade.benefitMemberTitle'), body: tx('upgrade.benefitMemberBody') },
  ]

  const steps = [
    tx('upgrade.stepRequest'),
    tx('upgrade.stepReview'),
    tx('upgrade.stepActivate'),
  ]

  return (
    <main className="upgrade-canvas route-content-reveal">
      <div className="upgrade-shell">
        <header className="upgrade-topbar">
          <div className="upgrade-brand">
            <span className="upgrade-brand-mark" aria-hidden="true">
              <Sparkles size={17} />
            </span>
            <span>{tx('upgrade.membershipCenter')}</span>
          </div>
          <button type="button" className="upgrade-back-button" onClick={returnToSettings}>
            <ArrowLeft size={14} aria-hidden="true" />
            {tx('upgrade.backToSettings')}
          </button>
        </header>

        <section className="upgrade-hero" aria-labelledby="upgrade-title">
          <div className="upgrade-hero-copy">
            <span className="upgrade-eyebrow">{tx('upgrade.eyebrow')}</span>
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

          <aside className="upgrade-limit-panel" aria-label={tx('upgrade.limitPanelLabel')}>
            <span className="upgrade-limit-icon" aria-hidden="true">
              <LockKeyhole size={18} />
            </span>
            <h2>{tx('upgrade.limitPanelTitle')}</h2>
            <p>{requestSummary}</p>
            <dl className="upgrade-limit-list">
              {metrics.map((metric) => (
                <div key={metric.label}>
                  <dt>{metric.label}</dt>
                  <dd>{metric.value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </section>

        <section className="upgrade-section" aria-labelledby="upgrade-plans-title">
          <div className="upgrade-section-head">
            <span className="upgrade-eyebrow">{tx('upgrade.plansEyebrow')}</span>
            <h2 id="upgrade-plans-title">{tx('upgrade.plansTitle')}</h2>
            <p>{tx('upgrade.plansDesc')}</p>
          </div>
          <div className="upgrade-plan-grid">
            {plans.map((plan) => (
              <article key={plan.key} className={`upgrade-plan-card ${plan.featured ? 'featured' : ''}`}>
                <div className="upgrade-plan-head">
                  {plan.badge ? <span className="upgrade-plan-chip">{plan.badge}</span> : null}
                  <h3>{plan.name}</h3>
                  <strong>{plan.price}</strong>
                  <p>{plan.description}</p>
                </div>
                <ul className="upgrade-feature-list">
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <CheckCircle2 size={13} aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                {plan.disabled ? (
                  <button type="button" className="upgrade-plan-action" disabled>
                    {plan.action}
                  </button>
                ) : (
                  <a className="upgrade-plan-action primary" href={mailto}>
                    {plan.action}
                  </a>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="upgrade-section upgrade-benefits" aria-labelledby="upgrade-benefits-title">
          <div className="upgrade-section-head compact">
            <span className="upgrade-eyebrow">{tx('upgrade.introEyebrow')}</span>
            <h2 id="upgrade-benefits-title">{tx('upgrade.introTitle')}</h2>
            <p>{tx('upgrade.introDesc')}</p>
          </div>
          <div className="upgrade-benefit-grid">
            {benefits.map((benefit) => {
              const Icon = benefit.icon
              return (
                <article key={benefit.title} className="upgrade-benefit-card">
                  <span aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <h3>{benefit.title}</h3>
                  <p>{benefit.body}</p>
                </article>
              )
            })}
          </div>
        </section>

        <section className="upgrade-flow" aria-label={tx('upgrade.flowTitle')}>
          <div>
            <span className="upgrade-eyebrow">{tx('upgrade.flowEyebrow')}</span>
            <h2>{tx('upgrade.flowTitle')}</h2>
            <p>{tx('upgrade.flowDesc')}</p>
          </div>
          <ol>
            {steps.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  )
}
