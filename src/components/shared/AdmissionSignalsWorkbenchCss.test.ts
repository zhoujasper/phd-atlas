import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const panelSource = readFileSync(
  resolve(root, 'src/components/shared/AdmissionSignalsPanel.tsx'),
  'utf8',
)
const layoutCss = readFileSync(resolve(root, 'src/styles/admissions.css'), 'utf8')
const evidenceCss = readFileSync(resolve(root, 'src/styles/admissionsSignals.css'), 'utf8')

describe('admission evidence workbench UI contract', () => {
  it('uses continuous table/list hierarchy instead of generated card grids', () => {
    expect(panelSource).toContain('<table className="admissions-outcomes-table">')
    expect(panelSource).toContain('<table className="admissions-official-facts">')
    expect(panelSource).toContain('<figure className="admissions-cycle-chart"')
    expect(panelSource).toContain('outcomes?.unmatchedDiscussions')
    expect(layoutCss).toContain('border-collapse: collapse')
    expect(layoutCss).toContain('border-bottom: 1px solid var(--border)')
    expect(layoutCss).not.toMatch(/admissions-(?:stat|trend|source)-card/)
    expect(`${layoutCss}\n${evidenceCss}`).not.toContain('transition: all')
  })

  it('keeps query observations out of the decision-year visualization', () => {
    expect(panelSource).toContain('Applicant-reported sample, not an official acceptance rate.')
    expect(panelSource).not.toContain('getAdmissionSignalHistory')
    expect(panelSource).not.toContain('trendData')
  })

  it('has compact/mobile and reduced-motion paths', () => {
    expect(layoutCss).toContain('@container (max-width: 680px)')
    expect(layoutCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(layoutCss).toContain('.admissions-outcomes-table thead { display: none; }')
  })

  it('ships the evidence language in every locale', () => {
    const localeRoot = resolve(root, 'src/i18n')
    const locales = readdirSync(localeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    const requiredPaths = [
      'allResults',
      'evidence',
      'staleReport',
      'worksTitle',
      'noWorks',
      'citationCount',
      'trends.caveat',
      'trends.verifiedSample',
      'bookmarks.add',
      'bookmarks.remove',
      'bookmarks.failed',
    ]
    const read = (value: unknown, path: string) => path
      .split('.')
      .reduce<unknown>((current, key) => (
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[key]
          : undefined
      ), value)

    expect(locales).toHaveLength(12)
    for (const locale of locales) {
      const dictionary = JSON.parse(readFileSync(resolve(localeRoot, locale, 'dossier.json'), 'utf8'))
      for (const path of requiredPaths) {
        expect(read(dictionary.dossier.admissions, path), `${locale}:${path}`).toBeTruthy()
      }
    }
  })
})
