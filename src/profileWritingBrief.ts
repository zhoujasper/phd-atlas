import type { ProfileWritingBrief } from './api/phdApi'

const authoredProfileKinds = new Set([
  'CV',
  'Personal Statement',
  'SOP',
  'Research Proposal',
  'Research Statement',
  'Teaching Statement',
  'Cover Letter',
  'Writing Sample',
  'Publications',
  'Portfolio',
  'Scholarship Essay',
])

export function supportsProfileWritingBrief(kind: string) {
  return authoredProfileKinds.has(kind)
}

/**
 * Counts Latin-style words and CJK characters without requiring a locale pack.
 * The result is deliberately deterministic so editor feedback and tests agree.
 */
export function countProfileDocumentWords(value: string) {
  const normalized = String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[`*_>#[\](){}|~]/g, ' ')
  const cjk = normalized.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/gu)?.length ?? 0
  const latin =
    normalized
      .replace(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/gu, ' ')
      .match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0
  return cjk + latin
}

export function writingBriefHasContent(brief?: ProfileWritingBrief | null) {
  if (!brief) return false
  return Boolean(
    brief.requirements?.trim() ||
    brief.sourceUrl?.trim() ||
    brief.wordLimit ||
    brief.pageLimit ||
    brief.customFields?.some((field) => field.label.trim() || field.value.trim()) ||
    brief.sections?.some((section) => section.title.trim() || section.content.trim()),
  )
}

export function createProfileBriefFieldId() {
  return `brief-field-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createProfileWritingSectionId() {
  return `writing-section-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
