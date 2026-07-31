import {
  ClipboardCheck,
  ClipboardList,
  Compass,
  DatabaseBackup,
  FileClock,
  LayoutList,
  Mail,
  Settings,
  UserRound,
  Users,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useI18n, useI18nValue } from '../hooks/useI18n'
import { useMarketingReveal } from '../hooks/useMarketingMotion'
import { useTheme } from '../hooks/useTheme'
import { MarketingProductScreenshot, type MarketingScreenshotSurface } from './MarketingProductScreenshot'

export function MarketingFeatureTour() {
  const tourRef = useRef<HTMLDivElement | null>(null)
  const parentI18n = useI18n()
  const { tx, lang } = useI18nValue(parentI18n.lang, [
    'core',
    'shared',
    'dashboard',
    'workspace',
    'dossier',
    'discover',
    'profile',
    'settings',
    'team',
  ])
  const { theme } = useTheme()
  const [activeScene, setActiveScene] = useState<MarketingScreenshotSurface>('workspace')
  const workflows = [
    {
      title: tx('nav.dashboard'),
      body: tx('authMarketingDashboardBody'),
      Icon: ClipboardList,
      features: [
        tx('dashboard.applicationSnapshot'),
        tx('dashboard.priorityItems'),
        tx('dashboard.taskChecklist'),
        tx('dashboard.upcomingDeadlines'),
        tx('dashboard.statusDistribution'),
      ],
    },
    {
      title: tx('nav.applications'),
      body: tx('authMarketingTrackBody'),
      Icon: LayoutList,
      features: [
        tx('dossier.tabs.dossier'),
        tx('dossier.tabs.materials'),
        tx('dossier.tabs.mail'),
        tx('dossier.tabs.funding'),
        tx('dossier.tabs.timeline'),
      ],
    },
    {
      title: tx('discover.title'),
      body: tx('discover.subtitle'),
      Icon: Compass,
      features: [
        tx('discover.tabPrograms'),
        tx('discover.tabPis'),
        tx('discover.compareMode'),
        tx('discover.evidenceOfficial'),
        tx('discover.import'),
      ],
    },
    {
      title: tx('profile.title'),
      body: tx('profile.subtitle'),
      Icon: UserRound,
      features: [
        tx('profile.libraryTitle'),
        tx('profile.cardView'),
        tx('profile.listView'),
        tx('profile.addSnippet'),
        tx('profile.aiProfileEyebrow'),
      ],
    },
    {
      title: tx('nav.team'),
      body: tx('authMarketingTeamBody'),
      Icon: Users,
      features: [
        tx('team.tabOverview'),
        tx('team.tabTeacherApps'),
        tx('team.tabTeacherStudents'),
        tx('team.tabResources'),
        tx('team.tabAudit'),
      ],
    },
    {
      title: tx('authMarketingContinuityTitle'),
      body: tx('authMarketingContinuityBody'),
      Icon: Settings,
      features: [
        tx('dossier.aiOpen'),
        tx('settings.emailConfiguration'),
        tx('notifications.title'),
        tx('settings.sharedLinks'),
        tx('settings.security'),
      ],
    },
  ]
  const scenes: Array<{
    key: MarketingScreenshotSurface
    label: string
    Icon: typeof ClipboardCheck
  }> = [
    { key: 'workspace', label: tx('dossier.tabs.materials'), Icon: ClipboardCheck },
    { key: 'correspondence', label: tx('dossier.tabs.mail'), Icon: Mail },
    { key: 'funding', label: tx('dossier.tabs.funding'), Icon: DatabaseBackup },
    { key: 'timeline', label: tx('dossier.tabs.timeline'), Icon: FileClock },
    { key: 'discover', label: tx('discover.title'), Icon: Compass },
    { key: 'profile', label: tx('profile.title'), Icon: UserRound },
  ]
  const selectedScene = scenes.find((scene) => scene.key === activeScene) ?? scenes[0]

  useMarketingReveal(tourRef)

  return (
    <div className="auth-feature-tour" ref={tourRef}>
      <section className="auth-story auth-product-tour" id="auth-story" aria-labelledby="auth-story-title">
        <div className="auth-story-heading" data-marketing-reveal>
          <span className="auth-section-index" aria-hidden="true">01</span>
          <div>
            <h2 id="auth-story-title">{tx('authMarketingStoryTitle')}</h2>
            <p>{tx('authMarketingStoryBody')}</p>
          </div>
        </div>

        <div className="auth-workflow-directory" data-marketing-reveal>
          {workflows.map(({ title, body, Icon, features }, index) => (
            <article key={title}>
              <header>
                <span>0{index + 1}</span>
                <Icon size={17} aria-hidden="true" />
                <h3>{title}</h3>
              </header>
              <p>{body}</p>
              <ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="auth-dossier-depth" aria-labelledby="auth-dossier-depth-title">
        <div className="auth-dossier-depth-head" data-marketing-reveal>
          <span className="auth-section-index" aria-hidden="true">02</span>
          <div>
            <h2 id="auth-dossier-depth-title">{tx('authMarketingDossierTitle')}</h2>
            <p>{tx('authMarketingDossierBody')}</p>
          </div>
        </div>
        <div className="auth-product-scenes" data-marketing-reveal>
          <div className="auth-scene-selector" role="group" aria-label={tx('authMarketingDossierTitle')}>
            {scenes.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                className={activeScene === key ? 'is-active' : ''}
                aria-pressed={activeScene === key}
                aria-controls="auth-product-scene-stage"
                onClick={() => setActiveScene(key)}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="auth-scene-stage" id="auth-product-scene-stage" aria-live="polite">
            <MarketingProductScreenshot
              surface={activeScene}
              language={lang}
              theme={theme}
              alt={`${selectedScene.label} · ${tx('appDesc')}`}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
