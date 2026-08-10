import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html'
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from '@lexical/list'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  $generateNodesFromMarkdownString,
  TRANSFORMERS,
  type TextFormatTransformer,
  type TextMatchTransformer,
  type Transformer,
} from '@lexical/markdown'
import { LinkNode } from '@lexical/link'
import { CodeNode, $createCodeNode } from '@lexical/code'
import { $setBlocksType } from '@lexical/selection'
import {
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
} from '@lexical/rich-text'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import CodeEditorExport from 'react-simple-code-editor'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-markdown'
import getCaretCoordinates from 'textarea-caret'
import { SAFE_RELOAD_FLUSH_EVENT } from '../../safeReload'
import {
  $applyNodeReplacement,
  $createRangeSelection,
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  DecoratorNode,
  FORMAT_TEXT_COMMAND,
  INDENT_CONTENT_COMMAND,
  INSERT_LINE_BREAK_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  PASTE_COMMAND,
  SKIP_SCROLL_INTO_VIEW_TAG,
  type EditorConfig,
  type EditorState,
  type EditorThemeClasses,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type PointType,
  type SerializedLexicalNode,
  type TextFormatType,
} from 'lexical'
import {
  AlignLeft,
  Bold,
  Braces,
  Code2,
  Eraser,
  Eye,
  Italic,
  List as ListIcon,
  ListOrdered,
  LoaderCircle,
  Quote,
  Strikethrough,
  Underline,
  type LucideIcon,
} from 'lucide-react'
import {
  forwardRef,
  startTransition,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { safeMarkdownHref } from '../../safeLinks'
import { useI18n } from '../hooks/useI18n'
import {
  detectRichTextFormat,
  escapeRichTextHtml,
  richTextNeedsFidelityPreview,
  sanitizeRichHtml,
  type RichTextFormat,
} from './richText'
import { formatRichTextSource } from './formatRichTextSource'
import { MarkdownContent } from './MarkdownContent'
import { resolveCodeEditorExport } from './codeEditorInterop'
import {
  getHtmlAutoCloseEdit,
  getSourceCompletions,
  type SourceCompletion,
  type SourceCompletionKind,
} from './sourceCompletions'

export type MarkdownTextareaMode = 'visual' | 'source'
type EditorMode = MarkdownTextareaMode
type FormatAction = 'bold' | 'italic' | 'underline' | 'strike' | 'bulletList' | 'numberedList' | 'quote' | 'code' | 'clear'
type SourceFormat = Exclude<RichTextFormat, 'plain'>

export type MarkdownTextareaSelectionPoint = Pick<PointType, 'key' | 'offset' | 'type'>

export type MarkdownTextareaSelection =
  | {
      mode: 'source'
      start: number
      end: number
    }
  | {
      mode: 'visual'
      anchor: MarkdownTextareaSelectionPoint
      focus: MarkdownTextareaSelectionPoint
      format: number
      style: string
    }

export type MarkdownTextareaReplaceResult = {
  value: string
  /** Exact inserted range when the editor can retain one; null means it cannot be safely replayed. */
  selection: MarkdownTextareaSelection | null
}

export type MarkdownTextareaController = {
  getMode: () => MarkdownTextareaMode
  getValue: () => string
  getSelection: () => MarkdownTextareaSelection | null
  focus: (options?: { atEnd?: boolean }) => void
  insertText: (text: string) => void
  replaceRange: (
    range: MarkdownTextareaSelection | null,
    text: string,
  ) => MarkdownTextareaReplaceResult | null
}

export type MarkdownTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  previewClassName?: string
  defaultMode?: EditorMode
  controllerRef?: Ref<MarkdownTextareaController>
  preservePlainLineBreaks?: boolean
}

// Vite 8 can preserve react-simple-code-editor's CommonJS `exports.default`
// wrapper in development even when dependency interop is explicitly enabled.
const Editor = resolveCodeEditorExport<typeof CodeEditorExport>(
  CodeEditorExport as typeof CodeEditorExport | { default: typeof CodeEditorExport },
)

type ContextMenuState = {
  x: number
  y: number
}

type SourceCompletionMenuState = {
  activeIndex: number
  items: SourceCompletion[]
  left: number
  top: number
  width: number
}

type FormatMenuItem = {
  action: FormatAction
  icon: LucideIcon
  labelKey: string
  shortcut?: string
  shift?: boolean
}

type EditorSyncProps = {
  formatRef: React.MutableRefObject<SourceFormat>
  lastEmittedValueRef: React.MutableRefObject<string | null>
  mode: EditorMode
  preservePlainLineBreaks: boolean
  recentVisualValuesRef: React.MutableRefObject<string[]>
  syncToken: number
  value: string
  visualDirtyRef: React.MutableRefObject<boolean>
  visualSyncValueRef: React.MutableRefObject<string>
}

const EXTERNAL_SYNC_TAG = 'phd-atlas-external-rich-text-sync'
const MAX_LENGTH_RESTORE_TAG = 'phd-atlas-rich-text-length-restore'
const CONTROLLER_EDIT_TAG = 'phd-atlas-rich-text-controller-edit'
const SOURCE_COMPLETION_LIMIT_HEIGHT = 286

if (languages.markdown && !Object.prototype.hasOwnProperty.call(languages.markdown, 'atlas-task')) {
  languages.insertBefore('markdown', 'blockquote', {
    'atlas-task': {
      pattern: /(^\s*[-*+]\s+)\[[ xX]\]/m,
      lookbehind: true,
      alias: 'important',
    },
    'atlas-footnote': {
      pattern: /\[\^[^\]\n]+\]/,
      alias: 'variable',
    },
    'atlas-table': {
      pattern: /(^|\n)\s{0,3}\|[^\n]*\|[^\n]*(?=\n|$)/,
      lookbehind: true,
      inside: {
        'table-punctuation': {
          pattern: /\|/,
          alias: 'punctuation',
        },
        'table-alignment': {
          pattern: /:?-{3,}:?/,
          alias: 'operator',
        },
      },
    },
  })
}
class MarkdownHardBreakNode extends DecoratorNode<null> {
  static getType() {
    return 'markdown-hard-break'
  }

  static clone(node: MarkdownHardBreakNode) {
    return new MarkdownHardBreakNode(node.__key)
  }

  static importJSON(serializedNode: SerializedLexicalNode) {
    return $createMarkdownHardBreakNode().updateFromJSON(serializedNode)
  }

  constructor(key?: NodeKey) {
    super(key)
  }

  createDOM(_config: EditorConfig) {
    return document.createElement('br')
  }

  updateDOM() {
    return false
  }

  getTextContent() {
    return '\n'
  }

  isInline(): true {
    return true
  }

  isKeyboardSelectable(): false {
    return false
  }
}

function $createMarkdownHardBreakNode() {
  return $applyNodeReplacement(new MarkdownHardBreakNode())
}

function $isMarkdownHardBreakNode(node: LexicalNode | null | undefined): node is MarkdownHardBreakNode {
  return node instanceof MarkdownHardBreakNode
}

const HARD_BREAK_TRANSFORMER: TextMatchTransformer = {
  type: 'text-match',
  dependencies: [MarkdownHardBreakNode],
  export: (node) => $isMarkdownHardBreakNode(node) ? '\\' + '\n' : null,
  regExp: /$a/,
}
const UNDERLINE_TRANSFORMER: TextFormatTransformer = {
  type: 'text-format',
  format: ['underline'],
  tag: '++',
}
const EDITOR_TRANSFORMERS: Transformer[] = [HARD_BREAK_TRANSFORMER, UNDERLINE_TRANSFORMER, ...TRANSFORMERS]

const lexicalTheme: EditorThemeClasses = {
  root: 'markdown-visual-editor',
  paragraph: 'markdown-editor-paragraph',
  quote: 'markdown-editor-quote',
  code: 'markdown-editor-code-block',
  link: 'markdown-editor-link',
  heading: {
    h1: 'markdown-editor-heading markdown-editor-heading-h1',
    h2: 'markdown-editor-heading markdown-editor-heading-h2',
    h3: 'markdown-editor-heading markdown-editor-heading-h3',
    h4: 'markdown-editor-heading markdown-editor-heading-h4',
    h5: 'markdown-editor-heading markdown-editor-heading-h5',
    h6: 'markdown-editor-heading markdown-editor-heading-h6',
  },
  list: {
    ul: 'markdown-editor-list markdown-editor-list-ul',
    ol: 'markdown-editor-list markdown-editor-list-ol',
    listitem: 'markdown-editor-list-item',
    nested: {
      list: 'markdown-editor-list-nested',
      listitem: 'markdown-editor-list-item-nested',
    },
  },
  text: {
    bold: 'markdown-editor-text-bold',
    italic: 'markdown-editor-text-italic',
    underline: 'markdown-editor-text-underline',
    strikethrough: 'markdown-editor-text-strikethrough',
    code: 'markdown-editor-text-code',
  },
}

const formatMenuItems: FormatMenuItem[] = [
  { action: 'bold', icon: Bold, labelKey: 'markdown.bold', shortcut: 'B' },
  { action: 'italic', icon: Italic, labelKey: 'markdown.italic', shortcut: 'I' },
  { action: 'underline', icon: Underline, labelKey: 'markdown.underline', shortcut: 'U' },
  { action: 'strike', icon: Strikethrough, labelKey: 'markdown.strikethrough', shortcut: 'X', shift: true },
  { action: 'bulletList', icon: ListIcon, labelKey: 'markdown.bulletList', shortcut: '8', shift: true },
  { action: 'numberedList', icon: ListOrdered, labelKey: 'markdown.numberedList', shortcut: '7', shift: true },
  { action: 'quote', icon: Quote, labelKey: 'markdown.quote' },
  { action: 'code', icon: Code2, labelKey: 'markdown.code' },
  { action: 'clear', icon: Eraser, labelKey: 'markdown.clearFormatting' },
]

function isMacPlatform() {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function usesPrimaryShortcutModifier(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>) {
  return isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
}

function formatMenuShortcut(item: FormatMenuItem, isMac: boolean) {
  if (!item.shortcut) return ''
  const modifier = isMac ? '⌘' : 'Ctrl+'
  const shift = item.shift ? (isMac ? '⇧' : 'Shift+') : ''
  return `${modifier}${shift}${item.shortcut}`
}

type IdleSchedulerWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

type ScheduledIdleTask = {
  kind: 'idle' | 'timeout'
  handle: number
}

const SOURCE_HIGHLIGHT_TIMEOUT = 120
const SOURCE_CHANGE_DEBOUNCE = 48
const SOURCE_CHANGE_LARGE_DEBOUNCE = 220
const SOURCE_FORMAT_CONTEXT_LIMIT = 4096

const EXPLICITLY_OWNED_SOURCE_ARIA_ATTRIBUTES = new Set([
  'aria-activedescendant',
  'aria-autocomplete',
  'aria-controls',
  'aria-expanded',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-invalid',
  'aria-required',
  'aria-hidden',
])

function getMirroredSourceAttributes(
  textareaProps: Record<string, unknown>,
): Array<[string, string]> {
  const mirrored: Array<[string, string]> = []
  Object.entries(textareaProps).forEach(([name, attributeValue]) => {
    const lowerName = name.toLowerCase()
    const attributeName = (name.startsWith('aria-') && !EXPLICITLY_OWNED_SOURCE_ARIA_ATTRIBUTES.has(name))
      || name.startsWith('data-')
      ? name
      : lowerName === 'inputmode' || lowerName === 'enterkeyhint'
        ? lowerName
        : ['dir', 'lang', 'title', 'wrap'].includes(lowerName)
          ? lowerName
          : ''
    if (!attributeName || attributeValue === undefined || attributeValue === null || attributeValue === false) return
    mirrored.push([attributeName, attributeValue === true ? '' : String(attributeValue)])
  })
  return mirrored
}

function formatForValue(value: string): SourceFormat {
  return detectRichTextFormat(value) === 'html' ? 'html' : 'markdown'
}

function shouldPreservePlainLineBreaks(value: string, enabled: boolean) {
  return enabled && detectRichTextFormat(value) !== 'html'
}

function sourceFormatForValue(value: string): SourceFormat {
  if (formatForValue(value) === 'html') return 'html'
  return /(?:^|\n)\s*<\/?[a-z][\w:-]*(?:\s[^<>]*)?$/i.test(value)
    || /(?:^|\n)\s*<$/.test(value)
    ? 'html'
    : 'markdown'
}

function sourceFormatForInput(value: string, currentFormat: SourceFormat, caret: number): SourceFormat {
  const contextStart = Math.max(0, caret - SOURCE_FORMAT_CONTEXT_LIMIT)
  const context = value.slice(contextStart, Math.min(value.length, caret + SOURCE_FORMAT_CONTEXT_LIMIT))
  if (!context.includes('<')) {
    // A long HTML document can have its nearest tag far above the caret. Keep
    // the known format without rescanning the whole document on every input.
    // A complete format reconciliation still happens on source exit/blur.
    return currentFormat
  }
  return currentFormat === 'html' ? 'html' : sourceFormatForValue(value)
}

function sourceCompletionTrigger(value: string, caret: number) {
  const contextStart = Math.max(0, caret - SOURCE_FORMAT_CONTEXT_LIMIT)
  const context = value.slice(contextStart, caret)
  return /<\/?[a-z][\w:-]*$/i.test(context)
    || /<[a-z][\w:-]*(?:[^<>]*\s+[a-z:@][\w:.-]*)?$/i.test(context)
    || /(?:^|\n)\s*(?:\/|#{1,3}|[-*+]|\d?\.?|>|!|\[|\[\^|`{1,3}|\|)$/.test(context)
    || /(?:^|[^\s\n])(?:!?\[|\[\^|`{1,3})$/.test(context)
}

function appendImportedNodes(root: ReturnType<typeof $getRoot>, nodes: LexicalNode[]) {
  let inlineParagraph: ReturnType<typeof $createParagraphNode> | null = null
  const flushInlineParagraph = () => {
    if (!inlineParagraph) return
    root.append(inlineParagraph)
    inlineParagraph = null
  }

  nodes.forEach((node) => {
    if (node.isInline()) {
      inlineParagraph ??= $createParagraphNode()
      inlineParagraph.append(node)
      return
    }
    flushInlineParagraph()
    root.append(node)
  })
  flushInlineParagraph()
}

function $replaceEditorValue(
  editor: LexicalEditor,
  value: string,
  format: SourceFormat,
  preservePlainLineBreaks: boolean,
) {
  const root = $getRoot()
  root.clear()
  if (!value.trim()) {
    root.append($createParagraphNode())
    return
  }

  if (format === 'html') {
    const dom = new DOMParser().parseFromString(sanitizeRichHtml(value), 'text/html')
    appendImportedNodes(root, $generateNodesFromDOM(editor, dom))
  } else {
    $convertFromMarkdownString(
      value,
      EDITOR_TRANSFORMERS,
      root,
      false,
      !preservePlainLineBreaks,
    )
  }

  if (root.getChildrenSize() === 0) root.append($createParagraphNode())
}

function serializeEditorState(
  editorState: EditorState,
  editor: LexicalEditor,
  format: SourceFormat,
) {
  return editorState.read(() => {
    if (format === 'html') return sanitizeRichHtml($generateHtmlFromNodes(editor))
    return $convertToMarkdownString(EDITOR_TRANSFORMERS, undefined, false)
  }, { editor })
}

function cloneSelectionPoint(point: PointType): MarkdownTextareaSelectionPoint {
  return { key: point.key, offset: point.offset, type: point.type }
}

function snapshotVisualSelection(
  selection: ReturnType<typeof $createRangeSelection>,
): Extract<MarkdownTextareaSelection, { mode: 'visual' }> {
  return {
    mode: 'visual',
    anchor: cloneSelectionPoint(selection.anchor),
    focus: cloneSelectionPoint(selection.focus),
    format: selection.format,
    style: selection.style,
  }
}

function $isValidSelectionPoint(point: MarkdownTextareaSelectionPoint) {
  if (!Number.isInteger(point.offset) || point.offset < 0) return false
  const node = $getNodeByKey(point.key)
  if (!node?.isAttached()) return false
  if (point.type === 'text') {
    return $isTextNode(node) && point.offset <= node.getTextContentSize()
  }
  return $isElementNode(node) && point.offset <= node.getChildrenSize()
}

function $createSelectionFromSnapshot(
  snapshot: Extract<MarkdownTextareaSelection, { mode: 'visual' }>,
) {
  if (!$isValidSelectionPoint(snapshot.anchor) || !$isValidSelectionPoint(snapshot.focus)) return null
  const selection = $createRangeSelection()
  selection.anchor.set(snapshot.anchor.key, snapshot.anchor.offset, snapshot.anchor.type)
  selection.focus.set(snapshot.focus.key, snapshot.focus.offset, snapshot.focus.type)
  selection.format = snapshot.format
  selection.style = snapshot.style
  return selection
}

function $captureInsertedVisualSelection(
  originalStart: MarkdownTextareaSelectionPoint,
  text: string,
) {
  const current = $getSelection()
  if (!$isRangeSelection(current) || !current.isCollapsed()) return null
  const end = cloneSelectionPoint(current.focus)
  const candidates: MarkdownTextareaSelectionPoint[] = []
  if (end.type === 'text' && end.offset >= text.length) {
    candidates.push({ ...end, offset: end.offset - text.length })
  }
  candidates.push(originalStart)

  for (const start of candidates) {
    const candidate = $createSelectionFromSnapshot({
      mode: 'visual',
      anchor: start,
      focus: end,
      format: current.format,
      style: current.style,
    })
    if (candidate && candidate.getTextContent() === text) return snapshotVisualSelection(candidate)
  }
  return text ? null : snapshotVisualSelection(current)
}

function LexicalBridgePlugin({ onReady }: { onReady: (editor: LexicalEditor | null) => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    onReady(editor)
    return () => onReady(null)
  }, [editor, onReady])
  return null
}

function EditableStatePlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => editor.setEditable(editable), [editable, editor])
  return null
}

function MarkdownHardBreakPlugin({ formatRef }: { formatRef: React.MutableRefObject<SourceFormat> }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => editor.registerCommand(
    INSERT_LINE_BREAK_COMMAND,
    (selectStart) => {
      if (formatRef.current !== 'markdown') return false
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return false
      const hardBreak = $createMarkdownHardBreakNode()
      selection.insertNodes([hardBreak])
      if (selectStart) {
        const parent = hardBreak.getParentOrThrow()
        const index = hardBreak.getIndexWithinParent()
        parent.select(index, index)
      }
      return true
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor, formatRef])

  return null
}

function ExternalValuePlugin({
  formatRef,
  lastEmittedValueRef,
  mode,
  preservePlainLineBreaks,
  recentVisualValuesRef,
  syncToken,
  value,
  visualDirtyRef,
  visualSyncValueRef,
}: EditorSyncProps) {
  const [editor] = useLexicalComposerContext()
  const previousModeRef = useRef(mode)
  const previousTokenRef = useRef(syncToken)

  useEffect(() => {
    const enteringVisual = previousModeRef.current === 'source' && mode === 'visual'
    const forced = previousTokenRef.current !== syncToken
    previousModeRef.current = mode
    previousTokenRef.current = syncToken
    if (mode !== 'visual') return
    if (visualDirtyRef.current) return
    if (!enteringVisual && !forced) {
      if (lastEmittedValueRef.current === value || recentVisualValuesRef.current.includes(value)) return
    }

    const nextValue = enteringVisual || forced ? visualSyncValueRef.current : value
    const format = formatForValue(nextValue)
    const preserveNewLines = shouldPreservePlainLineBreaks(nextValue, preservePlainLineBreaks)
    formatRef.current = format
    visualDirtyRef.current = false
    editor.update(
      () => $replaceEditorValue(editor, nextValue, format, preserveNewLines),
      { tag: EXTERNAL_SYNC_TAG },
    )
  }, [
    editor,
    formatRef,
    lastEmittedValueRef,
    mode,
    preservePlainLineBreaks,
    recentVisualValuesRef,
    syncToken,
    value,
    visualDirtyRef,
    visualSyncValueRef,
  ])

  return null
}

function BufferedOnChangePlugin({
  emitValue,
  formatRef,
  lastEmittedValueRef,
  pendingFlushRef,
  valueRef,
  visualDirtyRef,
}: {
  emitValue: (value: string) => void
  formatRef: React.MutableRefObject<SourceFormat>
  lastEmittedValueRef: React.MutableRefObject<string | null>
  pendingFlushRef: React.MutableRefObject<(() => void) | null>
  valueRef: React.MutableRefObject<string>
  visualDirtyRef: React.MutableRefObject<boolean>
}) {
  const timeoutRef = useRef<number | null>(null)
  const pendingRef = useRef<{ editor: LexicalEditor; editorState: EditorState } | null>(null)
  const emitValueRef = useRef(emitValue)
  emitValueRef.current = emitValue

  const flushPending = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = null
    if (!pending || !visualDirtyRef.current) return
    const nextValue = serializeEditorState(
      pending.editorState,
      pending.editor,
      formatRef.current,
    )
    visualDirtyRef.current = false
    if (nextValue === valueRef.current || nextValue === lastEmittedValueRef.current) return
    emitValueRef.current(nextValue)
  }, [formatRef, lastEmittedValueRef, valueRef, visualDirtyRef])
  pendingFlushRef.current = flushPending

  useEffect(() => {
    const flushBeforeExit = () => flushPending()
    window.addEventListener('pagehide', flushBeforeExit)
    window.addEventListener('beforeunload', flushBeforeExit)
    return () => {
      window.removeEventListener('pagehide', flushBeforeExit)
      window.removeEventListener('beforeunload', flushBeforeExit)
      flushPending()
    }
  }, [flushPending])

  const onEditorChange = useCallback((editorState: EditorState, editor: LexicalEditor, tags: Set<string>) => {
    if (
      tags.has(EXTERNAL_SYNC_TAG)
      || tags.has(MAX_LENGTH_RESTORE_TAG)
      || tags.has(CONTROLLER_EDIT_TAG)
    ) return
    visualDirtyRef.current = true
    pendingRef.current = { editor, editorState }
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    const delay = valueRef.current.length > 12_000 ? 220 : 48
    timeoutRef.current = window.setTimeout(() => {
      flushPending()
    }, delay)
  }, [flushPending, valueRef, visualDirtyRef])

  return <OnChangePlugin ignoreSelectionChange onChange={onEditorChange} />
}

function MaxLengthPlugin({ maxLength }: { maxLength?: number }) {
  const [editor] = useLexicalComposerContext()
  const lastValidStateRef = useRef(editor.getEditorState())
  const restoringRef = useRef(false)

  useEffect(() => {
    if (typeof maxLength !== 'number') return undefined
    return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, editorState, tags }) => {
      if (tags.has(EXTERNAL_SYNC_TAG) || tags.has(MAX_LENGTH_RESTORE_TAG) || restoringRef.current) {
        lastValidStateRef.current = editorState
        return
      }
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return
      const length = editorState.read(() => $getRoot().getTextContentSize())
      if (length <= maxLength) {
        lastValidStateRef.current = editorState
        return
      }
      restoringRef.current = true
      editor.setEditorState(lastValidStateRef.current, { tag: MAX_LENGTH_RESTORE_TAG })
      queueMicrotask(() => { restoringRef.current = false })
    })
  }, [editor, maxLength])

  return null
}

function PasteFormattingPlugin({
  onDetectedFormat,
  preservePlainLineBreaks,
}: {
  onDetectedFormat: (format: SourceFormat) => void
  preservePlainLineBreaks: boolean
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      if (!event || !('clipboardData' in event)) return false
      const clipboardData = event?.clipboardData
      if (!clipboardData) return false
      const sourceHtml = clipboardData.getData('text/html')
      const sourceText = clipboardData.getData('text/plain')
      const detected = detectRichTextFormat(sourceText)
      const sanitizedHtml = sourceHtml ? sanitizeRichHtml(sourceHtml) : ''
      const hasRichHtml = /<(?:p|div|br|strong|b|em|i|u|s|del|ul|ol|li|blockquote|pre|code|a|h[1-6])\b/i.test(sanitizedHtml)
      if (!hasRichHtml && detected === 'plain') return false

      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return false
      event.preventDefault()
      const insertImportedNodes = (nodes: LexicalNode[]) => {
        const root = $getRoot()
        if (root.getTextContentSize() === 0) {
          root.clear()
          appendImportedNodes(root, nodes)
          root.selectEnd()
        } else {
          selection.insertNodes(nodes)
        }
      }
      if (hasRichHtml || detected === 'html') {
        const html = hasRichHtml ? sanitizedHtml : sanitizeRichHtml(sourceText)
        const dom = new DOMParser().parseFromString(html, 'text/html')
        insertImportedNodes($generateNodesFromDOM(editor, dom))
        onDetectedFormat('html')
      } else {
        insertImportedNodes($generateNodesFromMarkdownString(
          sourceText,
          EDITOR_TRANSFORMERS,
          false,
          !shouldPreservePlainLineBreaks(sourceText, preservePlainLineBreaks),
        ))
        onDetectedFormat('markdown')
      }
      return true
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor, onDetectedFormat, preservePlainLineBreaks])

  return null
}

function sourceWrapper(action: FormatAction): [string, string] | null {
  if (action === 'bold') return ['**', '**']
  if (action === 'italic') return ['*', '*']
  if (action === 'underline') return ['++', '++']
  if (action === 'strike') return ['~~', '~~']
  if (action === 'code') return ['```\n', '\n```']
  return null
}

function toggleSourceWrapper(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
) {
  const selected = value.slice(start, end)
  const beforeSelection = value.slice(Math.max(0, start - before.length), start)
  const afterSelection = value.slice(end, end + after.length)

  if (beforeSelection === before && afterSelection === after) {
    return {
      value: value.slice(0, start - before.length) + selected + value.slice(end + after.length),
      start: start - before.length,
      end: end - before.length,
    }
  }

  if (selected.length >= before.length + after.length && selected.startsWith(before) && selected.endsWith(after)) {
    const unwrapped = selected.slice(before.length, selected.length - after.length)
    return {
      value: value.slice(0, start) + unwrapped + value.slice(end),
      start,
      end: start + unwrapped.length,
    }
  }

  return {
    value: value.slice(0, start) + before + selected + after + value.slice(end),
    start: start + before.length,
    end: start + before.length + selected.length,
  }
}

function toggleSourceLinePrefix(
  value: string,
  start: number,
  end: number,
  action: 'bulletList' | 'numberedList' | 'quote',
) {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const nextLine = value.indexOf('\n', end)
  const lineEnd = nextLine === -1 ? value.length : nextLine
  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const prefixPattern = action === 'bulletList'
    ? /^\s*[-*+]\s+/
    : action === 'numberedList'
      ? /^\s*\d+\.\s+/
      : /^\s*>\s?/
  const removePrefix = lines.every((line) => prefixPattern.test(line))
  const formatted = lines.map((line, index) => {
    if (removePrefix) return line.replace(prefixPattern, '')
    if (action === 'bulletList') return `- ${line.replace(/^\s*[-*+]\s+/, '')}`
    if (action === 'numberedList') return `${index + 1}. ${line.replace(/^\s*\d+\.\s+/, '')}`
    return `> ${line.replace(/^\s*>\s?/, '')}`
  }).join('\n')

  return {
    value: value.slice(0, lineStart) + formatted + value.slice(lineEnd),
    start: lineStart,
    end: lineStart + formatted.length,
  }
}

export const MarkdownTextarea = forwardRef<HTMLTextAreaElement, MarkdownTextareaProps>(function MarkdownTextarea(
  {
    value,
    onChange,
    className = '',
    previewClassName = '',
    defaultMode = 'visual',
    controllerRef,
    preservePlainLineBreaks = false,
    rows = 3,
    style,
    disabled = false,
    readOnly = false,
    maxLength,
    autoFocus = false,
    tabIndex,
    id,
    placeholder,
    onKeyDown,
    onFocus,
    onBlur,
    onPaste,
    onContextMenu,
    onInput,
    ...textareaProps
  },
  forwardedRef,
) {
  const { tx } = useI18n()
  const editorId = useId().replace(/:/g, '')
  const sourceStatusId = `${editorId}-source-status`
  const sourceSuggestionListId = `${editorId}-source-suggestions`
  const sourceAriaLabel = textareaProps['aria-label'] ?? placeholder
  const sourceAriaLabelledBy = textareaProps['aria-labelledby']
  const sourceAriaDescribedBy = [textareaProps['aria-describedby'], sourceStatusId].filter(Boolean).join(' ')
  const sourceAriaInvalid = textareaProps['aria-invalid']
  const sourceRequired = textareaProps.required
  const initialValueRef = useRef(value)
  const initialFormatRef = useRef<SourceFormat>(formatForValue(value))
  const initialPreservePlainLineBreaksRef = useRef(
    shouldPreservePlainLineBreaks(value, preservePlainLineBreaks),
  )
  const [mode, setMode] = useState<EditorMode>(defaultMode)
  const [sourceDraftValue, setSourceDraftValue] = useState(value)
  const [syncToken, setSyncToken] = useState(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [displayedContextMenu, setDisplayedContextMenu] = useState<ContextMenuState | null>(null)
  const [contextMenuExiting, setContextMenuExiting] = useState(false)
  const [sourceFormatting, setSourceFormatting] = useState(false)
  const [sourceFormatError, setSourceFormatError] = useState(false)
  const [sourceCompletionMenu, setSourceCompletionMenu] = useState<SourceCompletionMenuState | null>(null)
  const sourceHostRef = useRef<HTMLDivElement | null>(null)
  const sourceRef = useRef<HTMLTextAreaElement | null>(null)
  const lastSourceRef = useRef<HTMLTextAreaElement | null>(null)
  const sourceEditorRef = useRef<React.ElementRef<typeof Editor> | null>(null)
  const mirroredSourceAttributeNamesRef = useRef<string[]>([])
  const editorRef = useRef<LexicalEditor | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const contextMenuExitTimerRef = useRef<number | null>(null)
  const formatRef = useRef<SourceFormat>(initialFormatRef.current)
  const lastEmittedValueRef = useRef<string | null>(null)
  const recentVisualValuesRef = useRef<string[]>([])
  const recentSourceValuesRef = useRef<string[]>([])
  const visualDirtyRef = useRef(false)
  const visualSyncValueRef = useRef(value)
  const formatterRequestRef = useRef(0)
  const lastFormattedSourceRef = useRef('')
  const sourceDraftValueRef = useRef(value)
  const pendingSourceChangeRef = useRef<string | null>(null)
  const sourceChangeTimerRef = useRef<number | null>(null)
  const latestOnChangeRef = useRef(onChange)
  const sourceCompletionFrameRef = useRef<number | null>(null)
  const pendingSourceCompletionRef = useRef<{ value: string; force: boolean } | null>(null)
  const sourceHighlightCacheRef = useRef<{ value: string; highlighted: string } | null>(null)
  const sourceHighlightTaskRef = useRef<ScheduledIdleTask | null>(null)
  const pendingVisualFlushRef = useRef<(() => void) | null>(null)
  const [, bumpSourceHighlight] = useState(0)
  const valueRef = useRef(value)
  valueRef.current = mode === 'source' ? sourceDraftValue : value
  sourceDraftValueRef.current = sourceDraftValue
  latestOnChangeRef.current = onChange
  const isMac = isMacPlatform()
  const mirroredSourceAttributes = getMirroredSourceAttributes(textareaProps as Record<string, unknown>)
  const mirroredSourceAttributesRef = useRef(mirroredSourceAttributes)
  mirroredSourceAttributesRef.current = mirroredSourceAttributes
  const mirroredSourceAttributeSignature = mirroredSourceAttributes
    .map(([name, attributeValue]) => `${name}=${attributeValue}`)
    .join('\u0000')
  const sourceCompletionOpen = sourceCompletionMenu !== null

  const initialConfig = useMemo(() => ({
    namespace: `phd-atlas-rich-text-${editorId}`,
    editable: defaultMode === 'visual' && !disabled && !readOnly,
    theme: lexicalTheme,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode, MarkdownHardBreakNode],
    onError: (error: Error) => { throw error },
    editorState: (editor: LexicalEditor) => {
      $replaceEditorValue(
        editor,
        initialValueRef.current,
        initialFormatRef.current,
        initialPreservePlainLineBreaksRef.current,
      )
    },
  }), [defaultMode, disabled, editorId, readOnly])

  const setSourceRef = useCallback((node: HTMLTextAreaElement | null) => {
    sourceRef.current = node
    if (node) lastSourceRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }, [forwardedRef])

  useLayoutEffect(() => {
    const source = sourceHostRef.current?.querySelector<HTMLTextAreaElement>('textarea.markdown-source-input') ?? null
    setSourceRef(source)
    return () => setSourceRef(null)
  }, [setSourceRef])

  useLayoutEffect(() => {
    const source = sourceRef.current
    if (!source) return undefined

    const setOptionalAttribute = (name: string, attributeValue: unknown) => {
      if (attributeValue === undefined || attributeValue === null || attributeValue === false) {
        source.removeAttribute(name)
      } else {
        source.setAttribute(name, String(attributeValue))
      }
    }
    mirroredSourceAttributeNamesRef.current.forEach((name) => source.removeAttribute(name))
    setOptionalAttribute('aria-label', sourceAriaLabel)
    setOptionalAttribute('aria-labelledby', sourceAriaLabelledBy)
    setOptionalAttribute('aria-describedby', sourceAriaDescribedBy)
    setOptionalAttribute('aria-invalid', sourceAriaInvalid)
    setOptionalAttribute('aria-required', sourceRequired)
    setOptionalAttribute('aria-hidden', mode !== 'source')
    setOptionalAttribute('aria-autocomplete', mode === 'source' && !readOnly && !disabled ? 'list' : undefined)
    setOptionalAttribute('aria-controls', sourceCompletionMenu ? sourceSuggestionListId : undefined)
    setOptionalAttribute(
      'aria-expanded',
      mode === 'source' && !readOnly && !disabled ? String(Boolean(sourceCompletionMenu)) : undefined,
    )
    setOptionalAttribute(
      'aria-activedescendant',
      sourceCompletionMenu
        ? `${sourceSuggestionListId}-${sourceCompletionMenu.items[sourceCompletionMenu.activeIndex]?.id}`
        : undefined,
    )
    source.tabIndex = mode === 'source' ? tabIndex ?? 0 : -1

    mirroredSourceAttributesRef.current.forEach(([name, attributeValue]) => {
      source.setAttribute(name, attributeValue)
    })
    mirroredSourceAttributeNamesRef.current = mirroredSourceAttributesRef.current.map(([name]) => name)
    return undefined
  }, [
    disabled,
    mode,
    readOnly,
    setSourceRef,
    sourceAriaDescribedBy,
    sourceAriaInvalid,
    sourceAriaLabel,
    sourceAriaLabelledBy,
    sourceRequired,
    sourceCompletionMenu,
    sourceSuggestionListId,
    mirroredSourceAttributeSignature,
    tabIndex,
  ])

  const emitChange = useCallback((nextValue: string) => {
    const source = sourceRef.current ?? lastSourceRef.current
    if (!source) return
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    if (setter) setter.call(source, nextValue)
    else source.value = nextValue
    lastEmittedValueRef.current = nextValue
    valueRef.current = nextValue
    onChange({ target: source, currentTarget: source } as ChangeEvent<HTMLTextAreaElement>)
  }, [onChange])

  const emitVisualChange = useCallback((nextValue: string) => {
    recentVisualValuesRef.current = [...recentVisualValuesRef.current.slice(-23), nextValue]
    emitChange(nextValue)
  }, [emitChange])

  const flushVisualValue = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !visualDirtyRef.current) return valueRef.current
    const nextValue = serializeEditorState(
      editor.getEditorState(),
      editor,
      formatRef.current,
    )
    visualDirtyRef.current = false
    if (nextValue !== valueRef.current) emitVisualChange(nextValue)
    return nextValue
  }, [emitVisualChange])

  const flushSourceChange = useCallback((immediate = false) => {
    if (sourceChangeTimerRef.current !== null) {
      window.clearTimeout(sourceChangeTimerRef.current)
      sourceChangeTimerRef.current = null
    }
    const nextValue = pendingSourceChangeRef.current
    pendingSourceChangeRef.current = null
    const source = sourceRef.current ?? lastSourceRef.current
    if (nextValue === null || !source) return

    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    if (setter) setter.call(source, nextValue)
    else source.value = nextValue
    const notify = () => {
      lastEmittedValueRef.current = nextValue
      latestOnChangeRef.current({ target: source, currentTarget: source } as ChangeEvent<HTMLTextAreaElement>)
    }
    if (immediate) notify()
    else startTransition(notify)
  }, [])

  useEffect(() => {
    const flushResidentValue = () => {
      pendingVisualFlushRef.current?.()
      flushVisualValue()
      flushSourceChange(true)
    }
    window.addEventListener(SAFE_RELOAD_FLUSH_EVENT, flushResidentValue)
    return () => window.removeEventListener(SAFE_RELOAD_FLUSH_EVENT, flushResidentValue)
  }, [flushSourceChange, flushVisualValue])

  const queueSourceChange = useCallback((nextValue: string) => {
    pendingSourceChangeRef.current = nextValue
    if (sourceChangeTimerRef.current !== null) window.clearTimeout(sourceChangeTimerRef.current)
    const delay = nextValue.length > 12_000 ? SOURCE_CHANGE_LARGE_DEBOUNCE : SOURCE_CHANGE_DEBOUNCE
    sourceChangeTimerRef.current = window.setTimeout(() => {
      sourceChangeTimerRef.current = null
      flushSourceChange()
    }, delay)
  }, [flushSourceChange])

  const previousExternalValueRef = useRef(value)
  useEffect(() => {
    if (previousExternalValueRef.current === value) return
    previousExternalValueRef.current = value
    const pending = pendingSourceChangeRef.current
    if (pending !== null && pending === value) {
      pendingSourceChangeRef.current = null
      if (sourceChangeTimerRef.current !== null) {
        window.clearTimeout(sourceChangeTimerRef.current)
        sourceChangeTimerRef.current = null
      }
      return
    }
    // A controlled parent may publish an earlier debounced source value after
    // the user has already typed more characters locally. Treat values from
    // this editor as acknowledgements, not authoritative replacements; a
    // genuinely external value still falls through to the sync path below.
    if (recentSourceValuesRef.current.includes(value)) return
    if (pending !== null) {
      pendingSourceChangeRef.current = null
      if (sourceChangeTimerRef.current !== null) {
        window.clearTimeout(sourceChangeTimerRef.current)
        sourceChangeTimerRef.current = null
      }
    }
    sourceDraftValueRef.current = value
    formatRef.current = sourceFormatForValue(value)
    setSourceDraftValue((current) => current === value ? current : value)
  }, [value])

  useEffect(() => () => {
    flushSourceChange(true)
  }, [flushSourceChange])

  const updateSourceFormat = useCallback((format: SourceFormat) => {
    formatRef.current = format
  }, [])

  const positionSourceCompletionMenu = useCallback((
    items: SourceCompletion[],
    caret: number,
    preferredId?: string,
  ) => {
    const source = sourceRef.current
    if (!source || items.length === 0 || typeof window === 'undefined') {
      setSourceCompletionMenu(null)
      return
    }

    let coordinates = { top: 10, left: 12, height: 20 }
    try {
      const measured = getCaretCoordinates(source, caret)
      coordinates = {
        top: Number.isFinite(measured.top) ? measured.top : coordinates.top,
        left: Number.isFinite(measured.left) ? measured.left : coordinates.left,
        height: Number.isFinite(measured.height) ? measured.height : coordinates.height,
      }
    } catch {
      // The suggestion menu still gets a stable fallback in non-layout test environments.
    }

    const rect = source.getBoundingClientRect()
    const viewportGutter = 8
    const width = Math.min(304, Math.max(176, window.innerWidth - viewportGutter * 2))
    const estimatedHeight = Math.min(SOURCE_COMPLETION_LIMIT_HEIGHT, items.length * 38 + 34)
    const caretTop = rect.top + coordinates.top - source.scrollTop
    const below = caretTop + coordinates.height + 5
    const top = below + estimatedHeight <= window.innerHeight - viewportGutter
      ? below
      : Math.max(viewportGutter, caretTop - estimatedHeight - 5)
    const left = Math.max(
      viewportGutter,
      Math.min(
        rect.left + coordinates.left - source.scrollLeft,
        window.innerWidth - width - viewportGutter,
      ),
    )

    setSourceCompletionMenu((current) => {
      const currentId = preferredId ?? current?.items[current.activeIndex]?.id
      const activeIndex = Math.max(0, items.findIndex((item) => item.id === currentId))
      return { activeIndex, items, left, top, width }
    })
  }, [])

  const refreshSourceCompletions = useCallback((
    nextValue = valueRef.current,
    force = false,
  ) => {
    const source = sourceRef.current
    if (
      !source
      || mode !== 'source'
      || disabled
      || readOnly
      || source.selectionStart !== source.selectionEnd
    ) {
      setSourceCompletionMenu(null)
      return
    }
    const caret = source.selectionStart ?? nextValue.length
    const completionFormat = formatRef.current
    const items = getSourceCompletions(nextValue, caret, completionFormat, force)
    if (items.length === 0) {
      setSourceCompletionMenu(null)
      return
    }
    positionSourceCompletionMenu(items, caret)
  }, [disabled, mode, positionSourceCompletionMenu, readOnly])

  const scheduleSourceCompletions = useCallback((
    nextValue = valueRef.current,
    force = false,
  ) => {
    const pending = pendingSourceCompletionRef.current
    pendingSourceCompletionRef.current = {
      value: nextValue,
      force: force || Boolean(pending?.force),
    }
    if (sourceCompletionFrameRef.current !== null) return
    sourceCompletionFrameRef.current = window.requestAnimationFrame(() => {
      sourceCompletionFrameRef.current = null
      const next = pendingSourceCompletionRef.current
      pendingSourceCompletionRef.current = null
      if (next) refreshSourceCompletions(next.value, next.force)
    })
  }, [refreshSourceCompletions])

  useEffect(() => () => {
    if (sourceCompletionFrameRef.current !== null) {
      window.cancelAnimationFrame(sourceCompletionFrameRef.current)
      sourceCompletionFrameRef.current = null
    }
    pendingSourceCompletionRef.current = null
  }, [])

  const recordSourceHistory = useCallback((
    currentValue: string,
    nextValue: string,
    currentSelectionStart: number,
    currentSelectionEnd: number,
    nextSelectionStart: number,
    nextSelectionEnd: number,
  ) => {
    const sourceEditor = sourceEditorRef.current
    if (!sourceEditor) return
    const currentHistory = sourceEditor.session.history
    const stack = currentHistory.stack.slice(0, currentHistory.offset + 1)
    const timestamp = Date.now()
    if (stack.at(-1)?.value !== currentValue) {
      stack.push({
        value: currentValue,
        selectionStart: currentSelectionStart,
        selectionEnd: currentSelectionEnd,
        timestamp,
      })
    }
    stack.push({
      value: nextValue,
      selectionStart: nextSelectionStart,
      selectionEnd: nextSelectionEnd,
      timestamp,
    })
    const boundedStack = stack.slice(-100)
    sourceEditor.session = {
      history: {
        stack: boundedStack,
        offset: boundedStack.length - 1,
      },
    }
  }, [])

  const applySourceEdit = useCallback((
    from: number,
    to: number,
    insertText: string,
    selectFrom: number,
    selectTo = selectFrom,
  ) => {
    const source = sourceRef.current
    if (!source || disabled || readOnly) return false
    flushSourceChange(true)
    const currentValue = valueRef.current
    if (from < 0 || to < from || to > currentValue.length) return false
    const nextValue = currentValue.slice(0, from) + insertText + currentValue.slice(to)
    if (typeof maxLength === 'number' && nextValue.length > maxLength) {
      setSourceCompletionMenu(null)
      return false
    }

    const nextSelectionStart = from + selectFrom
    const nextSelectionEnd = from + selectTo
    recordSourceHistory(
      currentValue,
      nextValue,
      source.selectionStart ?? from,
      source.selectionEnd ?? to,
      nextSelectionStart,
      nextSelectionEnd,
    )
    lastFormattedSourceRef.current = ''
    visualSyncValueRef.current = nextValue
    updateSourceFormat(sourceFormatForValue(nextValue))
    sourceDraftValueRef.current = nextValue
    setSourceDraftValue(nextValue)
    emitChange(nextValue)
    setSourceCompletionMenu(null)
    window.requestAnimationFrame(() => {
      const activeSource = sourceRef.current
      if (!activeSource) return
      activeSource.focus()
      activeSource.setSelectionRange(nextSelectionStart, nextSelectionEnd)
    })
    return true
  }, [disabled, emitChange, flushSourceChange, maxLength, readOnly, recordSourceHistory, updateSourceFormat])

  const focusEditor = useCallback((options?: { atEnd?: boolean }) => {
    if (mode === 'source') {
      const source = sourceRef.current
      if (!source || disabled) return
      source.focus()
      if (options?.atEnd) {
        const end = source.value.length
        source.setSelectionRange(end, end)
      }
      return
    }

    const editor = editorRef.current
    if (!editor || disabled) return
    if (!options?.atEnd) {
      editor.focus()
      return
    }
    editor.getRootElement()?.focus()
    editor.update(() => $getRoot().selectEnd(), {
      discrete: true,
      tag: SKIP_SCROLL_INTO_VIEW_TAG,
    })
  }, [disabled, mode])

  const getControllerValue = useCallback(() => {
    if (mode === 'source') {
      flushSourceChange(true)
      return sourceDraftValueRef.current
    }
    pendingVisualFlushRef.current?.()
    return flushVisualValue()
  }, [flushSourceChange, flushVisualValue, mode])

  const getControllerSelection = useCallback((): MarkdownTextareaSelection | null => {
    if (mode === 'source') {
      const source = sourceRef.current
      if (!source) return null
      return {
        mode: 'source',
        start: source.selectionStart ?? source.value.length,
        end: source.selectionEnd ?? source.selectionStart ?? source.value.length,
      }
    }

    const editor = editorRef.current
    if (!editor || richTextNeedsFidelityPreview(valueRef.current, formatRef.current)) return null
    return editor.getEditorState().read(() => {
      const selection = $getSelection()
      return $isRangeSelection(selection) ? snapshotVisualSelection(selection) : null
    })
  }, [mode])

  const replaceControllerRange = useCallback((
    range: MarkdownTextareaSelection | null,
    text: string,
  ): MarkdownTextareaReplaceResult | null => {
    if (disabled || readOnly) return null

    if (mode === 'source') {
      const source = sourceRef.current
      if (!source || (range && range.mode !== 'source')) return null
      flushSourceChange(true)
      const currentValue = sourceDraftValueRef.current
      const from = range?.start ?? source.selectionStart ?? currentValue.length
      const to = range?.end ?? source.selectionEnd ?? from
      const nextValue = currentValue.slice(0, from) + text + currentValue.slice(to)
      if (!applySourceEdit(from, to, text, text.length)) return null
      return {
        value: nextValue,
        selection: { mode: 'source', start: from, end: from + text.length },
      }
    }

    const editor = editorRef.current
    if (
      !editor
      || (range && range.mode !== 'visual')
      || richTextNeedsFidelityPreview(valueRef.current, formatRef.current)
    ) return null

    pendingVisualFlushRef.current?.()
    flushVisualValue()
    let applied = false
    let insertedSelection: Extract<MarkdownTextareaSelection, { mode: 'visual' }> | null = null
    editor.update(() => {
      let selection = range ? $createSelectionFromSnapshot(range) : $getSelection()
      if (range && !selection) return
      if (!$isRangeSelection(selection)) {
        $getRoot().selectEnd()
        selection = $getSelection()
      }
      if (!$isRangeSelection(selection)) return
      if (range) $setSelection(selection)
      const originalStart = cloneSelectionPoint(selection.isBackward() ? selection.focus : selection.anchor)
      selection.insertText(text)
      insertedSelection = $captureInsertedVisualSelection(originalStart, text)
      applied = true
    }, { discrete: true, tag: CONTROLLER_EDIT_TAG })
    if (!applied) return null

    const editorState = editor.getEditorState()
    if (insertedSelection) {
      const validSelection = insertedSelection
      const remainsExact = editorState.read(() => {
        const selection = $createSelectionFromSnapshot(validSelection)
        return selection?.getTextContent() === text
      })
      if (!remainsExact) insertedSelection = null
    }
    const nextValue = serializeEditorState(editorState, editor, formatRef.current)
    visualDirtyRef.current = false
    if (nextValue !== valueRef.current) emitVisualChange(nextValue)
    editor.focus()
    return { value: nextValue, selection: insertedSelection }
  }, [applySourceEdit, disabled, emitVisualChange, flushSourceChange, flushVisualValue, mode, readOnly])

  const insertControllerText = useCallback((text: string) => {
    if (!text || disabled || readOnly) return
    if (mode === 'source') {
      const source = sourceRef.current
      if (!source) return
      const start = source.selectionStart ?? source.value.length
      const end = source.selectionEnd ?? start
      applySourceEdit(start, end, text, text.length)
      return
    }

    const editor = editorRef.current
    if (!editor || richTextNeedsFidelityPreview(valueRef.current, formatRef.current)) return
    editor.update(() => {
      let selection = $getSelection()
      if (!$isRangeSelection(selection)) {
        $getRoot().selectEnd()
        selection = $getSelection()
      }
      if ($isRangeSelection(selection)) selection.insertText(text)
    }, { onUpdate: () => editor.focus() })
  }, [applySourceEdit, disabled, mode, readOnly])

  useImperativeHandle(controllerRef, () => ({
    getMode: () => mode,
    getValue: getControllerValue,
    getSelection: getControllerSelection,
    focus: focusEditor,
    insertText: insertControllerText,
    replaceRange: replaceControllerRange,
  }), [
    focusEditor,
    getControllerSelection,
    getControllerValue,
    insertControllerText,
    mode,
    replaceControllerRange,
  ])

  const acceptSourceCompletion = useCallback((index = sourceCompletionMenu?.activeIndex ?? 0) => {
    const source = sourceRef.current
    const item = sourceCompletionMenu?.items[index]
    if (!source || !item || source.selectionStart !== item.to || source.selectionEnd !== item.to) {
      setSourceCompletionMenu(null)
      return false
    }
    return applySourceEdit(
      item.from,
      item.to,
      item.insertText,
      item.selectFrom,
      item.selectTo,
    )
  }, [applySourceEdit, sourceCompletionMenu])

  const runSourceFormatter = useCallback(async (snapshot = valueRef.current, focusAfter = false) => {
    if (disabled || readOnly || !snapshot.trim() || lastFormattedSourceRef.current === snapshot) return
    flushSourceChange(true)
    setSourceCompletionMenu(null)
    const request = formatterRequestRef.current + 1
    formatterRequestRef.current = request
    const source = sourceRef.current
    const selectionStart = source?.selectionStart ?? snapshot.length
    const selectionEnd = source?.selectionEnd ?? selectionStart
    const detectedFormat = sourceFormatForValue(snapshot)
    setSourceFormatting(true)
    setSourceFormatError(false)
    try {
      const formatted = await formatRichTextSource(snapshot, detectedFormat)
      if (formatterRequestRef.current !== request || valueRef.current !== snapshot) return
      if (typeof maxLength === 'number' && formatted.length > maxLength) {
        setSourceFormatError(true)
        return
      }
      lastFormattedSourceRef.current = formatted
      updateSourceFormat(detectedFormat)
      if (formatted !== snapshot) {
        sourceDraftValueRef.current = formatted
        setSourceDraftValue(formatted)
        visualSyncValueRef.current = formatted
        emitChange(formatted)
      }
      if (focusAfter) {
        window.requestAnimationFrame(() => {
          const activeSource = sourceRef.current
          if (!activeSource) return
          activeSource.focus()
          activeSource.setSelectionRange(
            Math.min(selectionStart, formatted.length),
            Math.min(selectionEnd, formatted.length),
          )
        })
      }
    } catch {
      if (formatterRequestRef.current === request) setSourceFormatError(true)
    } finally {
      if (formatterRequestRef.current === request) setSourceFormatting(false)
    }
  }, [disabled, emitChange, flushSourceChange, maxLength, readOnly, updateSourceFormat])

  useEffect(() => {
    if (mode !== 'source') return undefined
    const highlightValue = sourceDraftValue
    const idleWindow = window as IdleSchedulerWindow
    const renderHighlight = () => {
      sourceHighlightTaskRef.current = null
      if (mode !== 'source' || sourceDraftValueRef.current !== highlightValue) return
      const language = formatRef.current === 'html' ? 'markup' : 'markdown'
      const grammar = languages[language]
      const highlighted = grammar
        ? highlight(highlightValue, grammar, language)
        : escapeRichTextHtml(highlightValue)
      sourceHighlightCacheRef.current = { value: highlightValue, highlighted }
      bumpSourceHighlight((current) => current + 1)
    }

    if (typeof idleWindow.requestIdleCallback === 'function') {
      sourceHighlightTaskRef.current = {
        kind: 'idle',
        handle: idleWindow.requestIdleCallback(renderHighlight, { timeout: SOURCE_HIGHLIGHT_TIMEOUT }),
      }
    } else {
      sourceHighlightTaskRef.current = {
        kind: 'timeout',
        handle: window.setTimeout(renderHighlight, 0),
      }
    }

    return () => {
      const task = sourceHighlightTaskRef.current
      if (!task) return
      if (task.kind === 'idle') idleWindow.cancelIdleCallback?.(task.handle)
      else window.clearTimeout(task.handle)
      sourceHighlightTaskRef.current = null
    }
  }, [mode, sourceDraftValue])

  const highlightSource = useCallback((source: string) => {
    const cached = sourceHighlightCacheRef.current
    if (cached?.value === source) return cached.highlighted
    // Prism runs from the idle task above. During a burst, keep the overlay's
    // geometry current with a cheap escaped copy instead of blocking the input
    // event on a full-document tokenization pass.
    return escapeRichTextHtml(source)
  }, [])

  useLayoutEffect(() => () => {
    pendingVisualFlushRef.current?.()
    flushVisualValue()
  }, [flushVisualValue])

  useEffect(() => {
    if (contextMenu) {
      if (contextMenuExitTimerRef.current !== null) {
        window.clearTimeout(contextMenuExitTimerRef.current)
        contextMenuExitTimerRef.current = null
      }
      setDisplayedContextMenu(contextMenu)
      setContextMenuExiting(false)
      return undefined
    }
    if (!displayedContextMenu) return undefined
    setContextMenuExiting(true)
    contextMenuExitTimerRef.current = window.setTimeout(() => {
      contextMenuExitTimerRef.current = null
      setDisplayedContextMenu(null)
      setContextMenuExiting(false)
    }, getMotionDelay(160))
    return () => {
      if (contextMenuExitTimerRef.current === null) return
      window.clearTimeout(contextMenuExitTimerRef.current)
      contextMenuExitTimerRef.current = null
    }
  }, [contextMenu, displayedContextMenu])

  useEffect(() => {
    if (!contextMenu) return undefined
    const close = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setContextMenu(null)
    }
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    const closeMenu = () => setContextMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnKey)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnKey)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!sourceCompletionMenu || typeof document === 'undefined') return
    document
      .getElementById(`${sourceSuggestionListId}-${sourceCompletionMenu.items[sourceCompletionMenu.activeIndex]?.id}`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [sourceCompletionMenu, sourceSuggestionListId])

  useEffect(() => {
    if (!sourceCompletionOpen || typeof document === 'undefined') return undefined
    const closeOnResize = () => setSourceCompletionMenu(null)
    const closeOnScroll = (event: Event) => {
      const list = document.getElementById(sourceSuggestionListId)
      if (event.target instanceof Node && list?.contains(event.target)) return
      setSourceCompletionMenu(null)
    }
    window.addEventListener('resize', closeOnResize)
    window.addEventListener('scroll', closeOnScroll, true)
    return () => {
      window.removeEventListener('resize', closeOnResize)
      window.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [sourceCompletionOpen, sourceSuggestionListId])

  useEffect(() => {
    if (!autoFocus) return
    window.requestAnimationFrame(() => {
      if (mode === 'visual') editorRef.current?.focus(undefined, { defaultSelection: 'rootEnd' })
      else sourceRef.current?.focus()
    })
  }, [autoFocus, mode])

  const switchMode = (nextMode: EditorMode) => {
    if (nextMode === mode) return
    setContextMenu(null)
    setSourceCompletionMenu(null)
    if (nextMode === 'source') {
      flushVisualValue()
      sourceDraftValueRef.current = valueRef.current
      setSourceDraftValue(valueRef.current)
    }
    else {
      flushSourceChange(true)
      visualSyncValueRef.current = valueRef.current
      updateSourceFormat(formatForValue(valueRef.current))
      setSyncToken((current) => current + 1)
    }
    setMode(nextMode)
    window.requestAnimationFrame(() => {
      if (nextMode === 'visual') editorRef.current?.focus(undefined, { defaultSelection: 'rootEnd' })
      else {
        sourceRef.current?.focus()
        sourceRef.current?.setSelectionRange(sourceRef.current.value.length, sourceRef.current.value.length)
      }
    })
  }

  const applySourceFormatting = useCallback((action: FormatAction) => {
    const source = sourceRef.current
    if (!source || disabled || readOnly) return
    flushSourceChange(true)
    const currentValue = valueRef.current
    const start = source.selectionStart ?? currentValue.length
    const end = source.selectionEnd ?? start
    const selected = currentValue.slice(start, end)
    let nextValue = currentValue
    let nextStart = start
    let nextEnd = end
    const wrapper = sourceWrapper(action)

    if (wrapper) {
      const [before, after] = wrapper
      const toggled = toggleSourceWrapper(currentValue, start, end, before, after)
      nextValue = toggled.value
      nextStart = toggled.start
      nextEnd = toggled.end
    } else if (action === 'bulletList' || action === 'numberedList' || action === 'quote') {
      const toggled = toggleSourceLinePrefix(currentValue, start, end, action)
      nextValue = toggled.value
      nextStart = toggled.start
      nextEnd = toggled.end
    } else if (action === 'clear') {
      const cleaned = selected
        .replace(/(\*\*|__|~~|\+\+|`{1,3})/g, '')
        .replace(/^\s*(?:[-*+]\s+|\d+\.\s+|>\s?)/gm, '')
      nextValue = currentValue.slice(0, start) + cleaned + currentValue.slice(end)
      nextEnd = start + cleaned.length
    }

    if (nextValue === currentValue) return
    if (typeof maxLength === 'number' && nextValue.length > maxLength) return
    recordSourceHistory(
      currentValue,
      nextValue,
      start,
      end,
      nextStart,
      nextEnd,
    )
    lastFormattedSourceRef.current = ''
    visualSyncValueRef.current = nextValue
    updateSourceFormat(sourceFormatForValue(nextValue))
    sourceDraftValueRef.current = nextValue
    setSourceDraftValue(nextValue)
    emitChange(nextValue)
    scheduleSourceCompletions(nextValue)
    window.requestAnimationFrame(() => {
      const activeSource = sourceRef.current
      if (!activeSource) return
      activeSource.focus()
      activeSource.setSelectionRange(nextStart, nextEnd)
    })
  }, [disabled, emitChange, flushSourceChange, maxLength, readOnly, recordSourceHistory, scheduleSourceCompletions, updateSourceFormat])

  const runVisualCommand = useCallback((action: FormatAction) => {
    const editor = editorRef.current
    if (!editor || disabled || readOnly) return
    if (action === 'bold' || action === 'italic' || action === 'underline' || action === 'strike') {
      const format: TextFormatType = action === 'strike' ? 'strikethrough' : action
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
    } else if (action === 'bulletList') {
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
    } else if (action === 'numberedList') {
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
    } else {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        if (action === 'quote') $setBlocksType(selection, () => $createQuoteNode())
        else if (action === 'code') $setBlocksType(selection, () => $createCodeNode())
        else if (action === 'clear') {
          $setBlocksType(selection, () => $createParagraphNode())
          selection.getNodes().forEach((node) => {
            if ($isTextNode(node)) node.setFormat(0)
          })
        }
      })
    }
    editor.focus()
  }, [disabled, readOnly])

  const applyFormatting = useCallback((action: FormatAction) => {
    setContextMenu(null)
    if (mode === 'source') applySourceFormatting(action)
    else runVisualCommand(action)
  }, [applySourceFormatting, mode, runVisualCommand])

  const handleShortcut = useCallback((event: ReactKeyboardEvent<HTMLElement | HTMLTextAreaElement>) => {
    const modifier = usesPrimaryShortcutModifier(event)
    if (!modifier || event.altKey) return false
    const key = event.key.toLowerCase()
    const code = event.code
    let action: FormatAction | null = null
    if (!event.shiftKey && key === 'b') action = 'bold'
    else if (!event.shiftKey && key === 'i') action = 'italic'
    else if (!event.shiftKey && key === 'u') action = 'underline'
    else if (event.shiftKey && key === 'x') action = 'strike'
    else if (event.shiftKey && (key === '7' || code === 'Digit7')) action = 'numberedList'
    else if (event.shiftKey && (key === '8' || code === 'Digit8')) action = 'bulletList'
    if (!action) return false
    event.preventDefault()
    applyFormatting(action)
    return true
  }, [applyFormatting])

  const handleSourceKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.nativeEvent.isComposing) return
    if (
      usesPrimaryShortcutModifier(event)
      && !event.altKey
      && (event.key === ' ' || event.code === 'Space')
    ) {
      event.preventDefault()
      refreshSourceCompletions(valueRef.current, true)
      return
    }

    if (sourceCompletionMenu) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setSourceCompletionMenu((current) => {
          if (!current) return null
          const nextIndex = (current.activeIndex + direction + current.items.length) % current.items.length
          return { ...current, activeIndex: nextIndex }
        })
        return
      }
      if ((event.key === 'Tab' && !event.shiftKey) || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        acceptSourceCompletion()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSourceCompletionMenu(null)
        return
      }
    }

    if (
      event.key === '>'
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && event.currentTarget.selectionStart === event.currentTarget.selectionEnd
    ) {
      const caret = event.currentTarget.selectionStart ?? valueRef.current.length
      const edit = getHtmlAutoCloseEdit(valueRef.current, caret)
      if (edit) {
        event.preventDefault()
        applySourceEdit(caret, caret, edit.insertText, edit.caretOffset)
        return
      }
    }

    handleShortcut(event)
  }

  const handleVisualKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event as unknown as ReactKeyboardEvent<HTMLTextAreaElement>)
    if (event.defaultPrevented) return
    if (event.key === 'Tab') {
      event.preventDefault()
      editorRef.current?.dispatchCommand(event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND, undefined)
      return
    }
    handleShortcut(event)
  }, [handleShortcut, onKeyDown])

  const handleVisualContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    onContextMenu?.(event as unknown as ReactMouseEvent<HTMLTextAreaElement>)
    if (event.defaultPrevented || disabled) return
    event.preventDefault()
    const menuWidth = 244
    const menuHeight = 430
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    })
  }, [disabled, onContextMenu])

  const handleVisualInput = useCallback((event: React.FormEvent<HTMLDivElement>) => {
    onInput?.(event as unknown as Parameters<NonNullable<typeof onInput>>[0])
  }, [onInput])

  const handleVisualClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    editorRef.current?.focus()
  }, [])

  const handleVisualFocus = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    onFocus?.(event as unknown as ReactFocusEvent<HTMLTextAreaElement>)
  }, [onFocus])

  const handleVisualBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    flushVisualValue()
    onBlur?.(event as unknown as ReactFocusEvent<HTMLTextAreaElement>)
  }, [flushVisualValue, onBlur])

  const handleVisualPaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    onPaste?.(event as unknown as ReactClipboardEvent<HTMLTextAreaElement>)
  }, [onPaste])

  const handleLexicalReady = useCallback((editor: LexicalEditor | null) => {
    editorRef.current = editor
  }, [])

  const handleSourceChange = (nextValue: string) => {
    const source = sourceRef.current
    if (!source) return
    const nextFormat = sourceFormatForInput(
      nextValue,
      formatRef.current,
      source.selectionStart ?? nextValue.length,
    )
    sourceDraftValueRef.current = nextValue
    recentSourceValuesRef.current = [...recentSourceValuesRef.current.slice(-23), nextValue]
    setSourceDraftValue(nextValue)
    updateSourceFormat(nextFormat)
    setSourceFormatError(false)
    lastFormattedSourceRef.current = ''
    visualSyncValueRef.current = nextValue
    valueRef.current = nextValue
    queueSourceChange(nextValue)
    const caret = source.selectionStart ?? nextValue.length
    if (sourceCompletionMenu || sourceCompletionTrigger(nextValue, caret)) {
      scheduleSourceCompletions(nextValue)
    }
    // Programmatic/test change events do not necessarily focus the native
    // textarea first. Preserve the controlled-field contract for those paths;
    // real typing stays on the local fast path while the source has focus.
    if (typeof document === 'undefined' || document.activeElement !== source) {
      flushSourceChange(true)
    }
  }

  const handleSourceFocus = (event: ReactFocusEvent<HTMLTextAreaElement>) => {
    onFocus?.(event)
    if (!event.defaultPrevented) void runSourceFormatter(valueRef.current)
  }

  const handleSourceBlur = (event: ReactFocusEvent<HTMLTextAreaElement>) => {
    flushSourceChange(true)
    onBlur?.(event)
    setSourceCompletionMenu(null)
    void runSourceFormatter(valueRef.current)
  }

  const contentMinHeight = Math.max(56, Number(rows) * 21 + 18)
  const editorStyle = {
    ...style,
    '--markdown-editor-content-min-height': `${contentMinHeight}px`,
    '--markdown-editor-min-height': `${contentMinHeight}px`,
  } as CSSProperties
  const renderedValue = mode === 'source' ? sourceDraftValue : value
  const sourceDisplayFormat = mode === 'source' ? formatRef.current : sourceFormatForValue(value)
  const formatLabel = sourceDisplayFormat === 'html' ? tx('markdown.html') : tx('markdown.markdown')
  const sourceLabel = mode === 'visual' ? tx('markdown.showSource') : tx('markdown.showRendered')
  const SourceIcon = mode === 'visual' ? Braces : Eye
  const sourceId = mode === 'source' ? id : id ? `${id}-source` : undefined
  const visualId = mode === 'visual' ? id : id ? `${id}-visual` : undefined
  const needsFidelityPreview = mode === 'visual' && richTextNeedsFidelityPreview(renderedValue, sourceDisplayFormat)
  const editable = mode === 'visual' && !disabled && !readOnly && !needsFidelityPreview
  const sourceStatusMessage = sourceFormatting
    ? tx('markdown.formattingSource')
    : sourceFormatError
      ? tx('markdown.formatSourceFailed')
      : ''
  const sourceFormatActionLabel = [
    tx('markdown.formatSource'),
    formatLabel,
    sourceFormatError ? tx('markdown.formatSourceFailed') : '',
  ].filter(Boolean).join(' · ')
  const visualAriaDescribedBy = textareaProps['aria-describedby']
  const visualSpellCheck = textareaProps.spellCheck

  const visualEditorLayer = useMemo(() => (
    <div
      className={`markdown-lexical-layer ${needsFidelityPreview ? 'is-fidelity-hidden' : ''} ${previewClassName}`.trim()}
      aria-hidden={mode !== 'visual' || needsFidelityPreview}
    >
      <LexicalComposer initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={(
            <ContentEditable
              id={visualId}
              aria-label={sourceAriaLabel}
              aria-labelledby={sourceAriaLabelledBy}
              aria-describedby={visualAriaDescribedBy}
              aria-invalid={sourceAriaInvalid}
              aria-required={sourceRequired}
              aria-readonly={readOnly}
              aria-disabled={disabled}
              aria-placeholder={placeholder ?? ''}
              placeholder={<span className="markdown-editor-placeholder">{placeholder ?? ''}</span>}
              spellCheck={visualSpellCheck}
              tabIndex={mode === 'visual' && !needsFidelityPreview ? tabIndex ?? 0 : -1}
              onInput={handleVisualInput}
              onClick={handleVisualClick}
              onKeyDown={handleVisualKeyDown}
              onFocus={handleVisualFocus}
              onBlur={handleVisualBlur}
              onPaste={handleVisualPaste}
              onContextMenu={handleVisualContextMenu}
            />
          )}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin delay={420} />
        <ListPlugin hasStrictIndent shouldPreserveNumbering />
        <LinkPlugin validateUrl={(url) => Boolean(safeMarkdownHref(url))} attributes={{ target: '_blank', rel: 'noopener noreferrer' }} />
        <MarkdownShortcutPlugin transformers={EDITOR_TRANSFORMERS} />
        <MarkdownHardBreakPlugin formatRef={formatRef} />
        <PasteFormattingPlugin
          onDetectedFormat={updateSourceFormat}
          preservePlainLineBreaks={preservePlainLineBreaks}
        />
        <MaxLengthPlugin maxLength={maxLength} />
        <EditableStatePlugin editable={editable} />
        <ExternalValuePlugin
          value={value}
          mode={mode}
          preservePlainLineBreaks={preservePlainLineBreaks}
          recentVisualValuesRef={recentVisualValuesRef}
          syncToken={syncToken}
          formatRef={formatRef}
          lastEmittedValueRef={lastEmittedValueRef}
          visualDirtyRef={visualDirtyRef}
          visualSyncValueRef={visualSyncValueRef}
        />
        <BufferedOnChangePlugin
          emitValue={emitVisualChange}
          formatRef={formatRef}
          lastEmittedValueRef={lastEmittedValueRef}
          pendingFlushRef={pendingVisualFlushRef}
          valueRef={valueRef}
          visualDirtyRef={visualDirtyRef}
        />
        <LexicalBridgePlugin onReady={handleLexicalReady} />
      </LexicalComposer>
    </div>
  ), [
    disabled,
    editable,
    emitVisualChange,
    handleLexicalReady,
    handleVisualBlur,
    handleVisualClick,
    handleVisualContextMenu,
    handleVisualFocus,
    handleVisualInput,
    handleVisualKeyDown,
    handleVisualPaste,
    initialConfig,
    maxLength,
    mode,
    needsFidelityPreview,
    placeholder,
    preservePlainLineBreaks,
    previewClassName,
    readOnly,
    sourceAriaInvalid,
    sourceAriaLabel,
    sourceAriaLabelledBy,
    sourceRequired,
    syncToken,
    tabIndex,
    visualAriaDescribedBy,
    visualSpellCheck,
    updateSourceFormat,
    value,
    visualId,
  ])

  const contextMenuPortal = displayedContextMenu && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={menuRef}
        className={`markdown-context-menu ${contextMenuExiting ? 'exiting' : ''}`}
        role="menu"
        aria-label={tx('markdown.formattingMenu')}
        style={{ left: displayedContextMenu.x, top: displayedContextMenu.y }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <div className="markdown-context-menu-heading">{tx('markdown.formatting')}</div>
        {formatMenuItems.map((item) => {
          const Icon = item.icon
          const shortcut = formatMenuShortcut(item, isMac)
          return (
            <button key={item.action} type="button" role="menuitem" onClick={() => applyFormatting(item.action)}>
              <Icon size={14} aria-hidden="true" />
              <span>{tx(item.labelKey)}</span>
              {shortcut ? <kbd>{shortcut}</kbd> : null}
            </button>
          )
        })}
        <div className="markdown-context-menu-divider" role="separator" />
        <button type="button" role="menuitem" onClick={() => switchMode('source')}>
          <Braces size={14} aria-hidden="true" />
          <span>{tx('markdown.showSource')}</span>
          <em>{formatLabel}</em>
        </button>
      </div>,
      document.body,
    )
    : null

  const completionKindLabel = (kind: SourceCompletionKind) => {
    if (kind === 'element') return tx('markdown.sourceSuggestionElement')
    if (kind === 'attribute') return tx('markdown.sourceSuggestionAttribute')
    return tx('markdown.sourceSuggestionSnippet')
  }

  const sourceCompletionPortal = sourceCompletionMenu && mode === 'source' && typeof document !== 'undefined'
    ? createPortal(
      <div
        id={sourceSuggestionListId}
        className="markdown-source-suggestions"
        role="listbox"
        aria-label={tx('markdown.sourceSuggestions')}
        style={{
          left: sourceCompletionMenu.left,
          top: sourceCompletionMenu.top,
          width: sourceCompletionMenu.width,
        }}
      >
        <div className="markdown-source-suggestion-scroll">
          {sourceCompletionMenu.items.map((item, index) => {
            const selected = sourceCompletionMenu.activeIndex === index
            const kindMark = item.kind === 'element' ? '<>' : item.kind === 'attribute' ? '@' : 'MD'
            return (
              <button
                key={item.id}
                id={`${sourceSuggestionListId}-${item.id}`}
                type="button"
                role="option"
                aria-selected={selected}
                className={`markdown-source-suggestion ${selected ? 'is-active' : ''}`}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => {
                  if (!selected) {
                    setSourceCompletionMenu((current) => current ? { ...current, activeIndex: index } : null)
                  }
                }}
                onClick={() => acceptSourceCompletion(index)}
              >
                <span className={`markdown-source-suggestion-kind is-${item.kind}`} aria-hidden="true">
                  {kindMark}
                </span>
                <span className="markdown-source-suggestion-copy">
                  <code>{item.label}</code>
                  <small>{item.detail}</small>
                </span>
                <span className="sr-only">{completionKindLabel(item.kind)}</span>
              </button>
            )
          })}
        </div>
        <div className="markdown-source-suggestion-hint" aria-hidden="true">
          {tx('markdown.sourceSuggestionHint')}
        </div>
      </div>,
      document.body,
    )
    : null

  return (
    <div
      className={`markdown-textarea ${mode}-mode ${disabled ? 'is-disabled' : ''} ${readOnly ? 'is-readonly' : ''} ${sourceFormatError ? 'has-source-format-error' : ''} ${className}`.trim()}
      data-format={sourceDisplayFormat}
      style={editorStyle}
      onClick={(event) => {
        // A Markdown editor is often placed inside a visual field label. A
        // label's default activation must not turn a click on editor chrome
        // or blank editor space into a click on the first toolbar button.
        const target = event.target instanceof Element ? event.target : null
        if (event.currentTarget.closest('label') && !target?.closest('button, a, input, textarea, select, [contenteditable="true"]')) {
          event.preventDefault()
        }
      }}
    >
      <div className="markdown-mode-toolbar" role="toolbar" aria-label={tx('markdown.viewMode')}>
        {mode === 'source' ? (
          <>
            <span className="markdown-source-language" title={formatLabel} aria-hidden="true">
              <span />
              {sourceDisplayFormat === 'html' ? 'HTML' : 'MD'}
            </span>
            <button
              type="button"
              className="markdown-format-source"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { void runSourceFormatter(valueRef.current, true) }}
              aria-label={sourceFormatActionLabel}
              title={sourceFormatActionLabel}
              disabled={disabled || readOnly || sourceFormatting || !renderedValue.trim()}
            >
              {sourceFormatting
                ? <LoaderCircle className="markdown-format-spinner" size={14} aria-hidden="true" />
                : <AlignLeft size={14} aria-hidden="true" />}
              <span className="sr-only">{tx('markdown.formatSource')}</span>
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="markdown-mode-toggle"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => switchMode(mode === 'visual' ? 'source' : 'visual')}
          aria-label={`${sourceLabel} · ${formatLabel}`}
          title={`${sourceLabel} · ${formatLabel}`}
          disabled={disabled}
        >
          <SourceIcon size={14} aria-hidden="true" />
          <span className="sr-only">{sourceLabel}</span>
        </button>
      </div>

      <div className="markdown-editor-stage">
        <div
          ref={sourceHostRef}
          className="markdown-source-layer"
          aria-hidden={mode !== 'source'}
          onPaste={(event) => {
            if (event.target instanceof HTMLTextAreaElement) {
              onPaste?.(event as unknown as ReactClipboardEvent<HTMLTextAreaElement>)
            }
          }}
          onContextMenu={(event) => {
            if (event.target instanceof HTMLTextAreaElement) {
              onContextMenu?.(event as unknown as ReactMouseEvent<HTMLTextAreaElement>)
            }
          }}
          onInput={(event) => {
            if (event.target instanceof HTMLTextAreaElement) {
              onInput?.(event as unknown as Parameters<NonNullable<typeof onInput>>[0])
            }
          }}
        >
          <Editor
            ref={sourceEditorRef}
            className="markdown-source-editor"
            textareaId={sourceId}
            textareaClassName="markdown-source-input"
            preClassName="markdown-source-highlight"
            value={sourceDraftValue}
            highlight={highlightSource}
            onValueChange={handleSourceChange}
            padding={{ top: 10, right: 116, bottom: 10, left: 12 }}
            tabSize={2}
            insertSpaces
            maxLength={maxLength}
            minLength={textareaProps.minLength}
            name={textareaProps.name}
            form={textareaProps.form}
            required={textareaProps.required}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={placeholder}
            autoFocus={autoFocus && mode === 'source'}
            onKeyDown={(event) => {
              handleSourceKeyDown(event as unknown as ReactKeyboardEvent<HTMLTextAreaElement>)
            }}
            onKeyUp={(event) => {
              if (
                event.key === 'ArrowDown'
                || event.key === 'ArrowUp'
                || event.key === 'ArrowLeft'
                || event.key === 'ArrowRight'
                || event.key === 'Home'
                || event.key === 'End'
                || event.key === 'PageUp'
                || event.key === 'PageDown'
                || event.key === 'Tab'
                || event.shiftKey
              ) {
                scheduleSourceCompletions(valueRef.current)
              }
            }}
            onClick={() => scheduleSourceCompletions(valueRef.current)}
            onScroll={() => setSourceCompletionMenu(null)}
            onFocus={(event) => {
              handleSourceFocus(event as unknown as ReactFocusEvent<HTMLTextAreaElement>)
            }}
            onBlur={(event) => {
              handleSourceBlur(event as unknown as ReactFocusEvent<HTMLTextAreaElement>)
            }}
          />
        </div>

        {visualEditorLayer}
        {needsFidelityPreview ? (
          <div
            className={`markdown-fidelity-layer ${previewClassName}`.trim()}
            aria-hidden={mode !== 'visual'}
          >
            <MarkdownContent value={renderedValue} format={sourceDisplayFormat} />
          </div>
        ) : null}
      </div>
      <span id={sourceStatusId} className="sr-only" role="status" aria-live="polite">
        {sourceStatusMessage}
      </span>
      {contextMenuPortal}
      {sourceCompletionPortal}
    </div>
  )
})
