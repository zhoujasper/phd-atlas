import { describe, expect, it } from 'vitest'
import { pdfCopyForLanguage, resolvePdfLanguage, toPdfBuffer } from './pdfExport.js'

const application = {
  id: 'application-1',
  school: { name: '测试大学', country: 'China' },
  program: 'Computer Science PhD',
  status: 'Preparing',
  progress: 25,
  materials: [],
  communications: [],
  scholarships: [],
  tasks: [],
  timeline: [],
  shares: [],
}

describe('PDF export localization', () => {
  it('normalizes the active interface locale and falls back safely', () => {
    expect(resolvePdfLanguage('zh-CN')).toBe('zh')
    expect(resolvePdfLanguage('pt-BR')).toBe('pt')
    expect(resolvePdfLanguage('unsupported')).toBe('en')
  })

  it('provides localized report copy', () => {
    expect(pdfCopyForLanguage('zh').portfolioTitle).toBe('申请项目总览')
    expect(pdfCopyForLanguage('fr').portfolioTitle).toBe('Portefeuille de candidatures')
    expect(pdfCopyForLanguage('ja').currentTitle).toBe('出願書類')
    expect(pdfCopyForLanguage('de').pageNumber).toBe('Seite {page}')
  })

  it('creates a valid localized PDF buffer', async () => {
    const pdf = await toPdfBuffer([application], { scope: 'application', language: 'zh-CN' })

    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    expect(pdf.length).toBeGreaterThan(3_000)
  })
})
