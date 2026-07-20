import {
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  FileText,
  Flag,
  GraduationCap,
  Info,
  Route,
  ShieldAlert,
  Wallet,
} from 'lucide-react'
import clsx from 'clsx'
import type { DiscoverRequirements } from '../../data/discover'
import {
  daysUntilIso,
  deadlineUrgencyClass,
  primaryDeadline,
  testStatusTone,
} from '../../data/discover'
import { formatDate } from '../../appModel'
import { useI18n } from '../hooks/useI18n'

function statusLabel(status: string, tx: (path: string, fallback?: string) => string) {
  const map: Record<string, [string, string]> = {
    required: ['discover.reqStatusRequired', 'Required'],
    optional: ['discover.reqStatusOptional', 'Optional'],
    waived: ['discover.reqStatusWaived', 'Waived'],
    not_required: ['discover.reqStatusNotRequired', 'Not required'],
    required_if_intl: ['discover.reqStatusIfIntl', 'If international'],
    unknown: ['discover.reqStatusUnknown', 'Unknown'],
  }
  const entry = map[status] || map.unknown
  return tx(entry[0], entry[1])
}

function contactLabel(value: string, tx: (path: string, fallback?: string) => string) {
  const map: Record<string, [string, string]> = {
    required: ['discover.supervisorRequired', 'Supervisor contact required'],
    recommended: ['discover.supervisorRecommended', 'Supervisor contact recommended'],
    optional: ['discover.supervisorOptional', 'Supervisor contact optional'],
    not_needed: ['discover.supervisorNotNeeded', 'No supervisor contact needed'],
    unknown: ['discover.supervisorUnknown', 'Supervisor contact unknown'],
  }
  const entry = map[value] || map.unknown
  return tx(entry[0], entry[1])
}

export function DiscoverRequirementsPanel({
  requirements,
  freeTextFallback,
}: {
  requirements?: DiscoverRequirements | null
  freeTextFallback?: {
    deadlineAndTests?: string
    applicationRestrictions?: string
    applicationRoute?: string
    degreeStructure?: string
  }
}) {
  const { tx, format, lang } = useI18n()
  if (!requirements) {
    return (
      <div className="discover-req-empty">
        <Info size={14} />
        <span>
          {freeTextFallback?.deadlineAndTests
            || freeTextFallback?.applicationRestrictions
            || tx('discover.reqEmpty', 'No structured requirements yet — verify on the official site.')}
        </span>
      </div>
    )
  }

  const primary = primaryDeadline(requirements)
  const days = daysUntilIso(primary?.date)
  const urgency = deadlineUrgencyClass(days)

  return (
    <div className="discover-req-panel">
      <div className="discover-req-hero">
        <div className={clsx('discover-req-deadline-card', `is-${urgency}`)}>
          <div className="discover-req-deadline-icon">
            <CalendarClock size={18} />
          </div>
          <div className="discover-req-deadline-copy">
            <span className="label">{tx('discover.reqPrimaryDeadline', 'Primary deadline')}</span>
            <strong>
              {primary?.date
                ? formatDate(primary.date, lang)
                : primary?.certainty === 'rolling'
                  ? tx('discover.reqRolling', 'Rolling')
                  : tx('discover.reqDeadlineUnknown', 'Not dated')}
            </strong>
            <span className="meta">
              {primary?.label || '—'}
              {days != null
                ? ` · ${days < 0
                  ? format(tx('discover.reqDaysPast', '{count}d past'), { count: Math.abs(days) })
                  : format(tx('discover.reqDaysLeft', '{count}d left'), { count: days })}`
                : ''}
              {primary?.certainty ? ` · ${primary.certainty}` : ''}
            </span>
          </div>
        </div>
        <div className="discover-req-verify">
          <ShieldAlert size={14} />
          <span>{tx('discover.reqVerify', 'Snapshots only — confirm every rule on the official program page.')}</span>
        </div>
      </div>

      {requirements.deadlines.length > 1 ? (
        <section className="discover-req-section">
          <header>
            <CalendarClock size={14} />
            <h4>{tx('discover.reqAllDeadlines', 'All deadlines')}</h4>
          </header>
          <ul className="discover-req-timeline">
            {requirements.deadlines.map((item, index) => {
              const d = daysUntilIso(item.date)
              return (
                <li key={item.id} style={{ animationDelay: `${index * 40}ms` }} className="discover-req-timeline-item">
                  <span className={clsx('dot', `is-${deadlineUrgencyClass(d)}`)} />
                  <div>
                    <strong>{item.label}</strong>
                    <p>
                      {item.date ? formatDate(item.date, lang) : tx('discover.reqRolling', 'Rolling')}
                      {item.kind ? ` · ${item.kind}` : ''}
                      {item.certainty ? ` · ${item.certainty}` : ''}
                    </p>
                    {item.notes ? <p className="note">{item.notes}</p> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      <div className="discover-req-grid">
        <section className="discover-req-section">
          <header>
            <GraduationCap size={14} />
            <h4>{tx('discover.reqTests', 'Tests')}</h4>
          </header>
          <div className="discover-req-list">
            {requirements.tests.map((test) => (
              <div key={test.id} className={clsx('discover-req-row', `tone-${testStatusTone(test.status)}`)}>
                <span className="name">{test.name}</span>
                <span className="badge">{statusLabel(test.status, tx)}</span>
                {test.notes ? <span className="hint">{test.notes}</span> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="discover-req-section">
          <header>
            <ClipboardList size={14} />
            <h4>{tx('discover.reqMaterials', 'Materials')}</h4>
          </header>
          <div className="discover-req-list">
            {requirements.materials.map((material) => (
              <div key={material.id} className={clsx('discover-req-row', material.required ? 'tone-warn' : 'tone-ok')}>
                {material.required ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}
                <span className="name">
                  {material.name}
                  {material.count ? ` ×${material.count}` : ''}
                </span>
                <span className="badge">
                  {material.required
                    ? tx('discover.reqStatusRequired', 'Required')
                    : tx('discover.reqStatusOptional', 'Optional')}
                </span>
                {material.notes ? <span className="hint">{material.notes}</span> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="discover-req-section">
          <header>
            <Wallet size={14} />
            <h4>{tx('discover.reqFees', 'Application fee')}</h4>
          </header>
          <div className="discover-req-fee">
            <strong>
              {requirements.fees.amountUSD == null
                ? tx('discover.reqFeeUnknown', 'Fee unknown')
                : requirements.fees.amountUSD === 0
                  ? tx('discover.reqFeeNone', 'No typical portal fee')
                  : `~$${requirements.fees.amountUSD}`}
            </strong>
            <span className={clsx('badge', requirements.fees.waiverAvailable ? 'ok' : 'muted')}>
              {requirements.fees.waiverAvailable
                ? tx('discover.reqWaiverYes', 'Waiver possible')
                : tx('discover.reqWaiverNo', 'Waiver unclear')}
            </span>
            {requirements.fees.notes ? <p>{requirements.fees.notes}</p> : null}
          </div>
        </section>

        <section className="discover-req-section">
          <header>
            <Flag size={14} />
            <h4>{tx('discover.reqRestrictions', 'Restrictions')}</h4>
          </header>
          <div className="discover-req-list">
            <div className="discover-req-row tone-soft">
              <span className="name">{tx('discover.multiApply', 'Multi-apply')}</span>
              <span className="badge">
                {requirements.restrictions.multiApply === 'multi'
                  ? tx('discover.hedgeMulti', 'Multi OK')
                  : requirements.restrictions.multiApply === 'single'
                    ? tx('discover.hedgeSingle', 'Single only')
                    : tx('discover.hedgeAll', 'Any')}
              </span>
            </div>
            <div className="discover-req-row tone-soft">
              <span className="name">{contactLabel(requirements.restrictions.supervisorContact, tx)}</span>
            </div>
            <div className="discover-req-row">
              <span className="name">{tx('discover.reqPriorDegree', 'Prior degree')}</span>
              <span className="hint">{requirements.restrictions.priorDegree}</span>
            </div>
            <div className="discover-req-row">
              <span className="name">{tx('discover.reqIntl', 'International applicants')}</span>
              <span className="badge">
                {requirements.restrictions.intlEligible
                  ? tx('discover.reqIntlYes', 'Eligible')
                  : tx('discover.reqIntlNo', 'Restricted')}
              </span>
            </div>
            {requirements.restrictions.summary ? (
              <p className="discover-req-summary">{requirements.restrictions.summary}</p>
            ) : null}
            {requirements.restrictions.other?.length ? (
              <ul className="discover-req-bullets">
                {requirements.restrictions.other.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      </div>

      <section className="discover-req-section">
        <header>
          <Route size={14} />
          <h4>{tx('discover.reqRoute', 'Application route')}</h4>
        </header>
        <p className="discover-req-route-label">{requirements.route.label}</p>
        <ol className="discover-req-steps">
          {requirements.route.steps.map((step, index) => (
            <li key={`${step}-${index}`} style={{ animationDelay: `${index * 45}ms` }}>
              <span className="step-index">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {requirements.route.notes ? <p className="note">{requirements.route.notes}</p> : null}
      </section>

      {requirements.degreeMilestones?.length ? (
        <section className="discover-req-section">
          <header>
            <FileText size={14} />
            <h4>{tx('discover.reqMilestones', 'Degree structure')}</h4>
          </header>
          <div className="discover-req-milestones">
            {requirements.degreeMilestones.map((item, index) => (
              <span key={`${item}-${index}`} className="discover-req-milestone">
                {item}
              </span>
            ))}
          </div>
        </section>
      ) : freeTextFallback?.degreeStructure ? (
        <section className="discover-req-section">
          <header>
            <FileText size={14} />
            <h4>{tx('discover.reqMilestones', 'Degree structure')}</h4>
          </header>
          <p className="discover-req-summary">{freeTextFallback.degreeStructure}</p>
        </section>
      ) : null}
    </div>
  )
}
