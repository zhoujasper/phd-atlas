import { describe, expect, it } from 'vitest'
import dossierSource from './DossierView.tsx?raw'
import dossierStyles from '../../index.css?raw'

describe('Dossier mail classification integration', () => {
  it('keeps manual-over-AI categorization consistent across badges and the compact filter', () => {
    // A message can hold several categories, so the badge row and the filter
    // both read the whole list. Manual selection still wins over the classifier.
    expect(dossierSource).toContain('const mailCategoryList = effectiveMailCategories(item)')
    expect(dossierSource).toContain('effectiveMailCategories(item).some((category) => selectedCategorySet.has(category))')
    expect(dossierSource).toContain('communicationCategoryFilterOptions')
    expect(dossierSource).toContain('selectedValues={communicationCategoryFilters}')
    expect(dossierSource).toContain("nextValues.includes('all')")
    expect(dossierSource).toContain("setCommunicationCategoryFilters(")
    expect(dossierSource).toContain('noMailCategoryResults')
  })

  it('supports durable manual and AI batch actions while blocking unsafe AI input', () => {
    expect(dossierSource).toContain("id: 'mail-category'")
    expect(dossierSource).toContain('void onSetCommunicationCategory(ids, next)')
    expect(dossierSource).toContain('void onSetCommunicationCategory(ids, [])')
    expect(dossierSource).toContain("id: 'mail-classify-ai'")
    expect(dossierSource).toContain('classificationThreatBlocked')
    expect(dossierSource).toContain('targets.some((candidate) => Boolean(candidate.mailSecurity))')
    expect(dossierSource).toContain('communicationSelection.selectedIdList')
  })

  it('limits AI classification controls to received email', () => {
    expect(dossierSource).toContain('function isIncomingEmailForClassification')
    expect(dossierSource).toContain('isIncomingEmailForClassification(item)')
    expect(dossierSource).toContain('targets.every(isIncomingEmailForClassification)')
    expect(dossierSource).toContain('aiClassificationTargetsAreEligible')
  })

  it('adds an email to Interview Prep from the existing correspondence menu', () => {
    expect(dossierSource).toContain("id: 'mail-add-interview'")
    expect(dossierSource).toContain("tx('dossier.mailAddToInterviewPrep')")
    expect(dossierSource).toContain('onAddToInterviewPrep')
    expect(dossierSource).toContain('communicationId: single.id')
  })

  it('toggles categories in place and offers management where they are listed', () => {
    // Each entry toggles and the menu stays open: closing on the first tick
    // would force it to be reopened for every category.
    expect(dossierSource).toContain('keepOpen: true')
    expect(dossierSource).toContain(
      'targets.every((candidate) => effectiveMailCategories(candidate).includes(option.id))',
    )
    // Create/rename/delete live in the filter's own dropdown.
    expect(dossierSource).toContain('mailCategoryCreateConfig')
    expect(dossierSource).toContain('onCustomMailCategoriesChange')
    // Renaming must not re-derive the id, or every filed message is orphaned.
    expect(dossierSource).toContain('entry.id === id ? { ...entry, label } : entry')
    expect(dossierSource).toContain("mailCategorySectionCustom")
    expect(dossierSource).toContain("mailClassificationAiAll")
  })

  it('keeps category feedback compact, responsive, and tied to existing status tokens', () => {
    expect(dossierStyles).toMatch(/\.correspondence-category-filter\s*\{[^}]*display:\s*inline-flex/s)
    expect(dossierStyles).toMatch(/\.correspondence-view-row\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/s)
    expect(dossierStyles).toMatch(/\.correspondence-view-row::before\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/s)
    expect(dossierStyles).toMatch(/\.correspondence-view-row button\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/s)
    expect(dossierStyles).toMatch(/\.correspondence-mail-category\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/s)
    expect(dossierStyles).toContain('.correspondence-mail-category.is-pending')
    expect(dossierStyles).toContain('.correspondence-mail-category.tone-success')
    expect(dossierStyles).toMatch(
      /\.correspondence-category-filter \.custom-select-root\s*\{[^}]*flex:\s*1/s,
    )
  })
})
