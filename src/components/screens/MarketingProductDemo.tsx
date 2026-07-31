import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Compass,
  ExternalLink,
  FileCheck2,
  FileText,
  Filter,
  GraduationCap,
  LayoutGrid,
  LayoutList,
  ListChecks,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApplicationRecord } from '../../data/applications'
import { countryDisplayName } from '../../data/countries'
import { localeForLanguage, localizeStaticText } from '../../i18n'
import { useI18n, useI18nValue } from '../hooks/useI18n'
import { SchoolLogoMark } from '../shared/SchoolLogo'
import cambridgeLogoUrl from '../../../server/school-logo-catalog/assets/university-of-cambridge-e92e8268f8.png'
import ethLogoUrl from '../../../server/school-logo-catalog/assets/eth-zurich-bdcc94a0fb.png'
import mitLogoUrl from '../../../server/school-logo-catalog/assets/massachusetts-institute-of-technology-18dd08a7f9.png'
import stanfordLogoUrl from '../../../server/school-logo-catalog/assets/stanford-university-27faf32e46.png'

export type MarketingProductSurface = 'discover' | 'profile'
type MarketingI18n = Pick<ReturnType<typeof useI18nValue>, 'tx' | 'format' | 'lang'>
type MarketingSchoolLogo = NonNullable<ApplicationRecord['school']['logo']>
type DiscoverPreviewMode = 'programs' | 'advisors' | 'compare'
type DiscoverPreviewRegion = 'all' | 'EU' | 'UK' | 'US'
type ProfilePreviewView = 'cards' | 'list'

const MARKETING_LOGO_UPDATED_AT = '2026-07-29T00:00:00.000Z'

function marketingLogo(dataUrl: string): MarketingSchoolLogo {
  return {
    dataUrl,
    source: 'website',
    updatedAt: MARKETING_LOGO_UPDATED_AT,
  }
}

const previewPrograms = [
  {
    id: 'eth-formal-methods',
    school: 'ETH Zurich',
    program: 'Computer Science PhD',
    city: 'Zürich',
    country: 'Switzerland',
    region: 'EU' as const,
    match: 94,
    stipend: 'CHF 52k',
    deadline: '2026-11-30',
    advisors: 8,
    focus: 'Formal verification, trustworthy systems, privacy',
    rationale: 'Strong methods fit with multiple officially listed research groups and a funded doctoral employment route.',
    logo: marketingLogo(ethLogoUrl),
  },
  {
    id: 'cambridge-advanced-cs',
    school: 'University of Cambridge',
    program: 'Advanced Computer Science PhD',
    city: 'Cambridge',
    country: 'United Kingdom',
    region: 'UK' as const,
    match: 91,
    stipend: '£24k',
    deadline: '2026-12-03',
    advisors: 6,
    focus: 'Programming languages, systems, scientific machine learning',
    rationale: 'The programme and advisor pages show several close topic matches, with funding routes to verify before applying.',
    logo: marketingLogo(cambridgeLogoUrl),
  },
  {
    id: 'stanford-cs',
    school: 'Stanford University',
    program: 'Computer Science PhD',
    city: 'Stanford',
    country: 'United States',
    region: 'US' as const,
    match: 88,
    stipend: '$54k',
    deadline: '2026-12-05',
    advisors: 5,
    focus: 'Human-centered AI, reliable learning systems',
    rationale: 'Excellent research alignment, with a highly competitive programme and several relevant faculty profiles.',
    logo: marketingLogo(stanfordLogoUrl),
  },
  {
    id: 'mit-eecs',
    school: 'MIT',
    program: 'EECS PhD',
    city: 'Cambridge',
    country: 'United States',
    region: 'US' as const,
    match: 86,
    stipend: '$51k',
    deadline: '2026-12-15',
    advisors: 7,
    focus: 'Verification, robotics, safe autonomy',
    rationale: 'A broad department with several relevant groups; compare individual advisors before deciding where to focus.',
    logo: marketingLogo(mitLogoUrl),
  },
] as const

const previewAdvisors = [
  {
    id: 'advisor-wang',
    name: 'Prof. Olivia Wang',
    school: 'ETH Zurich',
    programme: 'Computer Science PhD',
    research: 'Trustworthy data systems · Formal verification',
    match: 96,
    hIndex: 31,
    recruiting: true,
  },
  {
    id: 'advisor-chen',
    name: 'Prof. Amelia Chen',
    school: 'University of Cambridge',
    programme: 'Advanced Computer Science PhD',
    research: 'Scientific machine learning · Evaluation',
    match: 92,
    hIndex: 27,
    recruiting: true,
  },
  {
    id: 'advisor-lee',
    name: 'Prof. Hannah Lee',
    school: 'Stanford University',
    programme: 'Computer Science PhD',
    research: 'Human-AI collaboration · Learning interfaces',
    match: 89,
    hIndex: 35,
    recruiting: false,
  },
] as const

const previewProfileAssets = [
  {
    id: 'statement',
    name: 'Statement of Purpose',
    kind: 'Personal statement',
    description: 'A focused narrative connecting research experience, current questions, and doctoral goals.',
    versions: ['v4 · Systems', 'v3 · General', 'v2 · Short'],
    attachments: 2,
    Icon: FileText,
  },
  {
    id: 'cv',
    name: 'Academic CV',
    kind: 'Curriculum vitae',
    description: 'Research, education, publications, projects, teaching, and selected technical work.',
    versions: ['v7 · Academic', 'v6 · Research'],
    attachments: 1,
    Icon: FileCheck2,
  },
  {
    id: 'proposal',
    name: 'Research Proposal',
    kind: 'Research plan',
    description: 'Problem framing, related work, methods, evaluation plan, and expected contribution.',
    versions: ['v3 · Formal methods', 'v2 · Data systems', 'v1 · Outline'],
    attachments: 3,
    Icon: Sparkles,
  },
] as const

function MarketingDemoRail({
  active,
  i18n,
}: {
  active: MarketingProductSurface
  i18n: MarketingI18n
}) {
  const { tx } = i18n
  const items = [
    { key: 'dashboard', label: tx('nav.dashboard'), Icon: ClipboardList },
    { key: 'applications', label: tx('nav.applications'), Icon: ListChecks },
    { key: 'discover', label: tx('nav.discover'), Icon: Compass },
    { key: 'profile', label: tx('nav.profile'), Icon: UserRound },
    { key: 'settings', label: tx('nav.settings'), Icon: Settings },
  ] as const

  return (
    <nav className="mpd-rail" aria-label={tx('primaryNavigation')}>
      <span className="mpd-rail-brand" aria-hidden="true"><GraduationCap size={14} /></span>
      {items.map(({ key, label, Icon }) => (
        <span className={key === active ? 'is-active' : ''} title={label} key={key}>
          <Icon size={13} aria-hidden="true" />
          <small>{label}</small>
        </span>
      ))}
    </nav>
  )
}

function DiscoverProgramMark({
  school,
  logo,
}: {
  school: string
  logo: MarketingSchoolLogo
}) {
  return <SchoolLogoMark schoolName={school} logo={logo} variant="list" />
}

function MarketingDiscoverSurface({ i18n }: { i18n: MarketingI18n }) {
  const { tx, format, lang } = i18n
  const locale = localeForLanguage(lang)
  const [mode, setMode] = useState<DiscoverPreviewMode>('programs')
  const [region, setRegion] = useState<DiscoverPreviewRegion>('all')
  const [query, setQuery] = useState('')
  const [selectedProgramId, setSelectedProgramId] = useState<string>(previewPrograms[0].id)
  const [selectedAdvisorId, setSelectedAdvisorId] = useState<string>(previewAdvisors[0].id)
  const [compareIds, setCompareIds] = useState<string[]>([
    previewPrograms[0].id,
    previewPrograms[1].id,
  ])
  const [researching, setResearching] = useState(false)
  const researchTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (researchTimerRef.current !== null) {
      window.clearTimeout(researchTimerRef.current)
    }
  }, [])

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' }),
    [locale],
  )
  const normalizedQuery = query.trim().toLocaleLowerCase(locale)
  const visiblePrograms = useMemo(
    () => previewPrograms.filter((program) => (
      (region === 'all' || program.region === region)
      && (
        !normalizedQuery
        || [program.school, program.program, program.city, program.focus]
          .some((value) => value.toLocaleLowerCase(locale).includes(normalizedQuery))
      )
    )),
    [locale, normalizedQuery, region],
  )
  const visibleAdvisors = useMemo(
    () => previewAdvisors.filter((advisor) => (
      !normalizedQuery
      || [advisor.name, advisor.school, advisor.programme, advisor.research]
        .some((value) => value.toLocaleLowerCase(locale).includes(normalizedQuery))
    )),
    [locale, normalizedQuery],
  )
  const selectedProgram = visiblePrograms.find((program) => program.id === selectedProgramId)
    ?? visiblePrograms[0]
    ?? previewPrograms[0]
  const selectedAdvisor = visibleAdvisors.find((advisor) => advisor.id === selectedAdvisorId)
    ?? visibleAdvisors[0]
    ?? previewAdvisors[0]
  const comparedPrograms = previewPrograms.filter((program) => compareIds.includes(program.id))
  const noVisibleResults = mode === 'programs'
    ? visiblePrograms.length === 0
    : mode === 'advisors' && visibleAdvisors.length === 0

  const toggleCompare = (id: string) => {
    setCompareIds((current) => (
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current.slice(-2), id]
    ))
  }

  const runResearch = () => {
    setResearching(true)
    if (researchTimerRef.current !== null) {
      window.clearTimeout(researchTimerRef.current)
    }
    researchTimerRef.current = window.setTimeout(() => {
      setResearching(false)
      researchTimerRef.current = null
    }, 760)
  }

  return (
    <div className="mpd-discover">
      <header className="mpd-discover-toolbar">
        <div className="mpd-discover-title">
          <span>
            <em>{tx('discover.eyebrow')}</em>
            <strong>{tx('discover.title')}</strong>
          </span>
          <p>{tx('discover.subtitle')}</p>
        </div>
        <nav className="mpd-discover-tabs" aria-label={tx('discover.title')}>
          {([
            ['programs', tx('discover.tabPrograms')],
            ['advisors', tx('discover.tabPis')],
            ['compare', tx('discover.compareMode', 'Compare')],
          ] as const).map(([value, label]) => (
            <button
              type="button"
              className={mode === value ? 'is-active' : ''}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              key={value}
            >
              {label}
              {value === 'compare' && compareIds.length > 0 ? <span>{compareIds.length}</span> : null}
            </button>
          ))}
        </nav>
        <label className="mpd-discover-search">
          <Search size={12} aria-hidden="true" />
          <span className="sr-only">{tx('discover.searchAll', 'Search schools, programs, advisors or topics')}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tx('discover.searchAll', 'Search schools, programs, advisors or topics')}
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label={tx('discover.clearSelection')}>
              <X size={10} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <button type="button" className="mpd-discover-refresh" onClick={runResearch} disabled={researching}>
          <RefreshCw size={11} className={researching ? 'spin-icon' : undefined} aria-hidden="true" />
          <span>{researching ? tx('discover.runningResearch') : tx('discover.updateResearch', 'Update research')}</span>
        </button>
      </header>

      <div className={`mpd-discover-workspace is-${mode}${noVisibleResults ? ' is-empty' : ''}`}>
        {mode !== 'compare' ? (
          <aside className="mpd-discover-filters">
            <header><Filter size={11} aria-hidden="true" /><strong>{tx('discover.filtersTitle', 'Filters')}</strong></header>
            <section>
              <span>{tx('discover.region')}</span>
              {([
                ['all', tx('discover.allRegions')],
                ['EU', countryDisplayName('Switzerland', lang)],
                ['UK', countryDisplayName('United Kingdom', lang)],
                ['US', countryDisplayName('United States', lang)],
              ] as const).map(([value, label]) => (
                <button
                  type="button"
                  className={region === value ? 'is-active' : ''}
                  aria-pressed={region === value}
                  onClick={() => setRegion(value)}
                  key={value}
                >
                  <span aria-hidden="true">{region === value ? <Check size={8} /> : null}</span>
                  {label}
                </button>
              ))}
            </section>
            <section>
              <span>{tx('discover.field')}</span>
              <p>{localizeStaticText('Computer Science', lang)}</p>
            </section>
            <section>
              <span>{tx('discover.minFit')}</span>
              <div className="mpd-fit-range" aria-hidden="true"><i /><b>80%</b></div>
            </section>
            <button type="button" className="mpd-filter-clear" onClick={() => {
              setRegion('all')
              setQuery('')
            }}>
              {tx('discover.clearFilters', 'Clear filters')}
            </button>
          </aside>
        ) : null}

        <main className="mpd-discover-results">
          {mode === 'programs' ? (
            <>
              <header>
                <span><strong>{tx('discover.programsList', 'Programs')}</strong><small>{visiblePrograms.length}</small></span>
                <SlidersHorizontal size={11} aria-hidden="true" />
              </header>
              <div className="mpd-program-table-head" aria-hidden="true">
                <span>{tx('discover.program', 'Program')}</span>
                <span>{tx('discover.match', 'Match')}</span>
                <span>{tx('discover.deadline')}</span>
                <span />
              </div>
              <div className="mpd-program-list">
                {visiblePrograms.length > 0 ? visiblePrograms.map((program) => {
                  const compared = compareIds.includes(program.id)
                  return (
                    <article className={selectedProgram.id === program.id ? 'is-selected' : ''} key={program.id}>
                      <button type="button" className="mpd-program-main" onClick={() => setSelectedProgramId(program.id)}>
                        <DiscoverProgramMark school={program.school} logo={program.logo} />
                        <span>
                          <strong>{program.school}</strong>
                          <small>{localizeStaticText(program.program, lang)} · {program.city}</small>
                        </span>
                      </button>
                      <strong className="mpd-program-match">{program.match}%</strong>
                      <time>{dateFormatter.format(new Date(`${program.deadline}T12:00:00`))}</time>
                      <button
                        type="button"
                        className={compared ? 'mpd-compare-toggle is-active' : 'mpd-compare-toggle'}
                        aria-pressed={compared}
                        aria-label={tx(compared ? 'discover.removeFromCompare' : 'discover.addToCompare', 'Compare')}
                        onClick={() => toggleCompare(program.id)}
                      >
                        {compared ? <Check size={9} /> : <Plus size={9} />}
                      </button>
                    </article>
                  )
                }) : (
                  <div className="mpd-discover-empty">
                    <Search size={15} aria-hidden="true" />
                    <strong>{tx('discover.noFilterResults')}</strong>
                    <small>{tx('discover.adjustFilters')}</small>
                  </div>
                )}
              </div>
            </>
          ) : mode === 'advisors' ? (
            <>
              <header>
                <span><strong>{tx('discover.pisList', 'Advisors')}</strong><small>{visibleAdvisors.length}</small></span>
                <SlidersHorizontal size={11} aria-hidden="true" />
              </header>
              <div className="mpd-advisor-list">
                {visibleAdvisors.length > 0 ? visibleAdvisors.map((advisor) => (
                  <button
                    type="button"
                    className={selectedAdvisor.id === advisor.id ? 'is-selected' : ''}
                    onClick={() => setSelectedAdvisorId(advisor.id)}
                    key={advisor.id}
                  >
                    <span className="mpd-advisor-avatar" aria-hidden="true">{advisor.name.replace(/^Prof\.\s*/u, '').slice(0, 1)}</span>
                    <span>
                      <strong>{advisor.name}</strong>
                      <small>{advisor.school} · {advisor.research}</small>
                    </span>
                    <b>{advisor.match}%</b>
                    <ChevronRight size={10} aria-hidden="true" />
                  </button>
                )) : (
                  <div className="mpd-discover-empty">
                    <Search size={15} aria-hidden="true" />
                    <strong>{tx('discover.noPiResults')}</strong>
                    <small>{tx('discover.adjustFilters')}</small>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <header>
                <span>
                  <strong>{tx('discover.compareMode', 'Compare')}</strong>
                  <small>{comparedPrograms.length}</small>
                </span>
                <button type="button" onClick={() => setCompareIds([])}>{tx('discover.clearAllCompare', 'Clear all')}</button>
              </header>
              <div className="mpd-compare-grid">
                {comparedPrograms.length > 0 ? comparedPrograms.map((program) => (
                  <article key={program.id}>
                    <header>
                      <DiscoverProgramMark school={program.school} logo={program.logo} />
                      <span><strong>{program.school}</strong><small>{localizeStaticText(program.program, lang)}</small></span>
                      <button type="button" onClick={() => toggleCompare(program.id)} aria-label={tx('discover.removeFromCompare')}><X size={9} /></button>
                    </header>
                    <dl>
                      <div><dt>{tx('discover.match', 'Match')}</dt><dd>{program.match}%</dd></div>
                      <div><dt>{tx('discover.stipend')}</dt><dd>{program.stipend}</dd></div>
                      <div><dt>{tx('discover.deadline')}</dt><dd>{dateFormatter.format(new Date(`${program.deadline}T12:00:00`))}</dd></div>
                      <div><dt>{tx('discover.kpiPis')}</dt><dd>{program.advisors}</dd></div>
                    </dl>
                    <button type="button">{tx('discover.import', 'Import as application')}<ArrowRight size={9} /></button>
                  </article>
                )) : (
                  <div className="mpd-compare-empty">
                    <LayoutGrid size={17} aria-hidden="true" />
                    <strong>{tx('discover.compareEmptyTitle', 'Choose programs to compare')}</strong>
                    <button type="button" onClick={() => {
                      setCompareIds([previewPrograms[0].id, previewPrograms[1].id])
                      setMode('programs')
                    }}>{tx('discover.tabPrograms')}</button>
                  </div>
                )}
              </div>
            </>
          )}
        </main>

        {mode !== 'compare' && !noVisibleResults ? (
          <aside className="mpd-discover-inspector">
            {mode === 'programs' ? (
              <>
                <header>
                  <DiscoverProgramMark school={selectedProgram.school} logo={selectedProgram.logo} />
                  <span><strong>{selectedProgram.school}</strong><small>{localizeStaticText(selectedProgram.program, lang)}</small></span>
                  <b>{selectedProgram.match}%</b>
                </header>
                <p>{localizeStaticText(selectedProgram.rationale, lang)}</p>
                <dl>
                  <div><dt>{tx('discover.region')}</dt><dd>{countryDisplayName(selectedProgram.country, lang)}</dd></div>
                  <div><dt>{tx('discover.stipend')}</dt><dd>{selectedProgram.stipend}</dd></div>
                  <div><dt>{tx('discover.deadline')}</dt><dd>{dateFormatter.format(new Date(`${selectedProgram.deadline}T12:00:00`))}</dd></div>
                  <div><dt>{tx('discover.kpiPis')}</dt><dd>{selectedProgram.advisors}</dd></div>
                </dl>
                <section>
                  <strong>{tx('discover.fitRationale')}</strong>
                  <span>{localizeStaticText(selectedProgram.focus, lang)}</span>
                </section>
                <footer>
                  <button type="button"><Plus size={9} />{tx('discover.import', 'Import as application')}</button>
                  <button type="button" aria-label={tx('discover.sources')}><ExternalLink size={9} /></button>
                </footer>
              </>
            ) : (
              <>
                <header>
                  <span className="mpd-advisor-avatar" aria-hidden="true">{selectedAdvisor.name.replace(/^Prof\.\s*/u, '').slice(0, 1)}</span>
                  <span><strong>{selectedAdvisor.name}</strong><small>{selectedAdvisor.school}</small></span>
                  <b>{selectedAdvisor.match}%</b>
                </header>
                <p>{tx('discover.piSummary')}</p>
                <dl>
                  <div><dt>{tx('discover.program')}</dt><dd>{localizeStaticText(selectedAdvisor.programme, lang)}</dd></div>
                  <div><dt>{tx('discover.hIndex')}</dt><dd>{selectedAdvisor.hIndex}</dd></div>
                  <div><dt>{tx('discover.recruiting')}</dt><dd>{selectedAdvisor.recruiting ? tx('discover.recruitingLikely') : tx('discover.recruitingUnknown')}</dd></div>
                </dl>
                <section>
                  <strong>{tx('discover.field')}</strong>
                  <span>{localizeStaticText(selectedAdvisor.research, lang)}</span>
                </section>
                <footer>
                  <button type="button"><Plus size={9} />{tx('discover.importPi', 'Import with this advisor')}</button>
                  <button type="button" aria-label={tx('discover.homepage')}><ExternalLink size={9} /></button>
                </footer>
              </>
            )}
          </aside>
        ) : null}
      </div>

      <footer className="mpd-discover-status">
        <span>
          {format(tx('discover.statusCount', '{programs} programs · {advisors} advisors'), {
            programs: previewPrograms.length,
            advisors: previewAdvisors.length,
          })}
        </span>
        <span><Check size={9} aria-hidden="true" />{tx('discover.evidenceOfficial')}</span>
      </footer>
    </div>
  )
}

function MarketingProfileSurface({ i18n }: { i18n: MarketingI18n }) {
  const { tx, format, lang } = i18n
  const locale = localeForLanguage(lang)
  const [view, setView] = useState<ProfilePreviewView>('cards')
  const [query, setQuery] = useState('')
  const [selectedAssetId, setSelectedAssetId] = useState<string>(previewProfileAssets[0].id)
  const [selectedVersionByAsset, setSelectedVersionByAsset] = useState<Record<string, number>>({})
  const [presetOpen, setPresetOpen] = useState(false)

  const normalizedQuery = query.trim().toLocaleLowerCase(locale)
  const filteredAssets = useMemo(
    () => previewProfileAssets.filter((asset) => (
      !normalizedQuery
      || [asset.name, asset.kind, asset.description]
        .some((value) => value.toLocaleLowerCase(locale).includes(normalizedQuery))
    )),
    [locale, normalizedQuery],
  )
  const selectedAsset = filteredAssets.find((asset) => asset.id === selectedAssetId)
    ?? filteredAssets[0]
    ?? previewProfileAssets[0]
  const selectedVersion = selectedVersionByAsset[selectedAsset.id] ?? 0

  return (
    <div className="mpd-profile">
      <header className="mpd-profile-hero">
        <div>
          <span>{tx('profile.eyebrow')}</span>
          <h2>{tx('profile.title')}</h2>
          <p>{tx('profile.subtitle')}</p>
        </div>
        <aside>
          <Sparkles size={12} aria-hidden="true" />
          <span>
            <small>{tx('profile.aiProfileEyebrow')}</small>
            <strong>{tx('profile.aiProfileReadyHint')}</strong>
          </span>
          <Check size={10} aria-hidden="true" />
        </aside>
      </header>

      <div className="mpd-profile-toolbar">
        <label>
          <Search size={11} aria-hidden="true" />
          <span className="sr-only">{tx('profile.searchAssets')}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tx('profile.searchAssets')} />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label={tx('profile.clearSelection')}><X size={9} /></button>
          ) : null}
        </label>
        <button type="button" className="mpd-profile-add" aria-expanded={presetOpen} onClick={() => setPresetOpen((current) => !current)}>
          <Plus size={10} aria-hidden="true" />
          {tx('profile.addSnippet')}
          <ChevronDown size={9} aria-hidden="true" />
        </button>
      </div>

      <div className={`mpd-profile-preset-sheet${presetOpen ? ' is-open' : ''}`} aria-hidden={!presetOpen} inert={!presetOpen || undefined}>
        <header>
          <span><small>{tx('profile.presetsEyebrow')}</small><strong>{tx('profile.presetsTitle')}</strong></span>
          <button type="button" onClick={() => setPresetOpen(false)} aria-label={tx('close')}><X size={10} /></button>
        </header>
        <div>
          {previewProfileAssets.map(({ id, name, Icon }) => (
            <button type="button" key={id} onClick={() => {
              setSelectedAssetId(id)
              setQuery('')
              setPresetOpen(false)
            }}>
              <Icon size={12} aria-hidden="true" />
              <span><strong>{localizeStaticText(name, lang)}</strong><small>{tx('profile.usePreset')}</small></span>
              <Plus size={9} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <section className="mpd-profile-library">
        <header>
          <div>
            <span>{tx('profile.libraryEyebrow')}</span>
            <strong>{tx('profile.libraryTitle')}</strong>
            <small>{tx('profile.libraryGroupHint')}</small>
          </div>
          <nav aria-label={tx('profile.viewModeLabel')}>
            <button type="button" className={view === 'cards' ? 'is-active' : ''} aria-pressed={view === 'cards'} onClick={() => setView('cards')}>
              <LayoutGrid size={10} aria-hidden="true" />
              <span>{tx('profile.cardView')}</span>
            </button>
            <button type="button" className={view === 'list' ? 'is-active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>
              <LayoutList size={10} aria-hidden="true" />
              <span>{tx('profile.listView')}</span>
            </button>
          </nav>
          <b>{filteredAssets.length}</b>
        </header>

        {filteredAssets.length === 0 ? (
          <div className="mpd-profile-empty">
            <Search size={15} aria-hidden="true" />
            <strong>{tx('noResults')}</strong>
            <small>{tx('profile.searchAssets')}</small>
          </div>
        ) : view === 'cards' ? (
          <div className="mpd-profile-card-grid">
            {filteredAssets.map((asset) => {
              const active = selectedAsset.id === asset.id
              const Icon = asset.Icon
              return (
                <article className={active ? 'is-active' : ''} key={asset.id}>
                  <button type="button" onClick={() => setSelectedAssetId(asset.id)} aria-pressed={active}>
                    <span className="mpd-profile-card-icon"><Icon size={16} aria-hidden="true" /></span>
                    <span>
                      <small>{localizeStaticText(asset.kind, lang)}</small>
                      <strong>{localizeStaticText(asset.name, lang)}</strong>
                      <em><Paperclip size={8} aria-hidden="true" />{asset.attachments} · {format(tx('profile.groupItemCount'), { count: asset.versions.length })}</em>
                    </span>
                    <ChevronRight size={10} aria-hidden="true" />
                  </button>
                  <i aria-hidden="true" />
                  <i aria-hidden="true" />
                </article>
              )
            })}
          </div>
        ) : (
          <div className="mpd-profile-list">
            {filteredAssets.map((asset) => {
              const active = selectedAsset.id === asset.id
              const Icon = asset.Icon
              return (
                <button type="button" className={active ? 'is-active' : ''} aria-pressed={active} onClick={() => setSelectedAssetId(asset.id)} key={asset.id}>
                  <span className="mpd-profile-card-icon"><Icon size={13} aria-hidden="true" /></span>
                  <span><strong>{localizeStaticText(asset.name, lang)}</strong><small>{localizeStaticText(asset.description, lang)}</small></span>
                  <em>{format(tx('profile.groupItemCount'), { count: asset.versions.length })}</em>
                  <ChevronRight size={10} aria-hidden="true" />
                </button>
              )
            })}
          </div>
        )}

        {filteredAssets.length > 0 ? (
          <div className="mpd-profile-detail" key={selectedAsset.id}>
            <header>
              <span className="mpd-profile-card-icon"><selectedAsset.Icon size={13} aria-hidden="true" /></span>
              <span>
                <small>{localizeStaticText(selectedAsset.kind, lang)}</small>
                <strong>{localizeStaticText(selectedAsset.name, lang)}</strong>
              </span>
              <button type="button" aria-label={tx('profile.openSnippet')}>
                {tx('profile.openSnippet')}<ArrowRight size={9} />
              </button>
            </header>
            <p>{localizeStaticText(selectedAsset.description, lang)}</p>
            <div>
              {selectedAsset.versions.map((version, index) => (
                <button
                  type="button"
                  className={selectedVersion === index ? 'is-active' : ''}
                  aria-pressed={selectedVersion === index}
                  onClick={() => setSelectedVersionByAsset((current) => ({ ...current, [selectedAsset.id]: index }))}
                  key={version}
                >
                  <span aria-hidden="true">{selectedVersion === index ? <Check size={8} /> : null}</span>
                  {version}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

export function MarketingProductDemo({
  surface,
  className = '',
}: {
  surface: MarketingProductSurface
  className?: string
}) {
  const parentI18n = useI18n()
  const i18n = useI18nValue(parentI18n.lang, ['core', 'shared', 'discover', 'profile'])
  const { tx } = i18n

  return (
    <section
      className={`marketing-workspace-demo marketing-product-demo is-${surface}${className ? ` ${className}` : ''}`}
      aria-label={surface === 'discover' ? tx('discover.subtitle') : tx('profile.subtitle')}
    >
      <div className="mpd-shell">
        <MarketingDemoRail active={surface} i18n={i18n} />
        {surface === 'discover' ? (
          <MarketingDiscoverSurface i18n={i18n} />
        ) : (
          <MarketingProfileSurface i18n={i18n} />
        )}
      </div>
    </section>
  )
}
