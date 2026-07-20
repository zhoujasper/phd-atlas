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
import {
  $applyNodeReplacement,
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  DecoratorNode,
  FORMAT_TEXT_COMMAND,
  INDENT_CONTENT_COMMAND,
  INSERT_LINE_BREAK_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  PASTE_COMMAND,
  type EditorConfig,
  type EditorState,
  type EditorThemeClasses,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type TextFormatType,
} from 'lexical'
import {
  Bold,
  Braces,
  Code2,
  Eraser,
  Eye,
  Italic,
  List as ListIcon,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
  type LucideIcon,
} from 'lucide-react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { safeMarkdownHref } from '../../safeLinks'
import { useI18n } from '../hooks/useI18n'
import {
  detectRichTextFormat,
  sanitizeRichHtml,
  type RichTextFormat,
} from './richText'

type EditorMode = 'visual' | 'source'
type FormatAction = 'bold' | 'italic' | 'underline' | 'strike' | 'bulletList' | 'numberedList' | 'quote' | 'code' | 'clear'
type SourceFormat = Exclude<RichTextFormat, 'plain'>

export type MarkdownTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  previewClassName?: string
  defaultMode?: EditorMode
}

type ContextMenuState = {
  x: number
  y: number
}

type FormatMenuItem = {
  action: FormatAction
  icon: LucideIcon
  labelKey: string
  shortcut?: string
}

type EditorSyncProps = {
  formatRef: React.MutableRefObject<SourceFormat>
  lastEmittedValueRef: React.MutableRefObject<string | null>
  mode: EditorMode
  recentVisualValuesRef: React.MutableRefObject<string[]>
  syncToken: number
  value: string
  visualDirtyRef: React.MutableRefObject<boolean>
  visualSyncValueRef: React.MutableRefObject<string>
}

const EXTERNAL_SYNC_TAG = 'phd-atlas-external-rich-text-sync'
const MAX_LENGTH_RESTORE_TAG = 'phd-atlas-rich-text-length-restore'
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
  { action: 'strike', icon: Strikethrough, labelKey: 'markdown.strikethrough', shortcut: '⇧X' },
  { action: 'bulletList', icon: ListIcon, labelKey: 'markdown.bulletList', shortcut: '⇧8' },
  { action: 'numberedList', icon: ListOrdered, labelKey: 'markdown.numberedList', shortcut: '⇧7' },
  { action: 'quote', icon: Quote, labelKey: 'markdown.quote' },
  { action: 'code', icon: Code2, labelKey: 'markdown.code' },
  { action: 'clear', icon: Eraser, labelKey: 'markdown.clearFormatting' },
]

function isMacPlatform() {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function formatForValue(value: string): SourceFormat {
  return detectRichTextFormat(value) === 'html' ? 'html' : 'markdown'
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

function $replaceEditorValue(editor: LexicalEditor, value: string, format: SourceFormat) {
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
    $convertFromMarkdownString(value, EDITOR_TRANSFORMERS, root, false, true)
  }

  if (root.getChildrenSize() === 0) root.append($createParagraphNode())
}

function serializeEditorState(editorState: EditorState, editor: LexicalEditor, format: SourceFormat) {
  return editorState.read(() => {
    if (format === 'html') return sanitizeRichHtml($generateHtmlFromNodes(editor))
    return $convertToMarkdownString(EDITOR_TRANSFORMERS, undefined, false)
  }, { editor })
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
    if (!enteringVisual && !forced) {
      if (lastEmittedValueRef.current === value || recentVisualValuesRef.current.includes(value)) return
    }

    const nextValue = enteringVisual || forced ? visualSyncValueRef.current : value
    const format = formatForValue(nextValue)
    formatRef.current = format
    visualDirtyRef.current = false
    editor.update(() => $replaceEditorValue(editor, nextValue, format), { tag: EXTERNAL_SYNC_TAG })
  }, [editor, formatRef, lastEmittedValueRef, mode, recentVisualValuesRef, syncToken, value, visualDirtyRef, visualSyncValueRef])

  return null
}

function BufferedOnChangePlugin({
  emitValue,
  formatRef,
  lastEmittedValueRef,
  valueRef,
  visualDirtyRef,
}: {
  emitValue: (value: string) => void
  formatRef: React.MutableRefObject<SourceFormat>
  lastEmittedValueRef: React.MutableRefObject<string | null>
  valueRef: React.MutableRefObject<string>
  visualDirtyRef: React.MutableRefObject<boolean>
}) {
  const timeoutRef = useRef<number | null>(null)
  const pendingRef = useRef<{ editor: LexicalEditor; editorState: EditorState } | null>(null)

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
  }, [])

  const onEditorChange = useCallback((editorState: EditorState, editor: LexicalEditor, tags: Set<string>) => {
    if (tags.has(EXTERNAL_SYNC_TAG) || tags.has(MAX_LENGTH_RESTORE_TAG)) return
    visualDirtyRef.current = true
    pendingRef.current = { editor, editorState }
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    const delay = valueRef.current.length > 12_000 ? 220 : 48
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null
      const pending = pendingRef.current
      pendingRef.current = null
      if (!pending || !visualDirtyRef.current) return
      const nextValue = serializeEditorState(pending.editorState, pending.editor, formatRef.current)
      visualDirtyRef.current = false
      if (nextValue === valueRef.current || nextValue === lastEmittedValueRef.current) return
      emitValue(nextValue)
    }, delay)
  }, [emitValue, formatRef, lastEmittedValueRef, valueRef, visualDirtyRef])

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

function PasteFormattingPlugin({ onDetectedFormat }: { onDetectedFormat: (format: SourceFormat) => void }) {
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
        insertImportedNodes($generateNodesFromMarkdownString(sourceText, EDITOR_TRANSFORMERS, false, true))
        onDetectedFormat('markdown')
      }
      return true
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor, onDetectedFormat])

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

export const MarkdownTextarea = forwardRef<HTMLTextAreaElement, MarkdownTextareaProps>(function MarkdownTextarea(
  {
    value,
    onChange,
    className = '',
    previewClassName = '',
    defaultMode = 'visual',
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
  const initialValueRef = useRef(value)
  const initialFormatRef = useRef<SourceFormat>(formatForValue(value))
  const [mode, setMode] = useState<EditorMode>(defaultMode)
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>(initialFormatRef.current)
  const [syncToken, setSyncToken] = useState(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [displayedContextMenu, setDisplayedContextMenu] = useState<ContextMenuState | null>(null)
  const [contextMenuExiting, setContextMenuExiting] = useState(false)
  const sourceRef = useRef<HTMLTextAreaElement | null>(null)
  const editorRef = useRef<LexicalEditor | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const contextMenuExitTimerRef = useRef<number | null>(null)
  const formatRef = useRef<SourceFormat>(initialFormatRef.current)
  const lastEmittedValueRef = useRef<string | null>(null)
  const recentVisualValuesRef = useRef<string[]>([])
  const visualDirtyRef = useRef(false)
  const visualSyncValueRef = useRef(value)
  const valueRef = useRef(value)
  valueRef.current = value
  const shortcutPrefix = isMacPlatform() ? '⌘' : 'Ctrl+'

  const initialConfig = useMemo(() => ({
    namespace: `phd-atlas-rich-text-${editorId}`,
    editable: defaultMode === 'visual' && !disabled && !readOnly,
    theme: lexicalTheme,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode, MarkdownHardBreakNode],
    onError: (error: Error) => { throw error },
    editorState: (editor: LexicalEditor) => {
      $replaceEditorValue(editor, initialValueRef.current, initialFormatRef.current)
    },
  }), [defaultMode, disabled, editorId, readOnly])

  const setSourceRef = useCallback((node: HTMLTextAreaElement | null) => {
    sourceRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }, [forwardedRef])

  const emitChange = useCallback((nextValue: string) => {
    const source = sourceRef.current
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

  const updateSourceFormat = useCallback((format: SourceFormat) => {
    formatRef.current = format
    setSourceFormat(format)
  }, [])

  const flushVisualValue = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !visualDirtyRef.current) return valueRef.current
    const nextValue = serializeEditorState(editor.getEditorState(), editor, formatRef.current)
    visualDirtyRef.current = false
    if (nextValue !== valueRef.current) emitVisualChange(nextValue)
    return nextValue
  }, [emitVisualChange])

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
    if (!autoFocus) return
    window.requestAnimationFrame(() => {
      if (mode === 'visual') editorRef.current?.focus(undefined, { defaultSelection: 'rootEnd' })
      else sourceRef.current?.focus()
    })
  }, [autoFocus, mode])

  const switchMode = (nextMode: EditorMode) => {
    if (nextMode === mode) return
    setContextMenu(null)
    if (nextMode === 'source') flushVisualValue()
    else {
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

  const applySourceFormatting = (action: FormatAction) => {
    const source = sourceRef.current
    if (!source || disabled || readOnly) return
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
      nextValue = currentValue.slice(0, start) + before + selected + after + currentValue.slice(end)
      nextStart = start + before.length
      nextEnd = nextStart + selected.length
    } else if (action === 'bulletList' || action === 'numberedList' || action === 'quote') {
      const lineStart = currentValue.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      const nextLine = currentValue.indexOf('\n', end)
      const lineEnd = nextLine === -1 ? currentValue.length : nextLine
      const block = currentValue.slice(lineStart, lineEnd)
      const formatted = block.split('\n').map((line, index) => {
        if (action === 'bulletList') return `- ${line.replace(/^\s*[-*+]\s+/, '')}`
        if (action === 'numberedList') return `${index + 1}. ${line.replace(/^\s*\d+\.\s+/, '')}`
        return `> ${line.replace(/^\s*>\s?/, '')}`
      }).join('\n')
      nextValue = currentValue.slice(0, lineStart) + formatted + currentValue.slice(lineEnd)
      nextStart = lineStart
      nextEnd = lineStart + formatted.length
    } else if (action === 'clear') {
      const cleaned = selected
        .replace(/(\*\*|__|~~|\+\+|`{1,3})/g, '')
        .replace(/^\s*(?:[-*+]\s+|\d+\.\s+|>\s?)/gm, '')
      nextValue = currentValue.slice(0, start) + cleaned + currentValue.slice(end)
      nextEnd = start + cleaned.length
    }

    emitChange(nextValue)
    window.requestAnimationFrame(() => {
      source.focus()
      source.setSelectionRange(nextStart, nextEnd)
    })
  }

  const applySourceTab = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const source = sourceRef.current
    if (!source) return
    event.preventDefault()
    const currentValue = valueRef.current
    const start = source.selectionStart ?? currentValue.length
    const end = source.selectionEnd ?? start
    const lineStart = currentValue.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const nextLine = currentValue.indexOf('\n', end)
    const lineEnd = nextLine === -1 ? currentValue.length : nextLine
    const selectedBlock = currentValue.slice(lineStart, lineEnd)

    if (!event.shiftKey && start === end && !selectedBlock.includes('\n')) {
      const nextValue = currentValue.slice(0, start) + '  ' + currentValue.slice(end)
      emitChange(nextValue)
      window.requestAnimationFrame(() => source.setSelectionRange(start + 2, start + 2))
      return
    }

    const lines = selectedBlock.split('\n')
    const formatted = lines.map((line) => event.shiftKey ? line.replace(/^ {1,2}/, '') : `  ${line}`).join('\n')
    const removed = selectedBlock.length - formatted.length
    const nextValue = currentValue.slice(0, lineStart) + formatted + currentValue.slice(lineEnd)
    emitChange(nextValue)
    window.requestAnimationFrame(() => {
      source.focus()
      source.setSelectionRange(
        event.shiftKey ? Math.max(lineStart, start - Math.min(2, start - lineStart)) : start + 2,
        event.shiftKey ? Math.max(lineStart, end - removed) : end + (2 * lines.length),
      )
    })
  }

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

  const applyFormatting = (action: FormatAction) => {
    setContextMenu(null)
    if (mode === 'source') applySourceFormatting(action)
    else runVisualCommand(action)
  }

  const handleShortcut = (event: ReactKeyboardEvent<HTMLElement | HTMLTextAreaElement>) => {
    const modifier = event.metaKey || event.ctrlKey
    if (!modifier || event.altKey) return false
    const key = event.key.toLowerCase()
    let action: FormatAction | null = null
    if (!event.shiftKey && key === 'b') action = 'bold'
    else if (!event.shiftKey && key === 'i') action = 'italic'
    else if (!event.shiftKey && key === 'u') action = 'underline'
    else if (event.shiftKey && key === 'x') action = 'strike'
    else if (event.shiftKey && key === '7') action = 'numberedList'
    else if (event.shiftKey && key === '8') action = 'bulletList'
    if (!action) return false
    event.preventDefault()
    applyFormatting(action)
    return true
  }

  const handleSourceKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === 'Tab') {
      applySourceTab(event)
      return
    }
    handleShortcut(event)
  }

  const handleVisualKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event as unknown as ReactKeyboardEvent<HTMLTextAreaElement>)
    if (event.defaultPrevented) return
    if (event.key === 'Tab') {
      event.preventDefault()
      editorRef.current?.dispatchCommand(event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND, undefined)
      return
    }
    handleShortcut(event)
  }

  const handleVisualContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    onContextMenu?.(event as unknown as ReactMouseEvent<HTMLTextAreaElement>)
    if (event.defaultPrevented || disabled) return
    event.preventDefault()
    const menuWidth = 244
    const menuHeight = 430
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    })
  }

  const handleSourceChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const detected = formatForValue(event.target.value)
    updateSourceFormat(detected)
    lastEmittedValueRef.current = mode === 'source' ? event.target.value : null
    visualSyncValueRef.current = event.target.value
    valueRef.current = event.target.value
    onChange(event)
  }

  const contentMinHeight = Math.max(56, Number(rows) * 21 + 18)
  const editorStyle = {
    ...style,
    '--markdown-editor-content-min-height': `${contentMinHeight}px`,
    '--markdown-editor-min-height': `${contentMinHeight}px`,
  } as CSSProperties
  const formatLabel = sourceFormat === 'html' ? tx('markdown.html') : tx('markdown.markdown')
  const sourceLabel = mode === 'visual' ? tx('markdown.showSource') : tx('markdown.showRendered')
  const SourceIcon = mode === 'visual' ? Braces : Eye
  const sourceId = mode === 'source' ? id : id ? `${id}-source` : undefined
  const visualId = mode === 'visual' ? id : id ? `${id}-visual` : undefined
  const editable = mode === 'visual' && !disabled && !readOnly

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
          const shortcut = item.shortcut ? `${shortcutPrefix}${item.shortcut}` : ''
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

  return (
    <div
      className={`markdown-textarea ${mode}-mode ${disabled ? 'is-disabled' : ''} ${readOnly ? 'is-readonly' : ''} ${className}`.trim()}
      data-format={sourceFormat}
      style={editorStyle}
    >
      <div className="markdown-mode-toolbar" role="toolbar" aria-label={tx('markdown.viewMode')}>
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
        <textarea
          {...textareaProps}
          ref={setSourceRef}
          id={sourceId}
          className="markdown-source-input"
          value={value}
          rows={rows}
          maxLength={maxLength}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder}
          autoFocus={autoFocus && mode === 'source'}
          tabIndex={mode === 'source' ? tabIndex : -1}
          aria-hidden={mode !== 'source'}
          onChange={handleSourceChange}
          onKeyDown={handleSourceKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          onPaste={onPaste}
          onContextMenu={onContextMenu}
          onInput={onInput}
        />

        <div className={`markdown-lexical-layer ${previewClassName}`.trim()} aria-hidden={mode !== 'visual'}>
          <LexicalComposer initialConfig={initialConfig}>
            <RichTextPlugin
              contentEditable={(
                <ContentEditable
                  id={visualId}
                  aria-label={textareaProps['aria-label'] ?? placeholder}
                  aria-labelledby={textareaProps['aria-labelledby']}
                  aria-describedby={textareaProps['aria-describedby']}
                  aria-invalid={textareaProps['aria-invalid']}
                  aria-required={textareaProps.required}
                  aria-readonly={readOnly}
                  aria-disabled={disabled}
                  aria-placeholder={placeholder ?? ''}
                  placeholder={<span className="markdown-editor-placeholder">{placeholder ?? ''}</span>}
                  spellCheck={textareaProps.spellCheck}
                  tabIndex={mode === 'visual' ? tabIndex ?? 0 : -1}
                  onInput={(event) => onInput?.(event as unknown as Parameters<NonNullable<typeof onInput>>[0])}
                  onClick={(event) => {
                    event.preventDefault()
                    editorRef.current?.focus()
                  }}
                  onKeyDown={handleVisualKeyDown}
                  onFocus={(event) => onFocus?.(event as unknown as ReactFocusEvent<HTMLTextAreaElement>)}
                  onBlur={(event) => {
                    flushVisualValue()
                    onBlur?.(event as unknown as ReactFocusEvent<HTMLTextAreaElement>)
                  }}
                  onPaste={(event) => onPaste?.(event as unknown as ReactClipboardEvent<HTMLTextAreaElement>)}
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
            <PasteFormattingPlugin onDetectedFormat={updateSourceFormat} />
            <MaxLengthPlugin maxLength={maxLength} />
            <EditableStatePlugin editable={editable} />
            <ExternalValuePlugin
              value={value}
              mode={mode}
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
              valueRef={valueRef}
              visualDirtyRef={visualDirtyRef}
            />
            <LexicalBridgePlugin onReady={(editor) => { editorRef.current = editor }} />
          </LexicalComposer>
        </div>
      </div>
      {contextMenuPortal}
    </div>
  )
})
