import { Download, FileText, FileType2, LoaderCircle, Presentation, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'
import { StandalonePreferences } from './StandalonePreferences'

export type AttachmentPreviewFile = {
  fileId: string
  fileName: string
  mimeType?: string
}

type PreviewKind = 'pdf' | 'image' | 'text' | 'docx' | 'sheet' | 'slides' | 'unsupported'

type SheetCell = {
  value: string
  colSpan?: number
  rowSpan?: number
  style?: CSSProperties
}

type SheetPreview = {
  name: string
  rows: Array<Array<SheetCell | null>>
  columnWidths: number[]
  rowHeights: number[]
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; kind: PreviewKind; objectUrl?: string; text?: string; arrayBuffer?: ArrayBuffer; sheets?: SheetPreview[] }
  | { status: 'error' }

function extensionOf(name: string) {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim())
  return match?.[1]?.toLowerCase() ?? ''
}

function previewKindFor(file: AttachmentPreviewFile): PreviewKind {
  const extension = extensionOf(file.fileName)
  const mimeType = String(file.mimeType ?? '').toLowerCase()
  if (extension === 'pdf' || mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) return 'image'
  if (['txt', 'md', 'markdown', 'csv', 'json', 'xml', 'yaml', 'yml', 'log', 'rtf'].includes(extension) || mimeType.startsWith('text/')) return 'text'
  if (extension === 'docx' || mimeType.includes('wordprocessingml')) return 'docx'
  if (['xls', 'xlsx', 'ods'].includes(extension) || mimeType.includes('spreadsheetml') || mimeType.includes('ms-excel')) return 'sheet'
  if (extension === 'pptx' || mimeType.includes('presentationml')) return 'slides'
  return 'unsupported'
}

function excelColor(color: unknown) {
  const candidate = color as { rgb?: string } | undefined
  const rgb = candidate?.rgb?.replace(/^FF(?=[0-9A-F]{6}$)/i, '')
  return rgb && /^[0-9A-F]{6}$/i.test(rgb) ? `#${rgb}` : undefined
}

function excelCellStyle(style: unknown): CSSProperties | undefined {
  if (!style || typeof style !== 'object') return undefined
  const source = style as {
    fill?: { fgColor?: unknown }
    font?: { bold?: boolean; italic?: boolean; sz?: number; name?: string; color?: unknown }
    alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean }
  }
  const horizontal = source.alignment?.horizontal
  const vertical = source.alignment?.vertical
  return {
    backgroundColor: excelColor(source.fill?.fgColor),
    color: excelColor(source.font?.color),
    fontWeight: source.font?.bold ? 700 : undefined,
    fontStyle: source.font?.italic ? 'italic' : undefined,
    fontSize: source.font?.sz ? `${source.font.sz}pt` : undefined,
    fontFamily: source.font?.name,
    textAlign: horizontal === 'center' || horizontal === 'right' || horizontal === 'left' ? horizontal : undefined,
    verticalAlign: vertical === 'center' ? 'middle' : vertical === 'bottom' ? 'bottom' : undefined,
    whiteSpace: source.alignment?.wrapText ? 'normal' : undefined,
  }
}

async function buildPreview(file: AttachmentPreviewFile, blob: Blob): Promise<PreviewState> {
  const kind = previewKindFor(file)
  if (kind === 'unsupported') return { status: 'ready', kind }
  if (kind === 'pdf' || kind === 'image') {
    return { status: 'ready', kind, objectUrl: URL.createObjectURL(blob) }
  }
  if (kind === 'text') {
    return { status: 'ready', kind, text: await blob.text() }
  }

  const arrayBuffer = await blob.arrayBuffer()
  if (kind === 'docx') {
    return { status: 'ready', kind, arrayBuffer }
  }
  if (kind === 'sheet') {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellText: true, cellDates: true, cellStyles: true })
    const sheets = workbook.SheetNames.slice(0, 24).map((name) => {
      const sheet = workbook.Sheets[name]
      const range = XLSX.utils.decode_range(sheet?.['!ref'] ?? 'A1:A1')
      range.e.r = Math.min(range.e.r, range.s.r + 249)
      range.e.c = Math.min(range.e.c, range.s.c + 39)
      const merges = (sheet?.['!merges'] ?? []).filter((merge) => (
        merge.s.r <= range.e.r && merge.s.c <= range.e.c && merge.e.r >= range.s.r && merge.e.c >= range.s.c
      ))
      const covered = new Set<string>()
      const mergeByStart = new Map<string, { rowSpan: number; colSpan: number }>()
      merges.forEach((merge) => {
        const startKey = `${merge.s.r}:${merge.s.c}`
        mergeByStart.set(startKey, {
          rowSpan: merge.e.r - merge.s.r + 1,
          colSpan: merge.e.c - merge.s.c + 1,
        })
        for (let row = merge.s.r; row <= merge.e.r; row += 1) {
          for (let column = merge.s.c; column <= merge.e.c; column += 1) {
            if (row !== merge.s.r || column !== merge.s.c) covered.add(`${row}:${column}`)
          }
        }
      })
      const rows: Array<Array<SheetCell | null>> = []
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        const cells: Array<SheetCell | null> = []
        for (let column = range.s.c; column <= range.e.c; column += 1) {
          const key = `${row}:${column}`
          if (covered.has(key)) {
            cells.push(null)
            continue
          }
          const cell = sheet?.[XLSX.utils.encode_cell({ r: row, c: column })] as { w?: string; v?: unknown; s?: unknown } | undefined
          cells.push({
            value: String(cell?.w ?? cell?.v ?? ''),
            ...mergeByStart.get(key),
            style: excelCellStyle(cell?.s),
          })
        }
        rows.push(cells)
      }
      const columns = sheet?.['!cols'] ?? []
      const rowMeta = sheet?.['!rows'] ?? []
      return {
        name,
        rows,
        columnWidths: Array.from({ length: range.e.c - range.s.c + 1 }, (_, index) => {
          const column = columns[range.s.c + index] as { wpx?: number; wch?: number } | undefined
          return Math.min(260, Math.max(54, column?.wpx ?? ((column?.wch ?? 11) * 7.5)))
        }),
        rowHeights: Array.from({ length: range.e.r - range.s.r + 1 }, (_, index) => {
          const meta = rowMeta[range.s.r + index] as { hpx?: number; hpt?: number } | undefined
          return Math.min(160, Math.max(24, meta?.hpx ?? ((meta?.hpt ?? 18) * 1.333)))
        }),
      }
    })
    return { status: 'ready', kind, sheets }
  }
  return { status: 'ready', kind, arrayBuffer }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function AttachmentPreviewDialog({
  file,
  loadFile,
  onClose,
}: {
  file: AttachmentPreviewFile | null
  loadFile: (fileId: string) => Promise<Blob>
  onClose: () => void
}) {
  const { tx } = useI18n()
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' })
  const [activeSheet, setActiveSheet] = useState(0)
  const [officeRendererLoading, setOfficeRendererLoading] = useState(false)
  const [officeRendererError, setOfficeRendererError] = useState(false)
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const wordContainerRef = useRef<HTMLDivElement>(null)
  const slidesContainerRef = useRef<HTMLDivElement>(null)
  const open = Boolean(file)
  const { exiting, requestClose } = useAnimatedClose(open, onClose, 150, file?.fileId)
  const dialogRef = useModalA11y<HTMLDivElement>({
    open: open && !exiting,
    onClose: () => requestClose(),
    initialFocusRef: closeRef,
  })

  useEffect(() => {
    if (!file) return undefined
    let current = true
    let objectUrl: string | undefined
    setPreview({ status: 'loading' })
    setActiveSheet(0)
    setOfficeRendererError(false)
    void loadFile(file.fileId)
      .then((blob) => buildPreview(file, blob))
      .then((next) => {
        if (!current) {
          if (next.status === 'ready' && next.objectUrl) URL.revokeObjectURL(next.objectUrl)
          return
        }
        objectUrl = next.status === 'ready' ? next.objectUrl : undefined
        setPreview(next)
      })
      .catch(() => {
        if (current) setPreview({ status: 'error' })
      })
    return () => {
      current = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file, loadFile])

  useEffect(() => {
    if (preview.status !== 'ready' || preview.kind !== 'docx' || !preview.arrayBuffer || !wordContainerRef.current) return undefined
    let current = true
    const container = wordContainerRef.current
    container.replaceChildren()
    setOfficeRendererLoading(true)
    void import('docx-preview')
      .then(({ renderAsync }) => renderAsync(preview.arrayBuffer!, container, container, {
        inWrapper: true,
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        renderAltChunks: true,
        useBase64URL: true,
      }))
      .then(() => { if (current) setOfficeRendererLoading(false) })
      .catch(() => {
        if (current) {
          setOfficeRendererLoading(false)
          setOfficeRendererError(true)
        }
      })
    return () => {
      current = false
      container.replaceChildren()
    }
  }, [preview])

  useEffect(() => {
    if (preview.status !== 'ready' || preview.kind !== 'slides' || !preview.arrayBuffer || !slidesContainerRef.current) return undefined
    let current = true
    let destroyViewer: (() => void) | undefined
    const container = slidesContainerRef.current
    container.replaceChildren()
    setOfficeRendererLoading(true)
    void import('@aiden0z/pptx-renderer/browser')
      .then(async ({ PptxViewer, RECOMMENDED_ZIP_LIMITS }) => {
        const viewer = await PptxViewer.open(preview.arrayBuffer!, container, {
          renderMode: 'list',
          fitMode: 'contain',
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          lazySlides: true,
          lazyMedia: true,
          pdfjs: false,
          listOptions: { windowed: true, initialSlides: 4, batchSize: 4 },
        })
        destroyViewer = () => viewer.destroy()
        if (!current) destroyViewer()
        else setOfficeRendererLoading(false)
      })
      .catch(() => {
        if (current) {
          setOfficeRendererLoading(false)
          setOfficeRendererError(true)
        }
      })
    return () => {
      current = false
      destroyViewer?.()
      container.replaceChildren()
    }
  }, [preview])

  const typeLabel = useMemo(() => {
    if (preview.status !== 'ready') return ''
    if (preview.kind === 'docx') return tx('filePreview.document')
    if (preview.kind === 'sheet') return tx('filePreview.spreadsheet')
    if (preview.kind === 'slides') return tx('filePreview.presentation')
    return ''
  }, [preview, tx])

  if (!file) return null

  const download = async () => {
    const blob = await loadFile(file.fileId)
    downloadBlob(blob, file.fileName)
  }
  const sheets = preview.status === 'ready' ? preview.sheets ?? [] : []
  const currentSheet = sheets[Math.min(activeSheet, Math.max(0, sheets.length - 1))]

  return (
    <ModalPortal>
      <div className={`dialog-layer attachment-preview-layer${exiting ? ' exiting' : ''}`} onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}>
        <section ref={dialogRef} className="attachment-preview-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <header className="attachment-preview-head">
            <div className="attachment-preview-title">
              <span className="attachment-preview-title-icon" aria-hidden="true"><FileText size={18} /></span>
              <div>
                <span className="eyebrow">{tx('filePreview.preview')}</span>
                <h2 id={titleId} title={file.fileName}>{file.fileName}</h2>
                {typeLabel ? <p>{typeLabel}</p> : null}
              </div>
          </div>
          <div className="attachment-preview-actions">
            <StandalonePreferences className="attachment-preview-preferences" />
            <button type="button" className="quiet-action attachment-preview-download" onClick={() => void download()}>
                <Download size={14} aria-hidden="true" />
                <span>{tx('dossier.download')}</span>
              </button>
              <button ref={closeRef} type="button" className="attachment-preview-close" onClick={() => requestClose()} aria-label={tx('close')} title={tx('close')}>
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="attachment-preview-stage" aria-busy={preview.status === 'loading' || undefined}>
            {preview.status === 'loading' ? (
              <div className="attachment-preview-loading"><LoaderCircle className="spin-icon" size={22} aria-hidden="true" /><span>{tx('working')}</span></div>
            ) : null}
            {preview.status === 'error' || (preview.status === 'ready' && preview.kind === 'unsupported') ? (
              <div className="attachment-preview-unavailable">
                <FileType2 size={26} aria-hidden="true" />
                <strong>{tx('filePreview.unavailable')}</strong>
                <p>{tx('filePreview.downloadHint')}</p>
              </div>
            ) : null}
            {preview.status === 'ready' && preview.kind === 'pdf' && preview.objectUrl ? (
              <iframe className="attachment-preview-frame" src={preview.objectUrl} title={file.fileName} />
            ) : null}
            {preview.status === 'ready' && preview.kind === 'image' && preview.objectUrl ? (
              <img className="attachment-preview-image" src={preview.objectUrl} alt={file.fileName} />
            ) : null}
            {preview.status === 'ready' && preview.kind === 'text' ? (
              <pre className="attachment-preview-text">{preview.text}</pre>
            ) : null}
            {preview.status === 'ready' && preview.kind === 'docx' ? (
              <div className="attachment-preview-office-scroll">
                <div ref={wordContainerRef} className="attachment-preview-document" />
                {officeRendererLoading ? <div className="attachment-preview-rendering"><LoaderCircle className="spin-icon" size={18} /><span>{tx('working')}</span></div> : null}
                {officeRendererError ? <div className="attachment-preview-render-error">{tx('filePreview.renderError')}</div> : null}
              </div>
            ) : null}
            {preview.status === 'ready' && preview.kind === 'sheet' ? (
              <div className="attachment-preview-sheet-viewer">
                {sheets.length > 1 ? (
                  <div className="attachment-preview-sheet-tabs" role="tablist" aria-label={tx('filePreview.sheets')}>
                    {sheets.map((sheet, index) => (
                      <button
                        key={sheet.name}
                        type="button"
                        role="tab"
                        aria-selected={activeSheet === index}
                        className={activeSheet === index ? 'active' : ''}
                        onClick={() => setActiveSheet(index)}
                      >
                        {sheet.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="attachment-preview-sheet-wrap">
                  <table className="attachment-preview-sheet">
                    {currentSheet ? (
                      <colgroup>
                        {currentSheet.columnWidths.map((width, index) => <col key={index} style={{ width }} />)}
                      </colgroup>
                    ) : null}
                    <tbody>
                      {(currentSheet?.rows ?? []).map((row, rowIndex) => (
                        <tr key={rowIndex} style={{ height: currentSheet?.rowHeights[rowIndex] }}>
                          {row.map((cell, cellIndex) => cell ? (
                            <td
                              key={cellIndex}
                              colSpan={cell.colSpan}
                              rowSpan={cell.rowSpan}
                              style={cell.style}
                            >
                              {cell.value}
                            </td>
                          ) : null)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {preview.status === 'ready' && preview.kind === 'slides' ? (
              <div className="attachment-preview-office-scroll attachment-preview-slides">
                <div ref={slidesContainerRef} className="attachment-preview-pptx-canvas" />
                {officeRendererLoading ? <div className="attachment-preview-rendering"><LoaderCircle className="spin-icon" size={18} /><span>{tx('working')}</span></div> : null}
                {officeRendererError ? (
                  <div className="attachment-preview-unavailable compact">
                    <Presentation size={24} aria-hidden="true" />
                    <strong>{tx('filePreview.renderError')}</strong>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </ModalPortal>
  )
}
