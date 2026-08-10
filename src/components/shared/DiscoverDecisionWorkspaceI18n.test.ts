import { describe, expect, it } from 'vitest'
import { WET_DRY_VALUES } from '../../data/discover'
import { SUPERVISOR_CONTACT_VALUES } from '../../data/discoverRequirements'
import de from '../../i18n/de/discover.json'
import en from '../../i18n/en/discover.json'
import es from '../../i18n/es/discover.json'
import fr from '../../i18n/fr/discover.json'
import itPack from '../../i18n/it/discover.json'
import ja from '../../i18n/ja/discover.json'
import ko from '../../i18n/ko/discover.json'
import pt from '../../i18n/pt/discover.json'
import ru from '../../i18n/ru/discover.json'
import th from '../../i18n/th/discover.json'
import vi from '../../i18n/vi/discover.json'
import zh from '../../i18n/zh/discover.json'
import decisionSource from './DiscoverDecisionWorkspace.tsx?raw'

const dictionaries = { en, zh, ja, ko, es, fr, de, pt, it: itPack, ru, vi, th }
const evidenceGaps = ['sources', 'funding', 'deadline', 'restrictions', 'advisors'] as const
const dynamicDiscoverKeys = [
  ...SUPERVISOR_CONTACT_VALUES.map((value) => `supervisor_${value}` as const),
  ...WET_DRY_VALUES.map((value) => `wetDry_${value}` as const),
]

describe('Discover decision workspace translations', () => {
  it('localizes every evidence gap and the compact day unit in all 12 packs', () => {
    for (const [language, dictionary] of Object.entries(dictionaries)) {
      for (const gap of evidenceGaps) {
        const value = dictionary.discover.evidenceGap[gap]
        expect(value, `${language}:discover.evidenceGap.${gap}`).toEqual(expect.any(String))
        expect(value.trim(), `${language}:discover.evidenceGap.${gap}`).not.toBe('')
      }
      expect(dictionary.discover.daysShort).toContain('{days}')
      if (language !== 'en') expect(dictionary.discover.daysShort).not.toBe(en.discover.daysShort)
    }
  })

  it('never renders internal English gap codes or hardcoded day-axis labels', () => {
    expect(decisionSource).toContain('localizedEvidenceGaps(selectedEvidence.missing)')
    expect(decisionSource).toContain('localizedEvidenceGaps(evidence.missing.slice(0, 2))')
    expect(decisionSource).not.toContain("selectedEvidence.missing.join(', ')")
    expect(decisionSource).not.toContain("evidence.missing.slice(0, 2).join(', ')")
    expect(decisionSource).not.toContain('<span>30d</span>')
    expect(decisionSource).toContain("new Intl.NumberFormat(locale")
  })

  it('localizes every model-owned supervisor and laboratory enum in all 12 packs', () => {
    for (const [language, dictionary] of Object.entries(dictionaries)) {
      for (const key of dynamicDiscoverKeys) {
        const value = dictionary.discover[key]
        expect(value, `${language}:discover.${key}`).toEqual(expect.any(String))
        expect(value.trim(), `${language}:discover.${key}`).not.toBe('')
        if (language !== 'en') {
          expect(value, `${language}:discover.${key} fell back to English`).not.toBe(en.discover[key])
        }
      }
    }
  })
})
