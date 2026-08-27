import '../../styles/dossier-collapsed.css'
import '../../styles/application-transfer.css'
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  ArrowUpRight,
  AtSign,
  Award,
  BadgeCheck,
  BadgeDollarSign,
  BadgeInfo,
  Bell,
  BellRing,
  BookMarked,
  BookOpen,
  BookOpenCheck,
  Bookmark,
  BookText,
  Brain,
  Briefcase,
  Building2,
  Calendar,
  ChartNoAxesColumn,
  ChartPie,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  CircleHelp,
  CircleUserRound,
  ClipboardList,
  Clock,
  Cloud,
  CloudUpload,
  Code,
  Columns2,
  Compass,
  Contact,
  Copy,
  Database,
  DoorOpen,
  Download,
  Earth,
  ExternalLink,
  Eye,
  FileCheck,
  FileClock,
  FileLock,
  FilePenLine,
  FileSearch,
  FileText,
  FileUp,
  Files,
  Flag,
  FolderOpen,
  Globe,
  GraduationCap,
  GripVertical,
  Handshake,
  Hash,
  HeartHandshake,
  Home,
  IdCard,
  Inbox,
  KeyRound,
  Landmark,
  Languages,
  Laptop,
  Layers,
  Library,
  Lightbulb,
  Link,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MailCheck,
  Map as LucideMap,
  MapPin,
  MapPinned,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Microscope,
  Network,
  Newspaper,
  NotebookTabs,
  PackageCheck,
  PanelTop,
  Paperclip,
  PenLine,
  Pencil,
  PencilLine,
  PhoneCall,
  Plane,
  Plus,
  Presentation,
  QrCode,
  Receipt,
  Reply,
  Route,
  Rows2,
  Save,
  School,
  Search,
  SearchCheck,
  Send,
  Settings,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Signature,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Stamp,
  Star,
  StickyNote,
  Tags,
  Target,
  Timer,
  Trash2,
  Trophy,
  Undo2,
  University,
  UploadCloud,
  User,
  UserCheck,
  UserRoundSearch,
  UsersRound,
  WalletCards,
  Waypoints,
  Wifi,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Fragment, memo, startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type SetStateAction } from 'react'
import { createPortal, flushSync } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
  type DropAnimationFunction,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ApiError, phdApi, type AiDraftAttachmentSelection, type AiDraftEvent, type AiDraftInput, type AiKey, type ApplicationRecommenderDecision, type AuthSession, type CommunicationAttachmentInput, type CommunicationInput, type CommunicationPatchInput, type CommunicationSendInput, type ProfileAsset, type TeamRole, type TeamTransferPreflight, type TeamWorkspaceOption } from '../../api/phdApi'
import type {
  ApplicationRecord,
  ApplicationStatus,
  MaterialRecommender,
  MaterialStatus,
  SharePermission,
} from '../../data/applications'
import {
  applicationStatusOrder,
  builtInApplicationStatuses,
} from '../../data/applications'
import { countReviewComments, reviewRepliesFor } from '../../reviewComments'
import type { DetailTab } from '../../appModel'
import { formatDate, today, daysUntil, deadlineUrgency, relativeTime, groupTimelineEvents, priorityToLevel, priorityTone, timelineDateStatus } from '../../appModel'
import { PrioritySlider } from '../shared/PrioritySlider'
import { AdmissionSignalsPanel } from '../shared/AdmissionSignalsPanel'
import { contentLanguagesFromSettings } from '../../contentLanguages'
import { normalizeErrorMessage } from '../../errorMessages'
import {
  MAX_APPLICATION_CORRESPONDENCE_EMAILS,
  additionalCorrespondenceEmails,
  applicationCorrespondenceEmails,
  isValidCorrespondenceEmail,
  normalizeCorrespondenceEmail,
} from '../../correspondenceRecipients'
import { formatList, localeForLanguage, localizeStaticText, t as translate, tpl, type Language } from '../../i18n'
import { materialStatusMenuTone, statusCssSlug, statusLabel, type StatusTone } from '../../statusLabels'
import { profileKindLabel } from '../../profileAssets'
import {
  materialRecommenderEmail,
  materialRecommenderPhone,
  normalizeRecommenderText,
} from '../../profileRecommenders'
import {
  effectiveMailCategories,
  hasManualMailCategory,
  mailCategoryOptions,
  customMailCategoryId,
  mailCategoryTonePalette,
  normalizedCustomMailCategories,
  MAX_CUSTOM_MAIL_CATEGORIES,
  MAX_CUSTOM_MAIL_CATEGORY_LABEL_LENGTH,
  type CustomMailCategory,
  resolveMailCategoryLabel,
  resolveMailCategoryTone,
  mailCategorySlug,
  mailConfidencePercent,
} from '../../mailClassification'
import {
  createDossierResourceCard,
  createDossierResourceField,
  dossierResourceCardWidths,
  dossierResourceColors,
  dossierResourceFieldTypes,
  dossierResourceFieldWidths,
  dossierResourceIconPresets,
  isDossierResourceFieldType,
  localizeDossierResourceCardTitle,
  localizeDossierResourceFieldLabel,
  mailtoHref,
  phoneHref,
  normalizeDossierResourceCardWidth,
  normalizeDossierResourceColor,
  normalizeDossierResourceFieldWidth,
  normalizeDossierResourceIcon,
  normalizeDossierResourceCards,
  normalizedExternalHref,
  preferredDossierResourceFieldWidth,
  resourceFieldSummary,
  resourceTags,
} from './dossierResourceModel'
import {
  resolveChecklistDrop,
  resolveChecklistPreviewPlacement,
  type ChecklistDragKind,
  type ChecklistDragRowMetric,
  type ChecklistGroupBoundary,
  type ChecklistGroupGeometry,
  type ChecklistDropPosition,
  type ChecklistDropTarget,
} from './checklistDragModel'
import type {
  DossierResourceCard,
  DossierResourceCardSettingsDraft,
  DossierResourceDefaultValues,
  DossierResourceField,
  DossierResourceFieldType,
} from './dossierResourceModel'
import {
  DEFAULT_UPLOAD_ALLOWED_TYPES,
  MAX_MAIL_ATTACHMENT_FILES,
  MAX_UPLOAD_FILE_SIZE,
  MAX_UPLOAD_FILES_PER_BATCH,
  filesRejectedForReason,
  formatFileSize,
  validateUploadFiles,
} from '../../fileUploads'
import {
  allowedFileTypesLabel,
  attachmentRows,
  buildUploadFileName,
  createRenamedFile,
  fileMatchesAllowedTypes,
  getUploadFileExtension,
  getUploadPresetSelection,
  normalizeUploadFileName,
  resolveUploadAllowedTypes,
  uploadOtherTypeId,
  uploadTypePresets,
} from '../../checklistFiles'
import { StatusPill, MaterialPill } from '../shared/StatusPill'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { ModalPortal } from '../shared/ModalPortal'
import { CopyButton } from '../shared/CopyButton'
import { DatePicker } from '../shared/DatePicker'
import { Select, type SelectCreateConfig } from '../shared/Select'
import { CountrySelect } from '../shared/CountrySelect'
import { useI18n } from '../hooks/useI18n'
import { getMotionDelay, useAnimatedClose } from '../hooks/useAnimatedClose'
import { hasExplorerSelectionModifier, useExplorerSelection } from '../hooks/useExplorerSelection'
import { useModalA11y } from '../hooks/useModalA11y'
import { CollapsiblePanel } from '../shared/CollapsiblePanel'
import { InlinePresence } from '../shared/InlinePresence'
import { InfoTooltip } from '../shared/InfoTooltip'
import { AssetInsertMenu, type InsertLanguage } from '../shared/AssetInsertMenu'
import { ExplorerContextMenu, type ExplorerContextMenuState } from '../shared/ExplorerContextMenu'
import { ExplorerSelectionBar } from '../shared/ExplorerSelectionBar'
import { FileDropzone } from '../shared/FileDropzone'
import { AttachmentPreviewDialog, type AttachmentPreviewFile } from '../shared/AttachmentPreviewDialog'
import { PendingLabel } from '../shared/PendingLabel'
import {
  type RecommenderComboboxOption,
} from '../shared/RecommenderCombobox'
import { ApplicationRecommendersPanel } from '../shared/ApplicationRecommendersPanel'
import { ProjectFooter } from '../shared/ProjectFooter'
import { AnimatedCheckmark } from '../shared/AnimatedCheckmark'
import { UserAvatar } from '../shared/UserAvatar'
import { emailLeadingInitial } from '../shared/avatarInitial'
import FeeTracker, { type FeeTrackerExitGuard } from '../shared/FeeTracker'
import { formatFeeAmount } from '../shared/feeFormatting'
import { MarkdownContent } from '../shared/MarkdownContent'
import { detectRichTextFormat } from '../shared/richText'
import { LazyMarkdownTextarea as MarkdownTextarea } from '../shared/LazyMarkdownTextarea'
import type {
  MarkdownTextareaController,
  MarkdownTextareaSelection,
} from '../shared/MarkdownTextarea'
import { AiDraftPanel } from '../shared/AiDraftPanel'
import { AnchoredPopover } from '../shared/AnchoredPopover'
import {
  ComposerRecipientControl,
  CorrespondenceRecipientSettings,
  RecipientTrackingDialog,
} from '../shared/CorrespondenceRecipients'
import { ApplicationTransferDialog } from '../shared/ApplicationTransferDialog'
import { SchoolLogoManager, SchoolLogoMark } from '../shared/SchoolLogo'
import { buildDossierAiAttachmentCandidates } from './dossierAiAttachmentCandidates'
import {
  clearRecoverableEmailComposer,
  defaultScheduledEmailTime,
  editableDraftEmailSubject,
  isFutureScheduledEmail,
  loadRecoverableEmailComposer,
  saveRecoverableEmailComposer,
  scheduledEmailIso,
  shouldConfirmMissingEmailAttachment,
  type RecoverableEmailComposer,
} from './dossierEmailComposerModel'
import {
  cleanScholarshipDraft,
  createScholarshipDraft,
  scholarshipDraftHasMeaningfulChanges,
  scholarshipMaterialDraftHasContent,
  scholarshipTaskDraftHasContent,
  scholarshipStatusOrder,
  scholarshipToDraft,
  sortScholarshipTimelineNewestFirst,
  type ScholarshipFormDraft,
  type ScholarshipItem,
  type ScholarshipMaterialItem,
  type ScholarshipStatus,
  type ScholarshipTaskItem,
} from './dossierScholarshipDraft'
import {
  checklistGroupI18n,
  checklistGroups,
  checklistMaterialFormatKey,
  checklistMaterialFormatLimit,
  checklistMaterialFormatSection,
  checklistMaterialTypeI18n,
  checklistMaterialTypes,
  defaultChecklistMaterialType,
  fileSizeLabel,
  isChecklistGroup,
  isRecommendationMaterial,
  materialStatusFilterValue,
  normalizeChecklistCustomMaterialFormats,
  normalizeChecklistMaterialFormat,
} from './dossierChecklistModel'
import type {
  MaterialFilter,
  MaterialItem,
} from './dossierChecklistModel'
import {
  checklistStatusKey,
  checklistStatusLimit,
  checklistTaskStatusOrder,
  mergeChecklistStatuses,
  normalizeChecklistCustomStatuses,
  normalizeChecklistStatus,
} from './checklistStatusModel'
import {
  TableCell,
  TableColGroup,
  TableHeaderCell,
} from '../shared/TableColumnChrome'
import { useTableColumnMenu } from '../shared/useTableColumnMenu'
import type { TableColumnDef } from '../shared/useTableColumns'

const builtInApplicationStatusKeys = new Set(
  builtInApplicationStatuses.map((status) => status.toLocaleLowerCase()),
)

const materialStatusOrder: MaterialStatus[] = [
  'Missing',
  'Not started',
  'Draft',
  'Requested',
  'In progress',
  'Waiting',
  'Needs Review',
  'Ready',
  'Needs revision',
  'Submitted',
]
const checklistStatusBuiltInOrder = [...materialStatusOrder, ...checklistTaskStatusOrder]
const BASE_DETAIL_TABS: DetailTab[] = ['dossier', 'materials', 'mail', 'funding', 'timeline', 'admissions']
/**
 * Deliberately looser than `type="url"`, which insists on a scheme and would
 * mark the bare `www.eth-zurich.edu` people actually paste as wrong. This wants
 * a host with a dot and no whitespace, and accepts an optional scheme and path.
 */
const WEB_ADDRESS_PATTERN = String.raw`\s*(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?([\/?#][^\s]*)?\s*`
const EMPTY_CLASSIFYING_COMMUNICATION_IDS: ReadonlySet<string> = new Set()

type TaskItem = ApplicationRecord['tasks'][number]
type CommunicationItem = ApplicationRecord['communications'][number]

function checklistTaskStatus(task: { done: boolean; status?: string }) {
  return normalizeChecklistStatus(task.status || (task.done ? 'Done' : 'Open')) || (task.done ? 'Done' : 'Open')
}

function createComposerDeliveryId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `delivery-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function localCommunicationDateTime(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0')
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  }
}

function communicationAbsoluteTime(item: CommunicationItem) {
  if (item.sentAt) return item.sentAt
  if ((item.deliveryStatus === 'queued' || item.deliveryStatus === 'sending') && item.scheduledAt)
    return item.scheduledAt
  return ''
}

function communicationSortStamp(item: CommunicationItem) {
  return communicationAbsoluteTime(item) || `${item.date}T${item.time || '00:00'}`
}

function communicationCalendarDate(item: CommunicationItem) {
  const absolute = communicationAbsoluteTime(item)
  if (!absolute) return item.date
  const parsed = new Date(absolute)
  return Number.isNaN(parsed.getTime()) ? item.date : localCommunicationDateTime(parsed).date
}

function communicationTimestamp(item: CommunicationItem, lang: Language) {
  const absolute = communicationAbsoluteTime(item)
  if (absolute) {
    const parsed = new Date(absolute)
    if (!Number.isNaN(parsed.getTime())) {
      const local = localCommunicationDateTime(parsed)
      return {
        dateTime: absolute,
        label: `${formatDate(local.date, lang)} ${local.time}`,
      }
    }
  }
  return {
    dateTime: `${item.date}${item.time ? `T${item.time}` : ''}`,
    label: `${formatDate(item.date, lang)}${item.time ? ` ${item.time}` : ''}`,
  }
}

function DossierExternalLinkAction({
  value,
  label,
}: {
  value: string
  label: string
}) {
  const href = normalizedExternalHref(value)
  const icon = <ExternalLink size={14} aria-hidden="true" />

  if (!href) {
    return (
      <button
        type="button"
        className="icon-action"
        aria-label={label}
        title={label}
        disabled
      >
        {icon}
      </button>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="icon-action"
      aria-label={label}
      title={label}
    >
      {icon}
    </a>
  )
}

function communicationEditDraftFrom(item: CommunicationItem): CommunicationPatchInput {
  return {
    subject: item.subject,
    channel: item.channel,
    date: item.date || today,
    summary: item.summary,
    direction: item.direction ?? (item.channel === 'Email' ? 'incoming' : 'note'),
    messageType: item.messageType ?? 'note',
    from: item.from ?? '',
    to: item.to ?? '',
    time: item.time ?? '',
  }
}

function communicationDirectionOf(item: CommunicationItem) {
  return item.direction ?? (item.channel === 'Email' ? 'incoming' : 'note')
}

function isIncomingEmailForClassification(item: CommunicationItem) {
  return item.channel === 'Email'
    && item.direction === 'incoming'
    && item.messageType !== 'draft-email'
}

function correspondenceAvatarIdentity(
  item: CommunicationItem,
  professorName: string,
  professorEmail: string,
  account: {
    name: string
    email: string
    avatarUrl?: string | null
  },
) {
  const direction = communicationDirectionOf(item)

  if (direction !== 'incoming') {
    return {
      name: account.name,
      email: account.email,
      avatarUrl: account.avatarUrl,
      displayEmail: '',
    }
  }

  const counterpartyEmail = normalizeCorrespondenceEmail(
    item.from,
  )
  const primaryProfessorEmail = normalizeCorrespondenceEmail(professorEmail)
  const hasMailProvenance = item.messageType === 'fetched-email'
    || Boolean(
      item.sourceMessageKey
      || item.sourceMailbox
      || item.importedAt
      || item.deliveryStatus === 'sent',
    )
  const useProfessorIdentity = !hasMailProvenance
    || !counterpartyEmail
    || counterpartyEmail === primaryProfessorEmail

  if (useProfessorIdentity) {
    return {
      name: professorName,
      email: primaryProfessorEmail,
      avatarUrl: undefined,
      displayEmail: '',
    }
  }

  return {
    name: emailLeadingInitial(counterpartyEmail),
    email: counterpartyEmail,
    avatarUrl: undefined,
    displayEmail: counterpartyEmail,
  }
}

type ChecklistUploadTarget = { kind: 'material'; id: string }
  | { kind: 'task'; id: string }
  | null
type ReminderMenuTarget = { kind: 'material'; id: string }
  | { kind: 'task'; id: string }
  | null
type UploadDraftFile = {
  id: string
  file: File
  name: string
  extension: string
}
type MaterialSort = 'manual' | 'name' | 'status' | 'group' | 'updated'
type TaskFilter = 'all' | 'open' | 'done' | 'overdue' | 'with-attachment' | 'with-reminder'
type TaskSort = 'manual' | 'due' | 'title' | 'status'

function scholarshipStatusMenuTone(status: ScholarshipStatus): 'neutral' | 'info' | 'success' | 'danger' {
  switch (status) {
    case 'Submitted':
      return 'info'
    case 'Awarded':
      return 'success'
    case 'Rejected':
      return 'danger'
    default:
      return 'neutral'
  }
}
type ChecklistDragTarget = { kind: ChecklistDragKind; id: string }
  | null
type ChecklistDragRowMeasurement = ChecklistDragRowMetric & {
  element: HTMLElement
  left: number
  top: number
  width: number
  height: number
}
type ChecklistDragSession = {
  kind: ChecklistDragKind
  id: string
  pointerId: number
  startX: number
  startY: number
  left: number
  top: number
  width: number
  height: number
  handle: HTMLElement
  item: HTMLElement
  scope: HTMLElement
  rows: ChecklistDragRowMeasurement[]
  /** Row centers after the current preview offsets, used only for hit testing. */
  previewRows: ChecklistDragRowMetric[]
  groupBoundaries: ChecklistGroupBoundary[]
  /** Cached boundary tops after the current compositor-only preview shift. */
  previewGroupBoundaries: ChecklistGroupBoundary[]
  groupPreviewShifts: Record<string, number>
  groupGeometry: ChecklistGroupGeometry[]
  groupHeaders: Array<{ group: string; element: HTMLElement }>
  sourceIndex: number
  scrollParent: HTMLElement | null
  scrollStart: number
  scrollMax: number
  viewportTop: number
  viewportBottom: number
  frame: number
  latestClientX: number
  latestClientY: number
  target: ChecklistDropTarget
  /** The group selected by pointer geometry, not necessarily target.id's group. */
  targetGroup?: string
  insertionIndex: number
  sourceShift: number
  overlay: HTMLElement | null
  dropAnimation: Animation | null
  status: 'pending' | 'dragging' | 'settling' | 'done'
  reducedMotion: boolean
  cleanupListeners: (() => void) | null
  finish: ((commit: boolean, immediate?: boolean) => void) | null
  forceSettle: (() => void) | null
  /** Suppresses the visual settle when a lifecycle interruption needs teardown now. */
  skipDropAnimation: boolean
  /** Last-resort release: the settle must never outlive the drop by more than this. */
  settleWatchdog: number
  expectedOrder: string[] | null
  expectedGroup?: string
  commitRequested: boolean
  commitObserved: boolean
}
type ScholarshipDragPreview = {
  formKey: string
  kind: 'material' | 'task'
  element: HTMLElement
  width: number | null
  height: number | null
}
type DossierResourceDropTarget = { id: string; position: ChecklistDropPosition } | null
type DossierResourceDragOffset = { id: string; x: number; y: number; left: number; top: number; width: number; height: number }
  | null
type DossierResourceDragSession = {
  id: string
  pointerId: number
  startX: number
  startY: number
  grabX: number
  grabY: number
  left: number
  top: number
  width: number
  height: number
  hasMoved: boolean
  handle: HTMLElement
  fixedContainingBlock: HTMLElement | null
  scrollParent: HTMLElement | null
}

function SortableResourceFieldRow({
  id,
  handleLabel,
  recent = false,
  children,
}: {
  id: string
  handleLabel: string
  recent?: boolean
  children: ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      data-resource-field-id={id}
      className={`resource-design-field-row${isDragging ? ' dragging' : ''}${recent ? ' resource-design-field-new' : ''}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition || undefined,
      }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="resource-field-drag-handle"
        title={handleLabel}
        aria-label={handleLabel}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} aria-hidden="true" />
      </button>
      {children}
    </div>
  )
}

const SCHOLARSHIP_ROW_EDITOR_MAX_HEIGHT = 76
const SCHOLARSHIP_DROP_ANIMATION = {
  // The list itself owns the final position. The overlay must never travel a
  // second time after release; it only hands the visual surface back to the
  // committed row.
  duration: 96,
  easing: 'cubic-bezier(0.4, 0, 1, 1)',
} as const
const SCHOLARSHIP_SORT_TRANSITION = {
  duration: 180,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const
const scholarshipPointerCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args)
}

function ScholarshipRowTitleEditor({
  value,
  onChange,
  placeholder,
  label,
  completed = false,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  completed?: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const resizeEditor = useCallback(() => {
    const editor = textareaRef.current
    if (!editor) return
    editor.style.height = '0px'
    const contentHeight = editor.scrollHeight
    const nextHeight = Math.min(SCHOLARSHIP_ROW_EDITOR_MAX_HEIGHT, Math.max(20, contentHeight))
    editor.style.height = `${nextHeight}px`
    editor.style.overflowY = contentHeight > SCHOLARSHIP_ROW_EDITOR_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [])

  useLayoutEffect(() => {
    resizeEditor()
  }, [resizeEditor, value])

  useEffect(() => {
    const editor = textareaRef.current
    if (!editor || typeof ResizeObserver === 'undefined') return undefined
    let observedWidth = Math.round(editor.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.round(entry.contentRect.width)
      if (nextWidth === observedWidth) return
      observedWidth = nextWidth
      resizeEditor()
    })
    observer.observe(editor)
    return () => observer.disconnect()
  }, [resizeEditor])

  return (
    <label className={`scholarship-row-title-editor${completed ? ' is-complete' : ''}`}>
      <span className="sr-only">{label}</span>
      <PencilLine size={13} aria-hidden="true" />
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={1}
        wrap="soft"
      />
    </label>
  )
}

function ScholarshipTimelineEditorRow({
  eventId,
  entering,
  onEntered,
  children,
}: {
  eventId: string
  entering: boolean
  onEntered: () => void
  children: ReactNode
}) {
  const enteringOnMountRef = useRef(entering)
  const onEnteredRef = useRef(onEntered)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const didFocusRef = useRef(false)
  const [open, setOpen] = useState(() => !enteringOnMountRef.current)
  onEnteredRef.current = onEntered

  useLayoutEffect(() => {
    if (!enteringOnMountRef.current) return undefined
    const frame = window.requestAnimationFrame(() => setOpen(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useLayoutEffect(() => {
    if (!open || !enteringOnMountRef.current || didFocusRef.current) return
    didFocusRef.current = true
    rowRef.current
      ?.querySelector<HTMLInputElement>('[data-timeline-title-input="true"]')
      ?.focus({ preventScroll: true })
    onEnteredRef.current()
  }, [open])

  return (
    <div
      ref={rowRef}
      className={`scholarship-timeline-row-presence${open ? ' open' : ''}${enteringOnMountRef.current ? ' is-entering' : ''}`}
      data-scholarship-timeline-event-id={eventId}
      role="listitem"
    >
      <div className="scholarship-timeline-row-presence-inner">{children}</div>
    </div>
  )
}

function SortableScholarshipRow({
  id,
  handleLabel,
  className,
  children,
}: {
  id: string
  handleLabel: string
  className: string
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    transition: SCHOLARSHIP_SORT_TRANSITION,
  })

  return (
    <div
      ref={setNodeRef}
      className={`scholarship-mini-row ${className}${isDragging ? ' is-dragging' : ''}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition || undefined,
        zIndex: isDragging ? 2 : undefined,
      }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="scholarship-row-drag-handle"
        title={handleLabel}
        aria-label={handleLabel}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} aria-hidden="true" />
      </button>
      {children}
    </div>
  )
}

function createScholarshipDragPreviewElement(source: HTMLElement) {
  const preview = source.cloneNode(true) as HTMLElement
  preview.removeAttribute('id')
  preview.removeAttribute('aria-selected')
  preview.classList.remove('is-dragging')
  preview.classList.add('scholarship-drag-preview')
  preview.style.removeProperty('transform')
  preview.style.removeProperty('transition')
  preview.style.removeProperty('z-index')
  preview.querySelectorAll<HTMLElement>('[id]').forEach((element) => element.removeAttribute('id'))
  preview
    .querySelectorAll<HTMLElement>('a, button, input, select, textarea, [tabindex]')
    .forEach((element) => element.setAttribute('tabindex', '-1'))

  const sourceFields = source.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
  const previewFields = preview.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
  sourceFields.forEach((field, index) => {
    const previewField = previewFields[index]
    if (previewField) previewField.value = field.value
  })
  return preview
}

function ScholarshipDragPreview({ preview }: { preview: ScholarshipDragPreview }) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    host.replaceChildren(preview.element)
    return () => {
      if (preview.element.parentElement === host) preview.element.remove()
    }
  }, [preview.element])

  return (
    <div
      ref={hostRef}
      className="scholarship-drag-preview-host"
      style={{
        width: preview.width ? `${preview.width}px` : undefined,
        height: preview.height ? `${preview.height}px` : undefined,
      }}
      aria-hidden="true"
      role="presentation"
    />
  )
}

function ScholarshipTrackableDragOverlay({
  preview,
  formKey,
  kind,
  reducedMotion,
  dropAnimation,
}: {
  preview: ScholarshipDragPreview | null
  formKey: string
  kind: ScholarshipDragPreview['kind']
  reducedMotion: boolean
  dropAnimation: DropAnimationFunction
}) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <DragOverlay
      dropAnimation={reducedMotion ? null : dropAnimation}
      className="scholarship-drag-overlay-layer"
    >
      {preview?.formKey === formKey && preview.kind === kind ? (
        <ScholarshipDragPreview preview={preview} />
      ) : null}
    </DragOverlay>,
    document.body,
  )
}

function reorderScholarshipRows<T extends { id: string }>(rows: T[], event: DragEndEvent, idPrefix: string) {
  if (!event.over || event.active.id === event.over.id) return rows
  const activeId = String(event.active.id)
  const overId = String(event.over.id)
  const fromIndex = rows.findIndex((row) => `${idPrefix}${row.id}` === activeId)
  const toIndex = rows.findIndex((row) => `${idPrefix}${row.id}` === overId)
  if (fromIndex < 0 || toIndex < 0) return rows
  return arrayMove(rows, fromIndex, toIndex)
}

/** Where a generated (non-manual) timeline card should jump to when clicked. */
type TimelineNav =
  | { tab: 'dossier' }
  | { tab: 'materials'; kind: 'material' | 'task'; id: string }
  | { tab: 'mail'; id: string }
  | { tab: 'funding'; scholarshipId: string }
  | { tab: 'funding'; feeId: string }
type TimelineSourceKind = 'manual' | 'dossier' | 'checklist' | 'mail' | 'funding'
type TimelineEventKind = 'manual' | 'deadline' | 'reminder' | 'update' | 'task' | 'message' | 'funding' | 'fee'

function TimelineEventGlyph({ kind }: { kind: TimelineEventKind }) {
  const iconProps = { size: 14, strokeWidth: 2.1, 'aria-hidden': true as const }
  switch (kind) {
    case 'deadline':
      return <Flag {...iconProps} />
    case 'reminder':
      return <BellRing {...iconProps} />
    case 'update':
      return <FilePenLine {...iconProps} />
    case 'task':
      return <ListChecks {...iconProps} />
    case 'message':
      return <Mail {...iconProps} />
    case 'funding':
      return <Award {...iconProps} />
    case 'fee':
      return <Receipt {...iconProps} />
    default:
      return <StickyNote {...iconProps} />
  }
}
type DossierJumpExpand = { kind: 'material' | 'task'; id: string } | { kind: 'scholarship'; id: string }
export type DossierJumpIntent = {
  applicationId: string
  token: number
  tab: DetailTab
  targetId: string
  fallbackText?: string[]
  expand?: DossierJumpExpand
}
export type ApplicationDraftSaveIntent = 'settled' | 'immediate' | 'external'

type PendingChecklistCreate = {
  kind: 'material' | 'task'
  id: string
  baseline: string
}

type ItemEditorKind =
  | 'communication'
  | 'scholarship'
  | 'scholarship-add'
  | 'timeline'
  | 'recommender-create'
  | 'checklist-create'

function ChecklistDisclosureItem({
  id,
  kind,
  itemId,
  group,
  tour,
  externalOpen,
  syncVersion,
  className,
  style,
  ariaSelected,
  onContextMenu,
  onOpenChange,
  children,
}: {
  id: string
  kind: 'material' | 'task'
  itemId: string
  group?: string
  tour?: string
  externalOpen: boolean
  syncVersion: number
  className: (open: boolean) => string
  style?: CSSProperties
  ariaSelected: boolean
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void
  onOpenChange?: (open: boolean) => void
  children: (open: boolean, toggle: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(externalOpen)

  useEffect(() => {
    setOpen(externalOpen)
  }, [externalOpen, syncVersion])

  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current
      onOpenChange?.(next)
      return next
    })
  }, [onOpenChange])

  return (
    <div
      id={id}
      data-checklist-kind={kind}
      data-checklist-id={itemId}
      data-checklist-group={group}
      data-tour={tour}
      className={className(open)}
      style={style}
      aria-selected={ariaSelected}
      onContextMenu={onContextMenu}
    >
      {children(open, toggle)}
    </div>
  )
}

/**
 * Keeps the completion affordance and the row's canonical draft state on the
 * same click commit. The autosave layer still owns the asynchronous persistence
 * and coalesces subsequent edits, but a visible status change is urgent UI state
 * and must not wait for a frame or a transition lane.
 */
const ChecklistCompletionButton = memo(function ChecklistCompletionButton({
  checked,
  uncheckedClassName = '',
  completeLabel,
  incompleteLabel,
  onChange,
}: {
  checked: boolean
  uncheckedClassName?: string
  completeLabel: string
  incompleteLabel: string
  onChange: (checked: boolean) => void
}) {
  const [visualChecked, setVisualChecked] = useState(checked)
  const visualCheckedRef = useRef(checked)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    visualCheckedRef.current = checked
    setVisualChecked(checked)
  }, [checked])

  const handleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const nextChecked = !visualCheckedRef.current
    visualCheckedRef.current = nextChecked
    setVisualChecked(nextChecked)
    // Keep the right-side status pill, row class, and checkbox in one urgent
    // React commit. Persistence is already deferred and deduplicated by the
    // autosave owner, so deferring this callback only delays visible feedback.
    onChangeRef.current(nextChecked)
  }, [])

  const label = visualChecked ? incompleteLabel : completeLabel
  const stateClassName = visualChecked ? 'on' : uncheckedClassName

  return (
    <button
      type="button"
      className={`checklist-check-btn${stateClassName ? ` ${stateClassName}` : ''}`}
      onClick={handleClick}
      title={label}
      aria-label={label}
      aria-pressed={visualChecked}
    >
      <AnimatedCheckmark checked={visualChecked} size={19} />
    </button>
  )
})

const DossierTabStrip = memo(function DossierTabStrip({
  detailTabs,
  tab,
  tabStripRef,
  setTabButtonRef,
  tx,
  onSelect,
}: {
  detailTabs: DetailTab[]
  tab: DetailTab
  tabStripRef: RefObject<HTMLDivElement | null>
  setTabButtonRef: (tab: DetailTab, node: HTMLButtonElement | null) => void
  tx: (key: string, fallback?: string) => string
  onSelect: (tab: DetailTab, markOptimistic: () => void) => void
}) {
  const [optimisticTab, setOptimisticTab] = useState<DetailTab | null>(null)
  const [tabScrollState, setTabScrollState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
    isOverflowing: false,
  })
  const activeTab = optimisticTab ?? tab

  useLayoutEffect(() => {
    const strip = tabStripRef.current
    if (!strip) return undefined

    const updateScrollState = () => {
      const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth)
      const nextState = {
        canScrollLeft: strip.scrollLeft > 1,
        canScrollRight: maxScrollLeft - strip.scrollLeft > 1,
        isOverflowing: maxScrollLeft > 1,
      }
      setTabScrollState((current) =>
        current.canScrollLeft === nextState.canScrollLeft &&
        current.canScrollRight === nextState.canScrollRight &&
        current.isOverflowing === nextState.isOverflowing
          ? current
          : nextState,
      )
    }

    updateScrollState()
    strip.addEventListener('scroll', updateScrollState, { passive: true })
    window.addEventListener('resize', updateScrollState)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollState)
    resizeObserver?.observe(strip)

    return () => {
      strip.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
      resizeObserver?.disconnect()
    }
  }, [detailTabs.length, tabStripRef])

  useEffect(() => {
    if (optimisticTab === null) return
    if (optimisticTab === tab || !detailTabs.includes(optimisticTab)) {
      setOptimisticTab(null)
    }
  }, [detailTabs, optimisticTab, tab])

  useLayoutEffect(() => {
    const strip = tabStripRef.current
    if (!strip || strip.scrollWidth <= strip.clientWidth) return
    const active = strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (!active) return
    const activeLeft = active.offsetLeft
    const activeRight = activeLeft + active.offsetWidth
    const visibleLeft = strip.scrollLeft
    const visibleRight = visibleLeft + strip.clientWidth
    if (activeLeft >= visibleLeft && activeRight <= visibleRight) return
    strip.scrollTo({
      left: Math.max(0, activeLeft - (strip.clientWidth - active.offsetWidth) / 2),
      behavior: 'auto',
    })
  }, [activeTab, tabStripRef])

  const labelForTab = (key: DetailTab) =>
    key === 'dossier'
      ? tx('dossier.tabs.dossier')
      : key === 'materials'
        ? tx('dossier.tabs.materials')
        : key === 'mail'
          ? tx('dossier.tabs.mail')
          : key === 'funding'
            ? tx('dossier.tabs.funding')
            : key === 'admissions'
              ? tx('dossier.tabs.admissions')
              : key === 'review'
                ? tx('dossier.tabs.review')
                : tx('dossier.tabs.timeline')

  const scrollTabs = (direction: -1 | 1) => {
    const strip = tabStripRef.current
    if (!strip) return
    const distance = Math.max(144, Math.round(strip.clientWidth * 0.68))
    const nextLeft = strip.scrollLeft + distance * direction
    if (typeof strip.scrollBy === 'function') {
      strip.scrollBy({ left: distance * direction, behavior: 'smooth' })
    } else {
      strip.scrollTo({ left: nextLeft, behavior: 'smooth' })
    }
  }

  return (
    <div className={`tab-strip-shell${tabScrollState.isOverflowing ? ' is-overflowing' : ''}`}>
      <button
        type="button"
        className="tab-strip-nav tab-strip-nav-prev"
        disabled={!tabScrollState.canScrollLeft}
        aria-label={tx('pagination.previous', 'Previous tabs')}
        title={tx('pagination.previous', 'Previous tabs')}
        onClick={() => scrollTabs(-1)}
      >
        <ChevronLeft size={15} aria-hidden="true" />
      </button>
      <div className="tab-strip" role="tablist" ref={tabStripRef} data-tour="dossier-tabs">
        {detailTabs.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            data-tour={key === 'materials' ? 'dossier-tab-materials' : key === 'mail' ? 'dossier-tab-mail' : undefined}
            ref={(node) => setTabButtonRef(key, node)}
            className={activeTab === key ? 'active' : ''}
            onClick={() => {
              if (activeTab === key) return
              onSelect(key, () => setOptimisticTab(key))
            }}
          >
            {labelForTab(key)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="tab-strip-nav tab-strip-nav-next"
        disabled={!tabScrollState.canScrollRight}
        aria-label={tx('pagination.next', 'Next tabs')}
        title={tx('pagination.next', 'Next tabs')}
        onClick={() => scrollTabs(1)}
      >
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </div>
  )
})

function DossierDeferredRows({ className = '' }: { className?: string }) {
  return (
    <div className={`dossier-list-deferred${className ? ` ${className}` : ''}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}

const ChecklistReminderFilterButton = memo(function ChecklistReminderFilterButton({
  active,
  count,
  label,
  actionLabel,
  onToggle,
}: {
  active: boolean
  count: number
  label: string
  actionLabel: string
  onToggle: () => void
}) {
  const [hasPointerIntent, setHasPointerIntent] = useState(false)
  const [hasFocusIntent, setHasFocusIntent] = useState(false)

  return (
    <button
      type="button"
      className={`checklist-hero-stat checklist-reminder-filter-btn${active ? ' active' : ''}`}
      onClick={onToggle}
      onPointerEnter={() => setHasPointerIntent(true)}
      onPointerLeave={() => setHasPointerIntent(false)}
      onPointerCancel={() => setHasPointerIntent(false)}
      onFocus={() => setHasFocusIntent(true)}
      onBlur={() => setHasFocusIntent(false)}
      aria-pressed={active}
      title={actionLabel}
      aria-label={actionLabel}
    >
      {active ? <BellRing size={13} aria-hidden="true" /> : <Bell size={13} aria-hidden="true" />}
      <strong className="checklist-reminder-filter-count">{count}</strong>
      <InlinePresence
        present={active || hasPointerIntent || hasFocusIntent}
        durationMs={220}
        parentGap="4px"
        className="checklist-reminder-filter-label"
      >
        {label}
      </InlinePresence>
    </button>
  )
})

type EmailAttachmentDraft = CommunicationAttachmentInput & {
  id: string
  name: string
  assetId?: string
  fileId?: string
  file?: File
  fileSize?: number
  mimeType?: string
  /** Candidate selected in the AI attachment planner. */
  aiCandidateId?: string
  /** Marks attachments owned by the AI plan while keeping them user-editable. */
  aiAttachedByTool?: boolean
  /** Replays bounded chip motion only when the AI plan actually changes this item. */
  aiMotionRevision?: number
  aiMotionKind?: 'enter' | 'update'
}

type CorrespondenceKind = 'outgoing-email' | 'incoming-email' | 'outgoing-message' | 'incoming-message' | 'note'

type CorrespondenceMode = 'draft-email' | 'record-email' | 'record-message' | 'note'
type CorrespondenceView = 'all' | 'drafts'
type RecordDirection = 'sent' | 'received'
/** 'all', a built-in category, or a `custom:` id this account defined. */
type CommunicationCategoryFilter = 'all' | string
type ComposerExitRequest = { proceed: () => void; keepOpenAfterSave?: boolean }
type PendingRecipientSend = {
  payload: CommunicationSendInput
  sourceApplicationId: string
  sourceMutationVersion: number
  afterSend?: () => void
}
type PendingMissingAttachmentSend = {
  afterSend?: () => void
  timing?: {
    sendAt: string
    date: string
    time: string
  }
}

const correspondenceKinds: Array<{
  value: CorrespondenceKind
  labelKey: string
  channel: 'Email' | 'Message' | 'Note'
  direction: 'incoming' | 'outgoing' | 'note'
}> = [
  {
    value: 'outgoing-email',
    labelKey: 'dossier.correspondenceTypes.outgoingEmail',
    channel: 'Email',
    direction: 'outgoing',
  },
  {
    value: 'incoming-email',
    labelKey: 'dossier.correspondenceTypes.incomingEmail',
    channel: 'Email',
    direction: 'incoming',
  },
  {
    value: 'outgoing-message',
    labelKey: 'dossier.correspondenceTypes.outgoingMessage',
    channel: 'Message',
    direction: 'outgoing',
  },
  {
    value: 'incoming-message',
    labelKey: 'dossier.correspondenceTypes.incomingMessage',
    channel: 'Message',
    direction: 'incoming',
  },
  {
    value: 'note',
    labelKey: 'dossier.correspondenceTypes.note',
    channel: 'Note',
    direction: 'note',
  },
]

function RecordDirectionToggle({
  value,
  receivedIcon: ReceivedIcon,
  sentLabel,
  receivedLabel,
  ariaLabel,
  onChange,
}: {
  value: RecordDirection
  receivedIcon: LucideIcon
  sentLabel: string
  receivedLabel: string
  ariaLabel: string
  onChange: (value: RecordDirection) => void
}) {
  return (
    <div
      className="record-direction-toggle"
      data-active-index={value === 'received' ? 1 : 0}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      <span className="record-direction-indicator" aria-hidden="true" />
      <button
        type="button"
        role="radio"
        aria-checked={value === 'sent'}
        className={value === 'sent' ? 'active' : ''}
        onClick={() => onChange('sent')}
      >
        <Send size={13} aria-hidden="true" />
        <span>{sentLabel}</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'received'}
        className={value === 'received' ? 'active' : ''}
        onClick={() => onChange('received')}
      >
        <ReceivedIcon size={13} aria-hidden="true" />
        <span>{receivedLabel}</span>
      </button>
    </div>
  )
}

const lucideResourceIcons: Record<string, LucideIcon> = {
  Archive,
  ArchiveRestore,
  AtSign,
  Award,
  BadgeCheck,
  BadgeDollarSign,
  BadgeInfo,
  BellRing,
  BookMarked,
  BookOpen,
  BookOpenCheck,
  Bookmark,
  BookText,
  Brain,
  Briefcase,
  Building2,
  Calendar,
  ChartNoAxesColumn,
  ChartPie,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  CircleHelp,
  CircleUserRound,
  ClipboardList,
  Clock,
  Cloud,
  CloudUpload,
  Code,
  Compass,
  Contact,
  Database,
  DoorOpen,
  Earth,
  ExternalLink,
  Eye,
  FileCheck,
  FileClock,
  FileLock,
  FilePenLine,
  FileSearch,
  FileText,
  FileUp,
  Files,
  Flag,
  FolderOpen,
  Globe,
  GraduationCap,
  Handshake,
  HeartHandshake,
  Home,
  IdCard,
  Inbox,
  KeyRound,
  Landmark,
  Languages,
  Laptop,
  Layers,
  Library,
  Lightbulb,
  Link,
  ListChecks,
  LockKeyhole,
  Mail,
  MailCheck,
  Map: LucideMap,
  MapPin,
  MapPinned,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Microscope,
  Network,
  Newspaper,
  NotebookTabs,
  PackageCheck,
  PanelTop,
  Paperclip,
  PencilLine,
  PhoneCall,
  Plane,
  Presentation,
  QrCode,
  Receipt,
  Route,
  School,
  SearchCheck,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  Signature,
  Sparkles,
  SquarePen,
  Stamp,
  Star,
  StickyNote,
  Tags,
  Target,
  Timer,
  Trophy,
  University,
  UploadCloud,
  User,
  UserCheck,
  UserRoundSearch,
  UsersRound,
  WalletCards,
  Waypoints,
  Wifi,
  Workflow,
  Zap,
}
const dossierResourceIconMap: Record<string, LucideIcon> = Object.fromEntries(
  dossierResourceIconPresets.map((preset) => [preset.id, lucideResourceIcons[preset.icon] ?? Link]),
) as Record<string, LucideIcon>
const taskReminderOffsetOptions = [
  { value: 'same-day', labelKey: 'dossier.reminderSameDay' },
  { value: '1d', labelKey: 'dossier.reminder1d' },
  { value: '3d', labelKey: 'dossier.reminder3d' },
  { value: '7d', labelKey: 'dossier.reminder7d' },
] as const
const destroyAnimationMs = 280

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function hasApplicationRecommenderContent(recommender: MaterialRecommender) {
  return Boolean(
    recommender.name.trim()
    || recommender.contact.trim()
    || recommender.email?.trim()
    || recommender.phone?.trim()
    || recommender.notes?.trim()
    || recommender.deadline?.trim()
    || recommender.deadlineTime?.trim()
    || recommender.reminderDate?.trim()
    || recommender.reminderTime?.trim()
    || recommender.profileId,
  )
}

/**
 * A newly opened teacher row belongs to the current editing session until it
 * identifies an actual person. This lets applicants set a deadline/reminder or
 * jot down context before they know the teacher's final details, without
 * putting an anonymous record through autosave.
 */
function hasApplicationRecommenderIdentity(recommender: MaterialRecommender) {
  return Boolean(recommender.name.trim() || recommender.profileId)
}

function applicationRecommenderFieldsEqual(left: MaterialRecommender, right: MaterialRecommender) {
  return left.id === right.id
    && left.name === right.name
    && materialRecommenderEmail(left) === materialRecommenderEmail(right)
    && materialRecommenderPhone(left) === materialRecommenderPhone(right)
    && (left.profileId ?? '') === (right.profileId ?? '')
    && (left.notes ?? '') === (right.notes ?? '')
    && (left.deadline ?? '') === (right.deadline ?? '')
    && (left.deadlineTime ?? '') === (right.deadlineTime ?? '')
    && (left.reminderDate ?? '') === (right.reminderDate ?? '')
    && (left.reminderTime ?? '') === (right.reminderTime ?? '')
}

function applicationRecommenderIdentityChanged(
  recommender: MaterialRecommender,
  persisted: MaterialRecommender | undefined,
  options: readonly RecommenderComboboxOption[],
) {
  if (!recommender.profileId) return false
  const selectedProfile = options.find((option) => option.profileId === recommender.profileId)
  // For an existing linked row, the resident application snapshot is the edit
  // baseline. Comparing it with a profile that refreshed in the background
  // would incorrectly ask to synchronize when the applicant changed only this
  // application's private note or schedule. A deliberate relink/new row uses
  // the selected directory entry as its baseline instead.
  const baseline = persisted?.profileId === recommender.profileId
    ? {
        name: persisted.name,
        email: materialRecommenderEmail(persisted),
        phone: materialRecommenderPhone(persisted),
      }
    : selectedProfile
      ? { name: selectedProfile.name, email: selectedProfile.email, phone: selectedProfile.phone }
      : null
  if (!baseline) return false
  return normalizeRecommenderText(recommender.name) !== normalizeRecommenderText(baseline.name)
    || normalizeRecommenderText(materialRecommenderEmail(recommender))
      !== normalizeRecommenderText(baseline.email)
    || normalizeRecommenderText(materialRecommenderPhone(recommender))
      !== normalizeRecommenderText(baseline.phone)
}

function applicationRecommendersForDraft(application: Pick<ApplicationRecord, 'materials' | 'recommenders'>) {
  const directRecommenders = application.recommenders ?? []
  if (directRecommenders.length > 0) return directRecommenders

  // A short-lived compatibility bridge for locally cached pre-migration
  // applications. The next recommender edit persists these on the application
  // itself and removes the old checklist rows.
  return application.materials
    .filter(isRecommendationMaterial)
    .flatMap((material) => material.recommenders ?? [])
    .filter(hasApplicationRecommenderContent)
}

function sameReminderTarget(a: ReminderMenuTarget, b: ReminderMenuTarget) {
  if (!a || !b) return a === b
  return a.kind === b.kind && a.id === b.id
}

function reminderTargetKey(target: Exclude<ReminderMenuTarget, null>) {
  return `${target.kind}:${target.id}`
}

function reorderById<T extends { id: string }>(
  items: T[],
  activeId: string,
  targetId: string,
  position: ChecklistDropPosition,
) {
  const from = items.findIndex((item) => item.id === activeId)
  const to = items.findIndex((item) => item.id === targetId)
  if (from === -1 || to === -1 || from === to) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  const targetIndex = next.findIndex((item) => item.id === targetId)
  if (targetIndex === -1) return items
  next.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, moved)
  return next.every((item, index) => item === items[index]) ? items : next
}

function sameChecklistDropTarget(a: ChecklistDropTarget, b: ChecklistDropTarget) {
  if (!a || !b) return a === b
  return a.kind === b.kind && a.id === b.id && a.position === b.position
}

function sameDossierResourceDropTarget(a: DossierResourceDropTarget, b: DossierResourceDropTarget) {
  if (!a || !b) return a === b
  return a.id === b.id && a.position === b.position
}

function findScrollableAncestor(element: HTMLElement) {
  let current = element.parentElement
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current)
    if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight) {
      return current
    }
    current = current.parentElement
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null
}

function hasActiveCssValue(value: string) {
  const normalized = value.trim()
  return normalized !== '' && normalized !== 'none' && normalized !== 'auto' && normalized !== 'normal'
}

function createsFixedContainingBlock(style: CSSStyleDeclaration) {
  const contain = style.contain
  const willChange = style.willChange
  return (
    hasActiveCssValue(style.transform) ||
    hasActiveCssValue(style.perspective) ||
    hasActiveCssValue(style.filter) ||
    hasActiveCssValue(style.getPropertyValue('backdrop-filter')) ||
    hasActiveCssValue(style.getPropertyValue('-webkit-backdrop-filter')) ||
    /\b(layout|paint|strict|content)\b/.test(contain) ||
    /\b(transform|perspective|filter|backdrop-filter|contain)\b/.test(willChange)
  )
}

function findFixedContainingBlock(element: HTMLElement) {
  let current = element.parentElement
  while (current && current !== document.documentElement) {
    if (createsFixedContainingBlock(window.getComputedStyle(current))) return current
    current = current.parentElement
  }
  return null
}

type TimelineJumpDockProps = {
  initialValue: string
  lang: Language
  timelinePageRef: RefObject<HTMLDivElement | null>
  nearToday: boolean
  todayDirection: 'up' | 'down' | 'here'
  usesViewportPortal: boolean
  hasMobileRail: boolean
  dockLabel: string
  dateLabel: string
  todayLabel: string
  onDateChange: (value: string) => void
  onToday: () => void
}

const TimelineJumpDock = memo(function TimelineJumpDock({
  initialValue,
  lang,
  timelinePageRef,
  nearToday,
  todayDirection,
  usesViewportPortal,
  hasMobileRail,
  dockLabel,
  dateLabel,
  todayLabel,
  onDateChange,
  onToday,
}: TimelineJumpDockProps) {
  const [indicator, setIndicator] = useState<{
    value: string
    previousValue: string | null
    direction: 'up' | 'down'
  }>(() => ({ value: initialValue, previousValue: null, direction: 'down' }))
  const previewDateRef = useRef(initialValue)
  const lastScrollPositionRef = useRef<number | null>(null)
  const scrollDirectionRef = useRef<'up' | 'down'>('down')
  const dockRef = useRef<HTMLDivElement | null>(null)
  const readoutRef = useRef<HTMLSpanElement | null>(null)
  const previousValueRef = useRef<HTMLSpanElement | null>(null)
  const currentValueRef = useRef<HTMLSpanElement | null>(null)

  const setPreviewDate = useCallback(
    (value: string, direction: 'up' | 'down') => {
      if (!value || value === previewDateRef.current) return
      previewDateRef.current = value
      const formattedValue = formatDate(value, lang)
      const previousValue = currentValueRef.current?.textContent ?? ''
      if (previousValueRef.current) previousValueRef.current.textContent = previousValue
      if (currentValueRef.current) currentValueRef.current.textContent = formattedValue
      const input = dockRef.current?.querySelector<HTMLInputElement>('.date-picker-display')
      if (input) input.value = formattedValue
      if (dockRef.current) {
        dockRef.current.dataset.timelinePreviewDate = value
        dockRef.current.dataset.timelinePreviewDirection = direction
      }
      if (readoutRef.current) {
        readoutRef.current.classList.remove('has-transition', 'direction-up', 'direction-down')
        // Restart only the two tiny text-layer animations; no timeline layout is touched.
        void readoutRef.current.offsetWidth
        readoutRef.current.classList.add('has-transition', `direction-${direction}`)
      }
      setIndicator((current) => ({
        value,
        previousValue: current.value,
        direction,
      }))
    },
    [lang],
  )

  useEffect(() => {
    let frame = 0
    const updatePreviewDate = () => {
      frame = 0
      const timelinePage = timelinePageRef.current
      if (!timelinePage) return
      const scrollParent = findScrollableAncestor(timelinePage)
      const viewport =
        !scrollParent || scrollParent === document.scrollingElement
          ? (() => {
              const visualViewport = window.visualViewport
              const top = visualViewport?.offsetTop ?? 0
              const height = visualViewport?.height ?? window.innerHeight
              return { top, bottom: top + height, height }
            })()
          : (() => {
              const rect = scrollParent.getBoundingClientRect()
              return {
                top: rect.top,
                bottom: rect.bottom,
                height: rect.height,
              }
            })()
      const scrollPosition =
        !scrollParent || scrollParent === document.scrollingElement ? window.scrollY : scrollParent.scrollTop
      const previousScrollPosition = lastScrollPositionRef.current
      if (previousScrollPosition !== null) {
        if (scrollPosition > previousScrollPosition + 0.5) scrollDirectionRef.current = 'down'
        if (scrollPosition < previousScrollPosition - 0.5) scrollDirectionRef.current = 'up'
      }
      lastScrollPositionRef.current = scrollPosition

      const readingLine = viewport.top + viewport.height * 0.5
      const nowMarker = timelinePage.querySelector<HTMLElement>('.timeline-now-marker[data-timeline-date]')
      if (nowMarker) {
        const markerRect = nowMarker.getBoundingClientRect()
        const markerCenter = (markerRect.top + markerRect.bottom) / 2
        if (Math.abs(markerCenter - readingLine) <= 24) {
          const markerDate = nowMarker.dataset.timelineDate ?? ''
          if (markerDate) setPreviewDate(markerDate, scrollDirectionRef.current)
          return
        }
      }
      let previewDate = ''
      let closestBlockDistance = Number.POSITIVE_INFINITY
      let closestCenterDistance = Number.POSITIVE_INFINITY
      timelinePage.querySelectorAll<HTMLElement>('[data-timeline-date]').forEach((item) => {
        const date = item.dataset.timelineDate ?? ''
        if (!date) return
        const rect = item.getBoundingClientRect()
        const blockDistance =
          readingLine < rect.top ? rect.top - readingLine : readingLine > rect.bottom ? readingLine - rect.bottom : 0
        const centerDistance = Math.abs((rect.top + rect.bottom) / 2 - readingLine)
        if (
          blockDistance < closestBlockDistance ||
          (blockDistance === closestBlockDistance && centerDistance < closestCenterDistance)
        ) {
          previewDate = date
          closestBlockDistance = blockDistance
          closestCenterDistance = centerDistance
        }
      })
      if (previewDate) setPreviewDate(previewDate, scrollDirectionRef.current)
    }

    const scheduleUpdate = () => {
      if (frame) return
      frame = window.requestAnimationFrame(updatePreviewDate)
    }
    const timelinePage = timelinePageRef.current
    const scrollParent = timelinePage ? findScrollableAncestor(timelinePage) : null
    scrollParent?.addEventListener('scroll', scheduleUpdate, { passive: true })
    document.addEventListener('scroll', scheduleUpdate, {
      capture: true,
      passive: true,
    })
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    scheduleUpdate()
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      lastScrollPositionRef.current = null
      scrollParent?.removeEventListener('scroll', scheduleUpdate)
      document.removeEventListener('scroll', scheduleUpdate, true)
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [setPreviewDate, timelinePageRef])

  const selectDate = (value: string) => {
    if (!value) return
    const direction = value < previewDateRef.current ? 'down' : 'up'
    scrollDirectionRef.current = direction
    setPreviewDate(value, direction)
    onDateChange(value)
  }

  return (
    <div
      ref={dockRef}
      className={`timeline-jump-dock${!nearToday ? ' is-away' : ' is-near'}${usesViewportPortal ? ' is-viewport-dock' : ''}${usesViewportPortal && hasMobileRail ? ' has-mobile-rail' : ''}`}
      aria-label={dockLabel}
      data-timeline-preview-date={indicator.value}
      data-timeline-preview-direction={indicator.direction}
    >
      <div className="timeline-jump-bar">
        <label className="timeline-jump-date">
          <span className="sr-only">{dateLabel}</span>
          <DatePicker value={indicator.value} onChange={selectDate} placeholder={dateLabel} />
          <span
            ref={readoutRef}
            className={`timeline-jump-date-readout${indicator.previousValue ? ' has-transition' : ''} direction-${indicator.direction}`}
            aria-hidden="true"
          >
            <span ref={previousValueRef} className="timeline-jump-date-value is-previous">
              {indicator.previousValue ? formatDate(indicator.previousValue, lang) : ''}
            </span>
            <span ref={currentValueRef} className="timeline-jump-date-value is-current">
              {formatDate(indicator.value, lang)}
            </span>
          </span>
        </label>
        <span
          className={`timeline-jump-today-slot${nearToday ? ' is-hidden' : ''}`}
          aria-hidden={nearToday || undefined}
        >
          <span className="timeline-jump-today-clip">
            <button
              type="button"
              className="timeline-jump-today"
              onClick={onToday}
              tabIndex={nearToday ? -1 : 0}
              data-tour="timeline-jump-today"
            >
              {todayDirection === 'up' ? (
                <ArrowUp size={12} aria-hidden="true" />
              ) : todayDirection === 'down' ? (
                <ArrowDown size={12} aria-hidden="true" />
              ) : (
                <Target size={12} aria-hidden="true" />
              )}
              <span>{todayLabel}</span>
            </button>
          </span>
        </span>
      </div>
    </div>
  )
})

export function DossierView({
  application,
  draft,
  tab,
  saving,
  isDirty,
  profileAssets,
  recommenderOptions,
  pendingRecommenderDrafts,
  onPendingRecommenderDraftsChange,
  onResolveRecommender,
  session,
  deferHeavyContent = false,
  aiKeys = [],
  onAiDraft,
  onAiInspectorOpenChange,
  onNotify,
  onTab,
  onDraft,
  onSave,
  onDiscardDraft,
  onDelete,
  onShare,
  onEnrich,
  onResolveSchoolLogo,
  onUploadSchoolLogo,
  onRemoveSchoolLogo,
  canToggleTeamVisibility = false,
  teamTransferRequiresApproval = true,
  teamTransferOrganizations = [],
  onPreflightTeamTransfer,
  onToggleTeamVisibility,
  onCustomApplicationStatusesChange,
  onCustomChecklistStatusesChange,
  onCustomChecklistMaterialFormatsChange,
  onCloseApplication,
  onOpenUpgrade,
  onRegisterNavigationGuard,
  saveErrorMessage,
  onReviewSaveFailure,
  onDraftInteraction,
  autoSaveEnabled = false,
  onFlushAutoSave,
  onCopy,
  onAddReviewComment,
  currentUserApplicationRole,
  applicationOwnerName,
  onUpload,
  onDownload,
  onPreview,
  onUploadMaterialFiles,
  onUploadTaskFiles,
  onRemoveMaterialFile,
  onRemoveTaskFile,
  onRenameMaterialFile,
  onRenameTaskFile,
  onUpdateTask,
  onToggleTask,
  onRemoveTask,
  onRemoveTasks,
  onAddCommunication,
  onUpdateCommunication,
  onSetCommunicationCategory,
  onCustomMailCategoriesChange,
  onClassifyCommunications,
  classifyingCommunicationIds = EMPTY_CLASSIFYING_COMMUNICATION_IDS,
  onAddToInterviewPrep,
  onSendCommunication,
  onRemoveCommunication,
  onRemoveCommunications,
  onAddScholarship,
  onUpdateScholarship,
  onRemoveScholarship,
  onRemoveScholarships,
  onAddFee,
  onUpdateFee,
  onDeleteFee,
  onAddTimelineEvent,
  onUpdateTimelineEvent,
  onRemoveTimelineEvent,
  onRemoveTimelineEvents,
  jumpIntent,
  onJumpIntentConsumed,
  allowedTabs,
  readOnly = false,
  readOnlyBanner,
  canShareApplication,
  canDeliverMail,
  canDeleteApplication,
}: {
  application: ApplicationRecord
  draft: ApplicationRecord
  tab: DetailTab
  saving: boolean
  isDirty: boolean
  profileAssets: ProfileAsset[]
  /** Owner-scoped suggestions. An explicit empty list must remain empty in Team/read-only contexts. */
  recommenderOptions?: readonly RecommenderComboboxOption[]
  /**
   * Anonymous rows live outside the persisted application until they identify
   * a teacher. App can own them so a same-record Dossier remount cannot erase
   * an editor the applicant has just opened.
   */
  pendingRecommenderDrafts?: readonly MaterialRecommender[]
  onPendingRecommenderDraftsChange?: (drafts: MaterialRecommender[]) => void
  /** Atomically resolves a saved row against the owner's shared recommender profile. */
  onResolveRecommender?: (
    recommender: MaterialRecommender,
    decision: ApplicationRecommenderDecision,
  ) => Promise<void>
  session: AuthSession
  /** True while the parent is capturing a lightweight View Transition target. */
  deferHeavyContent?: boolean
  aiKeys?: AiKey[]
  onAiDraft?: (input: AiDraftInput, onEvent: (event: AiDraftEvent) => void, signal?: AbortSignal) => Promise<void>
  onAiInspectorOpenChange?: (open: boolean) => void
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
  onTab: (tab: DetailTab, direction?: 'forward' | 'backward') => void
  onRegisterNavigationGuard?: (guard: ((proceed: () => void) => boolean) | null) => void
  /** Localized reason the last autosave was refused, shown in the leave dialog. */
  saveErrorMessage?: string
  /** Re-surfaces the field the refused save named, so "review" can jump to it. */
  onReviewSaveFailure?: () => void
  /**
   * Claims the current draft as soon as a view-local interaction begins. This
   * lets the App owner cancel a queued stale hydration without treating an
   * intentionally blank inline row as a draft mutation.
   */
  onDraftInteraction?: () => void
  autoSaveEnabled?: boolean
  onFlushAutoSave?: () => Promise<boolean>
  onDraft: (draft: ApplicationRecord, intent?: ApplicationDraftSaveIntent) => void
  onSave: () => boolean | void | Promise<boolean | void>
  onDiscardDraft: () => void
  onDelete: () => void
  onShare: (permission?: SharePermission) => void
  onEnrich?: () => void
  onResolveSchoolLogo?: (
    input: {
      website?: string
      imageUrl?: string
      auto?: true
      refresh?: boolean
    },
    options?: { silent?: boolean },
  ) => Promise<boolean>
  onUploadSchoolLogo?: (file: File) => Promise<boolean>
  onRemoveSchoolLogo?: () => Promise<boolean>
  canToggleTeamVisibility?: boolean
  teamTransferRequiresApproval?: boolean
  teamTransferOrganizations?: TeamWorkspaceOption[]
  onPreflightTeamTransfer?: (visible: boolean, teamId: string) => Promise<TeamTransferPreflight>
  onToggleTeamVisibility?: (visible: boolean, teamId?: string) => boolean | void | Promise<boolean | void>
  onCustomApplicationStatusesChange?: (statuses: ApplicationStatus[]) => void | Promise<void>
  onCustomChecklistStatusesChange?: (statuses: string[]) => void | Promise<void>
  onCustomChecklistMaterialFormatsChange?: (formats: string[]) => void | Promise<void>
  onCloseApplication?: () => void
  onOpenUpgrade?: (feature: string, requested: string, limit?: string) => void
  onCopy?: (value: string, label: string) => void
  onUpload: (file: File | null) => void | Promise<void>
  onPreview?: (fileId: string) => Promise<Blob>
  onUploadMaterialFiles?: (materialId: string, files: File[]) => void | Promise<void>
  onUploadTaskFiles?: (taskId: string, files: File[]) => void | Promise<void>
  onRemoveMaterialFile?: (materialId: string, fileId: string) => void | Promise<void>
  onRemoveTaskFile?: (taskId: string, fileId: string) => void | Promise<void>
  onRenameMaterialFile?: (materialId: string, fileId: string, fileName: string) => void | Promise<void>
  onRenameTaskFile?: (taskId: string, fileId: string, fileName: string) => void | Promise<void>
  onDownload: (fileId?: string, name?: string) => void
  onAddTask: (
    title: string,
    due: string,
    options?: Partial<
      Pick<
        TaskItem,
        | 'details'
        | 'status'
        | 'reminderEnabled'
        | 'reminderOffsets'
        | 'reminderTime'
        | 'reminderRepeat'
        | 'attachmentRequired'
        | 'uploadReserved'
        | 'allowedFileTypes'
      >
    >,
  ) => void
  onUpdateTask?: (
    taskId: string,
    patch: Partial<
      Pick<
        TaskItem,
        | 'title'
        | 'due'
        | 'done'
        | 'status'
        | 'details'
        | 'reminderEnabled'
        | 'reminderOffsets'
        | 'reminderTime'
        | 'reminderRepeat'
        | 'attachmentRequired'
        | 'uploadReserved'
        | 'allowedFileTypes'
      >
    >,
  ) => void
  onToggleTask: (taskId: string, done: boolean, status?: string) => void
  onRemoveTask: (taskId: string) => void
  onRemoveTasks?: (taskIds: string[]) => void
  onAddCommunication: (input: CommunicationInput) => boolean | void | Promise<boolean | void>
  onUpdateCommunication?: (id: string, input: CommunicationPatchInput) => boolean | void | Promise<boolean | void>
  /** Persists this account's own correspondence categories. */
  onCustomMailCategoriesChange?: (categories: CustomMailCategory[]) => void | Promise<void>
  /** Replaces the manual selection outright; an empty list clears it. */
  onSetCommunicationCategory?: (
    communicationIds: string[],
    categories: string[],
  ) => boolean | void | Promise<boolean | void>
  onClassifyCommunications?: (communicationIds: string[]) => boolean | void | Promise<boolean | void>
  classifyingCommunicationIds?: ReadonlySet<string>
  onAddToInterviewPrep?: (input: {
    applicationId: string
    communicationId: string
    subject: string
    school: string
    program: string
    advisor: string
  }) => boolean | void | Promise<boolean | void>
  onSendCommunication?: (input: CommunicationSendInput) => Promise<boolean>
  onRemoveCommunication: (id: string) => void
  onRemoveCommunications?: (ids: string[]) => void
  onAddScholarship: (input: Omit<ScholarshipItem, 'id'>) => boolean | void | Promise<boolean | void>
  onUpdateScholarship?: (id: string, input: Omit<ScholarshipItem, 'id'>) => boolean | void | Promise<boolean | void>
  onRemoveScholarship: (id: string) => void
  onRemoveScholarships?: (ids: string[]) => void
  onAddFee: (input: {
    amount: number
    currency: string
    paidDate?: string
    waived: boolean
    notes: string
  }) => boolean | void | Promise<boolean | void>
  onUpdateFee: (
    feeId: string,
    patch: {
      amount?: number
      currency?: string
      paidDate?: string | null
      waived?: boolean
      notes?: string
    },
  ) => boolean | void | Promise<boolean | void>
  onDeleteFee: (feeId: string) => void | Promise<void>
  onAddTimelineEvent?: (title: string, date: string, note: string) => boolean | void | Promise<boolean | void>
  onUpdateTimelineEvent?: (
    id: string,
    title: string,
    date: string,
    note: string,
  ) => boolean | void | Promise<boolean | void>
  onRemoveTimelineEvent?: (id: string) => void
  onRemoveTimelineEvents?: (ids: string[]) => void
  onAddReviewComment?: (
    body: string,
    targetTab?: DetailTab,
    parentId?: string,
    mentionedUserIds?: string[],
  ) => void | Promise<void>
  // Only set when viewing this application through the team-scoped workspace — the caller's
  // effective role on THIS application ('owner' also covers "it's my own app").
  // undefined/null means the personal workspace.
  currentUserApplicationRole?: TeamRole | null
  // Only set (and only when it isn't the viewer's own application) in the team-scoped workspace.
  applicationOwnerName?: string
  jumpIntent?: DossierJumpIntent | null
  onJumpIntentConsumed?: (token: number) => void
  /** Restrict visible dossier tabs (e.g. shared application sections). */
  allowedTabs?: DetailTab[]
  /** Disable all nested form controls and hide owner mutation affordances. */
  readOnly?: boolean
  /** Optional override for the default read-only banner copy. */
  readOnlyBanner?: string
  /** Share management is independently delegable from dossier editing in Team workspaces. */
  canShareApplication?: boolean
  /** SMTP delivery is only available after a desktop app connects to a deployed web system. */
  canDeliverMail?: boolean
  /** Team teachers/admins may remove an assigned student's application into their own recycle bin. */
  canDeleteApplication?: boolean
}) {
  const { tx, format, lang } = useI18n()
  // The tab strip is an interaction-critical surface. Keep its selected state
  // on the urgent path, while the dense panel tree is allowed to finish on a
  // background render. This keeps the previous panel visible instead of
  // blocking the click on checklist/mail/timeline data preparation.
  const renderedTab = useDeferredValue(tab)
  const [teamTransferDirection, setTeamTransferDirection] = useState<'join' | 'leave' | null>(null)
  const attachmentTableColumns = useMemo<TableColumnDef[]>(
    () => [
      {
        id: 'name',
        label: tx('dossier.uploadFileName'),
        defaultWidth: 220,
        minWidth: 120,
      },
      {
        id: 'size',
        label: tx('dossier.fileSize'),
        defaultWidth: 96,
        minWidth: 72,
      },
      {
        id: 'author',
        label: tx('dossier.uploadedBy'),
        defaultWidth: 120,
        minWidth: 80,
      },
      {
        id: 'uploadedAt',
        label: tx('dossier.uploadedAt'),
        defaultWidth: 140,
        minWidth: 100,
      },
      {
        id: 'actions',
        label: tx('dossier.actions'),
        defaultWidth: 236,
        minWidth: 216,
        hideable: false,
        resizable: false,
      },
    ],
    [tx],
  )
  const {
    api: attachmentTableApi,
    openMenu: openAttachmentTableMenu,
    menuNode: attachmentTableMenuNode,
  } = useTableColumnMenu('dossier-attachments', attachmentTableColumns)
  const attachmentCol = useMemo(
    () =>
      Object.fromEntries(attachmentTableColumns.map((column) => [column.id, column])) as Record<string, TableColumnDef>,
    [attachmentTableColumns],
  )
  const tabContentReady = !deferHeavyContent
  const deferredContentWasPendingRef = useRef(deferHeavyContent)
  const [isHeavyContentRevealing, setIsHeavyContentRevealing] = useState(false)

  useLayoutEffect(() => {
    if (deferHeavyContent) {
      deferredContentWasPendingRef.current = true
      setIsHeavyContentRevealing(false)
      return undefined
    }
    if (!deferredContentWasPendingRef.current) return undefined

    // The shell has already completed its record cross-fade. Let the secondary
    // cards join on the next painted state, then release the class after the
    // compositor-only entrance has settled so rapid switches stay reversible.
    deferredContentWasPendingRef.current = false
    setIsHeavyContentRevealing(true)
    const revealTimer = window.setTimeout(() => setIsHeavyContentRevealing(false), 480)
    return () => window.clearTimeout(revealTimer)
  }, [deferHeavyContent])

  // Checklist rows are the most expensive tab payload: filtering can localize and
  // sort every material/task. Keep that work out of the transition snapshot.
  const checklistContentReady = renderedTab === 'materials' && tabContentReady
  const canUseDrafts =
    session.user.role === 'admin' ||
    session.user.settings.membershipPlan === 'pro' ||
    session.user.settings.membershipPlan === 'team'
  const isReadOnly = readOnly
  const isOwnApplication = application.ownerId === session.user.id
  const personalRecommenderOptions = useMemo<RecommenderComboboxOption[]>(
    () => {
      // App already owns personal/team scoping: personal workspaces pass the
      // account's aggregated directory and Team workspaces pass an explicit
      // empty list. Honour that explicit boundary before falling back to the
      // record owner check so legacy personal applications without ownerId do
      // not lose otherwise valid cross-application suggestions.
      if (recommenderOptions !== undefined) return [...recommenderOptions]
      if (!isOwnApplication) return []
      return (session.user.settings.profileRecommenders ?? []).map((profile) => ({
        ...profile,
        key: `profile:${profile.id}`,
        profileId: profile.id,
      }))
    },
    [isOwnApplication, recommenderOptions, session.user.settings.profileRecommenders],
  )
  const canShare = canShareApplication ?? (!isReadOnly && isOwnApplication)
  const canSendMail = canDeliverMail !== false
  const canDelete = !isReadOnly && (canDeleteApplication ?? isOwnApplication)
  const pendingTeamTransfer =
    application.teamTransferRequest?.status === 'pending' ? application.teamTransferRequest : null
  const isTeamVisible = Boolean(application.teamId)
  const canManageTeamVisibility = canToggleTeamVisibility && !isReadOnly
  const isDirectManagedTransfer = canManageTeamVisibility && !isOwnApplication && !teamTransferRequiresApproval
  const shouldShowTeamVisibility =
    !isReadOnly && Boolean(pendingTeamTransfer || (!isOwnApplication && isTeamVisible) || canManageTeamVisibility)
  const teamVisibilityTitle = pendingTeamTransfer
    ? pendingTeamTransfer.direction === 'join'
      ? tx('dossier.teamVisibilityPendingJoinTitle')
      : tx('dossier.teamVisibilityPendingLeaveTitle')
    : isTeamVisible
      ? tx('dossier.teamVisibilityVisibleTitle')
      : tx('dossier.teamVisibilityPrivateTitle')
  const teamVisibilityDesc = pendingTeamTransfer
    ? pendingTeamTransfer.direction === 'join'
      ? tx('dossier.teamVisibilityPendingJoinDesc')
      : tx('dossier.teamVisibilityPendingLeaveDesc')
    : isTeamVisible
      ? tx('dossier.teamVisibilityVisibleDesc')
      : tx('dossier.teamVisibilityPrivateDesc')
  const teamFeedbackAvailable = Boolean(application.teamId && currentUserApplicationRole)
  const detailTabs: DetailTab[] = useMemo(() => {
    if (allowedTabs && allowedTabs.length > 0) {
      const unique = allowedTabs
        .filter((item, index) => allowedTabs.indexOf(item) === index)
        .filter((item) => item !== 'review' || teamFeedbackAvailable)
      return unique.length > 0 ? unique : ['dossier']
    }
    return teamFeedbackAvailable ? [...BASE_DETAIL_TABS, 'review'] : BASE_DETAIL_TABS
  }, [allowedTabs, teamFeedbackAvailable])
  const directionForTab = useCallback(
    (nextTab: DetailTab) => (detailTabs.indexOf(nextTab) >= detailTabs.indexOf(tab) ? 'forward' : 'backward'),
    [detailTabs, tab],
  )
  const defaultCorrespondenceMode: CorrespondenceMode = 'draft-email'

  // Form state
  const [pendingChecklistCreate, setPendingChecklistCreate] = useState<PendingChecklistCreate | null>(null)
  const [savingPendingChecklistCreate, setSavingPendingChecklistCreate] = useState(false)
  const [scholarshipAddOpen, setScholarshipAddOpen] = useState(false)
  const [scholarshipDraft, setScholarshipDraft] = useState<ScholarshipFormDraft>(() =>
    createScholarshipDraft(application.school.name),
  )
  const [expandedScholarships, setExpandedScholarships] = useState<Set<string>>(
    () => new Set(application.scholarships.map((item) => item.id)),
  )
  const previousScholarshipIdsRef = useRef<Set<string>>(new Set(application.scholarships.map((item) => item.id)))
  const [editingScholarshipId, setEditingScholarshipId] = useState<string | null>(null)
  const [scholarshipEditDraft, setScholarshipEditDraft] = useState<ScholarshipFormDraft | null>(null)
  const [savingScholarshipId, setSavingScholarshipId] = useState<string | null>(null)
  const [optimisticScholarships, setOptimisticScholarships] = useState<Record<string, ScholarshipItem>>({})
  const [scholarshipMaterialPreviousStatuses, setScholarshipMaterialPreviousStatuses] = useState<
    Record<string, MaterialStatus>
  >({})
  const recentScholarshipTimelineEventIdRef = useRef<string | null>(null)
  const [timelineTitle, setTimelineTitle] = useState('')
  const [timelineDate, setTimelineDate] = useState(today)
  const [timelineNote, setTimelineNote] = useState('')
  const [timelineAddOpen, setTimelineAddOpen] = useState(false)
  const [timelineNearToday, setTimelineNearToday] = useState(true)
  const timelineNearTodayRef = useRef(true)
  const [timelineTodayDirection, setTimelineTodayDirection] = useState<'up' | 'down' | 'here'>('here')
  const [timelineJumpUsesViewportPortal, setTimelineJumpUsesViewportPortal] = useState(
    () => typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 820px)').matches ?? false),
  )
  const [timelineJumpPageVisible, setTimelineJumpPageVisible] = useState(false)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDate, setEditDate] = useState(today)
  const [editNote, setEditNote] = useState('')
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())
  const [newTag, setNewTag] = useState('')
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreviewFile | null>(null)
  const [expandedDossierResourceCards, setExpandedDossierResourceCards] = useState<Set<string>>(new Set())
  // Resource cards open expanded so the page reads as filled-in content rather
  // than a stack of closed headers. Seeded once per application so a card the
  // user collapses stays collapsed while they stay on that record.
  const seededDossierResourceExpansionRef = useRef<string | null>(null)
  const [editingDossierResourceCardId, setEditingDossierResourceCardId] = useState<string | null>(null)
  const [dossierResourceSettingsDraft, setDossierResourceSettingsDraft] =
    useState<DossierResourceCardSettingsDraft | null>(null)
  const [recentDossierResourceCardId, setRecentDossierResourceCardId] = useState<string | null>(null)
  const [recentDossierResourceFieldId, setRecentDossierResourceFieldId] = useState<string | null>(null)
  const [dossierResourceIconSearch, setDossierResourceIconSearch] = useState('')
  const [dossierResourceDrag, setDossierResourceDrag] = useState<{
    id: string
  } | null>(null)
  const [dossierResourceDropTarget, setDossierResourceDropTarget] = useState<DossierResourceDropTarget>(null)
  const [dossierResourceDragOffset, setDossierResourceDragOffset] = useState<DossierResourceDragOffset>(null)
  const [expandedMaterials, setExpandedMaterials] = useState<Set<string>>(new Set())
  const [materialVisualGroupPins, setMaterialVisualGroupPins] = useState<Record<string, string>>({})
  const [materialGroupArrivalIds, setMaterialGroupArrivalIds] = useState<Set<string>>(new Set())
  const [expandedChecklistTasks, setExpandedChecklistTasks] = useState<Set<string>>(new Set())
  const [materialExpansionSyncVersion, setMaterialExpansionSyncVersion] = useState(0)
  const materialGroupMoveTimersRef = useRef<Record<string, number>>({})
  const [taskExpansionSyncVersion, setTaskExpansionSyncVersion] = useState(0)
  const [pendingTimelineNav, setPendingTimelineNav] = useState<TimelineNav | null>(null)
  const [checklistSearch, setChecklistSearch] = useState('')
  const [checklistToolsOpen, setChecklistToolsOpen] = useState(false)
  const [checklistToolsCompact, setChecklistToolsCompact] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 820px)').matches,
  )
  const [materialFilter, setMaterialFilter] = useState<MaterialFilter>('all')
  const [checklistFilterAnimKey, setChecklistFilterAnimKey] = useState(0)
  const [materialGroupFilter, setMaterialGroupFilter] = useState('all')
  const [materialSort, setMaterialSort] = useState<MaterialSort>('manual')
  const [materialPreviousStatuses, setMaterialPreviousStatuses] = useState<Record<string, MaterialStatus>>({})
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [taskSort, setTaskSort] = useState<TaskSort>('manual')
  const [recentChecklistItem, setRecentChecklistItem] = useState<ChecklistDragTarget>(null)
  const [removingMaterialIds, setRemovingMaterialIds] = useState<Set<string>>(new Set())
  const [removingTaskIds, setRemovingTaskIds] = useState<Set<string>>(new Set())
  const [removingCommunicationIds, setRemovingCommunicationIds] = useState<Set<string>>(new Set())
  const [removingScholarshipIds, setRemovingScholarshipIds] = useState<Set<string>>(new Set())
  const [removingTimelineIds, setRemovingTimelineIds] = useState<Set<string>>(new Set())
  const [reviewCommentText, setReviewCommentText] = useState('')
  const [reviewCommentBusy, setReviewCommentBusy] = useState(false)
  const [reviewReplyToId, setReviewReplyToId] = useState<string | null>(null)
  const [reviewReplyText, setReviewReplyText] = useState('')
  const [feedbackNote, setFeedbackNote] = useState('')
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null)
  const [confirmRemoveAttachment, setConfirmRemoveAttachment] = useState<{
    kind: 'material' | 'task'
    itemId: string
    fileId: string
  } | null>(null)
  const [confirmRemoveCommunicationId, setConfirmRemoveCommunicationId] = useState<string | null>(null)
  const [confirmRemoveScholarshipId, setConfirmRemoveScholarshipId] = useState<string | null>(null)
  const [checklistUploadTarget, setChecklistUploadTarget] = useState<ChecklistUploadTarget>(null)
  const [checklistUploadOpen, setChecklistUploadOpen] = useState(false)
  const [uploadDraftFiles, setUploadDraftFiles] = useState<UploadDraftFile[]>([])
  const [uploadBaseName, setUploadBaseName] = useState('')
  const [uploadAllowedPresetIds, setUploadAllowedPresetIds] = useState<string[]>([])
  const [uploadCustomTypes, setUploadCustomTypes] = useState('')
  const [uploadTypeError, setUploadTypeError] = useState('')
  const [uploadReservationEnabled, setUploadReservationEnabled] = useState(false)
  const [uploadSubmitting, setUploadSubmitting] = useState(false)
  const finalizeChecklistUploadClose = useCallback(() => {
    setChecklistUploadOpen(false)
    setChecklistUploadTarget(null)
    setUploadDraftFiles([])
    setUploadBaseName('')
    setUploadAllowedPresetIds([])
    setUploadCustomTypes('')
    setUploadTypeError('')
    setUploadReservationEnabled(false)
  }, [])
  const { exiting: checklistUploadExiting, requestClose: requestChecklistUploadClose } = useAnimatedClose(
    checklistUploadOpen,
    finalizeChecklistUploadClose,
    180,
    application.id,
  )
  const checklistUploadDialogRef = useModalA11y<HTMLDivElement>({
    open: checklistUploadOpen,
    onClose: () => requestChecklistUploadClose(),
  })
  const [reminderMenu, setReminderMenu] = useState<ReminderMenuTarget>(null)
  const [closingReminderMenu, setClosingReminderMenu] = useState<ReminderMenuTarget>(null)
  const [reminderPopoverStyle, setReminderPopoverStyle] = useState<CSSProperties>({})
  const [explorerMenu, setExplorerMenu] = useState<ExplorerContextMenuState | null>(null)
  const [recoveredEmailComposer] = useState(() =>
    loadRecoverableEmailComposer(session.user.id, application.id),
  )
  const initialScheduledEmailRef = useRef(
    recoveredEmailComposer
      ? { date: recoveredEmailComposer.scheduledDate, time: recoveredEmailComposer.scheduledTime }
      : defaultScheduledEmailTime(),
  )
  const [emailSubject, setEmailSubject] = useState(recoveredEmailComposer?.subject ?? '')
  const [emailBody, setEmailBody] = useState(recoveredEmailComposer?.body ?? '')
  const [emailRecipient, setEmailRecipient] = useState(
    () => recoveredEmailComposer?.recipient ?? normalizeCorrespondenceEmail(draft.professor.email),
  )
  const [emailScheduleDate, setEmailScheduleDate] = useState(today)
  const [emailScheduleTime, setEmailScheduleTime] = useState('')
  const [scheduledSendDate, setScheduledSendDate] = useState(initialScheduledEmailRef.current.date)
  const [scheduledSendTime, setScheduledSendTime] = useState(initialScheduledEmailRef.current.time)
  const composerDeliveryIdRef = useRef(recoveredEmailComposer?.deliveryId || createComposerDeliveryId())
  const [emailAttachments, setEmailAttachments] = useState<EmailAttachmentDraft[]>(() =>
    (recoveredEmailComposer?.attachments ?? []).map((attachment) => ({
      ...attachment,
      fileName: attachment.fileName ?? attachment.name,
    })),
  )
  const [activeComposerDraftId, setActiveComposerDraftId] = useState(
    recoveredEmailComposer?.activeDraftId ?? null,
  )
  const [composerBusy, setComposerBusy] = useState<'save' | 'send' | null>(null)
  const [emailInsertAnimating, setEmailInsertAnimating] = useState(false)
  const [emailAiGenerating, setEmailAiGenerating] = useState(false)
  const [emailAiSettling, setEmailAiSettling] = useState(false)
  const [emailAiRestoreAnimating, setEmailAiRestoreAnimating] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [aiDraftSessionKey, setAiDraftSessionKey] = useState(0)
  const [aiDraftMode, setAiDraftMode] = useState<'compose' | 'reply'>('compose')
  const [aiReplyToId, setAiReplyToId] = useState<string | null>(null)
  const [replyContextExpanded, setReplyContextExpanded] = useState(false)
  const [replyComposerNavigationToken, setReplyComposerNavigationToken] = useState(0)
  const [lastInsertSelection, setLastInsertSelection] = useState<{
    ids: string[]
    language: InsertLanguage
  } | null>(null)
  const [renamingAttachmentId, setRenamingAttachmentId] = useState<string | null>(null)
  const [renameAttachmentValue, setRenameAttachmentValue] = useState('')
  /** Checklist material/task file rename: `${kind}:${itemId}:${fileId}` */
  const [renamingChecklistFileKey, setRenamingChecklistFileKey] = useState<string | null>(null)
  const [renameChecklistFileValue, setRenameChecklistFileValue] = useState('')
  const renameChecklistFileInputRef = useRef<HTMLInputElement | null>(null)
  const [correspondenceKind, setCorrespondenceKind] = useState<CorrespondenceKind>('outgoing-email')
  const [composerOpen, setComposerOpen] = useState(Boolean(recoveredEmailComposer))
  const [correspondenceMode, setCorrespondenceMode] = useState<CorrespondenceMode>(defaultCorrespondenceMode)
  const [correspondenceView, setCorrespondenceView] = useState<CorrespondenceView>(
    recoveredEmailComposer?.activeDraftId ? 'drafts' : 'all',
  )
  const [communicationCategoryFilters, setCommunicationCategoryFilters] =
    useState<CommunicationCategoryFilter[]>(['all'])
  const [communicationRenderLimit, setCommunicationRenderLimit] = useState(50)
  const [recordDirection, setRecordDirection] = useState<RecordDirection>('sent')
  const [recordFromOverride, setRecordFromOverride] = useState<string | null>(null)
  const [recordToOverride, setRecordToOverride] = useState<string | null>(null)
  const [editingCommunicationId, setEditingCommunicationId] = useState<string | null>(null)
  const [communicationEditDraft, setCommunicationEditDraft] = useState<CommunicationPatchInput | null>(null)
  const [activeRouteSwap, setActiveRouteSwap] = useState<string | null>(null)
  const [pendingComposerExit, setPendingComposerExit] = useState<ComposerExitRequest | null>(null)
  const [pendingRecipientSend, setPendingRecipientSend] = useState<PendingRecipientSend | null>(null)
  const [pendingMissingAttachmentSend, setPendingMissingAttachmentSend] = useState<PendingMissingAttachmentSend | null>(
    null,
  )
  const [pendingDraftExit, setPendingDraftExit] = useState<{
    proceed: () => void
    /** The autosave flush was attempted and the server refused it. */
    blocked?: boolean
  } | null>(null)
  const [pendingResourceSettingsExit, setPendingResourceSettingsExit] = useState<{
    proceed?: () => void
    navigation?: boolean
  } | null>(null)
  const [pendingItemEditExit, setPendingItemEditExit] = useState<{
    kind: ItemEditorKind
    ids?: string[]
    proceed?: () => void
    navigation?: boolean
  } | null>(null)
  const [pendingRecommenderDecision, setPendingRecommenderDecision] = useState<MaterialRecommender | null>(null)
  const recommenderDecisionResolveRef = useRef<((decision: ApplicationRecommenderDecision | null) => void) | null>(null)
  // New, anonymous recommendation rows stay outside the persisted application.
  // App owns them in production so this component can be rebuilt without
  // dropping an editor; the local fallback keeps isolated consumers simple.
  const pendingRecommendersAreControlled =
    pendingRecommenderDrafts !== undefined && onPendingRecommenderDraftsChange !== undefined
  const [localPendingRecommenders, setLocalPendingRecommenders] = useState<MaterialRecommender[]>([])
  // A successful explicit save is authoritative for navigation immediately,
  // even though the App-owned pending row stays resident until the canonical
  // application prop acknowledges the same id. Keeping these two phases
  // separate prevents a just-saved teacher from reopening the unsaved-exit
  // dialog during the server/realtime handoff window.
  const [savedPendingRecommenderIds, setSavedPendingRecommenderIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const pendingOverviewRecommenders = pendingRecommendersAreControlled
    ? pendingRecommenderDrafts
    : localPendingRecommenders
  useEffect(() => {
    onAiInspectorOpenChange?.(aiPanelOpen)
  }, [aiPanelOpen, onAiInspectorOpenChange])

  useEffect(() => () => onAiInspectorOpenChange?.(false), [onAiInspectorOpenChange])
  const { exiting: composerExitExiting, requestClose: requestComposerExitClose } = useAnimatedClose(
    pendingComposerExit !== null,
    () => setPendingComposerExit(null),
    undefined,
    application.id,
  )
  const { exiting: draftExitExiting, requestClose: requestDraftExitClose } = useAnimatedClose(
    pendingDraftExit !== null,
    () => setPendingDraftExit(null),
    undefined,
    application.id,
  )
  const { exiting: resourceSettingsExitExiting, requestClose: requestResourceSettingsExitClose } = useAnimatedClose(
    pendingResourceSettingsExit !== null,
    () => setPendingResourceSettingsExit(null),
    undefined,
    application.id,
  )
  const { exiting: itemEditExitExiting, requestClose: requestItemEditExitClose } = useAnimatedClose(
    pendingItemEditExit !== null,
    () => setPendingItemEditExit(null),
    undefined,
    application.id,
  )
  const composerExitDialogRef = useModalA11y<HTMLElement>({
    open: pendingComposerExit !== null,
    onClose: () => requestComposerExitClose(),
  })
  const draftExitDialogRef = useModalA11y<HTMLElement>({
    open: pendingDraftExit !== null,
    onClose: () => requestDraftExitClose(),
  })
  const resourceSettingsExitDialogRef = useModalA11y<HTMLElement>({
    open: pendingResourceSettingsExit !== null,
    onClose: () => requestResourceSettingsExitClose(),
  })
  const itemEditExitDialogRef = useModalA11y<HTMLElement>({
    open: pendingItemEditExit !== null,
    onClose: () => requestItemEditExitClose(),
  })
  const draftRef = useRef(draft)
  const pendingChecklistCreateRef = useRef<PendingChecklistCreate | null>(pendingChecklistCreate)
  pendingChecklistCreateRef.current = pendingChecklistCreate
  const pendingOverviewRecommendersRef = useRef<readonly MaterialRecommender[]>(pendingOverviewRecommenders)
  pendingOverviewRecommendersRef.current = pendingOverviewRecommenders
  const savedPendingRecommenderIdsRef = useRef<ReadonlySet<string>>(savedPendingRecommenderIds)
  savedPendingRecommenderIdsRef.current = savedPendingRecommenderIds
  const markPendingRecommenderSaved = useCallback((recommenderId: string, saved: boolean) => {
    const current = savedPendingRecommenderIdsRef.current
    if (saved === current.has(recommenderId)) return
    const next = new Set(current)
    if (saved) next.add(recommenderId)
    else next.delete(recommenderId)
    savedPendingRecommenderIdsRef.current = next
    setSavedPendingRecommenderIds(next)
  }, [])
  const requestRecommenderDecision = useCallback((recommender: MaterialRecommender) => {
    recommenderDecisionResolveRef.current?.(null)
    setPendingRecommenderDecision(recommender)
    return new Promise<ApplicationRecommenderDecision | null>((resolve) => {
      recommenderDecisionResolveRef.current = resolve
    })
  }, [])
  const settleRecommenderDecision = useCallback((decision: ApplicationRecommenderDecision | null) => {
    const resolve = recommenderDecisionResolveRef.current
    recommenderDecisionResolveRef.current = null
    setPendingRecommenderDecision(null)
    resolve?.(decision)
  }, [])
  useEffect(() => () => {
    recommenderDecisionResolveRef.current?.(null)
    recommenderDecisionResolveRef.current = null
  }, [])
  const replacePendingOverviewRecommenders = useCallback(
    (next: MaterialRecommender[]) => {
      pendingOverviewRecommendersRef.current = next
      const nextIds = new Set(next.map((recommender) => recommender.id))
      const acknowledged = savedPendingRecommenderIdsRef.current
      if (Array.from(acknowledged).some((id) => !nextIds.has(id))) {
        const pruned = new Set(Array.from(acknowledged).filter((id) => nextIds.has(id)))
        savedPendingRecommenderIdsRef.current = pruned
        setSavedPendingRecommenderIds(pruned)
      }
      if (pendingRecommendersAreControlled) onPendingRecommenderDraftsChange?.(next)
      else setLocalPendingRecommenders(next)
    },
    [onPendingRecommenderDraftsChange, pendingRecommendersAreControlled],
  )
  const previousProfessorEmailRef = useRef(normalizeCorrespondenceEmail(draft.professor.email))
  const activeApplicationIdRef = useRef(application.id)
  const autoSaveNavigationIntentRef = useRef(0)
  const currentSchoolNameRef = useRef(application.school.name)
  currentSchoolNameRef.current = application.school.name
  const composerMutationVersionRef = useRef(0)
  const composerBusyRef = useRef<'save' | 'send' | null>(null)
  const clearEmailComposerRef = useRef<
    ((options?: { preserveRecovery?: boolean }) => boolean) | null
  >(null)
  const communicationEditInitialRef = useRef<string | null>(null)
  const composerBodyControllerRef = useRef<MarkdownTextareaController | null>(null)
  const dossierResourceDragSessionRef = useRef<DossierResourceDragSession | null>(null)
  const dossierResourceDropTargetRef = useRef<DossierResourceDropTarget>(null)
  const dossierResourceSettingsInitialRef = useRef<string | null>(null)
  const dossierResourceListRef = useRef<HTMLDivElement | null>(null)
  const checklistDragSessionRef = useRef<ChecklistDragSession | null>(null)
  const scholarshipDragPreviewRef = useRef<ScholarshipDragPreview | null>(null)
  const scholarshipDragReducedMotionRef = useRef(false)
  const reminderAnchorRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const reminderPopoverRef = useRef<HTMLDivElement | null>(null)
  const reminderCloseTimerRef = useRef<number | null>(null)
  const previousTabRef = useRef<DetailTab>(tab)
  const tabStripRef = useRef<HTMLDivElement | null>(null)
  const tabButtonRefs = useRef<Partial<Record<DetailTab, HTMLButtonElement | null>>>({})
  const dossierTabSelectRef = useRef<(nextTab: DetailTab, markOptimistic: () => void) => void>(() => {})
  const setDossierTabButtonRef = useCallback((key: DetailTab, node: HTMLButtonElement | null) => {
    tabButtonRefs.current[key] = node
  }, [])
  const correspondenceViewRowRef = useRef<HTMLDivElement | null>(null)
  const correspondenceViewButtonRefs = useRef<Partial<Record<CorrespondenceView, HTMLButtonElement | null>>>({})
  const correspondenceModeBarRef = useRef<HTMLDivElement | null>(null)
  const correspondenceModeButtonRefs = useRef<Partial<Record<CorrespondenceMode, HTMLButtonElement | null>>>({})
  const nowMarkerRef = useRef<HTMLDivElement | null>(null)
  const timelinePageRef = useRef<HTMLDivElement | null>(null)
  const removalTimersRef = useRef<number[]>([])
  const routeSwapTimerRef = useRef<number | null>(null)
  const scholarshipSaveTimerRef = useRef<number | null>(null)
  const emailInsertTimersRef = useRef<number[]>([])
  const emailAiSettleTimerRef = useRef<number | null>(null)
  const emailAiWasGeneratingRef = useRef(false)
  /** The exact range/text of the most recent auto-inserted snippet phrase, so a later selection change can replace it in place instead of appending. */
  const lastInsertRangeRef = useRef<{
    selection: MarkdownTextareaSelection
    text: string
    value: string
  } | null>(null)
  /** The full email body an in-flight animated write is converging toward — lets a new insert/replace settle a prior one to its intended end state instead of racing it. */
  const pendingWriteTargetRef = useRef<string | null>(null)
  const composerControllerWriteRef = useRef(false)
  const consumedJumpTokenRef = useRef<number | null>(null)
  const [tabDirection, setTabDirection] = useState<'forward' | 'backward'>('forward')
  const [scholarshipDragPreview, setScholarshipDragPreview] = useState<ScholarshipDragPreview | null>(null)
  const [scholarshipDragReducedMotion, setScholarshipDragReducedMotion] = useState(false)
  const dossierResourceFieldSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )
  const resourceSettingsDirty = Boolean(
    dossierResourceSettingsDraft &&
    dossierResourceSettingsInitialRef.current &&
    JSON.stringify(dossierResourceSettingsDraft) !== dossierResourceSettingsInitialRef.current,
  )
  const editingCommunication = editingCommunicationId
    ? (draft.communications.find((item) => item.id === editingCommunicationId) ?? null)
    : null
  const communicationEditDirty = Boolean(
    editingCommunication &&
    communicationEditDraft &&
    communicationEditInitialRef.current &&
    JSON.stringify(communicationEditDraft) !== communicationEditInitialRef.current,
  )
  const editingScholarship = editingScholarshipId
    ? (application.scholarships.find((item) => item.id === editingScholarshipId) ?? null)
    : null
  const scholarshipEditDirty = Boolean(
    editingScholarship &&
    scholarshipEditDraft &&
    scholarshipDraftHasMeaningfulChanges(
      scholarshipEditDraft,
      scholarshipToDraft(editingScholarship, application.school.name),
    ),
  )
  const scholarshipAddDirty = Boolean(
    scholarshipAddOpen &&
    scholarshipDraftHasMeaningfulChanges(
      scholarshipDraft,
      createScholarshipDraft(application.school.name),
    ),
  )
  const editingTimelineEvent = editingEventId
    ? (application.timeline.find((item) => item.id === editingEventId) ?? null)
    : null
  const timelineEditDirty = Boolean(
    editingTimelineEvent &&
    (editTitle !== editingTimelineEvent.title ||
      editDate !== editingTimelineEvent.date ||
      editNote !== editingTimelineEvent.note),
  )
  const itemEditDirty = communicationEditDirty || scholarshipEditDirty || timelineEditDirty
  const pendingOverviewRecommenderIsDirty = useCallback((recommender: MaterialRecommender) => {
    const persisted = applicationRecommendersForDraft(draft).find((candidate) => candidate.id === recommender.id)
    return persisted
      ? !applicationRecommenderFieldsEqual(persisted, recommender)
      : hasApplicationRecommenderContent(recommender)
  }, [draft])
  const dirtyPendingRecommenderIds = pendingOverviewRecommenders
    .filter((recommender) => (
      pendingOverviewRecommenderIsDirty(recommender)
      && !savedPendingRecommenderIds.has(recommender.id)
    ))
    .map((recommender) => recommender.id)
  const pendingChecklistCreateItem = pendingChecklistCreate?.kind === 'material'
    ? draft.materials.find((material) => material.id === pendingChecklistCreate.id)
    : pendingChecklistCreate?.kind === 'task'
      ? draft.tasks.find((task) => task.id === pendingChecklistCreate.id)
      : undefined
  const pendingChecklistCreateDirty = Boolean(
    pendingChecklistCreate &&
    pendingChecklistCreateItem &&
    JSON.stringify(pendingChecklistCreateItem) !== pendingChecklistCreate.baseline,
  )

  const due = daysUntil(application.deadline)
  const urgency = deadlineUrgency(due)
  const priorityLevel = priorityToLevel(draft.priority)
  const priorityLevelTone = priorityTone(draft.priority)
  const localize = useCallback((value: string) => localizeStaticText(value, lang), [lang])
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  useEffect(() => {
    const savedById = new Map(
      applicationRecommendersForDraft(application).map((recommender) => [recommender.id, recommender]),
    )
    const current = pendingOverviewRecommendersRef.current
    const acknowledged = savedPendingRecommenderIdsRef.current
    const next = current.filter((recommender) => {
      if (!acknowledged.has(recommender.id)) return true
      const saved = savedById.get(recommender.id)
      return !saved || !applicationRecommenderFieldsEqual(saved, recommender)
    })
    if (next.length !== current.length) replacePendingOverviewRecommenders(next)
  }, [application, replacePendingOverviewRecommenders, savedPendingRecommenderIds])
  useEffect(() => {
    const pending = pendingChecklistCreateRef.current
    if (!pending) return
    const canonicalOwnsPending = pending.kind === 'material'
      ? application.materials.some((material) => material.id === pending.id)
      : application.tasks.some((task) => task.id === pending.id)
    if (!canonicalOwnsPending) return
    pendingChecklistCreateRef.current = null
    setPendingChecklistCreate(null)
    setSavingPendingChecklistCreate(false)
  }, [application.materials, application.tasks])
  useEffect(() => {
    if (pendingRecommendersAreControlled) return
    pendingOverviewRecommendersRef.current = []
    setLocalPendingRecommenders([])
  }, [application.id, pendingRecommendersAreControlled])
  useEffect(() => {
    const nextPrimary = normalizeCorrespondenceEmail(draft.professor.email)
    const previousPrimary = previousProfessorEmailRef.current
    previousProfessorEmailRef.current = nextPrimary
    setEmailRecipient((current) =>
      !current || normalizeCorrespondenceEmail(current) === previousPrimary ? nextPrimary : current,
    )
  }, [draft.professor.email])
  const commitDraft = useCallback(
    (nextDraft: ApplicationRecord, intent: ApplicationDraftSaveIntent = 'settled') => {
      if (isReadOnly) return
      draftRef.current = nextDraft
      onDraft(nextDraft, intent)
    },
    [isReadOnly, onDraft],
  )

  const discardBlankPendingRecommenders = useCallback(() => {
    const current = pendingOverviewRecommendersRef.current
    const persistedIds = new Set(
      applicationRecommendersForDraft(draftRef.current).map((recommender) => recommender.id),
    )
    const next = current.filter((recommender) => (
      persistedIds.has(recommender.id) || hasApplicationRecommenderContent(recommender)
    ))
    if (next.length === current.length) return false
    replacePendingOverviewRecommenders(next)
    return true
  }, [replacePendingOverviewRecommenders])

  const discardPendingChecklistCreate = useCallback(() => {
    const pending = pendingChecklistCreateRef.current
    if (!pending) return false
    const currentDraft = draftRef.current
    const nextDraft = pending.kind === 'material'
      ? {
          ...currentDraft,
          materials: currentDraft.materials.filter((material) => material.id !== pending.id),
        }
      : {
          ...currentDraft,
          tasks: currentDraft.tasks.filter((task) => task.id !== pending.id),
        }
    pendingChecklistCreateRef.current = null
    setPendingChecklistCreate(null)
    setSavingPendingChecklistCreate(false)
    if (pending.kind === 'material') {
      setExpandedMaterials((current) => {
        const next = new Set(current)
        next.delete(pending.id)
        return next
      })
      setMaterialExpansionSyncVersion((version) => version + 1)
    } else {
      setExpandedChecklistTasks((current) => {
        const next = new Set(current)
        next.delete(pending.id)
        return next
      })
      setTaskExpansionSyncVersion((version) => version + 1)
    }
    commitDraft(nextDraft, 'external')
    return true
  }, [commitDraft])

  const pendingChecklistCreateIsDirty = useCallback(() => {
    const pending = pendingChecklistCreateRef.current
    if (!pending) return false
    const currentDraft = draftRef.current
    const item = pending.kind === 'material'
      ? currentDraft.materials.find((material) => material.id === pending.id)
      : currentDraft.tasks.find((task) => task.id === pending.id)
    return Boolean(item && JSON.stringify(item) !== pending.baseline)
  }, [])

  const pendingChecklistCreateIsValid = useCallback(() => {
    const pending = pendingChecklistCreateRef.current
    if (!pending) return false
    return pending.kind === 'material'
      ? Boolean(draftRef.current.materials.find((material) => material.id === pending.id)?.name.trim())
      : Boolean(draftRef.current.tasks.find((task) => task.id === pending.id)?.title.trim())
  }, [])

  const savePendingChecklistCreate = useCallback(async () => {
    const pending = pendingChecklistCreateRef.current
    if (!pending || !pendingChecklistCreateIsValid() || savingPendingChecklistCreate) return false
    setSavingPendingChecklistCreate(true)
    commitDraft(draftRef.current, 'immediate')
    let saved = false
    try {
      saved = onFlushAutoSave
        ? await onFlushAutoSave()
        : autoSaveEnabled
          ? true
          : (await onSave()) !== false
    } catch {
      saved = false
    }
    if (!saved) {
      setSavingPendingChecklistCreate(false)
      return false
    }
    // Production releases this owner only after the canonical application
    // contains the id. Isolated/non-autosave consumers have no canonical
    // acknowledgement channel, so complete the local handoff immediately.
    if (!onFlushAutoSave) {
      pendingChecklistCreateRef.current = null
      setPendingChecklistCreate(null)
      setSavingPendingChecklistCreate(false)
    }
    return true
  }, [
    autoSaveEnabled,
    commitDraft,
    onFlushAutoSave,
    onSave,
    pendingChecklistCreateIsValid,
    savingPendingChecklistCreate,
  ])

  const requestUnsavedCreationExit = useCallback((proceed?: () => void, navigation = false) => {
    discardBlankPendingRecommenders()
    const recommenderIds = pendingOverviewRecommendersRef.current
      .filter((recommender) => (
        pendingOverviewRecommenderIsDirty(recommender)
        && !savedPendingRecommenderIdsRef.current.has(recommender.id)
      ))
      .map((recommender) => recommender.id)
    if (recommenderIds.length > 0) {
      setPendingItemEditExit({ kind: 'recommender-create', ids: recommenderIds, proceed, navigation })
      return true
    }

    if (pendingChecklistCreateRef.current) {
      if (pendingChecklistCreateIsDirty()) {
        setPendingItemEditExit({
          kind: 'checklist-create',
          ids: [pendingChecklistCreateRef.current.id],
          proceed,
          navigation,
        })
        return true
      }
      discardPendingChecklistCreate()
    }

    if (scholarshipAddOpen) {
      if (scholarshipAddDirty) {
        setPendingItemEditExit({ kind: 'scholarship-add', proceed, navigation })
        return true
      }
      setScholarshipAddOpen(false)
      setScholarshipDraft(createScholarshipDraft(application.school.name))
    }
    return false
  }, [
    application.school.name,
    discardBlankPendingRecommenders,
    discardPendingChecklistCreate,
    pendingChecklistCreateIsDirty,
    pendingOverviewRecommenderIsDirty,
    scholarshipAddDirty,
    scholarshipAddOpen,
  ])
  const beginScholarshipDragPreview = useCallback(
    (preview: ScholarshipDragPreview, reducedMotion: boolean) => {
      scholarshipDragPreviewRef.current = preview
      scholarshipDragReducedMotionRef.current = reducedMotion
      setScholarshipDragReducedMotion(reducedMotion)
      setScholarshipDragPreview(preview)
    },
    [],
  )
  const finishScholarshipDragPreview = useCallback((immediate = false) => {
    const clear = () => {
      scholarshipDragPreviewRef.current = null
      setScholarshipDragPreview(null)
    }
    if (immediate || scholarshipDragReducedMotionRef.current) clear()
  }, [])
  const scholarshipDropAnimation = useMemo<DropAnimationFunction>(
    () => ({ dragOverlay, transform }) => {
      const previewAtAnimationStart = scholarshipDragPreviewRef.current

      return new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          // dnd-kit's overlay already carries the pointer transform. The
          // sortable list has also committed its own order by this point, so
          // calculating another destination transform creates a second motion
          // source and makes the row fly/twitch on release. Keep the transform
          // exactly where the pointer left it and fade the measured preview
          // out while the committed row becomes visible underneath.
          const currentTransform = `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scaleX}, ${transform.scaleY})`
          const animation = dragOverlay.node.animate(
            [
              { transform: currentTransform, opacity: 0.985 },
              { transform: currentTransform, opacity: 0 },
            ],
            {
              duration: SCHOLARSHIP_DROP_ANIMATION.duration,
              easing: SCHOLARSHIP_DROP_ANIMATION.easing,
              fill: 'forwards',
            },
          )
          const finish = () => {
            // The overlay owns this handoff. Clear the preview only after the
            // measured target animation completes, never on a guessed timer.
            if (scholarshipDragPreviewRef.current === previewAtAnimationStart) {
              finishScholarshipDragPreview(true)
            }
            resolve()
          }
          animation.onfinish = finish
          animation.oncancel = finish
        })
      })
    },
    [finishScholarshipDragPreview],
  )
  const checklistMaterials = useMemo(
    () => draft.materials.filter((material) => !isRecommendationMaterial(material)),
    [draft.materials],
  )
  const professorDisplayName =
    (lang === 'zh' ? draft.professor.chinese : draft.professor.english) ||
    draft.professor.english ||
    draft.professor.chinese ||
    tx('dossier.professor')
  const professorAvatarName = draft.professor.english || draft.professor.chinese || professorDisplayName
  const accountCorrespondenceIdentity = {
    name: session.user.name,
    email: session.user.email,
    avatarUrl: session.user.settings.avatarDataUrl,
  }
  const replyTargetCommunication = aiReplyToId
    ? (draft.communications.find((item) => item.id === aiReplyToId) ?? null)
    : null
  const replyTargetTimestamp = replyTargetCommunication ? communicationTimestamp(replyTargetCommunication, lang) : null
  const replyTargetAvatarIdentity = replyTargetCommunication
    ? correspondenceAvatarIdentity(
        replyTargetCommunication,
        professorAvatarName,
        draft.professor.email,
        accountCorrespondenceIdentity,
      )
    : null
  const emailBodyForCommunication = emailBody.trim() || tx('dossier.emptyEmailBody')
  const userSendFrom = session.user.settings.sendFrom || session.user.email
  const receiveEmails = session.user.settings.receiveEmails ?? []
  const primaryReceiveEmail =
    receiveEmails.find((email) => email.isPrimary && (email.verified ?? true))?.address ||
    session.user.settings.receiveAt ||
    session.user.email
  const incomingMailbox = session.user.settings.incomingUser || primaryReceiveEmail
  const trackedRecipientEmails = useMemo(() => applicationCorrespondenceEmails(draft.professor), [draft.professor])
  const selectedRecipient =
    normalizeCorrespondenceEmail(emailRecipient) ||
    trackedRecipientEmails[0] ||
    normalizeCorrespondenceEmail(draft.professor.email)
  const selectedRecipientIsTracked = trackedRecipientEmails.includes(selectedRecipient)
  const queueDestroyAnimation = (
    ids: string[],
    setRemovingIds: Dispatch<SetStateAction<Set<string>>>,
    commit: () => void,
  ) => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
    if (uniqueIds.length === 0) return
    setRemovingIds((current) => {
      const next = new Set(current)
      uniqueIds.forEach((id) => next.add(id))
      return next
    })
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const timer = window.setTimeout(
      () => {
        commit()
        setRemovingIds((current) => {
          const next = new Set(current)
          uniqueIds.forEach((id) => next.delete(id))
          return next
        })
      },
      reduceMotion ? 40 : destroyAnimationMs,
    )
    removalTimersRef.current.push(timer)
  }
  const correspondenceMeta =
    correspondenceKinds.find((item) => item.value === correspondenceKind) ?? correspondenceKinds[0]
  const correspondenceFrom =
    correspondenceMeta.direction === 'outgoing'
      ? userSendFrom
      : correspondenceMeta.direction === 'incoming'
        ? selectedRecipient
        : session.user.email
  const correspondenceTo =
    correspondenceMeta.direction === 'outgoing'
      ? selectedRecipient
      : correspondenceMeta.direction === 'incoming'
        ? incomingMailbox
        : draft.school.name
  const hasComposerContent =
    emailSubject.trim().length > 0 ||
    emailBody.trim().length > 0 ||
    (correspondenceMode !== 'draft-email' && (emailScheduleTime.trim().length > 0 || emailScheduleDate !== today)) ||
    emailAttachments.length > 0
  const composerContentFingerprint = JSON.stringify({
    activeDraftId: activeComposerDraftId,
    attachments: emailAttachments.map((attachment) => ({
      assetId: attachment.assetId,
      fileId: attachment.fileId,
      id: attachment.id,
      lastModified: attachment.file?.lastModified,
      mimeType: attachment.mimeType,
      name: attachment.name,
      size: attachment.file?.size ?? attachment.fileSize,
    })),
    body: emailBody,
    recipient: emailRecipient,
    scheduledDate: scheduledSendDate,
    scheduledTime: scheduledSendTime,
    subject: emailSubject,
  })
  const composerContentFingerprintRef = useRef(composerContentFingerprint)
  const composerRecoveryWarningShownRef = useRef(false)
  useLayoutEffect(() => {
    if (composerContentFingerprintRef.current === composerContentFingerprint) return
    composerContentFingerprintRef.current = composerContentFingerprint
    composerMutationVersionRef.current += 1
    composerDeliveryIdRef.current = createComposerDeliveryId()
  }, [composerContentFingerprint])
  const warnComposerRecoveryUnavailable = useCallback(() => {
    if (composerRecoveryWarningShownRef.current) return
    composerRecoveryWarningShownRef.current = true
    onNotify?.(
      tx(
        'localRecoveryUnavailable',
        'Local draft recovery is unavailable. This page will not reload automatically; save or discard your changes before leaving.',
      ),
      'warning',
    )
  }, [onNotify, tx])
  const persistEmailComposerRecovery = useCallback((
    patch: Partial<
      Pick<
        RecoverableEmailComposer,
        'body' | 'recipient' | 'scheduledDate' | 'scheduledTime' | 'subject'
      >
    > = {},
  ) => {
    if (!composerOpen || correspondenceMode !== 'draft-email') return true
    if (Object.keys(patch).length > 0) {
      composerMutationVersionRef.current += 1
      composerDeliveryIdRef.current = createComposerDeliveryId()
    }
    const subject = patch.subject ?? emailSubject
    const body = patch.body ?? emailBody
    const recipient = patch.recipient ?? emailRecipient
    const scheduledDate = patch.scheduledDate ?? scheduledSendDate
    const scheduledTime = patch.scheduledTime ?? scheduledSendTime
    if (!subject.trim() && !body.trim() && emailAttachments.length === 0) {
      const cleared = clearRecoverableEmailComposer(session.user.id, application.id)
      if (!cleared) warnComposerRecoveryUnavailable()
      return cleared
    }
    const saved = saveRecoverableEmailComposer(session.user.id, application.id, {
      activeDraftId: activeComposerDraftId ?? undefined,
      attachments: emailAttachments
        .filter((attachment) => !attachment.file && Boolean(attachment.fileId || attachment.assetId))
        .map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          fileName: attachment.fileName,
          fileId: attachment.fileId,
          assetId: attachment.assetId,
          fileSize: attachment.fileSize,
          mimeType: attachment.mimeType,
        })),
      body,
      deliveryId: composerDeliveryIdRef.current,
      recipient,
      scheduledDate,
      scheduledTime,
      subject,
      updatedAt: Date.now(),
    })
    if (!saved) warnComposerRecoveryUnavailable()
    return saved
  }, [
    activeComposerDraftId,
    application.id,
    composerOpen,
    correspondenceMode,
    emailAttachments,
    emailBody,
    emailRecipient,
    emailSubject,
    scheduledSendDate,
    scheduledSendTime,
    session.user.id,
    warnComposerRecoveryUnavailable,
  ])
  useEffect(() => {
    persistEmailComposerRecovery()
  }, [composerContentFingerprint, persistEmailComposerRecovery])
  const emailSubjectReady = emailSubject.trim().length > 0
  const emailBodyReady = emailBody.trim().length > 0
  const composerFieldsDisabled = composerBusy !== null || emailAiGenerating || emailInsertAnimating
  const scheduledSendAt = scheduledEmailIso(scheduledSendDate, scheduledSendTime)
  const scheduledSendIsFuture = isFutureScheduledEmail(scheduledSendDate, scheduledSendTime)
  const dossierResourceDefaultValues = useMemo<DossierResourceDefaultValues>(
    () => ({
      school: { website: draft.school.website },
      program: draft.program,
      deadline: draft.deadline,
      professor: {
        email: draft.professor.email,
        homepage: draft.professor.homepage,
        social: draft.professor.social,
        phone: draft.professor.phone,
      },
      tags: draft.tags,
    }),
    [
      draft.deadline,
      draft.professor.email,
      draft.professor.homepage,
      draft.professor.phone,
      draft.professor.social,
      draft.program,
      draft.school.website,
      draft.tags,
    ],
  )
  const dossierResourceCards = useMemo(
    () =>
      renderedTab === 'dossier' && tabContentReady
        ? normalizeDossierResourceCards(draft.dossierCards, dossierResourceDefaultValues, tx)
        : [],
    [dossierResourceDefaultValues, draft.dossierCards, renderedTab, tabContentReady, tx],
  )
  useEffect(() => {
    if (seededDossierResourceExpansionRef.current === application.id) return
    if (dossierResourceCards.length === 0) return
    seededDossierResourceExpansionRef.current = application.id
    setExpandedDossierResourceCards(new Set(dossierResourceCards.map((card) => card.id)))
  }, [application.id, dossierResourceCards])
  const dossierResourceFieldTypeOptions = useMemo(
    () =>
      dossierResourceFieldTypes.map((type) => ({
        value: type,
        label: tx(`dossier.resourceFieldTypes.${type}`),
      })),
    [tx],
  )
  const filteredDossierResourceIconPresets = useMemo(() => {
    const query = dossierResourceIconSearch.trim().toLocaleLowerCase()
    if (!query) return dossierResourceIconPresets
    return dossierResourceIconPresets.filter((preset) =>
      [tx(preset.labelKey, preset.label), preset.label, preset.id, preset.icon]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query),
    )
  }, [dossierResourceIconSearch, tx])

  const commitDossierResourceCards = useCallback(
    (cards: DossierResourceCard[]) => {
      const currentDraft = draftRef.current
      commitDraft(
        {
          ...currentDraft,
          dossierCards: cards.map((card) => ({
            ...card,
            icon: normalizeDossierResourceIcon(card.icon),
            color: normalizeDossierResourceColor(card.color),
            width: normalizeDossierResourceCardWidth(card.width),
            fields: card.fields.map((field) => {
              const type = isDossierResourceFieldType(field.type) ? field.type : 'text'
              return {
                ...field,
                type,
                value: field.value ?? '',
                width: normalizeDossierResourceFieldWidth(field.width, type),
              }
            }),
          })),
        },
        'immediate',
      )
    },
    [commitDraft],
  )

  const animateDossierResourceLayout = useCallback((update: () => void) => {
    const list = dossierResourceListRef.current
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (!list || reduceMotion) {
      update()
      return
    }
    const before = new Map<string, DOMRect>()
    list.querySelectorAll<HTMLElement>('[data-resource-layout-key]').forEach((element) => {
      const key = element.dataset.resourceLayoutKey
      if (key) before.set(key, element.getBoundingClientRect())
    })
    flushSync(update)
    list.querySelectorAll<HTMLElement>('[data-resource-layout-key]').forEach((element) => {
      const key = element.dataset.resourceLayoutKey
      const previous = key ? before.get(key) : null
      if (!previous) return
      const next = element.getBoundingClientRect()
      const dx = previous.left - next.left
      const dy = previous.top - next.top
      const scaleX = next.width > 0 ? previous.width / next.width : 1
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(scaleX - 1) < 0.01) return
      element.getAnimations().forEach((animation) => animation.cancel())
      element.animate(
        [
          {
            transform: `translate3d(${dx}px, ${dy}px, 0) scaleX(${scaleX})`,
            transformOrigin: 'top left',
          },
          {
            transform: 'translate3d(0, 0, 0) scaleX(1)',
            transformOrigin: 'top left',
          },
        ],
        {
          duration: 420,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      )
    })
  }, [])

  const toggleDossierResourceCard = (cardId: string) => {
    setExpandedDossierResourceCards((current) => {
      const next = new Set(current)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  const renderDossierCoreSummary = (Icon: LucideIcon, title: string) => {
    return (
      <div className="dossier-core-summary">
        <span className="dossier-core-summary-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        <span className="dossier-core-summary-copy">
          <strong>{title}</strong>
        </span>
      </div>
    )
  }

  const addDossierResourceCard = () => {
    const card = createDossierResourceCard(tx, 'half')
    const settingsDraft = {
      title: localizeDossierResourceCardTitle(card, tx),
      icon: normalizeDossierResourceIcon(card.icon),
      color: normalizeDossierResourceColor(card.color),
      width: normalizeDossierResourceCardWidth(card.width),
      fields: card.fields.map((field) => ({
        ...field,
        label: localizeDossierResourceFieldLabel(field, tx),
      })),
    }
    animateDossierResourceLayout(() => {
      commitDossierResourceCards([...dossierResourceCards, card])
      setExpandedDossierResourceCards((current) => new Set([...current, card.id]))
      setEditingDossierResourceCardId(card.id)
      setDossierResourceSettingsDraft(settingsDraft)
      dossierResourceSettingsInitialRef.current = JSON.stringify(settingsDraft)
      setDossierResourceIconSearch('')
      setRecentDossierResourceCardId(card.id)
    })
  }

  const updateDossierResourceCard = (cardId: string, updater: (card: DossierResourceCard) => DossierResourceCard) => {
    const updatedAt = new Date().toISOString()
    commitDossierResourceCards(
      dossierResourceCards.map((card) => (card.id === cardId ? { ...updater(card), updatedAt } : card)),
    )
  }

  const removeDossierResourceCard = (cardId: string) => {
    const nextCards = dossierResourceCards.filter((card) => card.id !== cardId)
    commitDossierResourceCards(nextCards)
    setExpandedDossierResourceCards((current) => {
      const next = new Set(current)
      next.delete(cardId)
      return next
    })
    if (editingDossierResourceCardId === cardId) {
      setEditingDossierResourceCardId(null)
      setDossierResourceSettingsDraft(null)
    }
  }

  const moveDossierResourceCard = (cardId: string, direction: -1 | 1) => {
    const index = dossierResourceCards.findIndex((card) => card.id === cardId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= dossierResourceCards.length) return
    const cards = [...dossierResourceCards]
    const [moved] = cards.splice(index, 1)
    cards.splice(nextIndex, 0, moved)
    animateDossierResourceLayout(() => commitDossierResourceCards(cards))
  }

  const startEditingDossierResourceCard = (card: DossierResourceCard) => {
    const settingsDraft: DossierResourceCardSettingsDraft = {
      title: localizeDossierResourceCardTitle(card, tx),
      icon: normalizeDossierResourceIcon(card.icon),
      color: normalizeDossierResourceColor(card.color),
      width: normalizeDossierResourceCardWidth(card.width),
      fields: card.fields.map((field) => {
        const type = isDossierResourceFieldType(field.type) ? field.type : 'text'
        return {
          ...field,
          type,
          label: localizeDossierResourceFieldLabel(field, tx),
          width: normalizeDossierResourceFieldWidth(field.width, type),
        }
      }),
    }
    setEditingDossierResourceCardId(card.id)
    setDossierResourceSettingsDraft(settingsDraft)
    dossierResourceSettingsInitialRef.current = JSON.stringify(settingsDraft)
    setExpandedDossierResourceCards((current) => new Set([...current, card.id]))
    setDossierResourceIconSearch('')
  }

  const cancelEditingDossierResourceCard = () => {
    const cardId = editingDossierResourceCardId
    setEditingDossierResourceCardId(null)
    setDossierResourceSettingsDraft(null)
    setDossierResourceIconSearch('')
    dossierResourceSettingsInitialRef.current = null
    setRecentDossierResourceFieldId(null)
    if (cardId) {
      setExpandedDossierResourceCards((current) => {
        const next = new Set(current)
        next.delete(cardId)
        return next
      })
    }
  }

  const requestCloseDossierResourceSettings = (proceed?: () => void, navigation = false) => {
    if (!editingDossierResourceCardId || !dossierResourceSettingsDraft) {
      proceed?.()
      return
    }
    if (resourceSettingsDirty) {
      setPendingResourceSettingsExit({ proceed, navigation })
      return
    }
    cancelEditingDossierResourceCard()
    proceed?.()
  }

  const updateDossierResourceSettingsDraft = (
    updater: (current: DossierResourceCardSettingsDraft) => DossierResourceCardSettingsDraft,
  ) => {
    setDossierResourceSettingsDraft((current) => (current ? updater(current) : current))
  }

  const saveDossierResourceCardSettings = () => {
    if (!editingDossierResourceCardId || !dossierResourceSettingsDraft) return
    updateDossierResourceCard(editingDossierResourceCardId, (card) => ({
      ...card,
      title: dossierResourceSettingsDraft.title,
      icon: normalizeDossierResourceIcon(dossierResourceSettingsDraft.icon),
      color: normalizeDossierResourceColor(dossierResourceSettingsDraft.color),
      width: normalizeDossierResourceCardWidth(dossierResourceSettingsDraft.width),
      fields: dossierResourceSettingsDraft.fields.map((field) => {
        const type = isDossierResourceFieldType(field.type) ? field.type : 'text'
        return {
          ...field,
          type,
          label: field.label,
          value: field.value ?? '',
          width: normalizeDossierResourceFieldWidth(field.width, type),
        }
      }),
    }))
    dossierResourceSettingsInitialRef.current = null
    cancelEditingDossierResourceCard()
  }

  const addDossierResourceSettingsField = (type: DossierResourceFieldType) => {
    const field = createDossierResourceField(type, tx)
    updateDossierResourceSettingsDraft((current) => ({
      ...current,
      fields: [...current.fields, field],
    }))
    setRecentDossierResourceFieldId(field.id)
  }

  const updateDossierResourceSettingsField = (fieldId: string, patch: Partial<DossierResourceField>) => {
    updateDossierResourceSettingsDraft((current) => ({
      ...current,
      fields: current.fields.map((field) => {
        if (field.id !== fieldId) return field
        const nextType = patch.type && isDossierResourceFieldType(patch.type) ? patch.type : field.type
        const nextWidth = patch.width
          ? normalizeDossierResourceFieldWidth(patch.width, nextType)
          : patch.type
            ? preferredDossierResourceFieldWidth(nextType)
            : normalizeDossierResourceFieldWidth(field.width, nextType)
        return { ...field, ...patch, type: nextType, width: nextWidth }
      }),
    }))
  }

  const moveDossierResourceSettingsField = (fieldId: string, direction: -1 | 1) => {
    updateDossierResourceSettingsDraft((current) => {
      const index = current.fields.findIndex((field) => field.id === fieldId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.fields.length) return current
      const fields = [...current.fields]
      const [moved] = fields.splice(index, 1)
      fields.splice(nextIndex, 0, moved)
      return { ...current, fields }
    })
  }

  const reorderDossierResourceSettingsField = (event: DragEndEvent) => {
    const activeId = String(event.active.id)
    const targetId = event.over ? String(event.over.id) : ''
    if (!activeId || !targetId || activeId === targetId) return
    updateDossierResourceSettingsDraft((current) => {
      const from = current.fields.findIndex((field) => field.id === activeId)
      const to = current.fields.findIndex((field) => field.id === targetId)
      if (from < 0 || to < 0 || from === to) return current
      return { ...current, fields: arrayMove(current.fields, from, to) }
    })
  }

  const removeDossierResourceSettingsField = (fieldId: string) => {
    updateDossierResourceSettingsDraft((current) => ({
      ...current,
      fields: current.fields.filter((field) => field.id !== fieldId),
    }))
  }

  const updateDossierResourceField = (cardId: string, fieldId: string, patch: Partial<DossierResourceField>) => {
    updateDossierResourceCard(cardId, (card) => ({
      ...card,
      fields: card.fields.map((field) => {
        if (field.id !== fieldId) return field
        const nextType = patch.type && isDossierResourceFieldType(patch.type) ? patch.type : field.type
        return {
          ...field,
          ...patch,
          type: nextType,
          width: normalizeDossierResourceFieldWidth(patch.width ?? field.width, nextType),
          value: patch.value ?? (nextType === 'date' && !field.value ? today : field.value),
        }
      }),
    }))
  }

  const updateDossierResourceDropTarget = useCallback((target: DossierResourceDropTarget) => {
    dossierResourceDropTargetRef.current = target
    setDossierResourceDropTarget((current) => (sameDossierResourceDropTarget(current, target) ? current : target))
  }, [])

  const endDossierResourceDrag = useCallback(() => {
    const session = dossierResourceDragSessionRef.current
    if (session) {
      try {
        session.handle.releasePointerCapture(session.pointerId)
      } catch {
        // Pointer capture may already be released by the browser on pointerup.
      }
    }
    dossierResourceDragSessionRef.current = null
    dossierResourceDropTargetRef.current = null
    setDossierResourceDrag(null)
    setDossierResourceDropTarget(null)
    setDossierResourceDragOffset(null)
    document.body.classList.remove('resource-drag-active')
  }, [])

  const findDossierResourceDropTarget = useCallback(
    (activeId: string, clientX: number, clientY: number): DossierResourceDropTarget => {
      // Once the preview slot opens it participates in grid layout and can move
      // neighbouring cards. Keep the current target while the pointer remains
      // inside that visible slot, otherwise a second pointermove can reinterpret
      // the same on-screen location and save a different order than the preview.
      const currentTarget = dossierResourceDropTargetRef.current
      const previewSlot = dossierResourceListRef.current?.querySelector<HTMLElement>('.resource-drop-slot')
      if (currentTarget && previewSlot) {
        const slotRect = previewSlot.getBoundingClientRect()
        if (
          clientX >= slotRect.left &&
          clientX <= slotRect.right &&
          clientY >= slotRect.top &&
          clientY <= slotRect.bottom
        )
          return currentTarget
      }
      const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-resource-card-id]')).filter(
        (card) => card.dataset.resourceCardId && card.dataset.resourceCardId !== activeId,
      )
      if (cards.length === 0) return null

      const nearest = cards
        .map((card) => {
          const rect = card.getBoundingClientRect()
          const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0
          const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0
          return { card, rect, distance: dx * dx + dy * dy }
        })
        .sort((a, b) => a.distance - b.distance || a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0]

      if (nearest) {
        const { card, rect } = nearest
        const id = card.dataset.resourceCardId ?? ''
        const listWidth = dossierResourceListRef.current?.getBoundingClientRect().width ?? rect.width
        const pointerWithinRow = clientY >= rect.top && clientY <= rect.bottom
        const isHalfWidth = rect.width < listWidth * 0.75
        const position =
          isHalfWidth && pointerWithinRow
            ? clientX <= rect.left + rect.width / 2
              ? 'before'
              : 'after'
            : clientY <= rect.top + rect.height / 2
              ? 'before'
              : 'after'
        return { id, position }
      }

      const last = cards[cards.length - 1]
      return { id: last.dataset.resourceCardId ?? '', position: 'after' }
    },
    [],
  )

  const scrollDossierResourceDuringDrag = useCallback((clientY: number) => {
    const scrollParent = dossierResourceDragSessionRef.current?.scrollParent
    if (!scrollParent) return
    const viewport =
      scrollParent === document.scrollingElement
        ? { top: 0, bottom: window.innerHeight }
        : scrollParent.getBoundingClientRect()
    const edge = 58
    const maxStep = 14
    if (clientY < viewport.top + edge) {
      const intensity = Math.min(1, (viewport.top + edge - clientY) / edge)
      scrollParent.scrollTop -= Math.ceil(maxStep * intensity)
    } else if (clientY > viewport.bottom - edge) {
      const intensity = Math.min(1, (clientY - (viewport.bottom - edge)) / edge)
      scrollParent.scrollTop += Math.ceil(maxStep * intensity)
    }
  }, [])

  const commitDossierResourceDrag = useCallback(() => {
    const drag = dossierResourceDragSessionRef.current
    const target = dossierResourceDropTargetRef.current
    if (!drag || !target || drag.id === target.id || !target.id) return false
    const cards = reorderById(dossierResourceCards, drag.id, target.id, target.position)
    if (cards === dossierResourceCards) return false
    animateDossierResourceLayout(() => {
      commitDossierResourceCards(cards)
      endDossierResourceDrag()
    })
    return true
  }, [animateDossierResourceLayout, commitDossierResourceCards, dossierResourceCards, endDossierResourceDrag])

  const startDossierResourceDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        event.preventDefault()
        return
      }
      const card = event.currentTarget.closest<HTMLElement>('.resource-card')
      if (!card) return
      const rect = card.getBoundingClientRect()
      const fixedContainingBlock = findFixedContainingBlock(card)
      const fixedContainingBlockRect = fixedContainingBlock?.getBoundingClientRect()
      const dragLeft = fixedContainingBlockRect ? rect.left - fixedContainingBlockRect.left : rect.left
      const dragTop = fixedContainingBlockRect ? rect.top - fixedContainingBlockRect.top : rect.top
      event.preventDefault()
      event.stopPropagation()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture is a progressive enhancement; window listeners still handle the drag.
      }
      dossierResourceDragSessionRef.current = {
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        grabX: event.clientX - rect.left,
        grabY: event.clientY - rect.top,
        left: dragLeft,
        top: dragTop,
        width: rect.width,
        height: rect.height,
        hasMoved: false,
        handle: event.currentTarget,
        fixedContainingBlock,
        scrollParent: findScrollableAncestor(card),
      }
      dossierResourceDropTargetRef.current = null
      document.body.classList.add('resource-drag-active')
      setDossierResourceDrag({ id })
      setDossierResourceDragOffset({
        id,
        x: 0,
        y: 0,
        left: dragLeft,
        top: dragTop,
        width: rect.width,
        height: rect.height,
      })
      updateDossierResourceDropTarget(null)
    },
    [updateDossierResourceDropTarget],
  )

  useEffect(() => {
    if (!dossierResourceDrag) return undefined

    const handlePointerMove = (event: PointerEvent) => {
      const session = dossierResourceDragSessionRef.current
      if (!session || event.pointerId !== session.pointerId) return
      event.preventDefault()
      const x = event.clientX - session.startX
      const y = event.clientY - session.startY
      const fixedContainingBlockRect = session.fixedContainingBlock?.getBoundingClientRect()
      const containingLeft = fixedContainingBlockRect?.left ?? 0
      const containingTop = fixedContainingBlockRect?.top ?? 0
      const left = event.clientX - containingLeft - session.grabX
      const top = event.clientY - containingTop - session.grabY
      if (!session.hasMoved && Math.hypot(x, y) > 4) {
        session.hasMoved = true
      }
      setDossierResourceDragOffset((current) => {
        if (
          current?.id === session.id &&
          current.x === x &&
          current.y === y &&
          current.left === left &&
          current.top === top
        ) {
          return current
        }
        return {
          id: session.id,
          x,
          y,
          left,
          top,
          width: session.width,
          height: session.height,
        }
      })
      updateDossierResourceDropTarget(
        session.hasMoved ? findDossierResourceDropTarget(session.id, event.clientX, event.clientY) : null,
      )
      scrollDossierResourceDuringDrag(event.clientY)
    }

    const handlePointerUp = (event: PointerEvent) => {
      const session = dossierResourceDragSessionRef.current
      if (!session || event.pointerId !== session.pointerId) return
      event.preventDefault()
      if (!session.hasMoved) dossierResourceDropTargetRef.current = null
      else if (!dossierResourceDropTargetRef.current) {
        dossierResourceDropTargetRef.current = findDossierResourceDropTarget(session.id, event.clientX, event.clientY)
      }
      if (!commitDossierResourceDrag()) endDossierResourceDrag()
    }

    const handlePointerCancel = (event: PointerEvent) => {
      const session = dossierResourceDragSessionRef.current
      if (!session || event.pointerId !== session.pointerId) return
      endDossierResourceDrag()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      endDossierResourceDrag()
    }

    window.addEventListener('pointermove', handlePointerMove, {
      passive: false,
    })
    window.addEventListener('pointerup', handlePointerUp, { passive: false })
    window.addEventListener('pointercancel', handlePointerCancel)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    dossierResourceDrag,
    commitDossierResourceDrag,
    endDossierResourceDrag,
    findDossierResourceDropTarget,
    scrollDossierResourceDuringDrag,
    updateDossierResourceDropTarget,
  ])

  const dossierResourceDragStyle = (id: string): CSSProperties | undefined => {
    if (!dossierResourceDragOffset || dossierResourceDragOffset.id !== id) return undefined
    return {
      '--resource-drag-x': `${dossierResourceDragOffset.x}px`,
      '--resource-drag-y': `${dossierResourceDragOffset.y}px`,
      '--resource-drag-left': `${dossierResourceDragOffset.left}px`,
      '--resource-drag-top': `${dossierResourceDragOffset.top}px`,
      '--resource-drag-width': `${dossierResourceDragOffset.width}px`,
      '--resource-drag-height': `${dossierResourceDragOffset.height}px`,
    } as CSSProperties
  }

  const renderDossierResourceDropSlot = (id: string, position: ChecklistDropPosition) => {
    if (
      !dossierResourceDragOffset ||
      dossierResourceDropTarget?.id !== id ||
      dossierResourceDropTarget.position !== position
    ) {
      return null
    }
    const slotHeight = Math.max(dossierResourceDragOffset.height, 96)
    const targetCard = dossierResourceCards.find((card) => card.id === id)
    const targetIndex = dossierResourceCards.findIndex((card) => card.id === id)
    const fullWidth = normalizeDossierResourceCardWidth(targetCard?.width) === 'full'
    return (
      <div
        key={`${id}-resource-drop-${position}`}
        className={`resource-drop-slot drop-${position}${fullWidth ? ' width-full' : ''}`}
        style={
          {
            '--resource-slot-height': `${slotHeight}px`,
            '--checklist-slot-height': `${slotHeight}px`,
            '--resource-card-order': `${Math.max(targetIndex, 0) * 2 + (position === 'before' ? -1 : 1)}`,
            height: `${slotHeight}px`,
            minHeight: `${slotHeight}px`,
          } as CSSProperties
        }
        aria-hidden="true"
      />
    )
  }

  const clearEmailInsertAnimation = (resetState = true) => {
    emailInsertTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    emailInsertTimersRef.current = []
    pendingWriteTargetRef.current = null
    if (resetState) setEmailInsertAnimating(false)
  }

  const handleEmailAiGeneratingChange = useCallback((generating: boolean) => {
    if (emailAiSettleTimerRef.current !== null) {
      window.clearTimeout(emailAiSettleTimerRef.current)
      emailAiSettleTimerRef.current = null
    }

    setEmailAiGenerating(generating)
    if (generating) {
      emailAiWasGeneratingRef.current = true
      setEmailAiSettling(false)
      return
    }

    // AiDraftPanel reports its initial idle state on mount. Only play the
    // completion handoff after a real generation/stop cycle.
    if (!emailAiWasGeneratingRef.current) return
    emailAiWasGeneratingRef.current = false
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setEmailAiSettling(false)
      return
    }

    setEmailAiSettling(true)
    emailAiSettleTimerRef.current = window.setTimeout(() => {
      setEmailAiSettling(false)
      emailAiSettleTimerRef.current = null
    }, 420)
  }, [])

  const insertChunkSize = (length: number) =>
    length > 180 ? 8 : length > 90 ? 5 : length > 42 ? 3 : length > 16 ? 2 : 1

  const applyComposerTextChange = (
    text: string,
    {
      animated = false,
      selection,
      onComplete,
    }: {
      animated?: boolean
      selection?: MarkdownTextareaSelection | null
      onComplete?: (result: {
        value: string
        selection: MarkdownTextareaSelection | null
      }) => void
    } = {},
  ) => {
    clearEmailInsertAnimation(false)
    const controller = composerBodyControllerRef.current
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const initialSelection = selection === undefined ? controller?.getSelection() ?? null : selection

    const replace = (activeSelection: MarkdownTextareaSelection | null, value: string) => {
      if (controller) {
        composerControllerWriteRef.current = true
        try {
          const result = controller.replaceRange(activeSelection, value)
          if (result) return result
        } finally {
          composerControllerWriteRef.current = false
        }
      }

      const source = controller?.getValue() ?? emailBody
      const from = activeSelection?.mode === 'source' ? activeSelection.start : source.length
      const to = activeSelection?.mode === 'source' ? activeSelection.end : from
      const nextValue = source.slice(0, from) + value + source.slice(to)
      setEmailBody(nextValue)
      persistEmailComposerRecovery({ body: nextValue })
      return {
        value: nextValue,
        selection: {
          mode: 'source' as const,
          start: from,
          end: from + value.length,
        },
      }
    }

    const finish = (result: { value: string; selection: MarkdownTextareaSelection | null }) => {
      pendingWriteTargetRef.current = result.value
      onComplete?.(result)
      const settle = () => {
        emailInsertTimersRef.current = []
        pendingWriteTargetRef.current = null
        setEmailInsertAnimating(false)
        window.requestAnimationFrame(() => composerBodyControllerRef.current?.focus())
      }
      if (!animated || reduceMotion) settle()
      else {
        const timer = window.setTimeout(settle, text.length <= 8 ? 120 : 80)
        emailInsertTimersRef.current.push(timer)
      }
    }

    if (!animated || reduceMotion) {
      finish(replace(initialSelection, text))
      return
    }

    setEmailInsertAnimating(true)
    const chunkSize = insertChunkSize(text.length)
    const stepDelay = text.length <= 8 ? 32 : 18
    const firstStepDelay = text.length <= 8 ? 48 : 24
    let written = 0
    let activeSelection = initialSelection

    const schedule = (callback: () => void, delay = stepDelay) => {
      const timer = window.setTimeout(callback, delay)
      emailInsertTimersRef.current.push(timer)
    }

    const writeNext = () => {
      if (written < text.length) {
        written = Math.min(text.length, written + chunkSize)
        const result = replace(activeSelection, text.slice(0, written))
        activeSelection = result.selection
        pendingWriteTargetRef.current = result.value
        if (written === text.length) {
          finish(result)
          return
        }
        schedule(writeNext)
        return
      }
      finish(replace(activeSelection, ''))
    }
    schedule(writeNext, firstStepDelay)
  }

  const formatAssetNameList = (names: string[], language: InsertLanguage) => {
    const seenNames = new Set<string>()
    const cleanNames = names
      .map((name) => name.trim())
      .filter((name) => {
        if (!name) return false
        const key = name.toLowerCase()
        if (seenNames.has(key)) return false
        seenNames.add(key)
        return true
      })
    return formatList(language, cleanNames)
  }

  const assetInsertLabel = (asset: ProfileAsset, language: InsertLanguage) => {
    const pair = contentLanguagesFromSettings(session.user.settings)
    const kindLabel = profileKindLabel(asset.kind, language, { zh: asset.customLabelZh, en: asset.customLabelEn }, pair)
    if (kindLabel.trim()) return kindLabel.trim()
    return localizeStaticText(asset.name, language).trim()
  }

  const buildAssetInsertPhrase = (selected: ProfileAsset[], language: InsertLanguage) => {
    const settings = session.user.settings
    const pair = contentLanguagesFromSettings(settings)
    // En storage = primary content language, Zh storage = secondary.
    const useSecondarySlot = language === pair.secondary
    const lead = (useSecondarySlot ? settings.snippetPhraseLeadZh : settings.snippetPhraseLeadEn) ?? ''
    const tail = (useSecondarySlot ? settings.snippetPhraseTailZh : settings.snippetPhraseTailEn) ?? ''
    const nameList = formatAssetNameList(
      selected.map((asset) => assetInsertLabel(asset, language)),
      language,
    )
    if (!lead.trim() && !tail.trim()) {
      return selected.length === 1
        ? tpl(translate(language, 'dossier.assetAttachedLine'), {
            name: nameList,
          })
        : tpl(translate(language, 'dossier.assetsAttachedLine'), {
            items: nameList,
          })
    }
    return `${lead}${nameList}${tail}`
  }

  const insertAssets = (selected: ProfileAsset[], language: InsertLanguage) => {
    const phrase = selected.length > 0 ? buildAssetInsertPhrase(selected, language) : ''

    // If a previous animated write is still mid-flight, settle it to its intended end state first —
    // otherwise the staleness check below would compare against a half-typed body and never match,
    // silently defeating "replace in place" on exactly the rapid-reselect flow it exists for.
    let effectiveBody = composerBodyControllerRef.current?.getValue() ?? emailBody
    if (emailInsertAnimating && pendingWriteTargetRef.current != null) {
      clearEmailInsertAnimation(false)
      effectiveBody = composerBodyControllerRef.current?.getValue() ?? emailBody
    }

    const priorRange = lastInsertRangeRef.current
    const canReplace = priorRange != null && effectiveBody === priorRange.value

    if (canReplace && priorRange) {
      applyComposerTextChange(phrase, {
        animated: true,
        selection: priorRange.selection,
        onComplete: (result) => {
          lastInsertRangeRef.current = phrase.trim() && result.selection
            ? { selection: result.selection, text: phrase, value: result.value }
            : null
        },
      })
    } else if (phrase.trim()) {
      applyComposerTextChange(phrase, {
        animated: true,
        onComplete: (result) => {
          lastInsertRangeRef.current = result.selection
            ? { selection: result.selection, text: phrase, value: result.value }
            : null
        },
      })
    }
    setLastInsertSelection(selected.length > 0 ? { ids: selected.map((asset) => asset.id), language } : null)

    const previousAssetIds = new Set(canReplace ? (lastInsertSelection?.ids ?? []) : [])
    const selectedAssetIds = new Set(selected.map((asset) => asset.id))
    const selectedAttachments = selected.flatMap((asset) =>
      (asset.attachments ?? []).map((attachment) => ({
        id: createLocalId('att'),
        name: attachment.fileName,
        fileName: attachment.fileName,
        assetId: asset.id,
        fileId: attachment.fileId,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType,
      })),
    )
    setEmailAttachments((current) => {
      const retained = current.filter(
        (attachment) =>
          !attachment.assetId || !previousAssetIds.has(attachment.assetId) || selectedAssetIds.has(attachment.assetId),
      )
      const existingFileIds = new Set(retained.map((attachment) => attachment.fileId).filter(Boolean))
      const additions = selectedAttachments.filter((attachment) => {
        if (!attachment.fileId || existingFileIds.has(attachment.fileId)) return false
        existingFileIds.add(attachment.fileId)
        return true
      })
      return [...retained, ...additions]
    })
  }

  const addEmailAttachmentFiles = (files: File[]) => {
    setEmailAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: createLocalId('att'),
        name: file.name,
        fileName: file.name,
        file,
        fileSize: file.size,
        mimeType: file.type,
      })),
    ])
  }

  const localEmailAttachmentCount = emailAttachments.filter((attachment) => Boolean(attachment.file)).length

  const emailAttachmentPayload = (): CommunicationAttachmentInput[] =>
    emailAttachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.name,
      fileId: attachment.fileId,
      assetId: attachment.assetId,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
      file: attachment.file,
    }))

  const removeAttachment = (id: string) => {
    setEmailAttachments((current) => current.filter((item) => item.id !== id))
  }

  const startRenameAttachment = (id: string, name: string) => {
    setRenamingAttachmentId(id)
    setRenameAttachmentValue(name)
  }

  const commitRenameAttachment = (id: string) => {
    const nextName = renameAttachmentValue.trim()
    if (nextName) {
      setEmailAttachments((current) =>
        current.map((item) => (item.id === id ? { ...item, name: nextName, fileName: nextName } : item)),
      )
    }
    setRenamingAttachmentId(null)
  }

  const clearEmailComposer = ({ preserveRecovery = false }: { preserveRecovery?: boolean } = {}) => {
    if (
      !preserveRecovery
      && !clearRecoverableEmailComposer(session.user.id, application.id)
    ) {
      warnComposerRecoveryUnavailable()
      return false
    }
    clearEmailInsertAnimation()
    if (emailAiSettleTimerRef.current !== null) {
      window.clearTimeout(emailAiSettleTimerRef.current)
      emailAiSettleTimerRef.current = null
    }
    emailAiWasGeneratingRef.current = false
    setEmailAiGenerating(false)
    setEmailAiSettling(false)
    setEmailAiRestoreAnimating(false)
    setAiDraftSessionKey((current) => current + 1)
    pendingWriteTargetRef.current = null
    lastInsertRangeRef.current = null
    setLastInsertSelection(null)
    setEmailSubject('')
    setEmailBody('')
    setEmailScheduleDate(today)
    setEmailScheduleTime('')
    const nextSchedule = defaultScheduledEmailTime()
    setScheduledSendDate(nextSchedule.date)
    setScheduledSendTime(nextSchedule.time)
    composerDeliveryIdRef.current = createComposerDeliveryId()
    setEmailAttachments([])
    setActiveComposerDraftId(null)
    composerBusyRef.current = null
    setComposerBusy(null)
    setPendingMissingAttachmentSend(null)
    setAiPanelOpen(false)
    setAiReplyToId(null)
    setAiDraftMode('compose')
    setReplyContextExpanded(false)
    setRecordFromOverride(null)
    setRecordToOverride(null)
    return true
  }
  clearEmailComposerRef.current = clearEmailComposer

  const triggerRouteSwapAnimation = (key: string) => {
    if (routeSwapTimerRef.current !== null) window.clearTimeout(routeSwapTimerRef.current)
    setActiveRouteSwap(key)
    routeSwapTimerRef.current = window.setTimeout(() => {
      setActiveRouteSwap(null)
      routeSwapTimerRef.current = null
    }, 360)
  }

  const swapRecordRoute = () => {
    const currentFrom = recordFromOverride ?? correspondenceFrom
    const currentTo = recordToOverride ?? correspondenceTo
    setRecordFromOverride(currentTo)
    setRecordToOverride(currentFrom)
    triggerRouteSwapAnimation('record')
  }

  const addTrackedRecipient = (email: string) => {
    const normalized = normalizeCorrespondenceEmail(email)
    const currentDraft = draftRef.current
    const currentEmails = applicationCorrespondenceEmails(currentDraft.professor)
    if (
      !isValidCorrespondenceEmail(normalized) ||
      currentEmails.includes(normalized) ||
      currentEmails.length >= MAX_APPLICATION_CORRESPONDENCE_EMAILS
    )
      return false
    const correspondenceEmails = additionalCorrespondenceEmails(currentDraft.professor.email, [
      ...(currentDraft.professor.correspondenceEmails ?? []),
      normalized,
    ])
    commitDraft(
      {
        ...currentDraft,
        professor: {
          ...currentDraft.professor,
          correspondenceEmails,
        },
      },
      'immediate',
    )
    setEmailRecipient(normalized)
    return true
  }

  const removeTrackedRecipient = (email: string) => {
    const normalized = normalizeCorrespondenceEmail(email)
    const currentDraft = draftRef.current
    if (normalized === normalizeCorrespondenceEmail(currentDraft.professor.email)) return
    const correspondenceEmails = additionalCorrespondenceEmails(
      currentDraft.professor.email,
      (currentDraft.professor.correspondenceEmails ?? []).filter(
        (candidate) => normalizeCorrespondenceEmail(candidate) !== normalized,
      ),
    )
    commitDraft(
      {
        ...currentDraft,
        professor: {
          ...currentDraft.professor,
          correspondenceEmails,
        },
      },
      'immediate',
    )
    if (normalizeCorrespondenceEmail(emailRecipient) === normalized) {
      setEmailRecipient(normalizeCorrespondenceEmail(currentDraft.professor.email))
    }
  }

  const buildCommunicationInput = (
    kind: CorrespondenceKind,
    subject: string,
    summary: string,
    patch: Partial<CommunicationInput> = {},
  ): CommunicationInput => {
    const meta = correspondenceKinds.find((item) => item.value === kind) ?? correspondenceKinds[0]
    const direction = patch.direction ?? meta.direction
    const from =
      patch.from ??
      (direction === 'outgoing' ? userSendFrom : direction === 'incoming' ? selectedRecipient : session.user.email)
    const to =
      patch.to ??
      (direction === 'outgoing' ? selectedRecipient : direction === 'incoming' ? incomingMailbox : draft.school.name)
    return {
      subject: subject.trim() || tx('dossier.untitledMessage'),
      summary,
      channel: patch.channel ?? meta.channel,
      date: patch.date ?? emailScheduleDate,
      time: patch.time ?? emailScheduleTime,
      direction,
      messageType: patch.messageType ?? kind,
      from,
      to,
      attachments: emailAttachmentPayload(),
    }
  }

  const applyRecordDirection = (direction: RecordDirection, channel: 'email' | 'message') => {
    setRecordDirection(direction)
    if (channel === 'email') {
      setCorrespondenceKind(direction === 'sent' ? 'outgoing-email' : 'incoming-email')
      setRecordFromOverride(null)
      setRecordToOverride(null)
      return
    }
    setCorrespondenceKind(direction === 'sent' ? 'outgoing-message' : 'incoming-message')
  }

  const applyCorrespondenceMode = (mode: CorrespondenceMode) => {
    const nextMode = mode
    setCorrespondenceMode(nextMode)
    if (nextMode === 'draft-email') setCorrespondenceKind('outgoing-email')
    else if (nextMode === 'record-email')
      setCorrespondenceKind(recordDirection === 'sent' ? 'outgoing-email' : 'incoming-email')
    else if (nextMode === 'record-message')
      setCorrespondenceKind(recordDirection === 'sent' ? 'outgoing-message' : 'incoming-message')
    else setCorrespondenceKind('note')
  }

  const requestComposerExit = (proceed: () => void, options: Omit<ComposerExitRequest, 'proceed'> = {}) => {
    if (composerOpen && hasComposerContent) {
      setPendingComposerExit({ proceed, ...options })
      return
    }
    proceed()
  }

  const feeExitGuardRef = useRef<FeeTrackerExitGuard | null>(null)
  const registerFeeExitGuard = useCallback((guard: FeeTrackerExitGuard | null) => {
    feeExitGuardRef.current = guard
  }, [])

  const requestLocalEditorExit = (proceed: () => void) => {
    const continueAfterFee = () => requestComposerExit(() => {
      if (requestUnsavedCreationExit(proceed)) return
      if (editingDossierResourceCardId !== null) {
        requestCloseDossierResourceSettings(proceed)
        return
      }
      if (editingCommunicationId) {
        requestCloseItemEditor('communication', proceed)
        return
      }
      if (editingScholarshipId) {
        requestCloseItemEditor('scholarship', proceed)
        return
      }
      if (editingEventId) {
        requestCloseItemEditor('timeline', proceed)
        return
      }
      proceed()
    })
    const feeGuard = feeExitGuardRef.current
    if (feeGuard) {
      feeGuard(continueAfterFee)
      return
    }
    continueAfterFee()
  }

  const openCorrespondenceMode = (mode: CorrespondenceMode) => {
    if (composerOpen && mode === correspondenceMode) {
      closeComposer()
      return
    }
    const openMode = () => {
      applyCorrespondenceMode(mode)
      setComposerOpen(true)
    }
    if (composerOpen && mode !== correspondenceMode) {
      requestComposerExit(openMode)
      return
    }
    openMode()
  }

  const closeComposer = () => {
    requestComposerExit(() => {
      if (!clearEmailComposer()) return
      setComposerOpen(false)
    })
  }

  const openAiDraft = (replyTo?: CommunicationItem) => {
    if (!onAiDraft) return
    const open = () => {
      // The composer trigger is a true disclosure: repeated clicks toggle the
      // same inspector rather than only ever re-opening it.
      if (!replyTo && composerOpen && correspondenceMode === 'draft-email' && aiPanelOpen) {
        setAiPanelOpen(false)
        return
      }
      applyCorrespondenceMode('draft-email')
      setComposerOpen(true)
      setAiDraftMode(replyTo ? 'reply' : 'compose')
      setAiReplyToId(replyTo?.id ?? null)
      setReplyContextExpanded(Boolean(replyTo))
      if (replyTo && !emailSubject.trim()) {
        setEmailSubject(replyTo.subject ? `Re: ${replyTo.subject.replace(/^re:\s*/i, '')}` : '')
      }
      if (replyTo) {
        const replyAddress = normalizeCorrespondenceEmail(replyTo.direction === 'incoming' ? replyTo.from : replyTo.to)
        if (isValidCorrespondenceEmail(replyAddress)) setEmailRecipient(replyAddress)
      }
      setAiPanelOpen(true)
      if (replyTo) setReplyComposerNavigationToken((current) => current + 1)
    }
    if (composerOpen && correspondenceMode !== 'draft-email') {
      requestComposerExit(open, { keepOpenAfterSave: true })
      return
    }
    open()
  }

  useEffect(() => {
    if (
      replyComposerNavigationToken === 0 ||
      !aiReplyToId ||
      renderedTab !== 'mail' ||
      !composerOpen ||
      correspondenceMode !== 'draft-email'
    ) {
      return undefined
    }

    const frame = window.requestAnimationFrame(() => {
      const scrollTarget = correspondenceModeBarRef.current
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      if (scrollTarget && typeof scrollTarget.scrollIntoView === 'function') {
        scrollTarget.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'start',
          inline: 'nearest',
        })
      }

      composerBodyControllerRef.current?.focus({ atEnd: true })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [aiReplyToId, composerOpen, correspondenceMode, renderedTab, replyComposerNavigationToken])

  const persistCurrentComposer = async ({ keepComposerOpen = false } = {}) => {
    if (!hasComposerContent || composerBusyRef.current) return false
    const sourceApplicationId = application.id
    const sourceMutationVersion = composerMutationVersionRef.current
    composerBusyRef.current = 'save'
    setComposerBusy('save')
    try {
      if (correspondenceMode === 'note') {
        if (!emailBody.trim()) return false
        const saved = await onAddCommunication(
          buildCommunicationInput('note', formatDate(emailScheduleDate, lang), emailBodyForCommunication),
        )
        if (saved === false) return false
      } else {
        const saved = await onAddCommunication(
          buildCommunicationInput(correspondenceKind, emailSubject, emailBodyForCommunication),
        )
        if (saved === false) return false
      }
      if (activeApplicationIdRef.current !== sourceApplicationId) return false
      if (composerMutationVersionRef.current !== sourceMutationVersion) return true
      if (!clearEmailComposer()) return false
      if (!keepComposerOpen) setComposerOpen(false)
      return true
    } finally {
      if (composerBusyRef.current === 'save') {
        composerBusyRef.current = null
        setComposerBusy(null)
      }
    }
  }

  const persistComposerDraft = async ({ keepComposerOpen = false } = {}) => {
    if (!canUseDrafts) return false
    if (!hasComposerContent || composerBusyRef.current) return false
    const sourceApplicationId = application.id
    const sourceMutationVersion = composerMutationVersionRef.current
    const input = buildCommunicationInput(
      'outgoing-email',
      format(tx('dossier.draftEmailSubject'), {
        subject: emailSubject || tx('dossier.untitledEmail'),
      }),
      emailBodyForCommunication,
      {
        date: today,
        time: '',
        messageType: 'draft-email',
        channel: 'Email',
        direction: 'outgoing',
      },
    )
    composerBusyRef.current = 'save'
    setComposerBusy('save')
    try {
      const saved = activeComposerDraftId
        ? await onUpdateCommunication?.(activeComposerDraftId, input)
        : await onAddCommunication(input)
      if (activeComposerDraftId && !onUpdateCommunication) return false
      if (saved === false) return false
      if (activeApplicationIdRef.current !== sourceApplicationId) return false
      if (composerMutationVersionRef.current !== sourceMutationVersion) return true
      if (!clearEmailComposer()) return false
      if (!keepComposerOpen) setComposerOpen(false)
      return true
    } finally {
      if (composerBusyRef.current === 'save') {
        composerBusyRef.current = null
        setComposerBusy(null)
      }
    }
  }

  const handlePendingComposerSave = async () => {
    const exit = pendingComposerExit
    setPendingComposerExit(null)
    const saved = await persistCurrentComposer({
      keepComposerOpen: exit?.keepOpenAfterSave,
    })
    if (saved && !exit?.keepOpenAfterSave) exit?.proceed()
  }

  const handlePendingComposerDraft = async () => {
    const exit = pendingComposerExit
    setPendingComposerExit(null)
    const saved = await persistComposerDraft({
      keepComposerOpen: exit?.keepOpenAfterSave,
    })
    if (saved && !exit?.keepOpenAfterSave) exit?.proceed()
  }

  const performComposerSend = async (pending: PendingRecipientSend, trackRecipient: boolean) => {
    if (!onSendCommunication || composerBusyRef.current) return false
    composerBusyRef.current = 'send'
    setComposerBusy('send')
    try {
      const sent = await onSendCommunication({
        ...pending.payload,
        trackRecipient,
      })
      // Keep the composer available after a failed send so its content is never lost.
      if (!sent) return false
      if (activeApplicationIdRef.current !== pending.sourceApplicationId) return false
      if (composerMutationVersionRef.current !== pending.sourceMutationVersion) {
        // A reopened server draft was consumed atomically by this send. Newer
        // request-period edits stay resident as a fresh, unsaved composer.
        setActiveComposerDraftId(null)
        return true
      }
      if (!clearEmailComposer()) return false
      setComposerOpen(false)
      pending.afterSend?.()
      return true
    } finally {
      if (composerBusyRef.current === 'send') {
        composerBusyRef.current = null
        setComposerBusy(null)
      }
    }
  }

  const sendComposerEmail = async (
    afterSend?: () => void,
    {
      skipMissingAttachmentCheck = false,
      timing,
    }: {
      skipMissingAttachmentCheck?: boolean
      timing?: PendingMissingAttachmentSend['timing']
    } = {},
  ): Promise<'sent' | 'failed' | 'prompted'> => {
    if (!hasComposerContent) return 'failed'
    if (
      !skipMissingAttachmentCheck &&
      shouldConfirmMissingEmailAttachment({
        subject: emailSubject,
        body: emailBody,
        attachmentCount: emailAttachments.length,
      })
    ) {
      setPendingMissingAttachmentSend({ afterSend, timing })
      return 'prompted'
    }
    if (!onSendCommunication) {
      if (timing) {
        onNotify?.(tx('dossier.emailNotConfigured'), 'error')
        return 'failed'
      }
      const saved = await persistCurrentComposer()
      if (saved) afterSend?.()
      return saved ? 'sent' : 'failed'
    }
    if (!isValidCorrespondenceEmail(selectedRecipient)) {
      onNotify?.(tx('dossier.recipientInvalid'), 'error')
      return 'failed'
    }
    const now = new Date()
    const immediate = localCommunicationDateTime(now)
    const payload = buildCommunicationInput(correspondenceKind, emailSubject, emailBodyForCommunication, {
      date: timing?.date ?? immediate.date,
      time: timing?.time ?? immediate.time,
      messageType: timing ? 'scheduled-email' : 'outgoing-email',
    })
    const pending = {
      payload: {
        ...payload,
        subject: payload.subject || tx('dossier.untitledEmail'),
        bodyFormat: detectRichTextFormat(emailBodyForCommunication),
        sendAt: timing?.sendAt,
        idempotencyKey: composerDeliveryIdRef.current,
        sourceDraftId: activeComposerDraftId ?? undefined,
      },
      sourceApplicationId: application.id,
      sourceMutationVersion: composerMutationVersionRef.current,
      afterSend,
    }
    if (!selectedRecipientIsTracked) {
      setPendingRecipientSend(pending)
      return 'prompted'
    }
    const primaryRecipient = normalizeCorrespondenceEmail(draft.professor.email)
    return (await performComposerSend(pending, selectedRecipient !== primaryRecipient)) ? 'sent' : 'failed'
  }

  const handleMissingAttachmentDecision = async (sendWithoutAttachment: boolean) => {
    const pending = pendingMissingAttachmentSend
    if (!pending || !sendWithoutAttachment) {
      setPendingMissingAttachmentSend(null)
      return
    }
    const result = await sendComposerEmail(pending.afterSend, {
      skipMissingAttachmentCheck: true,
      timing: pending.timing,
    })
    if (result === 'failed') {
      // The send routine already owns the localized error. Rejecting keeps the
      // confirmation resident so the draft cannot disappear behind a failed
      // request and the user can retry or cancel deliberately.
      throw new Error('missing-attachment-send-failed')
    }
    setPendingMissingAttachmentSend(null)
  }

  const handlePendingComposerSend = async () => {
    const exit = pendingComposerExit
    setPendingComposerExit(null)
    await sendComposerEmail(exit && !exit.keepOpenAfterSave ? exit.proceed : undefined)
  }

  const handleRecipientTrackingDecision = (decision: 'track' | 'once' | 'cancel') => {
    const pending = pendingRecipientSend
    setPendingRecipientSend(null)
    if (!pending || decision === 'cancel') return
    void performComposerSend(pending, decision === 'track')
  }

  const handlePendingComposerDiscard = () => {
    const exit = pendingComposerExit
    setPendingComposerExit(null)
    if (!clearEmailComposer()) return
    setComposerOpen(false)
    exit?.proceed()
  }

  const handlePendingDraftSave = async () => {
    const exit = pendingDraftExit
    setPendingDraftExit(null)
    const saved = await onSave()
    if (saved !== false) exit?.proceed()
  }

  const handlePendingDraftDiscard = () => {
    const exit = pendingDraftExit
    setPendingDraftExit(null)
    onDiscardDraft()
    exit?.proceed()
  }

  const handlePendingResourceSettingsSave = async () => {
    const exit = pendingResourceSettingsExit
    setPendingResourceSettingsExit(null)
    saveDossierResourceCardSettings()
    const saved = exit?.navigation ? await onSave() : true
    if (saved !== false) exit?.proceed?.()
  }

  const handlePendingResourceSettingsDiscard = () => {
    const exit = pendingResourceSettingsExit
    setPendingResourceSettingsExit(null)
    cancelEditingDossierResourceCard()
    if (exit?.navigation && isDirty && exit.proceed) {
      if (autoSaveEnabled && onFlushAutoSave) {
        void onFlushAutoSave().then((saved) => {
          if (saved) exit.proceed?.()
        })
      } else {
        setPendingDraftExit({ proceed: exit.proceed })
      }
      return
    }
    exit?.proceed?.()
  }

  const handleSendEmail = () => {
    void sendComposerEmail()
  }

  const handleSchedulePopoverOpen = (open: boolean) => {
    if (!open || isFutureScheduledEmail(scheduledSendDate, scheduledSendTime)) return
    const nextSchedule = defaultScheduledEmailTime()
    setScheduledSendDate(nextSchedule.date)
    setScheduledSendTime(nextSchedule.time)
  }

  const handleScheduleEmail = async (closePopover: () => void) => {
    const sendAt = scheduledEmailIso(scheduledSendDate, scheduledSendTime)
    if (!emailSubject.trim() || !sendAt || !isFutureScheduledEmail(scheduledSendDate, scheduledSendTime)) {
      onNotify?.(tx('dossier.scheduleMustBeFuture'), 'error')
      return
    }
    closePopover()
    await sendComposerEmail(undefined, {
      timing: {
        sendAt,
        date: scheduledSendDate,
        time: scheduledSendTime,
      },
    })
  }

  const persistRecordedCommunication = async (input: CommunicationInput) => {
    const sourceApplicationId = application.id
    const saved = await onAddCommunication(input)
    if (saved === false || activeApplicationIdRef.current !== sourceApplicationId) return false
    return clearEmailComposer()
  }

  const handleSaveDraft = () => {
    if (!canUseDrafts) return
    void persistComposerDraft()
  }

  useEffect(() => {
    if (!onRegisterNavigationGuard) return undefined
    onRegisterNavigationGuard((proceed) => {
      const navigationIntent = ++autoSaveNavigationIntentRef.current
      const continueAfterFee = () => {
        if (composerOpen && hasComposerContent) {
          setPendingComposerExit({ proceed })
          return true
        }
        if (requestUnsavedCreationExit(proceed, true)) return true
        if (editingDossierResourceCardId !== null && resourceSettingsDirty) {
          setPendingResourceSettingsExit({ proceed, navigation: true })
          return true
        }
        if (itemEditDirty) {
          setPendingItemEditExit({
            kind: communicationEditDirty ? 'communication' : scholarshipEditDirty ? 'scholarship' : 'timeline',
            proceed,
            navigation: true,
          })
          return true
        }
        if (isDirty) {
          if (autoSaveEnabled && onFlushAutoSave) {
            void onFlushAutoSave().then((saved) => {
              if (autoSaveNavigationIntentRef.current !== navigationIntent) return
              if (saved) {
                proceed()
                return
              }
              // The flush could not persist the draft. Swallowing that left the
              // click doing nothing at all — the person pressed another project
              // and simply stayed put, with only a small banner in the corner to
              // explain it. Make the refusal a decision instead.
              setPendingDraftExit({ proceed, blocked: true })
            })
          } else {
            setPendingDraftExit({ proceed })
          }
          return true
        }
        return false
      }
      const feeGuard = feeExitGuardRef.current
      if (!feeGuard) return continueAfterFee()
      let handledAfterFee = false
      const allowed = feeGuard(() => {
        handledAfterFee = continueAfterFee()
      })
      return allowed ? handledAfterFee : true
    })
    return () => {
      autoSaveNavigationIntentRef.current += 1
      onRegisterNavigationGuard(null)
    }
  }, [
    autoSaveEnabled,
    communicationEditDirty,
    composerOpen,
    hasComposerContent,
    editingDossierResourceCardId,
    isDirty,
    itemEditDirty,
    onFlushAutoSave,
    onRegisterNavigationGuard,
    requestUnsavedCreationExit,
    resourceSettingsDirty,
    scholarshipEditDirty,
  ])

  useEffect(() => {
    const manualDecisionPending =
      (composerOpen && hasComposerContent)
      || resourceSettingsDirty
      || itemEditDirty
      || dirtyPendingRecommenderIds.length > 0
      || pendingChecklistCreateDirty
      || scholarshipAddDirty
      || (!autoSaveEnabled && isDirty)
    if (!manualDecisionPending) return undefined
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [
    autoSaveEnabled,
    composerOpen,
    dirtyPendingRecommenderIds.length,
    hasComposerContent,
    isDirty,
    itemEditDirty,
    pendingChecklistCreateDirty,
    resourceSettingsDirty,
    scholarshipAddDirty,
  ])

  // App keys this component by application so normal record switches start from
  // fresh state in one render. Keep the reset path for embedders that update the
  // application prop in place, while avoiding a second synchronous mount render.
  const recordStateInitializedRef = useRef(false)
  const resetScholarshipsRef = useRef(application.scholarships)
  const resetDossierResourceCardsRef = useRef(dossierResourceCards)
  const resetTabRef = useRef(tab)
  resetScholarshipsRef.current = application.scholarships
  resetDossierResourceCardsRef.current = dossierResourceCards
  resetTabRef.current = tab
  useLayoutEffect(() => {
    activeApplicationIdRef.current = application.id
    if (!recordStateInitializedRef.current) {
      recordStateInitializedRef.current = true
      return
    }
    pendingChecklistCreateRef.current = null
    setPendingChecklistCreate(null)
    setSavingPendingChecklistCreate(false)
    setScholarshipAddOpen(false)
    setScholarshipDraft(createScholarshipDraft(currentSchoolNameRef.current))
    const scholarshipIds = resetScholarshipsRef.current.map((item) => item.id)
    setExpandedScholarships(new Set(scholarshipIds))
    previousScholarshipIdsRef.current = new Set(scholarshipIds)
    if (scholarshipSaveTimerRef.current !== null) {
      window.clearTimeout(scholarshipSaveTimerRef.current)
      scholarshipSaveTimerRef.current = null
    }
    setEditingScholarshipId(null)
    setScholarshipEditDraft(null)
    setSavingScholarshipId(null)
    setOptimisticScholarships({})
    setScholarshipMaterialPreviousStatuses({})
    recentScholarshipTimelineEventIdRef.current = null
    setTimelineTitle('')
    setTimelineDate(today)
    setTimelineNote('')
    setTimelineAddOpen(false)
    setEditingEventId(null)
    setEditTitle('')
    setEditDate(today)
    setEditNote('')
    setExpandedNotes(new Set())
    setNewTag('')
    setExpandedDossierResourceCards(new Set(resetDossierResourceCardsRef.current.map((card) => card.id)))
    setEditingDossierResourceCardId(null)
    setDossierResourceSettingsDraft(null)
    setRecentDossierResourceCardId(null)
    setDossierResourceIconSearch('')
    setDossierResourceDrag(null)
    setDossierResourceDropTarget(null)
    setDossierResourceDragOffset(null)
    setRecentDossierResourceFieldId(null)
    setPendingResourceSettingsExit(null)
    setPendingItemEditExit(null)
    dossierResourceSettingsInitialRef.current = null
    dossierResourceDragSessionRef.current = null
    dossierResourceDropTargetRef.current = null
    document.body.classList.remove('resource-drag-active')
    setExpandedMaterials(new Set())
    setMaterialVisualGroupPins({})
    setMaterialGroupArrivalIds(new Set())
    setExpandedChecklistTasks(new Set())
    setMaterialExpansionSyncVersion((version) => version + 1)
    setTaskExpansionSyncVersion((version) => version + 1)
    setPendingTimelineNav(null)
    setChecklistSearch('')
    setMaterialFilter('all')
    setMaterialGroupFilter('all')
    setMaterialSort('manual')
    setMaterialPreviousStatuses({})
    setTaskFilter('all')
    setTaskSort('manual')
    finishScholarshipDragPreview(true)
    checklistDragSessionRef.current?.finish?.(false, true)
    checklistDragSessionRef.current = null
    document.body.classList.remove('checklist-drag-active')
    setRecentChecklistItem(null)
    setRemovingMaterialIds(new Set())
    setRemovingTaskIds(new Set())
    setRemovingCommunicationIds(new Set())
    setRemovingScholarshipIds(new Set())
    setRemovingTimelineIds(new Set())
    removalTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    removalTimersRef.current = []
    setReviewCommentText('')
    setReviewCommentBusy(false)
    setConfirmRemoveAttachment(null)
    setConfirmRemoveCommunicationId(null)
    setConfirmRemoveScholarshipId(null)
    setChecklistUploadTarget(null)
    setChecklistUploadOpen(false)
    setUploadDraftFiles([])
    setUploadBaseName('')
    setUploadAllowedPresetIds([])
    setUploadCustomTypes('')
    setUploadTypeError('')
    setUploadReservationEnabled(false)
    setReminderMenu(null)
    setClosingReminderMenu(null)
    if (reminderCloseTimerRef.current !== null) {
      window.clearTimeout(reminderCloseTimerRef.current)
      reminderCloseTimerRef.current = null
    }
    setReminderPopoverStyle({})
    reminderAnchorRefs.current = {}
    setExplorerMenu(null)
    setCorrespondenceMode(defaultCorrespondenceMode)
    setCorrespondenceKind('outgoing-email')
    setPendingRecipientSend(null)
    setPendingMissingAttachmentSend(null)
    setRecordDirection('sent')
    setEditingCommunicationId(null)
    setCommunicationEditDraft(null)
    communicationEditInitialRef.current = null
    if (routeSwapTimerRef.current !== null) {
      window.clearTimeout(routeSwapTimerRef.current)
      routeSwapTimerRef.current = null
    }
    setActiveRouteSwap(null)
    clearEmailComposerRef.current?.({ preserveRecovery: true })
    const recovered = loadRecoverableEmailComposer(session.user.id, application.id)
    setCorrespondenceView(recovered?.activeDraftId ? 'drafts' : 'all')
    setEmailSubject(recovered?.subject ?? '')
    setEmailBody(recovered?.body ?? '')
    setEmailRecipient(recovered?.recipient ?? normalizeCorrespondenceEmail(draftRef.current.professor.email))
    const recoveredSchedule = recovered
      ? { date: recovered.scheduledDate, time: recovered.scheduledTime }
      : defaultScheduledEmailTime()
    setScheduledSendDate(recoveredSchedule.date)
    setScheduledSendTime(recoveredSchedule.time)
    composerDeliveryIdRef.current = recovered?.deliveryId || createComposerDeliveryId()
    setEmailAttachments((recovered?.attachments ?? []).map((attachment) => ({
      ...attachment,
      fileName: attachment.fileName ?? attachment.name,
    })))
    setActiveComposerDraftId(recovered?.activeDraftId ?? null)
    setRenamingAttachmentId(null)
    setRenameAttachmentValue('')
    setComposerOpen(Boolean(recovered))
    setPendingComposerExit(null)
    setPendingDraftExit(null)
    previousTabRef.current = resetTabRef.current
    setTabDirection('forward')
    consumedJumpTokenRef.current = null
  }, [application.id, defaultCorrespondenceMode, finishScholarshipDragPreview, session.user.id])

  useEffect(() => {
    const currentScholarshipIds = new Set(application.scholarships.map((item) => item.id))
    setExpandedScholarships((current) => {
      const next = new Set<string>()
      current.forEach((id) => {
        if (currentScholarshipIds.has(id)) next.add(id)
      })
      let changed = next.size !== current.size
      currentScholarshipIds.forEach((id) => {
        if (!previousScholarshipIdsRef.current.has(id)) {
          next.add(id)
          if (!current.has(id)) changed = true
        }
      })
      return changed ? next : current
    })
    previousScholarshipIdsRef.current = currentScholarshipIds
  }, [application.scholarships])

  useEffect(() => {
    if (!recentChecklistItem) return undefined
    const timer = window.setTimeout(() => setRecentChecklistItem(null), 900)
    return () => window.clearTimeout(timer)
  }, [recentChecklistItem])

  useEffect(() => {
    if (!recentDossierResourceCardId) return undefined
    const timer = window.setTimeout(() => setRecentDossierResourceCardId(null), 900)
    return () => window.clearTimeout(timer)
  }, [recentDossierResourceCardId])

  useEffect(() => {
    if (!recentDossierResourceFieldId) return undefined
    const timer = window.setTimeout(() => setRecentDossierResourceFieldId(null), 720)
    return () => window.clearTimeout(timer)
  }, [recentDossierResourceFieldId])

  useEffect(() => {
    const previousTab = previousTabRef.current
    previousTabRef.current = tab
    const previousIndex = detailTabs.indexOf(previousTab)
    const nextIndex = detailTabs.indexOf(tab)
    setTabDirection(nextIndex >= previousIndex ? 'forward' : 'backward')
    if (tab === 'mail' && previousTab !== 'mail' && !composerOpen) {
      setCorrespondenceMode(defaultCorrespondenceMode)
      setCorrespondenceKind('outgoing-email')
    }
  }, [tab, composerOpen, defaultCorrespondenceMode, detailTabs])

  useEffect(() => {
    const strip = tabStripRef.current
    const activeButton = tabButtonRefs.current[tab]
    if (!strip || !activeButton) return undefined
    let frame = 0

    const updateIndicator = () => {
      const stripRect = strip.getBoundingClientRect()
      const buttonRect = activeButton.getBoundingClientRect()
      strip.style.setProperty('--tab-indicator-left', `${buttonRect.left - stripRect.left + strip.scrollLeft + 14}px`)
      strip.style.setProperty('--tab-indicator-width', `${Math.max(0, buttonRect.width - 28)}px`)
      strip.style.setProperty('--tab-indicator-opacity', '1')
    }

    const scheduleIndicator = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updateIndicator()
      })
    }

    scheduleIndicator()
    window.addEventListener('resize', scheduleIndicator)
    strip.addEventListener('scroll', scheduleIndicator, { passive: true })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', scheduleIndicator)
      strip.removeEventListener('scroll', scheduleIndicator)
    }
  }, [tab, lang])

  // Keyboard shortcuts for timeline interactions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingEventId !== null) {
          e.preventDefault()
          setEditingEventId(null)
        } else if (timelineAddOpen) {
          e.preventDefault()
          setTimelineAddOpen(false)
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [editingEventId, timelineAddOpen])

  useEffect(() => {
    return () => {
      if (reminderCloseTimerRef.current !== null) {
        window.clearTimeout(reminderCloseTimerRef.current)
      }
      removalTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      removalTimersRef.current = []
      emailInsertTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      emailInsertTimersRef.current = []
      if (emailAiSettleTimerRef.current !== null) {
        window.clearTimeout(emailAiSettleTimerRef.current)
        emailAiSettleTimerRef.current = null
      }
      if (routeSwapTimerRef.current !== null) {
        window.clearTimeout(routeSwapTimerRef.current)
      }
      if (scholarshipSaveTimerRef.current !== null) {
        window.clearTimeout(scholarshipSaveTimerRef.current)
      }
      checklistDragSessionRef.current?.finish?.(false, true)
      checklistDragSessionRef.current = null
      document.body.classList.remove('checklist-drag-active')
    }
  }, [])

  const getReminderPopoverStyle = useCallback((target: Exclude<ReminderMenuTarget, null>): CSSProperties => {
    const anchor = reminderAnchorRefs.current[reminderTargetKey(target)]
    if (!anchor) return { visibility: 'hidden' }
    const rect = anchor.getBoundingClientRect()
    const gap = 8
    const viewportPadding = 16
    const width = Math.min(320, Math.max(240, window.innerWidth - viewportPadding * 2))
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    )
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding
    const spaceAbove = rect.top - gap - viewportPadding
    const openBelow = spaceBelow >= 260 || spaceBelow >= spaceAbove
    const availableSpace = Math.max(180, openBelow ? spaceBelow : spaceAbove)
    return {
      position: 'fixed',
      left,
      top: openBelow ? rect.bottom + gap : 'auto',
      bottom: openBelow ? 'auto' : window.innerHeight - rect.top + gap,
      width,
      maxHeight: Math.min(360, availableSpace),
      transformOrigin: openBelow ? 'top left' : 'bottom left',
    }
  }, [])

  useEffect(() => {
    if (!reminderMenu) return undefined
    const target = reminderMenu
    let frame = 0

    const updatePosition = () => {
      setReminderPopoverStyle(getReminderPopoverStyle(target))
    }

    const schedulePosition = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updatePosition()
      })
    }

    schedulePosition()
    window.addEventListener('resize', schedulePosition)
    window.addEventListener('scroll', schedulePosition, {
      capture: true,
      passive: true,
    })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedulePosition)
      window.removeEventListener('scroll', schedulePosition, true)
    }
  }, [getReminderPopoverStyle, reminderMenu])

  const createChecklistItemNow = () => {
    const newId = createLocalId('material')
    const material: MaterialItem = {
      id: newId,
      name: '',
      type: defaultChecklistMaterialType,
      status: 'Draft' as MaterialStatus,
      group: 'Core materials',
      details: '',
      reminderEnabled: false,
      reminderDate: '',
      reminderTime: '',
      reminderRepeat: 'once',
      uploadReserved: false,
      allowedFileTypes: [],
      requiredCount: 1,
      recommenders: [],
      version: 'v0',
      updatedAt: today,
      versions: [],
    }
    const pending: PendingChecklistCreate = {
      kind: 'material',
      id: newId,
      baseline: JSON.stringify(material),
    }
    pendingChecklistCreateRef.current = pending
    setPendingChecklistCreate(pending)
    setChecklistSearch('')
    setMaterialFilter('all')
    setMaterialGroupFilter('all')
    setMaterialSort('manual')
    commitDraft(
      {
        ...draftRef.current,
        materials: [material, ...draftRef.current.materials],
      },
      'external',
    )
    setExpandedMaterials((prev) => new Set([...prev, newId]))
    setMaterialExpansionSyncVersion((version) => version + 1)
    setRecentChecklistItem({ kind: 'material', id: newId })
  }

  const createChecklistItem = () => {
    if (!requestUnsavedCreationExit(createChecklistItemNow)) createChecklistItemNow()
  }

  const openChecklistUpload = (target: ChecklistUploadTarget) => {
    const existingTarget =
      target?.kind === 'material'
        ? draftRef.current.materials.find((material) => material.id === target.id)
        : target?.kind === 'task'
          ? draftRef.current.tasks.find((task) => task.id === target.id)
          : null
    const { presetIds, customTypes } = getUploadPresetSelection(existingTarget?.allowedFileTypes)
    // Prepare form state first, then open on the next frame so the click paint
    // settles and the enter animation starts cleanly (no one-frame flash).
    setChecklistUploadTarget(target)
    setUploadDraftFiles([])
    setUploadBaseName('')
    setUploadAllowedPresetIds(customTypes.length ? [...presetIds, uploadOtherTypeId] : presetIds)
    setUploadCustomTypes(customTypes.join(', '))
    setUploadTypeError('')
    setUploadReservationEnabled(Boolean(existingTarget?.uploadReserved ?? target))
    setUploadSubmitting(false)
    window.requestAnimationFrame(() => {
      setChecklistUploadOpen(true)
    })
  }

  const requestChecklistUpload = (target: ChecklistUploadTarget) => {
    if (reminderMenu) {
      closeReminderMenu(() => openChecklistUpload(target))
      return
    }
    openChecklistUpload(target)
  }

  const closeChecklistUpload = (afterClose?: () => void) => {
    if (!afterClose) {
      requestChecklistUploadClose()
      return
    }
    requestChecklistUploadClose(() => {
      finalizeChecklistUploadClose()
      afterClose()
    })
  }

  const uploadAllowedTypes = useMemo(
    () => resolveUploadAllowedTypes(uploadAllowedPresetIds, uploadCustomTypes),
    [uploadAllowedPresetIds, uploadCustomTypes],
  )
  const effectiveUploadAllowedTypes = useMemo(
    () => (uploadAllowedTypes.length > 0 ? uploadAllowedTypes : [...DEFAULT_UPLOAD_ALLOWED_TYPES]),
    [uploadAllowedTypes],
  )

  const addUploadDraftFiles = (files: readonly File[]) => {
    const result = validateUploadFiles(files, {
      allowedTypes: effectiveUploadAllowedTypes,
      maxFileSize: MAX_UPLOAD_FILE_SIZE,
      maxFiles: MAX_UPLOAD_FILES_PER_BATCH,
      existingFileCount: uploadDraftFiles.length,
      multiple: true,
    })
    const messages: string[] = []
    const typeRejected = filesRejectedForReason(result.rejected, 'type')
    const sizeRejected = filesRejectedForReason(result.rejected, 'size')
    const countRejected = filesRejectedForReason(result.rejected, 'count')
    if (typeRejected.length > 0) {
      messages.push(
        format(tx('dossier.uploadTypeRejected'), {
          count: typeRejected.length,
          types: allowedFileTypesLabel(uploadAllowedTypes, tx('dossier.fileTypeAny')),
        }),
      )
    }
    if (sizeRejected.length > 0) {
      messages.push(
        format(tx('fileUpload.filesTooLarge'), {
          names: sizeRejected
            .slice(0, 3)
            .map((file) => file.name)
            .join(', '),
          size: formatFileSize(MAX_UPLOAD_FILE_SIZE),
        }),
      )
    }
    if (countRejected.length > 0) {
      messages.push(
        format(tx('fileUpload.tooManyFiles'), {
          count: MAX_UPLOAD_FILES_PER_BATCH,
        }),
      )
    }
    setUploadTypeError(messages.join(' '))
    if (result.accepted.length === 0) return
    setUploadDraftFiles((current) => [
      ...current,
      ...result.accepted.map((file) => ({
        id: createLocalId('upload'),
        file,
        name: file.name,
        // Lock the source extension at selection time. Renaming the display
        // value must never make upload validation depend on user input.
        extension: getUploadFileExtension(file.name),
      })),
    ])
  }

  const uploadCustomTypesOpen = uploadAllowedPresetIds.includes(uploadOtherTypeId)
  const hasUploadTypeMismatch = useMemo(
    () => uploadDraftFiles.some((draftFile) => !fileMatchesAllowedTypes(draftFile.file, effectiveUploadAllowedTypes)),
    [effectiveUploadAllowedTypes, uploadDraftFiles],
  )
  const uploadTypeMessage =
    uploadTypeError ||
    (hasUploadTypeMismatch
      ? format(tx('dossier.uploadTypeMismatch'), {
          types: allowedFileTypesLabel(uploadAllowedTypes, tx('dossier.fileTypeAny')),
        })
      : '')

  const currentUploadTargetItem = useMemo<MaterialItem | TaskItem | null>(() => {
    if (!checklistUploadTarget) return null
    return checklistUploadTarget.kind === 'material'
      ? (checklistMaterials.find((material) => material.id === checklistUploadTarget.id) ?? null)
      : (draft.tasks.find((task) => task.id === checklistUploadTarget.id) ?? null)
  }, [checklistUploadTarget, checklistMaterials, draft.tasks])

  const existingUploadNames = useMemo(() => {
    if (!currentUploadTargetItem) return new Set<string>()
    return new Set(
      attachmentRows(currentUploadTargetItem)
        .map((row) => normalizeUploadFileName(row.file))
        .filter(Boolean),
    )
  }, [currentUploadTargetItem])

  const uploadDraftFinalNames = useMemo(
    () =>
      uploadDraftFiles.map((draftFile, index) =>
        buildUploadFileName(
          draftFile.file,
          uploadBaseName,
          index,
          uploadDraftFiles.length,
          draftFile.name,
          draftFile.extension,
        ),
      ),
    [uploadBaseName, uploadDraftFiles],
  )

  const duplicateUploadNames = useMemo(() => {
    const counts = new Map<string, number>()
    uploadDraftFinalNames.forEach((name) => {
      const normalized = normalizeUploadFileName(name)
      if (!normalized) return
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    })
    const duplicates = new Set<string>()
    counts.forEach((count, name) => {
      if (count > 1 || existingUploadNames.has(name)) duplicates.add(name)
    })
    return duplicates
  }, [existingUploadNames, uploadDraftFinalNames])

  const hasUploadNameConflict = duplicateUploadNames.size > 0

  const toggleUploadPreset = (id: string) => {
    setUploadAllowedPresetIds((current) => {
      if (id === uploadOtherTypeId) {
        const isOpen = current.includes(uploadOtherTypeId)
        if (isOpen) setUploadCustomTypes('')
        return isOpen ? current.filter((item) => item !== id) : [...current, id]
      }
      return current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    })
  }

  const saveUploadReservation = () => {
    if (!checklistUploadTarget) return
    if (checklistUploadTarget.kind === 'material') {
      const patch = {
        uploadReserved: uploadReservationEnabled,
        allowedFileTypes: uploadAllowedTypes,
      }
      updateMaterial(checklistUploadTarget.id, patch)
    } else {
      const patch = {
        uploadReserved: uploadReservationEnabled,
        allowedFileTypes: uploadAllowedTypes,
        attachmentRequired: uploadReservationEnabled,
      }
      updateTaskWithServer(checklistUploadTarget.id, patch)
    }
  }

  const shareChecklistUpload = () => {
    if (!checklistUploadTarget) return

    // Upload-only share links are intentionally limited to reserved checklist
    // items. Promote the item before handing off to the share dialog so the
    // link opened from this row always has a real upload target.
    setUploadReservationEnabled(true)
    if (checklistUploadTarget.kind === 'material') {
      updateMaterial(checklistUploadTarget.id, {
        uploadReserved: true,
        allowedFileTypes: uploadAllowedTypes,
      })
    } else {
      updateTaskWithServer(checklistUploadTarget.id, {
        uploadReserved: true,
        allowedFileTypes: uploadAllowedTypes,
        attachmentRequired: true,
      })
    }

    requestChecklistUploadClose(() => {
      finalizeChecklistUploadClose()
      onShare('upload')
    })
  }

  const submitChecklistUpload = async (afterClose?: () => void) => {
    if (uploadSubmitting || hasUploadNameConflict || hasUploadTypeMismatch) return
    const sourceApplicationId = application.id
    setUploadSubmitting(true)
    try {
      const target = checklistUploadTarget
      const files = uploadDraftFiles.map((draftFile, index) => {
        const name = buildUploadFileName(
          draftFile.file,
          uploadBaseName,
          index,
          uploadDraftFiles.length,
          draftFile.name,
          draftFile.extension,
        )
        return createRenamedFile(draftFile.file, name)
      })
      if (target?.kind === 'material' && files.length > 0) {
        await Promise.resolve(onUploadMaterialFiles?.(target.id, files))
      } else if (target?.kind === 'task' && files.length > 0) {
        await Promise.resolve(onUploadTaskFiles?.(target.id, files))
      } else {
        for (const file of files) await Promise.resolve(onUpload(file))
      }
      if (activeApplicationIdRef.current !== sourceApplicationId) return
      if (uploadReservationEnabled && target) saveUploadReservation()
      closeChecklistUpload(afterClose)
    } catch {
      // The owning mutation already reports the localized failure. Keep the
      // upload sheet mounted and consume the rejection so an async form event
      // cannot turn a failed upload into an unhandled promise.
    } finally {
      if (activeApplicationIdRef.current === sourceApplicationId) setUploadSubmitting(false)
    }
  }

  const createChecklistTaskNow = () => {
    const newId = createLocalId('task')
    const task: TaskItem = {
      id: newId,
      title: '',
      due: today,
      done: false,
      status: 'Open',
      details: '',
      reminderEnabled: false,
      reminderOffsets: [],
      reminderTime: '',
      reminderRepeat: 'once',
      attachmentRequired: false,
      uploadReserved: false,
      allowedFileTypes: [],
      versions: [],
    }
    const pending: PendingChecklistCreate = {
      kind: 'task',
      id: newId,
      baseline: JSON.stringify(task),
    }
    pendingChecklistCreateRef.current = pending
    setPendingChecklistCreate(pending)
    setChecklistSearch('')
    setTaskFilter('all')
    setTaskSort('manual')
    commitDraft(
      {
        ...draftRef.current,
        tasks: [task, ...draftRef.current.tasks],
      },
      'external',
    )
    setExpandedChecklistTasks((current) => new Set([...current, newId]))
    setTaskExpansionSyncVersion((version) => version + 1)
    setRecentChecklistItem({ kind: 'task', id: newId })
  }

  const createChecklistTask = () => {
    if (!requestUnsavedCreationExit(createChecklistTaskNow)) createChecklistTaskNow()
  }

  const requestChecklistItemToggle = (
    kind: PendingChecklistCreate['kind'],
    id: string,
    isExpanded: boolean,
    toggleExpanded: () => void,
  ) => {
    const pending = pendingChecklistCreateRef.current
    if (!isExpanded || !pending || pending.kind !== kind || pending.id !== id) {
      toggleExpanded()
      return
    }
    if (!pendingChecklistCreateIsDirty()) {
      discardPendingChecklistCreate()
      return
    }
    setPendingItemEditExit({ kind: 'checklist-create', ids: [id], proceed: toggleExpanded })
  }

  const updateTaskDraft = (id: string, patch: Partial<TaskItem>, intent: ApplicationDraftSaveIntent = 'settled') => {
    const currentDraft = draftRef.current
    commitDraft(
      {
        ...currentDraft,
        tasks: currentDraft.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
      },
      pendingChecklistCreateRef.current?.id === id ? 'external' : intent,
    )
  }

  const updateTaskStatus = (id: string, rawStatus: string) => {
    const status = normalizeChecklistStatus(rawStatus)
    if (!status) return
    const done = checklistStatusKey(status) === checklistStatusKey('Done')
      ? true
      : checklistStatusKey(status) === checklistStatusKey('Open')
        ? false
        : undefined
    const patch: Partial<TaskItem> = done === undefined ? { status } : { status, done }
    updateTaskDraft(id, patch, autoSaveEnabled ? 'immediate' : 'external')
    if (!autoSaveEnabled && pendingChecklistCreateRef.current?.id !== id) onUpdateTask?.(id, patch)
  }

  const replaceTaskStatusValue = (id: string, previousValue: string, nextValue: string) => {
    const task = draftRef.current.tasks.find((candidate) => candidate.id === id)
    if (!task || checklistStatusKey(checklistTaskStatus(task)) !== checklistStatusKey(previousValue)) return
    updateTaskStatus(id, nextValue)
  }

  const deleteTaskStatusValue = (id: string, value: string) => {
    replaceTaskStatusValue(id, value, 'Open')
  }

  const savedChecklistStatuses = useMemo(
    () => normalizeChecklistCustomStatuses(
      session.user.settings.customChecklistStatuses,
      checklistStatusBuiltInOrder,
    ),
    [session.user.settings.customChecklistStatuses],
  )
  const savedChecklistStatusKeys = useMemo(
    () => new Set(savedChecklistStatuses.map(checklistStatusKey)),
    [savedChecklistStatuses],
  )
  const savedChecklistMaterialFormats = useMemo(
    () => normalizeChecklistCustomMaterialFormats(session.user.settings.customChecklistMaterialFormats),
    [session.user.settings.customChecklistMaterialFormats],
  )
  const savedChecklistMaterialFormatKeys = useMemo(
    () => new Set(savedChecklistMaterialFormats.map(checklistMaterialFormatKey)),
    [savedChecklistMaterialFormats],
  )
  const scholarshipChecklistStatusValues = useMemo(
    () => [
      ...draft.scholarships.flatMap((scholarship) => [
        ...(scholarship.materials ?? []).map((material) => material.status),
        ...(scholarship.tasks ?? []).map((task) => checklistTaskStatus(task)),
      ]),
      ...(scholarshipDraft?.materials ?? []).map((material) => material.status),
      ...(scholarshipDraft?.tasks ?? []).map((task) => checklistTaskStatus(task)),
      ...(scholarshipEditDraft?.materials ?? []).map((material) => material.status),
      ...(scholarshipEditDraft?.tasks ?? []).map((task) => checklistTaskStatus(task)),
    ],
    [draft.scholarships, scholarshipDraft, scholarshipEditDraft],
  )
  const materialStatuses = useMemo(
    () => mergeChecklistStatuses(
      materialStatusOrder,
      savedChecklistStatuses,
      [
        ...(checklistContentReady ? checklistMaterials.map((material) => material.status) : []),
        ...scholarshipChecklistStatusValues,
      ],
    ),
    [checklistContentReady, checklistMaterials, savedChecklistStatuses, scholarshipChecklistStatusValues],
  )
  const taskStatuses = useMemo(
    () => mergeChecklistStatuses(
      checklistTaskStatusOrder,
      savedChecklistStatuses,
      [
        ...(checklistContentReady ? draft.tasks.map(checklistTaskStatus) : []),
        ...scholarshipChecklistStatusValues,
      ],
    ),
    [checklistContentReady, draft.tasks, savedChecklistStatuses, scholarshipChecklistStatusValues],
  )
  const materialTypeOptions = useMemo(() => {
    const builtInKeys = new Set(checklistMaterialTypes.map(checklistMaterialFormatKey))
    // Custom formats belong to the account, so a brand new application starts
    // with the built-in taxonomy only and every application sees a format the
    // moment it is added anywhere. Values left on materials by a format that
    // was since deleted stay selectable so nothing silently changes type. Those
    // legacy values are still user-owned in practice, so they get the same
    // management affordances as newly saved custom formats.
    const seen = new Set<string>(builtInKeys)
    const customTypes: string[] = []
    for (const type of [
      ...savedChecklistMaterialFormats,
      ...(checklistContentReady ? checklistMaterials.map((material) => material.type.trim()) : []),
    ]) {
      const key = checklistMaterialFormatKey(type)
      if (!type || seen.has(key)) continue
      seen.add(key)
      customTypes.push(type)
    }
    return [
      ...checklistMaterialTypes.map((type) => ({
        value: type,
        label: tx(`dossier.checklistMaterialFormats.${checklistMaterialTypeI18n[type]}`, type),
        section: tx(
          checklistMaterialFormatSection[type] === 'files'
            ? 'dossier.materialFormatSectionFiles'
            : 'dossier.materialFormatSectionWorkflow',
        ),
      })),
      ...customTypes.map((type) => ({
        value: type,
        label: localize(type),
        section: tx('dossier.materialFormatSectionCustom'),
        custom: true,
      })),
    ]
  }, [
    checklistContentReady,
    checklistMaterials,
    localize,
    savedChecklistMaterialFormats,
    tx,
  ])
  const materialTypeLabel = useCallback(
    (type: string) => materialTypeOptions.find((option) => option.value === type)?.label ?? localize(type),
    [localize, materialTypeOptions],
  )
  const checklistGroupOptions = useMemo(() => {
    const builtInGroups = checklistGroups.filter((group) => group !== 'Custom')
    const builtIn = new Set<string>(builtInGroups)
    const groupCounts = new Map<string, number>()
    for (const material of checklistContentReady ? checklistMaterials : []) {
      const group = (material.group || 'Core materials').trim()
      groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1)
    }
    const customGroups = checklistContentReady
      ? Array.from(
          new Set(
            checklistMaterials
              .map((material) => (material.group || 'Core materials').trim())
              .filter((group) => group && !builtIn.has(group)),
          ),
        )
      : []
    return [
      ...builtInGroups.map((group) => ({
        value: group,
        label: tx(`dossier.checklistGroups.${checklistGroupI18n[group]}`),
        meta: format(tx('dossier.itemCount'), { count: groupCounts.get(group) ?? 0 }),
        section: tx('dossier.materialGroupSectionDefault'),
      })),
      ...customGroups.map((group) => ({
        value: group,
        label: localize(group),
        meta: format(tx('dossier.itemCount'), { count: groupCounts.get(group) ?? 0 }),
        section: tx('dossier.materialGroupSectionCustom'),
        custom: true,
      })),
    ]
  }, [checklistContentReady, checklistMaterials, format, localize, tx])
  const materialStatusOptions = useMemo(
    () =>
      materialStatuses.map((status) => ({
        value: status,
        label: statusLabel(status, tx),
        custom: savedChecklistStatusKeys.has(checklistStatusKey(status)),
      })),
    [materialStatuses, savedChecklistStatusKeys, tx],
  )
  const taskStatusOptions = useMemo(
    () =>
      taskStatuses.map((status) => ({
        value: status,
        label: statusLabel(status, tx),
        custom: savedChecklistStatusKeys.has(checklistStatusKey(status)),
      })),
    [savedChecklistStatusKeys, taskStatuses, tx],
  )
  const scholarshipStatusOptions = scholarshipStatusOrder.map((status) => ({
    value: status,
    label: tx(`dossier.scholarshipStatus.${status}`, status),
  }))
  const applicationStatusOptions = useMemo(() => {
    const customStatuses = session.user.settings.customApplicationStatuses ?? []
    const savedCustomStatusKeys = new Set(
      customStatuses.map((status) => status.trim().toLocaleLowerCase()),
    )
    const ordered = applicationStatusOrder(customStatuses, [draft.status])
    return ordered.map((status) => ({
      value: status,
      label: statusLabel(status, tx),
      // A record can retain a legacy custom value after its account taxonomy
      // was removed. Keep that value selectable, but expose management only
      // for options that are actually owned by the account settings.
      custom: !builtInApplicationStatusKeys.has(status.toLocaleLowerCase())
        && savedCustomStatusKeys.has(status.toLocaleLowerCase()),
    }))
  }, [draft.status, session.user.settings.customApplicationStatuses, tx])
  const applicationStatusCreateConfig = useMemo<SelectCreateConfig<ApplicationStatus> | undefined>(() => {
    if (!onCustomApplicationStatusesChange || isReadOnly) return undefined
    const savedCustomStatuses = applicationStatusOrder(session.user.settings.customApplicationStatuses ?? []).filter(
      (status) => !builtInApplicationStatusKeys.has(status.toLocaleLowerCase()),
    )
    const normalizeStatus = (rawValue: string) => rawValue.trim().replace(/\s+/g, ' ')
    const savedStatusKey = (rawValue: string) => normalizeStatus(rawValue).toLocaleLowerCase()
    const updateCurrentDraftStatus = (previousValue: string, nextValue: ApplicationStatus) => {
      const currentDraft = draftRef.current
      if (!currentDraft || savedStatusKey(currentDraft.status) !== savedStatusKey(previousValue)) return
      commitDraft({ ...currentDraft, status: nextValue }, 'immediate')
    }
    return {
      label: tx('dossier.addCustomOption'),
      placeholder: tx('dossier.customStatusPlaceholder'),
      createAriaLabel: tx('dossier.addCustomOption'),
      renameAriaLabel: tx('dossier.renameCustomOption'),
      deleteAriaLabel: tx('dossier.deleteCustomOption'),
      canCreate: savedCustomStatuses.length < 30,
      maxLength: 64,
      onCreate: (rawValue) => {
        const value = normalizeStatus(rawValue)
        if (!value) return
        const existing = applicationStatusOptions.find(
          (option) => savedStatusKey(option.value) === savedStatusKey(value),
        )
        const nextStatus = existing?.value ?? value
        if (!existing) {
          if (savedCustomStatuses.length >= 30) return
          const nextCustom = applicationStatusOrder(savedCustomStatuses, [value])
            .filter((status) => !builtInApplicationStatusKeys.has(status.toLocaleLowerCase()))
            .slice(0, 30)
          void onCustomApplicationStatusesChange(nextCustom)
        }
        const currentDraft = draftRef.current
        commitDraft({ ...currentDraft, status: nextStatus }, 'immediate')
      },
      onRename: (rawPreviousValue, rawNextValue) => {
        const previousValue = normalizeStatus(rawPreviousValue)
        const nextValue = normalizeStatus(rawNextValue)
        if (!previousValue || !nextValue || builtInApplicationStatusKeys.has(savedStatusKey(nextValue))) return
        const previousKey = savedStatusKey(previousValue)
        if (!savedCustomStatuses.some((status) => savedStatusKey(status) === previousKey)) return
        if (savedCustomStatuses.some(
          (status) => savedStatusKey(status) !== previousKey && savedStatusKey(status) === savedStatusKey(nextValue),
        )) return
        const nextCustom = savedCustomStatuses.map((status) =>
          savedStatusKey(status) === previousKey ? nextValue : status,
        )
        void onCustomApplicationStatusesChange(nextCustom)
        updateCurrentDraftStatus(previousValue, nextValue)
      },
      onDelete: (rawValue) => {
        const value = normalizeStatus(rawValue)
        const valueKey = savedStatusKey(value)
        const nextCustom = savedCustomStatuses.filter((status) => savedStatusKey(status) !== valueKey)
        if (nextCustom.length === savedCustomStatuses.length) return
        void onCustomApplicationStatusesChange(nextCustom)
        updateCurrentDraftStatus(value, 'Draft')
      },
    }
  }, [
    applicationStatusOptions,
    commitDraft,
    isReadOnly,
    onCustomApplicationStatusesChange,
    session.user.settings.customApplicationStatuses,
    tx,
  ])
  const notificationTarget = session.user.settings.receiveAt || session.user.email
  const completedChecklistCount = useMemo(
    () => (checklistContentReady ? checklistMaterials.filter((material) => material.status === 'Submitted').length : 0),
    [checklistContentReady, checklistMaterials],
  )
  const reminderChecklistCount = useMemo(() => {
    if (!checklistContentReady) return 0
    const materialCount = checklistMaterials.filter((material) => material.reminderEnabled).length
    const taskCount = draft.tasks.filter((task) => task.reminderEnabled).length
    return materialCount + taskCount
  }, [checklistContentReady, checklistMaterials, draft.tasks])
  const reminderFilterActive = materialFilter === 'with-reminder' || taskFilter === 'with-reminder'
  const groupLabel = useCallback(
    (group: string) =>
      isChecklistGroup(group) ? tx(`dossier.checklistGroups.${checklistGroupI18n[group]}`) : localize(group),
    [localize, tx],
  )

  const normalizedChecklistSearch = checklistSearch.trim().toLocaleLowerCase()
  const materialFilterOptions: Array<{ value: MaterialFilter; label: string }> = [
    { value: 'all', label: tx('dossier.allMaterials') },
    ...materialStatuses.map((status) => ({
      value: materialStatusFilterValue(status),
      label: statusLabel(status, tx),
    })),
    { value: 'with-reminder', label: tx('dossier.withReminder') },
    { value: 'with-attachment', label: tx('dossier.withAttachment') },
  ]
  const materialGroupOptions = useMemo<Array<{ value: string; label: string }>>(() => {
    const groups = checklistContentReady
      ? Array.from(new Set(checklistMaterials.map((material) => material.group || 'Core materials')))
      : []
    return [
      { value: 'all', label: tx('dossier.allGroups') },
      ...groups.map((group) => ({ value: group, label: groupLabel(group) })),
    ]
  }, [checklistContentReady, checklistMaterials, groupLabel, tx])
  const materialSortOptions: Array<{ value: MaterialSort; label: string }> = [
    { value: 'manual', label: tx('dossier.manualOrder') },
    { value: 'name', label: tx('dossier.sortByName') },
    { value: 'status', label: tx('dossier.sortByStatus') },
    { value: 'group', label: tx('dossier.sortByGroup') },
    { value: 'updated', label: tx('dossier.sortByUpdated') },
  ]
  const taskFilterOptions: Array<{ value: TaskFilter; label: string }> = [
    { value: 'all', label: tx('dossier.allTasks') },
    { value: 'open', label: tx('dossier.openTasksOnly') },
    { value: 'done', label: tx('dossier.doneTasksOnly') },
    { value: 'overdue', label: tx('dossier.overdueTasks') },
    { value: 'with-reminder', label: tx('dossier.withReminder') },
    { value: 'with-attachment', label: tx('dossier.withAttachment') },
  ]
  const taskSortOptions: Array<{ value: TaskSort; label: string }> = [
    { value: 'manual', label: tx('dossier.manualOrder') },
    { value: 'due', label: tx('dossier.sortByDue') },
    { value: 'title', label: tx('dossier.sortByTitle') },
    { value: 'status', label: tx('dossier.sortByStatus') },
  ]

  const visibleMaterials = useMemo(() => {
    if (!checklistContentReady) return []
    const matchesSearch = (material: MaterialItem) => {
      if (!normalizedChecklistSearch) return true
      return [
        localize(material.name),
        materialTypeLabel(material.type),
        statusLabel(material.status, tx),
        groupLabel(material.group || 'Core materials'),
        localize(material.details ?? ''),
        material.fileName ?? '',
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedChecklistSearch)
    }
    const filtered = checklistMaterials.filter((material) => {
      const visualGroup = materialVisualGroupPins[material.id] || material.group || 'Core materials'
      if (materialGroupFilter !== 'all' && visualGroup !== materialGroupFilter) return false
      if (materialFilter === 'with-reminder' && !material.reminderEnabled) return false
      if (materialFilter === 'with-attachment' && !material.fileId && !material.fileName) return false
      if (materialFilter.startsWith('status:') && material.status !== materialFilter.slice('status:'.length))
        return false
      return matchesSearch(material)
    })
    if (materialSort === 'manual') return filtered
    return [...filtered].sort((a, b) => {
      if (materialSort === 'name') return localize(a.name).localeCompare(localize(b.name), lang)
      if (materialSort === 'status') return materialStatuses.indexOf(a.status) - materialStatuses.indexOf(b.status)
      if (materialSort === 'group')
        return groupLabel(a.group || 'Core materials').localeCompare(groupLabel(b.group || 'Core materials'), lang)
      return (b.updatedAt || '').localeCompare(a.updatedAt || '')
    })
  }, [
    checklistContentReady,
    checklistMaterials,
    groupLabel,
    lang,
    materialFilter,
    materialGroupFilter,
    materialSort,
    materialStatuses,
    materialTypeLabel,
    materialVisualGroupPins,
    normalizedChecklistSearch,
    localize,
    tx,
  ])

  const visibleTasks = useMemo(() => {
    if (!checklistContentReady) return []
    const matchesSearch = (task: TaskItem) => {
      if (!normalizedChecklistSearch) return true
      return [
        localize(task.title),
        localize(task.details ?? ''),
        statusLabel(checklistTaskStatus(task), tx),
        task.fileName ?? '',
        task.due,
        formatDate(task.due, lang),
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedChecklistSearch)
    }
    const filtered = draft.tasks.filter((task) => {
      if (taskFilter === 'open' && task.done) return false
      if (taskFilter === 'done' && !task.done) return false
      if (taskFilter === 'overdue' && (task.done || !task.due || task.due >= today)) return false
      if (taskFilter === 'with-reminder' && !task.reminderEnabled) return false
      if (taskFilter === 'with-attachment' && !task.fileId && !task.fileName) return false
      return matchesSearch(task)
    })
    if (taskSort === 'manual') return filtered
    return [...filtered].sort((a, b) => {
      if (taskSort === 'due') return (a.due || '').localeCompare(b.due || '')
      if (taskSort === 'title') return localize(a.title).localeCompare(localize(b.title), lang)
      return taskStatuses.indexOf(checklistTaskStatus(a)) - taskStatuses.indexOf(checklistTaskStatus(b))
        || (a.due || '').localeCompare(b.due || '')
    })
  }, [checklistContentReady, draft.tasks, lang, normalizedChecklistSearch, localize, taskFilter, taskSort, taskStatuses, tx])

  const groupedChecklist = useMemo(
    () =>
      checklistContentReady
        ? visibleMaterials.reduce<Array<{ group: string; items: MaterialItem[] }>>((groups, material) => {
            const group = materialVisualGroupPins[material.id] || material.group || 'Core materials'
            const existing = groups.find((candidate) => candidate.group === group)
            if (existing) {
              existing.items.push(material)
            } else {
              groups.push({ group, items: [material] })
            }
            return groups
          }, [])
        : [],
    [checklistContentReady, materialVisualGroupPins, visibleMaterials],
  )

  const hasChecklistFilters = Boolean(
    checklistSearch.trim() ||
    materialFilter !== 'all' ||
    materialGroupFilter !== 'all' ||
    materialSort !== 'manual' ||
    taskFilter !== 'all' ||
    taskSort !== 'manual',
  )
  const checklistToolFilterCount =
    Number(materialFilter !== 'all') +
    Number(materialGroupFilter !== 'all') +
    Number(materialSort !== 'manual') +
    Number(taskFilter !== 'all') +
    Number(taskSort !== 'manual')

  const updateMaterial = (id: string, patch: Partial<MaterialItem>, intentOverride?: ApplicationDraftSaveIntent) => {
    const currentDraft = draftRef.current
    const intent: ApplicationDraftSaveIntent =
      intentOverride ??
      (Object.keys(patch).some((key) => key === 'name' || key === 'details' || key === 'recommenders')
        ? 'settled'
        : 'immediate')
    commitDraft(
      {
        ...currentDraft,
        materials: currentDraft.materials.map((material) =>
          material.id === id ? { ...material, ...patch, updatedAt: today } : material,
        ),
      },
      pendingChecklistCreateRef.current?.id === id ? 'external' : intent,
    )
  }

  const replaceMaterialTaxonomyValue = (key: 'type' | 'group' | 'status', previousValue: string, nextValue: string) => {
    const cleanValue = nextValue.trim()
    if (!cleanValue || cleanValue === previousValue) return
    const currentDraft = draftRef.current
    commitDraft(
      {
        ...currentDraft,
        materials: currentDraft.materials.map((material) =>
          String(material[key] ?? '') === previousValue
            ? { ...material, [key]: cleanValue, updatedAt: today }
            : material,
        ),
      },
      'immediate',
    )
  }

  const deleteMaterialTaxonomyValue = (key: 'type' | 'group' | 'status', value: string) => {
    const fallback = key === 'type' ? 'File' : key === 'group' ? 'Core materials' : 'Draft'
    replaceMaterialTaxonomyValue(key, value, fallback)
  }

  const changeMaterialGroup = (material: MaterialItem, nextGroup: string, keepVisualPosition: boolean) => {
    const cleanGroup = nextGroup.trim()
    if (!cleanGroup || cleanGroup === (material.group || 'Core materials')) return
    if (keepVisualPosition) {
      setMaterialVisualGroupPins((current) =>
        current[material.id] ? current : { ...current, [material.id]: material.group || 'Core materials' },
      )
    }
    updateMaterial(material.id, { group: cleanGroup })
  }

  const checklistStatusCreateConfig = (actions: {
    onCreate: (value: string) => void
    onRename?: (value: string, nextValue: string) => void
    onDelete?: (value: string) => void
  }): SelectCreateConfig<string> | undefined => {
    if (!onCustomChecklistStatusesChange || isReadOnly) return undefined
    const normalize = normalizeChecklistStatus
    const savedStatuses = savedChecklistStatuses
    const savedKeys = new Set(savedStatuses.map(checklistStatusKey))
    const allOptions = [...materialStatuses, ...taskStatuses]
    return {
      label: tx('dossier.addCustomOption'),
      placeholder: tx('dossier.customStatusPlaceholder'),
      createAriaLabel: tx('dossier.addCustomOption'),
      renameAriaLabel: tx('dossier.renameCustomOption'),
      deleteAriaLabel: tx('dossier.deleteCustomOption'),
      canCreate: savedStatuses.length < checklistStatusLimit,
      maxLength: 64,
      onCreate: (rawValue) => {
        const value = normalize(rawValue)
        if (!value) return
        const valueKey = checklistStatusKey(value)
        const existing = allOptions.find((option) => checklistStatusKey(option) === valueKey)
        const nextValue = existing ?? value
        if (!existing && savedStatuses.length < checklistStatusLimit) {
          void onCustomChecklistStatusesChange(
            normalizeChecklistCustomStatuses([...savedStatuses, value], checklistStatusBuiltInOrder),
          )
        }
        actions.onCreate(nextValue)
      },
      onRename: (rawPreviousValue, rawNextValue) => {
        const previousValue = normalize(rawPreviousValue)
        const nextValue = normalize(rawNextValue)
        const previousKey = checklistStatusKey(previousValue)
        const nextKey = checklistStatusKey(nextValue)
        if (!savedKeys.has(previousKey) || !nextValue || checklistStatusBuiltInOrder.some((status) => checklistStatusKey(status) === nextKey))
          return
        if (savedStatuses.some((status) => checklistStatusKey(status) === nextKey && checklistStatusKey(status) !== previousKey))
          return
        const nextStatuses = savedStatuses.map((status) => (checklistStatusKey(status) === previousKey ? nextValue : status))
        void onCustomChecklistStatusesChange(
          normalizeChecklistCustomStatuses(nextStatuses, checklistStatusBuiltInOrder),
        )
        actions.onRename?.(previousValue, nextValue)
      },
      onDelete: (rawValue) => {
        const value = normalize(rawValue)
        const valueKey = checklistStatusKey(value)
        if (!savedKeys.has(valueKey)) return
        void onCustomChecklistStatusesChange(
          savedStatuses.filter((status) => checklistStatusKey(status) !== valueKey),
        )
        actions.onDelete?.(value)
      },
    }
  }

  /**
   * Custom formats are account-scoped, so create/rename/delete has to update the
   * saved taxonomy as well as this material — otherwise the option would vanish
   * from every other application the moment nothing referenced it here.
   */
  const materialFormatCreateConfig = (material: MaterialItem): SelectCreateConfig<string> | undefined => {
    if (!onCustomChecklistMaterialFormatsChange || isReadOnly) return undefined
    const savedFormats = savedChecklistMaterialFormats
    const savedKeys = savedChecklistMaterialFormatKeys
    const builtInKeys = new Set(checklistMaterialTypes.map(checklistMaterialFormatKey))
    const customOptionKeys = new Set(
      materialTypeOptions
        .filter((option) => 'custom' in option && option.custom)
        .map((option) => checklistMaterialFormatKey(option.value)),
    )
    const commit = (formats: readonly string[]) => {
      void onCustomChecklistMaterialFormatsChange(normalizeChecklistCustomMaterialFormats(formats))
    }
    return {
      label: tx('dossier.addCustomOption'),
      placeholder: tx('dossier.customOptionPlaceholder'),
      createAriaLabel: tx('dossier.addCustomOption'),
      renameAriaLabel: tx('dossier.renameCustomOption'),
      deleteAriaLabel: tx('dossier.deleteCustomOption'),
      canCreate: savedFormats.length < checklistMaterialFormatLimit,
      maxLength: 64,
      onCreate: (rawValue) => {
        const value = normalizeChecklistMaterialFormat(rawValue)
        if (!value) return
        const valueKey = checklistMaterialFormatKey(value)
        const existing = materialTypeOptions.find(
          (option) => checklistMaterialFormatKey(option.value) === valueKey,
        )?.value
        if (!existing && !builtInKeys.has(valueKey) && savedFormats.length < checklistMaterialFormatLimit) {
          commit([...savedFormats, value])
        }
        updateMaterial(material.id, { type: existing ?? value })
      },
      onRename: (rawValue, rawNextValue) => {
        const value = normalizeChecklistMaterialFormat(rawValue)
        const nextValue = normalizeChecklistMaterialFormat(rawNextValue)
        const valueKey = checklistMaterialFormatKey(value)
        const nextKey = checklistMaterialFormatKey(nextValue)
        if (!customOptionKeys.has(valueKey) || !nextValue || builtInKeys.has(nextKey)) return
        if (
          nextKey !== valueKey
          && (savedKeys.has(nextKey) || customOptionKeys.has(nextKey))
        ) return
        const nextFormats = savedKeys.has(valueKey)
          ? savedFormats.map((format) => (checklistMaterialFormatKey(format) === valueKey ? nextValue : format))
          : [...savedFormats, nextValue]
        commit(nextFormats)
        replaceMaterialTaxonomyValue('type', value, nextValue)
      },
      onDelete: (rawValue) => {
        const value = normalizeChecklistMaterialFormat(rawValue)
        const valueKey = checklistMaterialFormatKey(value)
        if (!customOptionKeys.has(valueKey)) return
        commit(savedFormats.filter((format) => checklistMaterialFormatKey(format) !== valueKey))
        deleteMaterialTaxonomyValue('type', value)
      },
    }
  }

  const materialTaxonomyCreateConfig = (
    key: 'type' | 'group' | 'status',
    material: MaterialItem,
    keepVisualPosition: boolean,
  ): SelectCreateConfig<string> | undefined => {
    if (key === 'status') {
      return checklistStatusCreateConfig({
        onCreate: (value) => updateMaterial(material.id, { status: value }),
        onRename: (value, nextValue) => replaceMaterialTaxonomyValue('status', value, nextValue),
        onDelete: (value) => deleteMaterialTaxonomyValue('status', value),
      })
    }
    if (key === 'type') return materialFormatCreateConfig(material)
    return {
    label: tx('dossier.addCustomOption'),
    placeholder: tx('dossier.customOptionPlaceholder'),
    createAriaLabel: tx('dossier.addCustomOption'),
    renameAriaLabel: tx('dossier.renameCustomOption'),
    deleteAriaLabel: tx('dossier.deleteCustomOption'),
    onCreate: (value) => {
      if (key === 'group') changeMaterialGroup(material, value, keepVisualPosition)
      else if (key === 'type') updateMaterial(material.id, { type: value })
      else updateMaterial(material.id, { status: value })
    },
    onRename: (value, nextValue) => {
      if (key === 'group' && keepVisualPosition && value === (material.group || 'Core materials')) {
        setMaterialVisualGroupPins((current) =>
          current[material.id] ? current : { ...current, [material.id]: material.group || 'Core materials' },
        )
      }
      replaceMaterialTaxonomyValue(key, value, nextValue)
    },
    onDelete: (value) => {
      if (key === 'group' && keepVisualPosition && value === (material.group || 'Core materials')) {
        setMaterialVisualGroupPins((current) =>
          current[material.id] ? current : { ...current, [material.id]: material.group || 'Core materials' },
        )
      }
      deleteMaterialTaxonomyValue(key, value)
    },
    }
  }

  const taskStatusCreateConfig = (task: TaskItem): SelectCreateConfig<string> | undefined =>
    checklistStatusCreateConfig({
      onCreate: (value) => updateTaskStatus(task.id, value),
      onRename: (value, nextValue) => replaceTaskStatusValue(task.id, value, nextValue),
      onDelete: (value) => deleteTaskStatusValue(task.id, value),
    })
  const taskStatusSelectConfig = {
    options: taskStatusOptions,
    create: taskStatusCreateConfig,
  }

  const releaseMaterialGroupPin = useCallback((materialId: string) => {
    const currentTimer = materialGroupMoveTimersRef.current[materialId]
    if (currentTimer) window.clearTimeout(currentTimer)
    materialGroupMoveTimersRef.current[materialId] = window.setTimeout(() => {
      setMaterialVisualGroupPins((current) => {
        if (!current[materialId]) return current
        const next = { ...current }
        delete next[materialId]
        return next
      })
      setMaterialGroupArrivalIds((current) => new Set(current).add(materialId))
      materialGroupMoveTimersRef.current[materialId] = window.setTimeout(() => {
        setMaterialGroupArrivalIds((current) => {
          const next = new Set(current)
          next.delete(materialId)
          return next
        })
        delete materialGroupMoveTimersRef.current[materialId]
      }, getMotionDelay(520))
    }, getMotionDelay(390))
  }, [])

  useEffect(
    () => () => {
      Object.values(materialGroupMoveTimersRef.current).forEach((timer) => window.clearTimeout(timer))
      materialGroupMoveTimersRef.current = {}
    },
    [],
  )

  const commitApplicationRecommenders = (
    recommenders: MaterialRecommender[],
    intent: ApplicationDraftSaveIntent = 'settled',
  ) => {
    const currentDraft = draftRef.current
    commitDraft(
      {
        ...currentDraft,
        recommenders,
        // Recommendation contacts are an application-level relationship, not
        // checklist rows. Saving an edit is the deliberate migration boundary
        // for any legacy cached recommendation material.
        materials: currentDraft.materials.filter((material) => !isRecommendationMaterial(material)),
      },
      intent,
    )
  }

  const addOverviewRecommender = () => {
    if (isReadOnly) return
    const recommender: MaterialRecommender = {
      id: createLocalId('recommender'),
      name: '',
      contact: '',
      email: '',
      phone: '',
      notes: '',
      deadline: '',
      deadlineTime: '',
      reminderDate: '',
      reminderTime: '',
    }
    // A deliberate blank row is a local editing affordance, not yet a
    // meaningful saved contact. Claim the draft before showing it so a queued
    // selection hydration cannot paint an older snapshot over this row. The
    // row itself stays outside the application draft until it has a teacher
    // identity, so this activity signal never autosaves an empty contact.
    onDraftInteraction?.()
    const nextPending = [...pendingOverviewRecommendersRef.current, recommender]
    replacePendingOverviewRecommenders(nextPending)
    return recommender.id
  }

  const updateOverviewRecommender = (
    recommenderId: string,
    patch: Partial<MaterialRecommender>,
    intent: 'settled' | 'immediate',
  ) => {
    if (isReadOnly) return
    void intent
    const pending = pendingOverviewRecommendersRef.current.find((recommender) => recommender.id === recommenderId)
    if (pending) {
      // Editing after a successful acknowledgement creates a new unsaved
      // revision and must restore the ordinary navigation warning contract.
      markPendingRecommenderSaved(recommenderId, false)
      const nextPendingRecommender = { ...pending, ...patch }
      if ('profileId' in patch && !patch.profileId) delete nextPendingRecommender.profileId
      const nextPending = pendingOverviewRecommendersRef.current.map((recommender) =>
        recommender.id === recommenderId ? nextPendingRecommender : recommender,
      )
      replacePendingOverviewRecommenders(nextPending)
      return
    }
    const persisted = applicationRecommendersForDraft(draftRef.current)
      .find((recommender) => recommender.id === recommenderId)
    if (!persisted) return
    const next = { ...persisted, ...patch }
    if ('profileId' in patch && !patch.profileId) delete next.profileId
    onDraftInteraction?.()
    replacePendingOverviewRecommenders([...pendingOverviewRecommendersRef.current, next])
  }

  const saveOverviewRecommender = async (recommenderId: string) => {
    if (isReadOnly) return false
    const pending = pendingOverviewRecommendersRef.current.find((recommender) => recommender.id === recommenderId)
    if (pending) {
      if (!hasApplicationRecommenderIdentity(pending)) return false
      if (onResolveRecommender) {
        let decision: ApplicationRecommenderDecision = 'auto'
        const persisted = applicationRecommendersForDraft(draftRef.current)
          .find((recommender) => recommender.id === pending.id)
        if (applicationRecommenderIdentityChanged(pending, persisted, personalRecommenderOptions)) {
          const selectedDecision = await requestRecommenderDecision(pending)
          if (!selectedDecision) return false
          decision = selectedDecision
        }

        try {
          await onResolveRecommender(pending, decision)
        } catch (error) {
          // A stale/missing local directory can miss that a linked identity was
          // edited. The server remains authoritative and requests the same
          // explicit choice instead of silently applying either outcome.
          if (decision === 'auto' && error instanceof ApiError && error.code === 'RECOMMENDER_SYNC_DECISION_REQUIRED') {
            const selectedDecision = await requestRecommenderDecision(pending)
            if (!selectedDecision) return false
            try {
              await onResolveRecommender(pending, selectedDecision)
            } catch {
              return false
            }
          } else {
            return false
          }
        }

        if (pendingOverviewRecommendersRef.current.some((recommender) => recommender.id === recommenderId)) {
          markPendingRecommenderSaved(recommenderId, true)
        }
        return true
      }

      const currentRecommenders = applicationRecommendersForDraft(draftRef.current)
      const nextRecommenders = currentRecommenders.some((recommender) => recommender.id === recommenderId)
        ? currentRecommenders.map((recommender) => recommender.id === recommenderId ? pending : recommender)
        : [...currentRecommenders, pending]
      commitApplicationRecommenders(
        nextRecommenders,
        'immediate',
      )
      // Keep the App-owned pending row until the canonical application prop
      // confirms that the durable write (or offline queue) owns this exact id.
      // Clearing it before the request settles is what made a failed/stale save
      // collapse into the misleading zero-teacher empty state.
      let saved = false
      try {
        saved = onFlushAutoSave
          ? await onFlushAutoSave()
          : (await onSave()) !== false
      } catch {
        saved = false
      }
      if (saved) {
        if (pendingOverviewRecommendersRef.current.some((recommender) => recommender.id === recommenderId)) {
          markPendingRecommenderSaved(recommenderId, true)
        }
        if (!onFlushAutoSave) {
          replacePendingOverviewRecommenders(
            pendingOverviewRecommendersRef.current.filter((recommender) => recommender.id !== recommenderId),
          )
        }
      }
      return saved
    }

    const recommenders = applicationRecommendersForDraft(draftRef.current)
    const recommender = recommenders.find((candidate) => candidate.id === recommenderId)
    if (!recommender || !hasApplicationRecommenderIdentity(recommender)) return false
    commitApplicationRecommenders(recommenders, 'immediate')
    try {
      return onFlushAutoSave
        ? await onFlushAutoSave()
        : (await onSave()) !== false
    } catch {
      return false
    }
  }

  const removeOverviewRecommender = (recommenderId: string) => {
    if (isReadOnly) return
    if (pendingOverviewRecommendersRef.current.some((recommender) => recommender.id === recommenderId)) {
      const persisted = applicationRecommendersForDraft(draftRef.current)
        .some((recommender) => recommender.id === recommenderId)
      const nextPending = pendingOverviewRecommendersRef.current.filter(
        (recommender) => recommender.id !== recommenderId,
      )
      replacePendingOverviewRecommenders(nextPending)
      if (persisted) {
        commitApplicationRecommenders(
          applicationRecommendersForDraft(draftRef.current)
            .filter((recommender) => recommender.id !== recommenderId),
          'immediate',
        )
      }
      return
    }
    commitApplicationRecommenders(
      applicationRecommendersForDraft(draftRef.current).filter((recommender) => recommender.id !== recommenderId),
      'immediate',
    )
  }

  const requestCloseOverviewRecommender = (recommenderId: string, proceed: () => void) => {
    const pending = pendingOverviewRecommendersRef.current.find(
      (recommender) => recommender.id === recommenderId,
    )
    if (!pending) {
      proceed()
      return
    }
    if (savedPendingRecommenderIdsRef.current.has(recommenderId)) {
      proceed()
      return
    }
    const persisted = applicationRecommendersForDraft(draftRef.current)
      .find((recommender) => recommender.id === recommenderId)
    if (!persisted && !hasApplicationRecommenderContent(pending)) {
      removeOverviewRecommender(recommenderId)
      proceed()
      return
    }
    if (persisted && applicationRecommenderFieldsEqual(persisted, pending)) {
      replacePendingOverviewRecommenders(
        pendingOverviewRecommendersRef.current.filter((recommender) => recommender.id !== recommenderId),
      )
      proceed()
      return
    }
    setPendingItemEditExit({ kind: 'recommender-create', ids: [recommenderId], proceed })
  }

  const persistedOverviewRecommenders = applicationRecommendersForDraft(draft)
  const pendingOverviewRecommendersById = new Map(
    pendingOverviewRecommenders.map((recommender) => [recommender.id, recommender]),
  )
  const overviewRecommenders = [
    ...persistedOverviewRecommenders.map((recommender) => (
      pendingOverviewRecommendersById.get(recommender.id) ?? recommender
    )),
    ...pendingOverviewRecommenders.filter(
      (pending) => !persistedOverviewRecommenders.some((recommender) => recommender.id === pending.id),
    ),
  ]

  const removeAttachmentFromItem = <T extends MaterialItem | TaskItem>(item: T, fileId: string): T => {
    const versions = (item.versions ?? []).filter((version) => version.fileId !== fileId)
    const latest = versions[versions.length - 1]
    const base = {
      ...item,
      versions,
      fileId: latest?.fileId,
      fileName: latest?.file,
      fileSize: latest?.size,
      mimeType: latest?.mimeType,
      storageName: latest?.storageName,
    } as T
    if (!latest) {
      const cleared = base as Partial<MaterialItem | TaskItem>
      delete cleared.fileId
      delete cleared.fileName
      delete cleared.fileSize
      delete cleared.mimeType
      delete cleared.storageName
    }
    if ('version' in base) {
      return {
        ...base,
        version: latest ? `v${versions.length}` : 'v0',
        updatedAt: today,
      }
    }
    return base
  }

  const removeChecklistAttachment = async (kind: 'material' | 'task', item: MaterialItem | TaskItem, fileId?: string) => {
    if (!fileId) return
    if (kind === 'material') {
      if (onRemoveMaterialFile) {
        await Promise.resolve(onRemoveMaterialFile(item.id, fileId))
        return
      }
      commitDraft(
        {
          ...draftRef.current,
          materials: draftRef.current.materials.map((material) =>
            material.id === item.id ? removeAttachmentFromItem(material, fileId) : material,
          ),
        },
        'immediate',
      )
      return
    }
    if (onRemoveTaskFile) {
      await Promise.resolve(onRemoveTaskFile(item.id, fileId))
      return
    }
    const nextTask = removeAttachmentFromItem(item as TaskItem, fileId)
    updateTaskDraft(item.id, nextTask, 'immediate')
  }

  const cancelUploadReservation = (kind: 'material' | 'task', item: MaterialItem | TaskItem) => {
    if (kind === 'material') {
      updateMaterial(item.id, {
        uploadReserved: false,
        allowedFileTypes: [],
      })
      return
    }
    updateTaskWithServer(item.id, {
      uploadReserved: false,
      allowedFileTypes: [],
      attachmentRequired: item.fileId || item.fileName ? (item as TaskItem).attachmentRequired : false,
    })
  }

  const offsetLabel = (value: string) =>
    tx(taskReminderOffsetOptions.find((option) => option.value === value)?.labelKey ?? 'dossier.reminder1d')

  const materialReminderSummary = (material: MaterialItem) => {
    if (!material.reminderEnabled) return tx('dossier.reminderNotSet')
    return [
      material.reminderDate ? formatDate(material.reminderDate, lang) : tx('dossier.reminderDate'),
      material.reminderTime,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  const taskReminderSummary = (task: TaskItem) => {
    if (!task.reminderEnabled) return tx('dossier.reminderNotSet')
    const offsets = task.reminderOffsets?.length ? task.reminderOffsets : ['1d']
    return [offsets.map(offsetLabel).join(' / '), task.reminderTime].filter(Boolean).join(' · ')
  }

  const showReminderMenu = (target: Exclude<ReminderMenuTarget, null>) => {
    if (reminderCloseTimerRef.current !== null) {
      window.clearTimeout(reminderCloseTimerRef.current)
      reminderCloseTimerRef.current = null
    }
    reminderPopoverRef.current?.classList.remove('closing')
    setReminderPopoverStyle(getReminderPopoverStyle(target))
    setClosingReminderMenu(null)
    setReminderMenu(target)
  }

  const openReminderMenu = (target: Exclude<ReminderMenuTarget, null>) => {
    if (checklistUploadOpen) {
      if (checklistUploadExiting || uploadSubmitting) return
      const showAfterUpload = () => showReminderMenu(target)
      if (uploadDraftFiles.length > 0 || (uploadReservationEnabled && checklistUploadTarget)) {
        void submitChecklistUpload(showAfterUpload)
      } else {
        closeChecklistUpload(showAfterUpload)
      }
      return
    }
    if (sameReminderTarget(reminderMenu, target) && !sameReminderTarget(closingReminderMenu, target)) {
      closeReminderMenu()
      return
    }
    showReminderMenu(target)
  }

  const closeReminderMenu = (afterClose?: () => void) => {
    const target = reminderMenu
    if (!target) return
    if (reminderCloseTimerRef.current !== null) {
      window.clearTimeout(reminderCloseTimerRef.current)
    }
    reminderPopoverRef.current?.classList.add('closing')
    setClosingReminderMenu(target)
    reminderCloseTimerRef.current = window.setTimeout(() => {
      afterClose?.()
      setReminderMenu((current) => (sameReminderTarget(current, target) ? null : current))
      setClosingReminderMenu((current) => (sameReminderTarget(current, target) ? null : current))
      reminderCloseTimerRef.current = null
    }, getMotionDelay(170))
  }

  const updateTaskWithServer = (taskId: string, patch: Partial<TaskItem>) => {
    if (pendingChecklistCreateRef.current?.id === taskId) {
      updateTaskDraft(taskId, patch, 'external')
      return
    }
    if (autoSaveEnabled) {
      updateTaskDraft(taskId, patch, 'immediate')
      return
    }
    updateTaskDraft(taskId, patch, 'external')
    onUpdateTask?.(taskId, patch)
  }

  const renderMaterialReminderControl = (material: MaterialItem) => {
    const isOpen = reminderMenu?.kind === 'material' && reminderMenu.id === material.id
    const isClosing = sameReminderTarget(closingReminderMenu, {
      kind: 'material',
      id: material.id,
    })
    const shouldRenderMenu = isOpen || isClosing
    const targetKey = reminderTargetKey({ kind: 'material', id: material.id })
    return (
      <div
        className="checklist-popover-anchor"
        ref={(node) => {
          reminderAnchorRefs.current[targetKey] = node
        }}
      >
        <button
          type="button"
          className={`checklist-pill-control ${material.reminderEnabled ? 'active' : ''}`}
          onClick={() => openReminderMenu({ kind: 'material', id: material.id })}
          aria-expanded={isOpen && !isClosing}
        >
          <Bell size={13} />
          <span>{tx('dossier.reminder')}</span>
          <strong>{materialReminderSummary(material)}</strong>
        </button>
        {shouldRenderMenu &&
          createPortal(
            <div
              ref={reminderPopoverRef}
              className={`checklist-popover ${isClosing ? 'closing' : ''}`}
              style={reminderPopoverStyle}
              role="dialog"
              aria-label={tx('dossier.reminderMenuTitle')}
            >
              <div className="checklist-popover-title">
                <Bell size={13} />
                <span>{tx('dossier.reminderMenuTitle')}</span>
              </div>
              <label className="checklist-menu-field">
                <span>{tx('dossier.reminderDate')}</span>
                <DatePicker
                  value={material.reminderDate || draft.nextReminder || today}
                  timeValue={material.reminderTime ?? ''}
                  onChange={(value) =>
                    updateMaterial(material.id, {
                      reminderEnabled: true,
                      reminderDate: value,
                      reminderRepeat: 'once',
                    })
                  }
                  placeholder={tx('dossier.reminderDate')}
                  onTimeChange={(value) =>
                    updateMaterial(material.id, {
                      reminderEnabled: true,
                      reminderDate: material.reminderDate || draft.nextReminder || today,
                      reminderTime: value,
                      reminderRepeat: 'once',
                    })
                  }
                  timeAriaLabel={tx('dossier.reminderTime')}
                />
              </label>
              <div className="checklist-popover-actions">
                <button
                  type="button"
                  className="quiet-action"
                  onClick={() => {
                    closeReminderMenu(() =>
                      updateMaterial(material.id, {
                        reminderEnabled: false,
                        reminderDate: '',
                        reminderTime: '',
                        reminderRepeat: 'once',
                      }),
                    )
                  }}
                >
                  {tx('dossier.clearReminder')}
                </button>
                <button type="button" className="primary-action compact-action" onClick={() => closeReminderMenu()}>
                  {tx('dossier.done')}
                </button>
              </div>
            </div>,
            document.body,
          )}
      </div>
    )
  }

  const renderTaskReminderControl = (task: TaskItem) => {
    const isOpen = reminderMenu?.kind === 'task' && reminderMenu.id === task.id
    const isClosing = sameReminderTarget(closingReminderMenu, {
      kind: 'task',
      id: task.id,
    })
    const shouldRenderMenu = isOpen || isClosing
    const offsets = task.reminderOffsets?.length ? task.reminderOffsets : ['1d']
    const targetKey = reminderTargetKey({ kind: 'task', id: task.id })
    return (
      <div
        className="checklist-popover-anchor"
        ref={(node) => {
          reminderAnchorRefs.current[targetKey] = node
        }}
      >
        <button
          type="button"
          className={`checklist-pill-control ${task.reminderEnabled ? 'active' : ''}`}
          onClick={() => openReminderMenu({ kind: 'task', id: task.id })}
          aria-expanded={isOpen && !isClosing}
        >
          <Bell size={13} />
          <span>{tx('dossier.reminder')}</span>
          <strong>{taskReminderSummary(task)}</strong>
        </button>
        {shouldRenderMenu &&
          createPortal(
            <div
              ref={reminderPopoverRef}
              className={`checklist-popover ${isClosing ? 'closing' : ''}`}
              style={reminderPopoverStyle}
              role="dialog"
              aria-label={tx('dossier.reminderMenuTitle')}
            >
              <div className="checklist-popover-title">
                <Bell size={13} />
                <span>{tx('dossier.reminderMenuTitle')}</span>
              </div>
              <label className="checklist-menu-field">
                <span>{tx('dossier.reminderDate')}</span>
                <DatePicker
                  value={task.due}
                  timeValue={task.reminderTime ?? ''}
                  onChange={(value) =>
                    updateTaskWithServer(task.id, {
                      due: value,
                      reminderEnabled: true,
                      reminderRepeat: 'once',
                    })
                  }
                  placeholder={tx('dossier.reminderDate')}
                  onTimeChange={(value) =>
                    updateTaskWithServer(task.id, {
                      reminderEnabled: true,
                      reminderOffsets: offsets,
                      reminderTime: value,
                      reminderRepeat: 'once',
                    })
                  }
                  timeAriaLabel={tx('dossier.reminderTime')}
                />
              </label>
              <div className="checklist-menu-row">
                <span>{tx('dossier.notifyWhen')}</span>
                <div className="checklist-menu-chips">
                  {taskReminderOffsetOptions.map((option) => {
                    const active = offsets.includes(option.value)
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`checklist-offset-chip ${active ? 'active' : ''}`}
                        onClick={() => {
                          const next = active
                            ? offsets.filter((value) => value !== option.value)
                            : [...offsets, option.value]
                          updateTaskWithServer(task.id, {
                            reminderEnabled: true,
                            reminderOffsets: next.length ? next : ['1d'],
                            reminderRepeat: 'once',
                          })
                        }}
                      >
                        {tx(option.labelKey)}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="checklist-popover-actions">
                <button
                  type="button"
                  className="quiet-action"
                  onClick={() => {
                    closeReminderMenu(() =>
                      updateTaskWithServer(task.id, {
                        reminderEnabled: false,
                        reminderOffsets: [],
                        reminderTime: '',
                        reminderRepeat: 'once',
                      }),
                    )
                  }}
                >
                  {tx('dossier.clearReminder')}
                </button>
                <button type="button" className="primary-action compact-action" onClick={() => closeReminderMenu()}>
                  {tx('dossier.done')}
                </button>
              </div>
            </div>,
            document.body,
          )}
      </div>
    )
  }

  const renderAttachmentControl = (kind: 'material' | 'task', item: MaterialItem | TaskItem, title: string) => {
    const rows = attachmentRows(item)
    if (rows.length > 0) return null

    const currentRow = rows.find((row) => row.current) ?? rows[0]
    const uploadReserved = Boolean(item.uploadReserved)
    const statusText =
      rows.length > 1
        ? format(tx('dossier.attachmentCount'), { count: rows.length })
        : currentRow?.file || (uploadReserved ? tx('dossier.uploadReserved') : tx('dossier.noAttachment'))
    return (
      <div className="checklist-control-cluster">
        <button
          type="button"
          className={`checklist-pill-control ${rows.length || uploadReserved ? 'active' : ''}`}
          onClick={() => requestChecklistUpload({ kind, id: item.id })}
        >
          <Paperclip size={13} />
          <span>{tx('dossier.attachment')}</span>
          <strong>{statusText}</strong>
        </button>
        {currentRow?.fileId ? (
          <button
            type="button"
            className="checklist-icon-control"
            onClick={() => onDownload(currentRow.fileId, currentRow.file || title)}
            title={tx('dossier.download')}
          >
            <Download size={13} />
          </button>
        ) : null}
      </div>
    )
  }

  const formatAttachmentTimestamp = (value: string) => {
    if (!value) return '—'
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return new Intl.DateTimeFormat(localeForLanguage(lang), {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(parsed)
  }

  const startChecklistFileRename = (kind: 'material' | 'task', itemId: string, fileId: string, currentName: string) => {
    if (readOnly) return
    if (kind === 'material' && !onRenameMaterialFile) return
    if (kind === 'task' && !onRenameTaskFile) return
    setRenamingChecklistFileKey(`${kind}:${itemId}:${fileId}`)
    setRenameChecklistFileValue(currentName)
  }

  const cancelChecklistFileRename = () => {
    setRenamingChecklistFileKey(null)
    setRenameChecklistFileValue('')
  }

  const commitChecklistFileRename = async (kind: 'material' | 'task', itemId: string, fileId: string) => {
    const nextName = renameChecklistFileValue.trim()
    if (!nextName) {
      cancelChecklistFileRename()
      return
    }
    try {
      if (kind === 'material') await Promise.resolve(onRenameMaterialFile?.(itemId, fileId, nextName))
      else await Promise.resolve(onRenameTaskFile?.(itemId, fileId, nextName))
    } catch {
      // Keep the inline editor mounted so a rejected rename can be corrected
      // and retried; the owner has already shown its localized error.
      return false
    }
    cancelChecklistFileRename()
    return true
  }

  useEffect(() => {
    if (!renamingChecklistFileKey) return
    const frame = window.requestAnimationFrame(() => {
      renameChecklistFileInputRef.current?.focus()
      renameChecklistFileInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [renamingChecklistFileKey])

  const renderAttachmentTable = (kind: 'material' | 'task', item: MaterialItem | TaskItem, title: string) => {
    const rows = attachmentRows(item)
    const reserved = Boolean(item.uploadReserved)
    if (!rows.length && !reserved) return null
    const canRename = !readOnly && (kind === 'material' ? Boolean(onRenameMaterialFile) : Boolean(onRenameTaskFile))

    return (
      <section className={`checklist-attachment-panel ${reserved ? 'reserved' : ''}`}>
        <div className="checklist-attachment-head">
          <div>
            <span>
              <Paperclip size={13} aria-hidden="true" /> {tx('dossier.attachments')}
            </span>
            <strong>
              {rows.length ? format(tx('dossier.attachmentCount'), { count: rows.length }) : tx('dossier.noAttachment')}
            </strong>
          </div>
          <div className="checklist-attachment-actions">
            {reserved ? (
              <button
                type="button"
                className="quiet-action compact-action danger-quiet"
                onClick={() => cancelUploadReservation(kind, item)}
              >
                <X size={13} aria-hidden="true" /> {tx('dossier.cancelUploadReservation')}
              </button>
            ) : null}
            <button
              type="button"
              className="quiet-action compact-action"
              onClick={() => requestChecklistUpload({ kind, id: item.id })}
            >
              <UploadCloud size={13} aria-hidden="true" />{' '}
              {rows.length ? tx('dossier.addMoreFiles') : tx('dossier.uploadAttachment')}
            </button>
          </div>
        </div>

        {reserved ? (
          <div className="checklist-attachment-reserved">
            <UploadCloud size={13} aria-hidden="true" />
            <span>{tx('dossier.uploadReservedHint')}</span>
          </div>
        ) : null}

        {rows.length ? (
          <div className="checklist-attachment-table-wrap atlas-table-shell" onContextMenu={openAttachmentTableMenu}>
            <table className="checklist-attachment-table atlas-table">
              <TableColGroup columns={attachmentTableColumns} api={attachmentTableApi} />
              <thead>
                <tr>
                  <TableHeaderCell column={attachmentCol.name} api={attachmentTableApi}>
                    {tx('dossier.uploadFileName')}
                  </TableHeaderCell>
                  <TableHeaderCell column={attachmentCol.size} api={attachmentTableApi}>
                    {tx('dossier.fileSize')}
                  </TableHeaderCell>
                  <TableHeaderCell column={attachmentCol.author} api={attachmentTableApi}>
                    {tx('dossier.uploadedBy')}
                  </TableHeaderCell>
                  <TableHeaderCell column={attachmentCol.uploadedAt} api={attachmentTableApi}>
                    {tx('dossier.uploadedAt')}
                  </TableHeaderCell>
                  <TableHeaderCell column={attachmentCol.actions} api={attachmentTableApi}>
                    {tx('dossier.actions')}
                  </TableHeaderCell>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const fileId = row.fileId
                  const renameKey = fileId ? `${kind}:${item.id}:${fileId}` : null
                  const renaming = Boolean(renameKey && renamingChecklistFileKey === renameKey)
                  const displayName = row.file || tx('dossier.attachment')
                  return (
                    <tr key={fileId ?? row.id} className={renaming ? 'is-renaming-attachment' : undefined}>
                      <TableCell columnId="name" api={attachmentTableApi}>
                        <div className={`checklist-attachment-name${renaming ? ' is-renaming' : ''}`}>
                          <Paperclip size={12} aria-hidden="true" />
                          <div className="checklist-attachment-name-wrap">
                            <button
                              type="button"
                              className="checklist-attachment-filename"
                              title={canRename ? tx('dossier.renameFileHint', 'Double-click to rename') : displayName}
                              onDoubleClick={(event) => {
                                event.preventDefault()
                                if (!canRename || !fileId) return
                                startChecklistFileRename(kind, item.id, fileId, displayName)
                              }}
                            >
                              <span>{displayName}</span>
                            </button>
                            <input
                              ref={renaming ? renameChecklistFileInputRef : undefined}
                              className="checklist-attachment-rename-input"
                              value={renaming ? renameChecklistFileValue : displayName}
                              onChange={(event) => setRenameChecklistFileValue(event.target.value)}
                              onBlur={() => {
                                if (renaming && fileId) void commitChecklistFileRename(kind, item.id, fileId)
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  if (fileId) void commitChecklistFileRename(kind, item.id, fileId)
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault()
                                  cancelChecklistFileRename()
                                }
                              }}
                              aria-label={tx('dossier.renameFile', 'Rename file')}
                              tabIndex={renaming ? 0 : -1}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell columnId="size" api={attachmentTableApi}>
                        {fileSizeLabel(row.size)}
                      </TableCell>
                      <TableCell columnId="author" api={attachmentTableApi}>
                        {row.author || '—'}
                      </TableCell>
                      <TableCell columnId="uploadedAt" api={attachmentTableApi}>
                        {formatAttachmentTimestamp(row.createdAt)}
                      </TableCell>
                      <TableCell columnId="actions" api={attachmentTableApi}>
                        <div className="checklist-attachment-row-actions">
                          {fileId ? (
                            onPreview ? (
                              <button
                                type="button"
                                className="checklist-attachment-action"
                                onClick={() =>
                                  setAttachmentPreview({
                                    fileId,
                                    fileName: row.file || title,
                                    mimeType: row.mimeType,
                                  })
                                }
                                title={tx('filePreview.preview')}
                                aria-label={tx('filePreview.preview')}
                              >
                                <Eye size={13} aria-hidden="true" />
                                <span>{tx('filePreview.preview')}</span>
                              </button>
                            ) : null
                          ) : null}
                          {fileId ? (
                            <button
                              type="button"
                              className="checklist-attachment-action"
                              onClick={() => onDownload(fileId, row.file || title)}
                              title={tx('dossier.download')}
                              aria-label={tx('dossier.download')}
                            >
                              <Download size={13} aria-hidden="true" />
                              <span>{tx('dossier.download')}</span>
                            </button>
                          ) : null}
                          {fileId && !readOnly ? (
                            <button
                              type="button"
                              className="checklist-attachment-action checklist-delete-btn"
                              onClick={() =>
                                setConfirmRemoveAttachment({
                                  kind,
                                  itemId: item.id,
                                  fileId,
                                })
                              }
                              title={tx('dossier.removeAttachment')}
                              aria-label={tx('dossier.removeAttachment')}
                            >
                              <Trash2 size={13} aria-hidden="true" />
                              <span>{tx('dossier.remove')}</span>
                            </button>
                          ) : null}
                        </div>
                      </TableCell>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {attachmentTableMenuNode}
          </div>
        ) : null}
      </section>
    )
  }

  const sortedCommunications = useMemo(
    () =>
      renderedTab === 'mail' && tabContentReady
        ? [...draft.communications].sort((a, b) => communicationSortStamp(a).localeCompare(communicationSortStamp(b)))
        : [],
    [draft.communications, renderedTab, tabContentReady],
  )
  const nonDraftCommunications = useMemo(
    () => sortedCommunications.filter((item) => item.messageType !== 'draft-email'),
    [sortedCommunications],
  )
  const draftCommunications = useMemo(
    () => sortedCommunications.filter((item) => item.messageType === 'draft-email'),
    [sortedCommunications],
  )
  /** This account's own categories, shown after the built-in taxonomy. */
  const customMailCategories = useMemo(
    () => normalizedCustomMailCategories(session?.user.settings.customMailCategories),
    [session?.user.settings.customMailCategories],
  )
  const mailCategoryChoices = useMemo(
    () => mailCategoryOptions(customMailCategories).map((option) => ({
      ...option,
      label: resolveMailCategoryLabel(option.id, customMailCategories, tx),
      section: option.custom
        ? tx('dossier.mailCategorySectionCustom')
        : tx('dossier.mailCategorySectionBuiltIn'),
    })),
    [customMailCategories, tx],
  )
  const communicationCategoryFilterOptions = useMemo(
    () => [
      { value: 'all' as const, label: tx('dossier.mailCategoryFilterAll') },
      ...mailCategoryChoices.map((option) => ({
        value: option.id,
        label: option.label,
        section: option.section,
        custom: option.custom,
      })),
    ],
    [mailCategoryChoices, tx],
  )
  const activeCommunicationCategoryFilters = communicationCategoryFilters.filter((id) => id !== 'all')
  const hasActiveCommunicationCategoryFilter = activeCommunicationCategoryFilters.length > 0
  const communicationCategoryFilterLabel = activeCommunicationCategoryFilters.length === 0
    ? tx('dossier.mailCategoryFilterAll')
    : activeCommunicationCategoryFilters.length === 1
      ? communicationCategoryFilterOptions.find(
          (option) => option.value === activeCommunicationCategoryFilters[0],
        )?.label ?? tx('dossier.mailCategoryFilterAll')
      : format(tx('dossier.mailCategoryFilterSelected'), {
          count: activeCommunicationCategoryFilters.length,
        })
  /**
   * Managing categories belongs where they are already listed, so the filter's
   * own dropdown carries create, rename and delete. Built-ins are code-owned
   * and stay unmanageable; only this account's own entries can be touched.
   */
  const mailCategoryCreateConfig = useMemo((): SelectCreateConfig<CommunicationCategoryFilter> | undefined => {
    if (!onCustomMailCategoriesChange || isReadOnly) return undefined
    const persist = (next: CustomMailCategory[]) => {
      void onCustomMailCategoriesChange(normalizedCustomMailCategories(next))
    }
    return {
      label: tx('dossier.mailCategoryAdd'),
      placeholder: tx('dossier.mailCategoryPlaceholder'),
      createAriaLabel: tx('dossier.mailCategoryAdd'),
      renameAriaLabel: tx('dossier.mailCategoryRename'),
      deleteAriaLabel: tx('dossier.mailCategoryDelete'),
      canCreate: customMailCategories.length < MAX_CUSTOM_MAIL_CATEGORIES,
      maxLength: MAX_CUSTOM_MAIL_CATEGORY_LABEL_LENGTH,
      onCreate: (rawLabel) => {
        const label = rawLabel.trim().slice(0, MAX_CUSTOM_MAIL_CATEGORY_LABEL_LENGTH)
        if (!label) return
        const takenLabels = new Set(customMailCategories.map((entry) => entry.label.toLocaleLowerCase()))
        if (takenLabels.has(label.toLocaleLowerCase())) return
        const id = customMailCategoryId(label, new Set(customMailCategories.map((entry) => entry.id)))
        // Cycle the palette so consecutive new categories stay distinguishable.
        const tone = mailCategoryTonePalette[customMailCategories.length % mailCategoryTonePalette.length]
        persist([...customMailCategories, { id, label, tone }])
      },
      onRename: (id, rawLabel) => {
        const label = rawLabel.trim().slice(0, MAX_CUSTOM_MAIL_CATEGORY_LABEL_LENGTH)
        // The id never changes with the name: renaming must not orphan every
        // message already filed under this category.
        if (!label || !customMailCategories.some((entry) => entry.id === id)) return
        persist(customMailCategories.map((entry) => (
          entry.id === id ? { ...entry, label } : entry
        )))
      },
      onDelete: (id) => {
        if (!customMailCategories.some((entry) => entry.id === id)) return
        const nextFilters = communicationCategoryFilters.filter((entry) => entry !== id)
        setCommunicationCategoryFilters(nextFilters.length > 0 ? nextFilters : ['all'])
        persist(customMailCategories.filter((entry) => entry.id !== id))
      },
    }
  }, [
    communicationCategoryFilters,
    customMailCategories,
    isReadOnly,
    onCustomMailCategoriesChange,
    tx,
  ])
  /** Every category on the message, joined, for the classification tooltip. */
  const classificationCategoryLabels = useCallback(
    (record: Parameters<typeof effectiveMailCategories>[0]) => effectiveMailCategories(record)
      .map((id) => resolveMailCategoryLabel(id, customMailCategories, tx))
      .join(', '),
    [customMailCategories, tx],
  )
  const visibleCommunications = useMemo(
    () => {
      if (correspondenceView === 'drafts') return draftCommunications
      if (!hasActiveCommunicationCategoryFilter) return nonDraftCommunications
      const selectedCategorySet = new Set(activeCommunicationCategoryFilters)
      // A message carrying several categories belongs in each selected filter;
      // selecting several filters therefore uses OR semantics.
      return nonDraftCommunications.filter(
        (item) => effectiveMailCategories(item).some((category) => selectedCategorySet.has(category)),
      )
    }, [
      activeCommunicationCategoryFilters,
      correspondenceView,
      draftCommunications,
      hasActiveCommunicationCategoryFilter,
      nonDraftCommunications,
    ],
  )
  const renderedCommunications = useMemo(
    () => visibleCommunications.slice(0, communicationRenderLimit),
    [communicationRenderLimit, visibleCommunications],
  )

  useEffect(() => {
    setCommunicationRenderLimit(50)
  }, [communicationCategoryFilters, correspondenceView, renderedTab])

  useEffect(() => {
    const row = correspondenceViewRowRef.current
    const activeButton = correspondenceViewButtonRefs.current[correspondenceView]
    if (renderedTab !== 'mail' || !canUseDrafts || !row || !activeButton) return undefined
    let frame = 0

    const updateIndicator = () => {
      const rowRect = row.getBoundingClientRect()
      const buttonRect = activeButton.getBoundingClientRect()
      row.style.setProperty('--correspondence-view-indicator-x', `${buttonRect.left - rowRect.left + row.scrollLeft}px`)
      row.style.setProperty('--correspondence-view-indicator-y', `${buttonRect.top - rowRect.top + row.scrollTop}px`)
      row.style.setProperty('--correspondence-view-indicator-width', `${buttonRect.width}px`)
      row.style.setProperty('--correspondence-view-indicator-height', `${buttonRect.height}px`)
      row.style.setProperty('--correspondence-view-indicator-opacity', '1')
    }

    const scheduleIndicator = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updateIndicator()
      })
    }

    scheduleIndicator()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleIndicator)
    resizeObserver?.observe(row)
    resizeObserver?.observe(activeButton)
    window.addEventListener('resize', scheduleIndicator)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleIndicator)
    }
  }, [renderedTab, canUseDrafts, correspondenceView, nonDraftCommunications.length, draftCommunications.length, lang])

  useEffect(() => {
    const bar = correspondenceModeBarRef.current
    if (renderedTab !== 'mail' || !bar) return undefined
    const activeButton = composerOpen ? correspondenceModeButtonRefs.current[correspondenceMode] : null
    if (!activeButton) {
      bar.style.setProperty('--correspondence-mode-indicator-opacity', '0')
      return undefined
    }
    let frame = 0

    const updateIndicator = () => {
      const barRect = bar.getBoundingClientRect()
      const buttonRect = activeButton.getBoundingClientRect()
      bar.style.setProperty('--correspondence-mode-indicator-x', `${buttonRect.left - barRect.left + bar.scrollLeft}px`)
      bar.style.setProperty('--correspondence-mode-indicator-y', `${buttonRect.top - barRect.top + bar.scrollTop}px`)
      bar.style.setProperty('--correspondence-mode-indicator-width', `${buttonRect.width}px`)
      bar.style.setProperty('--correspondence-mode-indicator-height', `${buttonRect.height}px`)
      bar.style.setProperty('--correspondence-mode-indicator-opacity', '1')
    }

    const scheduleIndicator = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updateIndicator()
      })
    }

    scheduleIndicator()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleIndicator)
    resizeObserver?.observe(bar)
    resizeObserver?.observe(activeButton)
    window.addEventListener('resize', scheduleIndicator)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleIndicator)
    }
  }, [renderedTab, composerOpen, correspondenceMode, canUseDrafts, lang])

  const unifiedTimelineEvents = useMemo(() => {
    if (renderedTab !== 'timeline' || !tabContentReady) return []
    const communications = (draft.communications ?? []).filter(Boolean)
    const communicationKeys = new Set(
      communications.map(
        (item) =>
          `${item.date || today}|${item.channel || 'Email'}: ${item.subject || tx('dossier.untitledMessage')}|${item.summary || ''}`,
      ),
    )
    const manualEvents = application.timeline
      .filter((event) => !communicationKeys.has(`${event.date}|${event.title}|${event.note}`))
      .map((event) => ({
        ...event,
        source: tx('dossier.timelineSourceManual'),
        sourceKind: 'manual' as const,
        eventKind: (event.id.startsWith('time_mail_') ? 'message' : 'manual') as TimelineEventKind,
        manual: true,
        plainText: event.id.startsWith('time_mail_'),
      }))
    type GeneratedTimelineEvent = {
      id: string
      title: string
      date: string
      note: string
      source: string
      sourceKind: TimelineSourceKind
      eventKind: TimelineEventKind
      nav: TimelineNav
      value?: string
      statusText?: string
      statusTone?: StatusTone
      plainText?: boolean
    }
    const rawGenerated: Array<GeneratedTimelineEvent | null> = [
      {
        id: `auto-deadline-${application.id}`,
        title: tx('dossier.timelineDeadlineTitle'),
        date: draft.deadline,
        note: format(tx('dossier.timelineDeadlineNote'), {
          school: draft.school.name,
        }),
        source: tx('dossier.timelineSourceDossier'),
        sourceKind: 'dossier' as TimelineSourceKind,
        eventKind: 'deadline' as TimelineEventKind,
        nav: { tab: 'dossier' } as TimelineNav,
      },
      draft.nextReminder
        ? {
            id: `auto-reminder-${application.id}`,
            title: tx('dossier.timelineReminderTitle'),
            date: draft.nextReminder,
            note: tx('dossier.timelineReminderNote'),
            source: tx('dossier.timelineSourceDossier'),
            sourceKind: 'dossier' as TimelineSourceKind,
            eventKind: 'reminder' as TimelineEventKind,
            nav: { tab: 'dossier' } as TimelineNav,
          }
        : null,
      ...checklistMaterials.flatMap((material) => [
        material.reminderEnabled && material.reminderDate
          ? {
              id: `auto-material-reminder-${material.id}`,
              title: format(tx('dossier.timelineMaterialReminder'), {
                name: localize(material.name),
              }),
              date: material.reminderDate,
              note: material.details || tx('dossier.emailReminder'),
              source: tx('dossier.timelineSourceChecklist'),
              sourceKind: 'checklist' as TimelineSourceKind,
              eventKind: 'reminder' as TimelineEventKind,
              nav: {
                tab: 'materials',
                kind: 'material',
                id: material.id,
              } as TimelineNav,
            }
          : null,
        material.updatedAt
          ? {
              id: `auto-material-updated-${material.id}`,
              title: format(tx('dossier.timelineMaterialUpdated'), {
                name: localize(material.name),
              }),
              date: material.updatedAt,
              note: material.fileName || material.details || '',
              source: tx('dossier.timelineSourceChecklist'),
              sourceKind: 'checklist' as TimelineSourceKind,
              eventKind: 'update' as TimelineEventKind,
              statusText: statusLabel(material.status, tx),
              statusTone: materialStatusMenuTone(material.status),
              nav: {
                tab: 'materials',
                kind: 'material',
                id: material.id,
              } as TimelineNav,
            }
          : null,
      ]),
      ...draft.tasks.filter((task) => task.due).map((task) => ({
        id: `auto-task-${task.id}`,
        title: format(tx('dossier.taskDue'), { name: localize(task.title) }),
        date: task.due,
        note: task.details || '',
        source: tx('dossier.timelineSourceChecklist'),
        sourceKind: 'checklist' as TimelineSourceKind,
        eventKind: 'task' as TimelineEventKind,
        statusText: task.done ? tx('dossier.timelineTaskDone') : statusLabel(task.status || 'Open', tx),
        statusTone: task.done ? 'success' as StatusTone : materialStatusMenuTone(task.status || 'Open'),
        nav: { tab: 'materials', kind: 'task', id: task.id } as TimelineNav,
      })),
      ...communications.map((item) => ({
        id: `auto-communication-${item.id}`,
        title: `${tx(`channel.${item.channel || 'Email'}`, item.channel || 'Email')}: ${localize(item.subject || tx('dossier.untitledMessage'))}`,
        date: communicationCalendarDate(item) || today,
        note: item.summary || '',
        source: tx('dossier.timelineSourceMail'),
        sourceKind: 'mail' as TimelineSourceKind,
        eventKind: 'message' as TimelineEventKind,
        nav: { tab: 'mail', id: item.id } as TimelineNav,
        plainText: item.messageType === 'fetched-email',
      })),
      ...(application.fees ?? []).map((fee) => {
        const isPaid = Boolean(fee.paidDate)
        const statusText = fee.waived
          ? tx('fees.waived')
          : isPaid
            ? tx('fees.paid')
            : tx('fees.remaining')
        return {
          id: `auto-fee-${fee.id}`,
          title: tx('fees.sectionTitle'),
          date: fee.paidDate || fee.createdAt?.slice(0, 10) || today,
          note: fee.notes || '',
          source: tx('dossier.timelineSourceFunding'),
          sourceKind: 'funding' as TimelineSourceKind,
          eventKind: 'fee' as TimelineEventKind,
          value: formatFeeAmount(fee.amount, fee.currency, lang),
          statusText,
          statusTone: (fee.waived ? 'info' : isPaid ? 'success' : 'warning') as StatusTone,
          nav: { tab: 'funding', feeId: fee.id } as TimelineNav,
        }
      }),
      ...application.scholarships.flatMap((item) => [
        {
          id: `auto-scholarship-start-${item.id}`,
          title: format(tx('dossier.timelineScholarshipStart'), {
            name: localize(item.name),
          }),
          date: item.startDate,
          note: item.issuer || '',
          source: tx('dossier.timelineSourceFunding'),
          sourceKind: 'funding' as TimelineSourceKind,
          eventKind: 'funding' as TimelineEventKind,
          value: item.amount || undefined,
          statusText: item.status ? statusLabel(item.status, tx) : undefined,
          statusTone: item.status ? materialStatusMenuTone(item.status) : undefined,
          nav: { tab: 'funding', scholarshipId: item.id } as TimelineNav,
        },
        {
          id: `auto-scholarship-end-${item.id}`,
          title: format(tx('dossier.timelineScholarshipEnd'), {
            name: localize(item.name),
          }),
          date: item.endDate,
          note: item.issuer || '',
          source: tx('dossier.timelineSourceFunding'),
          sourceKind: 'funding' as TimelineSourceKind,
          eventKind: 'funding' as TimelineEventKind,
          value: item.amount || undefined,
          statusText: item.status ? statusLabel(item.status, tx) : undefined,
          statusTone: item.status ? materialStatusMenuTone(item.status) : undefined,
          nav: { tab: 'funding', scholarshipId: item.id } as TimelineNav,
        },
        ...(item.materials ?? []).map((material) => ({
          id: `auto-scholarship-material-${item.id}-${material.id}`,
          title: format(tx('dossier.timelineScholarshipMaterial'), {
            name: localize(material.name),
            scholarship: localize(item.name),
          }),
          date: material.due || item.endDate,
          note: material.details || '',
          source: tx('dossier.timelineSourceFunding'),
          sourceKind: 'funding' as TimelineSourceKind,
          eventKind: 'deadline' as TimelineEventKind,
          statusText: statusLabel(material.status, tx),
          statusTone: materialStatusMenuTone(material.status),
          nav: { tab: 'funding', scholarshipId: item.id } as TimelineNav,
        })),
        ...(item.tasks ?? []).map((task) => ({
          id: `auto-scholarship-task-${item.id}-${task.id}`,
          title: format(tx('dossier.timelineScholarshipTask'), {
            name: localize(task.title),
            scholarship: localize(item.name),
          }),
          date: task.due || item.endDate,
          note: task.details || '',
          source: tx('dossier.timelineSourceFunding'),
          sourceKind: 'funding' as TimelineSourceKind,
          eventKind: 'task' as TimelineEventKind,
          statusText: task.done ? tx('dossier.timelineTaskDone') : statusLabel(task.status || 'Open', tx),
          statusTone: task.done ? 'success' as StatusTone : materialStatusMenuTone(task.status || 'Open'),
          nav: { tab: 'funding', scholarshipId: item.id } as TimelineNav,
        })),
        ...(item.timeline ?? []).map((event) => ({
          id: `auto-scholarship-event-${item.id}-${event.id}`,
          title: `${localize(item.name)}: ${localize(event.title)}`,
          date: event.date || item.endDate,
          note: event.note || '',
          source: tx('dossier.timelineSourceFunding'),
          sourceKind: 'funding' as TimelineSourceKind,
          eventKind: 'funding' as TimelineEventKind,
          nav: { tab: 'funding', scholarshipId: item.id } as TimelineNav,
        })),
      ]),
    ]
    const generated = rawGenerated.filter((event): event is GeneratedTimelineEvent => Boolean(event && event.date))
    const deduped = new Map<
      string,
      {
        id: string
        title: string
        date: string
        note: string
        source?: string
        sourceKind: TimelineSourceKind
        eventKind: TimelineEventKind
        manual?: boolean
        nav?: TimelineNav
        value?: string
        statusText?: string
        statusTone?: StatusTone
        plainText?: boolean
      }
    >()
    const manualDisplayKeys = new Set<string>()
    for (const event of manualEvents) {
      const key = `${event.date}|${event.title}|${event.note}`
      manualDisplayKeys.add(key)
      if (!deduped.has(key)) deduped.set(key, event)
    }
    for (const event of generated) {
      const displayKey = `${event.date}|${event.title}|${event.note}`
      if (manualDisplayKeys.has(displayKey)) continue
      // Generated records have stable source ids. Keep distinct fees, reminders,
      // and tasks even when their visible summary happens to be identical.
      deduped.set(`generated:${event.id}`, event)
    }
    return Array.from(deduped.values())
  }, [application, checklistMaterials, draft, format, lang, localize, renderedTab, tabContentReady, tx])
  const groupedTimeline = useMemo(
    () => (renderedTab === 'timeline' ? groupTimelineEvents(unifiedTimelineEvents, lang) : []),
    [unifiedTimelineEvents, lang, renderedTab],
  )
  // Position of the first past event (groups are newest-first), so the "today" marker can be
  // inserted right before it. Jump-to-today is user-initiated via the floating dock.
  const timelineNowMarker = useMemo(() => {
    if (groupedTimeline.length === 0) return null
    for (let gi = 0; gi < groupedTimeline.length; gi++) {
      const events = groupedTimeline[gi].events
      for (let ei = 0; ei < events.length; ei++) {
        if (events[ei].date < today) return { groupIndex: gi, eventIndex: ei }
      }
    }
    return { groupIndex: groupedTimeline.length, eventIndex: 0 }
  }, [groupedTimeline])

  // `content-visibility: auto` keeps long timelines inexpensive, but the browser
  // otherwise paints newly materialized rows in a single hard frame. Reveal each
  // row only as it approaches the active scrollport so lazy painting feels like a
  // continuous part of the user's scroll on both desktop and mobile.
  useLayoutEffect(() => {
    if (renderedTab !== 'timeline' || !tabContentReady || groupedTimeline.length === 0) return undefined
    const timelinePage = timelinePageRef.current
    if (!timelinePage) return undefined

    const rows = Array.from(timelinePage.querySelectorAll<HTMLElement>('[data-timeline-scroll-reveal]')).filter(
      (row) => !row.classList.contains('is-scroll-revealed'),
    )
    if (rows.length === 0) return undefined

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const revealRows = (items: HTMLElement[]) => {
      // Read every row position before changing styles/classes. Sorting with a
      // layout read inside the comparator re-measured the same rows O(n log n).
      items
        .map((row) => ({ row, top: row.getBoundingClientRect().top }))
        .sort((a, b) => a.top - b.top)
        .forEach(({ row }, index) => {
          row.style.setProperty('--timeline-reveal-delay', `${Math.min(index, 4) * 34}ms`)
          row.classList.add('is-scroll-revealed')
        })
    }

    if (reduceMotion || typeof IntersectionObserver === 'undefined') {
      revealRows(rows)
      return undefined
    }

    const scrollParent = findScrollableAncestor(timelinePage)
    const root = !scrollParent || scrollParent === document.scrollingElement ? null : scrollParent
    const observer = new IntersectionObserver(
      (entries) => {
        const entering = entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target as HTMLElement)
        if (entering.length === 0) return
        revealRows(entering)
        entering.forEach((row) => observer.unobserve(row))
      },
      {
        root,
        rootMargin: '96px 0px -5% 0px',
        threshold: 0.02,
      },
    )

    rows.forEach((row) => observer.observe(row))
    return () => observer.disconnect()
  }, [application.id, groupedTimeline, renderedTab, tabContentReady])

  const timelineProgrammaticScrollRef = useRef(false)
  const timelineProgrammaticScrollTimerRef = useRef<number | null>(null)

  const scrollTimelineToElement = useCallback((element: HTMLElement | null) => {
    if (!element) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const scrollParent = findScrollableAncestor(element)
    const usesViewportScroll = !scrollParent || scrollParent === document.scrollingElement

    // Freeze proximity updates so the jump dock does not collapse mid-scroll
    // (that layout shift was aborting native smooth scrolling after one partial jump).
    timelineProgrammaticScrollRef.current = true
    if (timelineProgrammaticScrollTimerRef.current !== null) {
      window.clearTimeout(timelineProgrammaticScrollTimerRef.current)
      timelineProgrammaticScrollTimerRef.current = null
    }

    const releaseLock = () => {
      timelineProgrammaticScrollRef.current = false
      timelineProgrammaticScrollTimerRef.current = null
    }

    const centerInParent = (behavior: ScrollBehavior) => {
      if (usesViewportScroll) {
        const visualViewport = window.visualViewport
        const viewportTop = visualViewport?.offsetTop ?? 0
        const viewportHeight = visualViewport?.height ?? window.innerHeight
        const elementRect = element.getBoundingClientRect()
        const absoluteElementMid = window.scrollY + elementRect.top + elementRect.height / 2
        const targetTop = absoluteElementMid - viewportTop - viewportHeight / 2
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - viewportHeight)
        const nextTop = Math.max(0, Math.min(maxScroll, targetTop))
        if (behavior === 'auto' || Math.abs(window.scrollY - nextTop) < 2) {
          window.scrollTo({ top: nextTop, behavior: 'auto' })
          return
        }
        window.scrollTo({ top: nextTop, behavior: 'smooth' })
        return
      }
      if (!scrollParent) return
      const parentRect = scrollParent.getBoundingClientRect()
      const elRect = element.getBoundingClientRect()
      const elMid = elRect.top - parentRect.top + scrollParent.scrollTop + elRect.height / 2
      const targetTop = elMid - scrollParent.clientHeight / 2
      const maxScroll = Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight)
      const nextTop = Math.max(0, Math.min(maxScroll, targetTop))
      if (behavior === 'auto' || Math.abs(scrollParent.scrollTop - nextTop) < 2) {
        scrollParent.scrollTop = nextTop
        return
      }
      scrollParent.scrollTo({ top: nextTop, behavior: 'smooth' })
    }

    // Always drive a single scroll parent — scrollIntoView can nudge multiple
    // ancestors and stop short when one of them finishes early.
    centerInParent(reduceMotion ? 'auto' : 'smooth')

    if (reduceMotion) {
      // One more layout pass in case fonts/images shifted the marker.
      window.requestAnimationFrame(() => {
        centerInParent('auto')
        releaseLock()
      })
      return
    }

    const scrollEventTarget: HTMLElement | Window | null = usesViewportScroll ? window : scrollParent
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      scrollEventTarget?.removeEventListener('scrollend', onScrollEnd)
      // Correct any shortfall after the smooth animation (common with sticky chrome).
      centerInParent('auto')
      releaseLock()
    }
    const onScrollEnd = () => finish()
    scrollEventTarget?.addEventListener('scrollend', onScrollEnd, {
      once: true,
    })
    // Fallback when `scrollend` is missing or never fires.
    timelineProgrammaticScrollTimerRef.current = window.setTimeout(finish, 720)
  }, [])

  const scrollTimelineToToday = useCallback(() => {
    scrollTimelineToElement(nowMarkerRef.current)
  }, [scrollTimelineToElement])

  const scrollTimelineToDate = useCallback(
    (date: string) => {
      if (date === today) {
        scrollTimelineToToday()
        return
      }

      const exact = unifiedTimelineEvents
        .filter((event) => event.date === date)
        .sort((a, b) => a.id.localeCompare(b.id))
      if (exact[0]) {
        scrollTimelineToElement(document.getElementById(`timeline-event-${exact[0].id}`))
        return
      }

      // No exact hit — land on the nearest event by calendar distance.
      let nearest: (typeof unifiedTimelineEvents)[number] | null = null
      let nearestDistance = Number.POSITIVE_INFINITY
      const targetTime = new Date(`${date}T00:00:00`).getTime()
      for (const event of unifiedTimelineEvents) {
        const eventTime = new Date(`${event.date}T00:00:00`).getTime()
        if (!Number.isFinite(eventTime)) continue
        const distance = Math.abs(eventTime - targetTime)
        if (distance < nearestDistance || (distance === nearestDistance && nearest && event.date > nearest.date)) {
          nearestDistance = distance
          nearest = event
        }
      }
      if (nearest) {
        scrollTimelineToElement(document.getElementById(`timeline-event-${nearest.id}`))
        return
      }
      scrollTimelineToToday()
    },
    [scrollTimelineToElement, scrollTimelineToToday, unifiedTimelineEvents],
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mobileQuery = window.matchMedia('(max-width: 820px)')
    const updateDockSurface = () => {
      setTimelineJumpUsesViewportPortal(mobileQuery.matches)
      setChecklistToolsCompact(mobileQuery.matches)
    }
    updateDockSurface()
    mobileQuery.addEventListener?.('change', updateDockSurface)
    return () => mobileQuery.removeEventListener?.('change', updateDockSurface)
  }, [])

  useEffect(() => {
    if (!timelineJumpUsesViewportPortal || renderedTab !== 'timeline') {
      setTimelineJumpPageVisible(false)
      return undefined
    }
    const timelinePage = timelinePageRef.current
    if (!timelinePage || typeof IntersectionObserver === 'undefined') {
      setTimelineJumpPageVisible(Boolean(timelinePage))
      return undefined
    }
    const observer = new IntersectionObserver(([entry]) => {
      setTimelineJumpPageVisible(Boolean(entry?.isIntersecting))
    })
    observer.observe(timelinePage)
    return () => observer.disconnect()
  }, [renderedTab, tabContentReady, timelineJumpUsesViewportPortal])

  // Track whether the "today" marker sits in the middle band of the scrollport so the
  // jump dock can animate the Today action in/out. Date preview tracking stays isolated
  // inside TimelineJumpDock so scroll updates never rerender the full dossier surface.
  useEffect(() => {
    if (renderedTab !== 'timeline' || !tabContentReady || unifiedTimelineEvents.length === 0) {
      timelineNearTodayRef.current = true
      setTimelineNearToday(true)
      setTimelineTodayDirection('here')
      return undefined
    }

    let frame = 0
    const updateProximity = () => {
      frame = 0
      const timelinePage = timelinePageRef.current
      const marker = nowMarkerRef.current
      const scrollParent = timelinePage
        ? findScrollableAncestor(timelinePage)
        : marker
          ? findScrollableAncestor(marker)
          : null
      const viewport =
        !scrollParent || scrollParent === document.scrollingElement
          ? (() => {
              const visualViewport = window.visualViewport
              const top = visualViewport?.offsetTop ?? 0
              const height = visualViewport?.height ?? window.innerHeight
              return { top, bottom: top + height, height }
            })()
          : (() => {
              const rect = scrollParent.getBoundingClientRect()
              return {
                top: rect.top,
                bottom: rect.bottom,
                height: rect.height,
              }
            })()

      // Ignore scroll samples while a programmatic jump is in flight so the
      // Today action does not collapse and cancel the animation mid-way.
      if (timelineProgrammaticScrollRef.current) return
      if (!marker) {
        timelineNearTodayRef.current = true
        setTimelineNearToday(true)
        setTimelineTodayDirection('here')
        return
      }
      const markerRect = marker.getBoundingClientRect()
      const viewportCenter = (viewport.top + viewport.bottom) / 2
      const markerCenter = (markerRect.top + markerRect.bottom) / 2
      const band = Math.max(72, viewport.height * 0.28)
      // A small hysteresis band prevents the action from flickering when the
      // marker rests on the visibility boundary during trackpad momentum.
      const proximityThreshold = timelineNearTodayRef.current ? band + 18 : Math.max(48, band - 14)
      const inBand =
        Math.abs(markerCenter - viewportCenter) <= proximityThreshold &&
        markerRect.bottom > viewport.top + 24 &&
        markerRect.top < viewport.bottom - 24
      if (timelineNearTodayRef.current !== inBand) {
        timelineNearTodayRef.current = inBand
        setTimelineNearToday(inBand)
      }
      if (inBand) {
        setTimelineTodayDirection('here')
      } else {
        setTimelineTodayDirection(markerCenter < viewportCenter ? 'up' : 'down')
      }
    }

    const scheduleUpdate = () => {
      if (frame) return
      frame = window.requestAnimationFrame(updateProximity)
    }

    scheduleUpdate()
    const scrollParent = nowMarkerRef.current
      ? findScrollableAncestor(nowMarkerRef.current)
      : timelinePageRef.current
        ? findScrollableAncestor(timelinePageRef.current)
        : null
    const targets = Array.from(new Set<EventTarget>([window, scrollParent].filter(Boolean) as EventTarget[]))
    targets.forEach((target) => target.addEventListener('scroll', scheduleUpdate, { passive: true }))
    // Scroll does not bubble. Capture at the document boundary as a resilient fallback
    // when deferred timeline rows make the real dossier scroll owner appear after mount.
    document.addEventListener('scroll', scheduleUpdate, {
      capture: true,
      passive: true,
    })
    window.addEventListener('resize', scheduleUpdate)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      targets.forEach((target) => target.removeEventListener('scroll', scheduleUpdate))
      document.removeEventListener('scroll', scheduleUpdate, true)
      window.removeEventListener('resize', scheduleUpdate)
      if (timelineProgrammaticScrollTimerRef.current !== null) {
        window.clearTimeout(timelineProgrammaticScrollTimerRef.current)
        timelineProgrammaticScrollTimerRef.current = null
      }
      timelineProgrammaticScrollRef.current = false
    }
  }, [renderedTab, tabContentReady, unifiedTimelineEvents.length])

  const latestTimelineEvent = useMemo(
    () =>
      unifiedTimelineEvents.reduce<(typeof unifiedTimelineEvents)[number] | null>(
        (latest, event) => (!latest || event.date > latest.date ? event : latest),
        null,
      ),
    [unifiedTimelineEvents],
  )
  const materialIds = useMemo(
    () => (checklistContentReady ? visibleMaterials.map((material) => material.id) : []),
    [checklistContentReady, visibleMaterials],
  )
  const taskIds = useMemo(
    () => (checklistContentReady ? visibleTasks.map((task) => task.id) : []),
    [checklistContentReady, visibleTasks],
  )
  const communicationIds = useMemo(
    () => (renderedTab === 'mail' ? visibleCommunications.map((item) => item.id) : []),
    [visibleCommunications, renderedTab],
  )
  const scholarshipIds = useMemo(
    () => (renderedTab === 'funding' ? application.scholarships.map((item) => item.id) : []),
    [application.scholarships, renderedTab],
  )
  const timelineEventIds = useMemo(
    () => (renderedTab === 'timeline' ? unifiedTimelineEvents.map((event) => event.id) : []),
    [unifiedTimelineEvents, renderedTab],
  )
  const materialSelection = useExplorerSelection(materialIds)
  const taskSelection = useExplorerSelection(taskIds)
  const communicationSelection = useExplorerSelection(communicationIds)
  const scholarshipSelection = useExplorerSelection(scholarshipIds)
  const timelineSelection = useExplorerSelection(timelineEventIds)
  const selectedCommunicationItems = visibleCommunications.filter((item) =>
    communicationSelection.selectedIds.has(item.id),
  )
  const selectedCommunicationsAreClassifying = selectedCommunicationItems.some((item) =>
    classifyingCommunicationIds.has(item.id),
  )
  const selectedCommunicationsCanClassify =
    selectedCommunicationItems.length > 0 &&
    selectedCommunicationItems.every(
      (item) =>
        isIncomingEmailForClassification(item) &&
        !item.mailSecurity &&
        !classifyingCommunicationIds.has(item.id),
    )
  const allEmailClassificationIds = useMemo(
    () => nonDraftCommunications
      .filter(
        (item) => isIncomingEmailForClassification(item)
          && !item.mailSecurity
          && !classifyingCommunicationIds.has(item.id),
      )
      .map((item) => item.id),
    [classifyingCommunicationIds, nonDraftCommunications],
  )
  const hasClassifiableEmails = nonDraftCommunications.some(
    (item) => isIncomingEmailForClassification(item) && !item.mailSecurity,
  )
  const allEmailClassificationPending = hasClassifiableEmails && allEmailClassificationIds.length === 0
  const clearMaterialSelection = materialSelection.clearSelection
  const clearTaskSelection = taskSelection.clearSelection
  const clearCommunicationSelection = communicationSelection.clearSelection
  const clearScholarshipSelection = scholarshipSelection.clearSelection
  const clearTimelineSelection = timelineSelection.clearSelection

  // Item IDs are normally unique, but templates and imported records can reuse
  // them. Scope multi-select state to the active application rather than relying
  // on an ID intersection to prune it after paint.
  useLayoutEffect(() => {
    clearMaterialSelection()
    clearTaskSelection()
    clearCommunicationSelection()
    clearScholarshipSelection()
    clearTimelineSelection()
  }, [
    application.id,
    clearCommunicationSelection,
    clearMaterialSelection,
    clearScholarshipSelection,
    clearTaskSelection,
    clearTimelineSelection,
  ])

  const closeExplorerMenu = () => setExplorerMenu(null)

  const copyExplorerValue = (value: string, label: string) => {
    if (!value.trim()) return
    if (onCopy) {
      onCopy(value, label)
      return
    }
    void navigator.clipboard?.writeText(value)
  }

  const selectedMaterialIds = (id: string) =>
    materialSelection.selectedIds.has(id) ? materialSelection.selectedIdList : [id]

  const selectedTaskIds = (id: string) => (taskSelection.selectedIds.has(id) ? taskSelection.selectedIdList : [id])

  const selectedCommunicationIds = (id: string) =>
    communicationSelection.selectedIds.has(id) ? communicationSelection.selectedIdList : [id]

  const selectedScholarshipIds = (id: string) =>
    scholarshipSelection.selectedIds.has(id) ? scholarshipSelection.selectedIdList : [id]

  const selectedTimelineIds = (id: string) =>
    timelineSelection.selectedIds.has(id) ? timelineSelection.selectedIdList : [id]

  const updateMaterialsStatus = (ids: string[], status: MaterialStatus) => {
    const targets = new Set(ids)
    if (status === 'Submitted') {
      setMaterialPreviousStatuses((current) => {
        const next = { ...current }
        draft.materials.forEach((material) => {
          if (targets.has(material.id) && material.status !== 'Submitted') next[material.id] = material.status
        })
        return next
      })
    } else {
      setMaterialPreviousStatuses((current) => {
        const next = { ...current }
        targets.forEach((id) => {
          delete next[id]
        })
        return next
      })
    }
    commitDraft(
      {
        ...draftRef.current,
        materials: draftRef.current.materials.map((material) =>
          targets.has(material.id) ? { ...material, status, updatedAt: today } : material,
        ),
      },
      'immediate',
    )
  }

  const toggleMaterialCompletion = (material: MaterialItem, nextSubmitted = material.status !== 'Submitted') => {
    const isSubmitted = material.status === 'Submitted'
    if (nextSubmitted === isSubmitted) return
    if (!nextSubmitted) {
      const previousStatus = materialPreviousStatuses[material.id] || 'Draft'
      updateMaterial(material.id, { status: previousStatus, updatedAt: today })
      setMaterialPreviousStatuses((current) => {
        const { [material.id]: _removed, ...next } = current
        return next
      })
      return
    }
    setMaterialPreviousStatuses((current) => ({
      ...current,
      [material.id]: material.status || 'Draft',
    }))
    updateMaterial(material.id, { status: 'Submitted', updatedAt: today })
  }

  const removeMaterials = (ids: string[]) => {
    const pendingId = pendingChecklistCreateRef.current?.kind === 'material'
      ? pendingChecklistCreateRef.current.id
      : null
    if (pendingId && ids.includes(pendingId)) discardPendingChecklistCreate()
    const uniqueIds = Array.from(new Set(ids))
      .filter((id) => id !== pendingId && !removingMaterialIds.has(id))
    const targets = new Set(uniqueIds)
    if (targets.size === 0) return
    queueDestroyAnimation(uniqueIds, setRemovingMaterialIds, () => {
      commitDraft(
        {
          ...draftRef.current,
          materials: draftRef.current.materials.filter((material) => !targets.has(material.id)),
        },
        'immediate',
      )
      setExpandedMaterials((current) => new Set([...current].filter((id) => !targets.has(id))))
    })
    materialSelection.clearSelection()
  }

  const setMaterialsExpanded = (ids: string[], expanded: boolean) => {
    if (!expanded) {
      ids.forEach((id) => {
        if (materialVisualGroupPins[id]) releaseMaterialGroupPin(id)
      })
    }
    startTransition(() => {
      setExpandedMaterials((current) => {
        const next = new Set(current)
        ids.forEach((id) => {
          if (expanded) next.add(id)
          else next.delete(id)
        })
        return next
      })
      setMaterialExpansionSyncVersion((version) => version + 1)
    })
  }

  const updateTasksDone = async (ids: string[], done: boolean) => {
    const targets = new Set(ids)
    commitDraft(
      {
        ...draftRef.current,
        tasks: draftRef.current.tasks.map((task) => (targets.has(task.id) ? { ...task, done, status: done ? 'Done' : 'Open' } : task)),
      },
      autoSaveEnabled ? 'immediate' : 'external',
    )
    if (autoSaveEnabled) return

    // Track which tasks succeeded for potential rollback
    const succeeded: string[] = []
    try {
      for (const id of ids) {
        await Promise.resolve(onToggleTask(id, done, done ? 'Done' : 'Open'))
        succeeded.push(id)
      }
    } catch {
      // Rollback: revert the succeeded tasks
      const rollbackTargets = new Set(succeeded)
      commitDraft(
        {
          ...draftRef.current,
          tasks: draftRef.current.tasks.map((task) => (rollbackTargets.has(task.id)
            ? { ...task, done: !done, status: !done ? 'Done' : 'Open' }
            : task)),
        },
        'external',
      )
      for (const id of succeeded) {
        onToggleTask(id, !done, !done ? 'Done' : 'Open')
      }
    }
  }

  const removeTasks = (ids: string[]) => {
    const pendingId = pendingChecklistCreateRef.current?.kind === 'task'
      ? pendingChecklistCreateRef.current.id
      : null
    if (pendingId && ids.includes(pendingId)) discardPendingChecklistCreate()
    const uniqueIds = Array.from(new Set(ids))
      .filter((id) => id !== pendingId && !removingTaskIds.has(id))
    if (uniqueIds.length === 0) return
    queueDestroyAnimation(uniqueIds, setRemovingTaskIds, () => {
      if (onRemoveTasks) onRemoveTasks(uniqueIds)
      else uniqueIds.forEach((id) => onRemoveTask(id))
      setExpandedChecklistTasks((current) => new Set([...current].filter((id) => !uniqueIds.includes(id))))
    })
    taskSelection.clearSelection()
  }

  const setTasksExpanded = (ids: string[], expanded: boolean) => {
    startTransition(() => {
      setExpandedChecklistTasks((current) => {
        const next = new Set(current)
        ids.forEach((id) => {
          if (expanded) next.add(id)
          else next.delete(id)
        })
        return next
      })
      setTaskExpansionSyncVersion((version) => version + 1)
    })
  }

  const clearChecklistFilters = () => {
    setChecklistSearch('')
    setMaterialFilter('all')
    setMaterialGroupFilter('all')
    setMaterialSort('manual')
    setTaskFilter('all')
    setTaskSort('manual')
    setChecklistFilterAnimKey((key) => key + 1)
  }

  const toggleReminderFilter = () => {
    const nextActive = !reminderFilterActive
    setMaterialFilter(nextActive ? 'with-reminder' : 'all')
    setTaskFilter(nextActive ? 'with-reminder' : 'all')
    setChecklistFilterAnimKey((key) => key + 1)
  }

  const cleanupChecklistDrag = useCallback((session: ChecklistDragSession) => {
    if (session.status === 'done') return

    session.status = 'done'
    if (session.frame) {
      window.cancelAnimationFrame(session.frame)
      session.frame = 0
    }
    if (session.settleWatchdog) {
      window.clearTimeout(session.settleWatchdog)
      session.settleWatchdog = 0
    }
    const animation = session.dropAnimation
    session.dropAnimation = null
    animation?.cancel()
    const cleanupListeners = session.cleanupListeners
    session.cleanupListeners = null
    cleanupListeners?.()
    try {
      session.handle.releasePointerCapture(session.pointerId)
    } catch {
      // Pointer capture may already have ended after pointerup/cancel.
    }
    session.rows.forEach(({ element }) => {
      element.classList.remove('checklist-drag-source', 'checklist-sort-displaced')
      element.style.removeProperty('--checklist-source-shift')
      element.style.removeProperty('--checklist-sort-shift')
    })
    session.groupHeaders.forEach(({ element }) => {
      element.classList.remove('checklist-sort-displaced')
      element.style.removeProperty('--checklist-sort-shift')
    })
    session.scope.classList.remove('checklist-sort-active', 'checklist-sort-settling')
    session.overlay?.remove()
    session.overlay = null
    session.finish = null
    session.forceSettle = null
    if (checklistDragSessionRef.current === session) {
      checklistDragSessionRef.current = null
    }
    document.body.classList.remove('checklist-drag-active')
  }, [])

  const settleChecklistOverlay = useCallback(
    (session: ChecklistDragSession, immediate = false) => {
      if (session.status !== 'settling' || session.dropAnimation) return

      // React can re-parent a material row when it changes group. Resolve the
      // live keyed row after the commit instead of assuming the pre-drag node
      // is still connected.
      const liveItem = Array.from(
        session.scope.querySelectorAll<HTMLElement>(`[data-checklist-kind="${session.kind}"]`),
      ).find((element) => element.dataset.checklistId === session.id) ?? session.item

      session.rows.forEach(({ element }) => {
        element.classList.remove('checklist-sort-displaced')
        element.style.removeProperty('--checklist-source-shift')
        element.style.removeProperty('--checklist-sort-shift')
        if (element !== liveItem) element.classList.remove('checklist-drag-source')
      })
      session.groupHeaders.forEach(({ element }) => {
        element.classList.remove('checklist-sort-displaced')
        element.style.removeProperty('--checklist-sort-shift')
      })
      liveItem.classList.add('checklist-drag-source')
      session.item = liveItem
      if (session.rows[session.sourceIndex]) session.rows[session.sourceIndex].element = liveItem

      if (
        immediate ||
        session.skipDropAnimation ||
        session.reducedMotion ||
        !session.overlay ||
        typeof session.overlay.animate !== 'function' ||
        !liveItem.isConnected
      ) {
        cleanupChecklistDrag(session)
        return
      }

      // One release-time layout read is intentional: the canonical DOM order
      // is now mounted, so this is the actual destination. Animating to cached
      // preview geometry is what allowed the overlay and real row to disagree.
      const destination = liveItem.getBoundingClientRect()
      const currentTransform = session.overlay.style.transform
      const animation = session.overlay.animate(
        [
          { transform: currentTransform },
          {
            transform: `translate3d(${destination.left - session.left}px, ${destination.top - session.top}px, 0) scale(1)`,
          },
        ],
        {
          duration: 140,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards',
        },
      )
      session.dropAnimation = animation
      const finishDropAnimation = () => {
        if (session.dropAnimation !== animation) return
        session.dropAnimation = null
        cleanupChecklistDrag(session)
      }
      animation.onfinish = finishDropAnimation
      animation.oncancel = finishDropAnimation
    },
    [cleanupChecklistDrag],
  )

  const commitChecklistDrag = useCallback(
    (session: ChecklistDragSession, forceNotify = false) => {
      const target = session.target
      if (!target || session.kind !== target.kind || session.id === target.id || !target.id) return
      const currentDraft = draftRef.current
      if (session.kind === 'material') {
        const reordered = reorderById(currentDraft.materials, session.id, target.id, target.position)
        // Landing among another group's rows is the gesture for regrouping, so
        // the row adopts the group it was dropped into.
        const targetGroup = session.targetGroup
          || currentDraft.materials.find((item) => item.id === target.id)?.group
          || 'Core materials'
        const draggedGroup = currentDraft.materials.find((item) => item.id === session.id)?.group
          || 'Core materials'
        const materials = targetGroup === draggedGroup
          ? reordered
          : reordered.map((item) => (item.id === session.id ? { ...item, group: targetGroup } : item))
        if (materials !== currentDraft.materials) {
          // The real row already remains in flow as the drag placeholder. Do
          // not add a second visual-group state machine here: a pin followed
          // by a delayed arrival animation causes a second handoff after the
          // drop has visibly finished.
          commitDraft({ ...currentDraft, materials }, 'immediate')
        } else if (forceNotify) {
          // A transition may already have updated draftRef while its render is
          // still pending. Re-notify the parent inside flushSync so the settled
          // preview is never released back to the stale DOM order.
          commitDraft(currentDraft, 'immediate')
        }
        return
      }
      const tasks = reorderById(currentDraft.tasks, session.id, target.id, target.position)
      if (tasks !== currentDraft.tasks) {
        commitDraft({ ...currentDraft, tasks }, 'immediate')
      } else if (forceNotify) {
        commitDraft(currentDraft, 'immediate')
      }
    },
    [commitDraft],
  )

  useLayoutEffect(() => {
    const session = checklistDragSessionRef.current
    if (
      !session ||
      session.status !== 'settling' ||
      !session.commitRequested ||
      (!session.expectedOrder && !session.expectedGroup) ||
      session.commitObserved
    ) {
      return
    }
    const currentOrder = (session.kind === 'material' ? draft.materials : draft.tasks).map((item) => item.id)
    if (
      session.expectedOrder && (
        currentOrder.length !== session.expectedOrder.length ||
        currentOrder.some((id, index) => id !== session.expectedOrder?.[index])
      )
    ) {
      return
    }
    if (session.expectedGroup) {
      const currentMaterial = draft.materials.find((item) => item.id === session.id)
      const currentGroup = currentMaterial?.group || 'Core materials'
      if (currentGroup !== session.expectedGroup) return
    }
    session.commitObserved = true
    // Keep the body-level copy mounted across React's reorder. Once the real
    // row exists at its canonical position, hand the overlay to that measured
    // node and remove it only after the drop animation completes.
    settleChecklistOverlay(session)
  }, [draft.materials, draft.tasks, settleChecklistOverlay])

  const startChecklistDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, kind: ChecklistDragKind, id: string) => {
      const canDrag = kind === 'material' ? materialSort === 'manual' : taskSort === 'manual'
      if (!canDrag || (event.pointerType === 'mouse' && event.button !== 0)) {
        event.preventDefault()
        return
      }

      checklistDragSessionRef.current?.finish?.(false, true)
      const handle = event.currentTarget
      const item = handle.closest<HTMLElement>('.checklist-item')
      // Materials drag across the whole grouped list, not just their own group:
      // dropping a row among another group's rows is how an item is regrouped.
      const scope =
        kind === 'task'
          ? item?.closest<HTMLElement>('.checklist-task-list')
          : item?.closest<HTMLElement>('.checklist-groups') ?? item?.closest<HTMLElement>('.checklist-group')
      if (!item || !scope) return

      // Read every piece of geometry once, before the first visual write. During
      // pointer movement the cached centers are adjusted only by scrollTop.
      const rowElements = Array.from(scope.querySelectorAll<HTMLElement>(`[data-checklist-kind="${kind}"]`)).filter(
        (row) => row.dataset.checklistId && !row.classList.contains('is-removing'),
      )
      if (rowElements.length < 2) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const rows: ChecklistDragRowMeasurement[] = rowElements.map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          id: element.dataset.checklistId ?? '',
          element,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          center: rect.top + rect.height / 2,
          group: element.dataset.checklistGroup || undefined,
        }
      })
      const sourceIndex = rows.findIndex((row) => row.id === id)
      if (sourceIndex < 0) return
      const source = rows[sourceIndex]
      const groupHeaderMeasurements = kind === 'material'
        ? Array.from(scope.querySelectorAll<HTMLElement>('[data-checklist-group-header]'))
          .map((element) => {
            const group = element.dataset.checklistGroupHeader?.trim()
            if (!group) return null
            const rect = element.getBoundingClientRect()
            return { group, element, top: rect.top, height: rect.height }
          })
          .filter((header): header is { group: string; element: HTMLElement; top: number; height: number } => header !== null)
        : []
      const groupBoundaries: ChecklistGroupBoundary[] = groupHeaderMeasurements.map(({ group, top }) => ({ group, top }))
      const groupGeometry: ChecklistGroupGeometry[] = groupHeaderMeasurements.map(({ group, top, height }) => {
        const groupRows = rows.filter((row) => row.group === group)
        const first = groupRows[0]
        const second = groupRows[1]
        const headerRowGap = first ? Math.max(0, first.top - (top + height)) : 0
        const rowGap = first && second
          ? Math.max(0, second.top - (first.top + first.height))
          : headerRowGap
        return { group, top, height, headerRowGap, rowGap }
      })
      const groupHeaders = groupHeaderMeasurements.map(({ group, element }) => ({ group, element }))
      const scrollParent = findScrollableAncestor(item)
      const scrollStart = scrollParent?.scrollTop ?? 0
      const scrollMax = scrollParent ? Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight) : 0
      const pageScroller = scrollParent === document.scrollingElement
      const scrollViewport = scrollParent && !pageScroller ? scrollParent.getBoundingClientRect() : null

      event.preventDefault()
      event.stopPropagation()
      try {
        handle.setPointerCapture(event.pointerId)
      } catch {
        // Window listeners keep the drag functional when capture is unavailable.
      }

      const session: ChecklistDragSession = {
        kind,
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: source.left,
        top: source.top,
        width: source.width,
        height: source.height,
        handle,
        item,
        scope,
        rows,
        previewRows: rows.map(({ id, center, group }) => ({ id, center, group })),
        groupBoundaries,
        previewGroupBoundaries: groupBoundaries.map((boundary) => ({ ...boundary })),
        groupPreviewShifts: {},
        groupGeometry,
        groupHeaders,
        sourceIndex,
        scrollParent,
        scrollStart,
        scrollMax,
        viewportTop: Math.max(0, scrollViewport?.top ?? 0),
        viewportBottom: Math.min(window.innerHeight, scrollViewport?.bottom ?? window.innerHeight),
        frame: 0,
        latestClientX: event.clientX,
        latestClientY: event.clientY,
        target: null,
        targetGroup: undefined,
        insertionIndex: sourceIndex,
        sourceShift: 0,
        overlay: null,
        dropAnimation: null,
        status: 'pending',
        reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
        cleanupListeners: null,
        finish: null,
        forceSettle: null,
        skipDropAnimation: false,
        settleWatchdog: 0,
        expectedOrder: null,
        expectedGroup: undefined,
        commitRequested: false,
        commitObserved: false,
      }
      checklistDragSessionRef.current = session

      const activateDrag = () => {
        if (session.status !== 'pending') return
        session.status = 'dragging'

        const overlay = session.item.cloneNode(true) as HTMLElement
        overlay.removeAttribute('id')
        overlay.removeAttribute('data-checklist-kind')
        overlay.removeAttribute('data-checklist-id')
        overlay.removeAttribute('data-tour')
        overlay.removeAttribute('aria-selected')
        overlay.setAttribute('aria-hidden', 'true')
        overlay.setAttribute('role', 'presentation')
        overlay.classList.remove(
          'checklist-drag-source',
          'checklist-sort-displaced',
          'checklist-item-new',
          'checklist-item-group-arrival',
          'checklist-filter-enter',
          'explorer-selected',
        )
        overlay.classList.add('checklist-drag-overlay')
        overlay.querySelectorAll<HTMLElement>('[id]').forEach((element) => element.removeAttribute('id'))
        overlay.querySelectorAll<HTMLElement>('[data-tour]').forEach((element) => element.removeAttribute('data-tour'))
        overlay
          .querySelectorAll<HTMLElement>('a, button, input, select, textarea, [tabindex]')
          .forEach((element) => element.setAttribute('tabindex', '-1'))
        overlay.style.left = `${session.left}px`
        overlay.style.top = `${session.top}px`
        overlay.style.width = `${session.width}px`
        overlay.style.height = `${session.height}px`
        overlay.style.transform = 'translate3d(0, 0, 0) scale(1.008)'

        session.overlay = overlay
        session.scope.classList.add('checklist-sort-active')
        session.item.classList.add('checklist-drag-source')
        document.body.appendChild(overlay)
        document.body.classList.add('checklist-drag-active')
      }

      const applyPreview = (targetGroup?: string) => {
        const sourceRow = session.rows[session.sourceIndex]
        // Rebuild the preview from the measured group blocks. This keeps the
        // real empty slot aligned with both the rows and the headings when a
        // material crosses a group boundary.
        const placement = resolveChecklistPreviewPlacement(
          session.rows,
          session.sourceIndex,
          session.insertionIndex,
          session.groupGeometry,
          targetGroup,
        )
        session.sourceShift = placement.sourceShift
        sourceRow.element.style.setProperty('--checklist-source-shift', `${placement.sourceShift}px`)

        session.rows.forEach((row, index) => {
          if (index === session.sourceIndex) return
          const shift = placement.shifts[index] ?? 0
          session.previewRows[index].center = row.center + shift
          row.element.classList.toggle('checklist-sort-displaced', shift !== 0)
          if (shift === 0) row.element.style.removeProperty('--checklist-sort-shift')
          else row.element.style.setProperty('--checklist-sort-shift', `${shift}px`)
        })
        session.previewRows[session.sourceIndex].center = sourceRow.center + placement.sourceShift
        const groupShifts = placement.groupShifts ?? {}
        session.groupHeaders.forEach(({ group, element }) => {
          const shift = groupShifts[group] ?? 0
          const boundary = session.previewGroupBoundaries.find((candidate) => candidate.group === group)
          if (boundary) boundary.top = boundary.top - (session.groupPreviewShifts?.[group] ?? 0) + shift
          element.classList.toggle('checklist-sort-displaced', shift !== 0)
          if (shift === 0) element.style.removeProperty('--checklist-sort-shift')
          else element.style.setProperty('--checklist-sort-shift', `${shift}px`)
        })
        session.groupPreviewShifts = groupShifts
      }

      const updateDropPreview = () => {
        const scrollDelta = session.scrollParent ? session.scrollParent.scrollTop - session.scrollStart : 0
        const resolution = resolveChecklistDrop(
          session.kind,
          session.id,
          session.previewRows,
          session.latestClientY,
          scrollDelta,
          session.insertionIndex,
          7,
          session.previewGroupBoundaries,
        )
        if (
          resolution.insertionIndex === session.insertionIndex &&
          resolution.group === session.targetGroup &&
          sameChecklistDropTarget(resolution.target, session.target)
        ) {
          return
        }
        session.target = resolution.target
        session.targetGroup = resolution.group
        session.insertionIndex = resolution.insertionIndex
        applyPreview(resolution.group)
      }

      const autoScroll = () => {
        const scroller = session.scrollParent
        if (!scroller || session.scrollMax <= 0) return false
        const viewportHeight = session.viewportBottom - session.viewportTop
        const edge = Math.min(72, Math.max(44, viewportHeight * 0.18))
        const pointerY = session.latestClientY
        let step = 0
        if (pointerY < session.viewportTop + edge) {
          const intensity = Math.min(1, (session.viewportTop + edge - pointerY) / edge)
          step = -Math.max(1, Math.ceil(18 * intensity * intensity))
        } else if (pointerY > session.viewportBottom - edge) {
          const intensity = Math.min(1, (pointerY - (session.viewportBottom - edge)) / edge)
          step = Math.max(1, Math.ceil(18 * intensity * intensity))
        }
        if (step === 0) return false
        const current = scroller.scrollTop
        const next = Math.max(0, Math.min(session.scrollMax, current + step))
        if (next === current) return false
        scroller.scrollTop = next
        return true
      }

      const paintFrame = (allowAutoScroll: boolean) => {
        if (session.status !== 'pending' && session.status !== 'dragging') return false
        const x = session.latestClientX - session.startX
        const y = session.latestClientY - session.startY
        if (session.status === 'pending' && Math.hypot(x, y) > 4) activateDrag()
        if (session.status !== 'dragging' || !session.overlay) return false

        const keepAutoScrolling = allowAutoScroll && autoScroll()
        session.overlay.style.transform = `translate3d(0, ${y}px, 0) scale(1.008)`
        updateDropPreview()
        return keepAutoScrolling
      }

      const runFrame = () => {
        session.frame = 0
        if (!session.item.isConnected || !session.scope.isConnected) {
          session.finish?.(false, true)
          return
        }
        const keepAutoScrolling = paintFrame(true)
        if (keepAutoScrolling && session.status === 'dragging') {
          session.frame = window.requestAnimationFrame(runFrame)
        }
      }

      const scheduleFrame = () => {
        if (!session.frame && (session.status === 'pending' || session.status === 'dragging')) {
          session.frame = window.requestAnimationFrame(runFrame)
        }
      }

      const finish = (commit: boolean, immediate = false) => {
        if (session.status === 'done') return
        if (session.status === 'settling') {
          if (immediate) session.forceSettle?.()
          return
        }
        if (session.frame) {
          window.cancelAnimationFrame(session.frame)
          session.frame = 0
        }
        if (session.status === 'pending') paintFrame(false)
        if (session.status === 'pending') {
          cleanupChecklistDrag(session)
          return
        }

        if (session.status === 'dragging') paintFrame(false)
        session.status = 'settling'
        session.scope.classList.add('checklist-sort-settling')
        const cleanupListeners = session.cleanupListeners
        session.cleanupListeners = null
        cleanupListeners?.()
        try {
          session.handle.releasePointerCapture(session.pointerId)
        } catch {
          // The browser may have released capture as part of pointerup.
        }

        const shouldCommit = !isReadOnly && commit && session.target !== null
        session.expectedOrder = null
        session.expectedGroup = undefined
        session.commitRequested = false
        session.commitObserved = false
        if (shouldCommit && session.target) {
          const currentDraft = draftRef.current
          const nextOrder = session.kind === 'material'
            ? reorderById(currentDraft.materials, session.id, session.target.id, session.target.position)
              .map((item) => item.id)
            : reorderById(currentDraft.tasks, session.id, session.target.id, session.target.position)
              .map((item) => item.id)
          const currentOrder = (session.kind === 'material' ? currentDraft.materials : currentDraft.tasks)
            .map((item) => item.id)
          // Dropping a row back into the slot it came from commits nothing, so
          // no re-render will ever arrive to observe. Only wait for an order or
          // group assignment that is actually going to change.
          const unchanged = currentOrder.length === nextOrder.length
            && currentOrder.every((id, index) => id === nextOrder[index])
          const draggedMaterial = session.kind === 'material'
            ? currentDraft.materials.find((item) => item.id === session.id)
            : undefined
          const targetMaterial = session.kind === 'material'
            ? currentDraft.materials.find((item) => item.id === session.target?.id)
            : undefined
          const draggedGroup = draggedMaterial?.group || 'Core materials'
          const targetGroup = session.targetGroup || targetMaterial?.group || 'Core materials'
          const groupChanged = session.kind === 'material' && draggedGroup !== targetGroup
          // Re-grouping can leave the id order unchanged (for example, a row
          // already sitting immediately before the next group's first row).
          // Treat the group mutation as a real commit in that case too.
          session.expectedOrder = unchanged && !groupChanged ? null : nextOrder
          session.expectedGroup = groupChanged ? targetGroup : undefined
        }
        const commitExpected = shouldCommit && Boolean(session.expectedOrder || session.expectedGroup)
        const requestCommit = (immediateCommit: boolean) => {
          if (!commitExpected) return
          if (session.commitRequested && !immediateCommit) return
          session.commitRequested = true
          if (immediateCommit) {
            // A rapid second drag or the bounded watchdog can arrive after the
            // transition callback ran but before its render painted. Re-send
            // the latest ref-backed draft synchronously in that case; removing
            // the preview first would expose the stale order for one frame.
            flushSync(() => commitChecklistDrag(session, true))
            return
          }
          // Reorder the client state as soon as the pointer is released. The
          // overlay stays mounted while React reconciles, so the update can be
          // concurrent without exposing the old DOM order or blocking on an
          // idle callback before the handoff even begins.
          startTransition(() => commitChecklistDrag(session))
        }

        session.forceSettle = () => {
          session.skipDropAnimation = true
          if (commitExpected && !session.commitObserved) requestCommit(true)
          if (session.status === 'settling' && !session.commitObserved) cleanupChecklistDrag(session)
        }

        if (!commitExpected) {
          settleChecklistOverlay(session, immediate)
          return
        }

        if (immediate || session.reducedMotion) session.skipDropAnimation = true
        requestCommit(immediate || session.reducedMotion)
        if (session.status !== 'settling' || session.commitObserved) return

        // A transition should normally commit immediately. Keep one bounded
        // fail-safe for an interrupted render, but force the canonical order
        // before removing any preview DOM so rollback can never flash.
        session.settleWatchdog = window.setTimeout(() => {
          session.settleWatchdog = 0
          if (session.status !== 'settling' || session.commitObserved) return
          session.skipDropAnimation = true
          requestCommit(true)
          if (session.status === 'settling' && !session.commitObserved) cleanupChecklistDrag(session)
        }, getMotionDelay(700) + 200)
      }
      session.finish = finish

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== session.pointerId) return
        pointerEvent.preventDefault()
        session.latestClientX = pointerEvent.clientX
        session.latestClientY = pointerEvent.clientY
        scheduleFrame()
      }
      const handlePointerUp = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== session.pointerId) return
        pointerEvent.preventDefault()
        session.latestClientX = pointerEvent.clientX
        session.latestClientY = pointerEvent.clientY
        finish(true)
      }
      const handlePointerCancel = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId === session.pointerId) finish(false)
      }
      const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
        if (keyboardEvent.key !== 'Escape') return
        keyboardEvent.preventDefault()
        finish(false)
      }
      const handleWindowBlur = () => finish(false)
      const handleWindowResize = () => finish(false, true)
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') finish(false, true)
      }

      window.addEventListener('pointermove', handlePointerMove, {
        passive: false,
      })
      window.addEventListener('pointerup', handlePointerUp, { passive: false })
      window.addEventListener('pointercancel', handlePointerCancel)
      window.addEventListener('keydown', handleKeyDown)
      window.addEventListener('blur', handleWindowBlur)
      window.addEventListener('resize', handleWindowResize)
      document.addEventListener('visibilitychange', handleVisibilityChange)
      session.cleanupListeners = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerCancel)
        window.removeEventListener('keydown', handleKeyDown)
        window.removeEventListener('blur', handleWindowBlur)
        window.removeEventListener('resize', handleWindowResize)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    },
    [cleanupChecklistDrag, commitChecklistDrag, isReadOnly, materialSort, settleChecklistOverlay, taskSort],
  )

  const removeCommunications = (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids)).filter((id) => !removingCommunicationIds.has(id))
    if (uniqueIds.length === 0) return
    queueDestroyAnimation(uniqueIds, setRemovingCommunicationIds, () => {
      if (onRemoveCommunications) onRemoveCommunications(uniqueIds)
      else uniqueIds.forEach((id) => onRemoveCommunication(id))
    })
    communicationSelection.clearSelection()
  }

  const openSavedDraft = (item: CommunicationItem) => {
    if (item.messageType !== 'draft-email') return
    requestLocalEditorExit(() => {
      if (!clearEmailComposer()) return
      applyCorrespondenceMode('draft-email')
      setCorrespondenceKind('outgoing-email')
      setActiveComposerDraftId(item.id)
      setEmailSubject(editableDraftEmailSubject(localize(item.subject)))
      setEmailBody(item.summary)
      const draftRecipient = normalizeCorrespondenceEmail(item.to)
      setEmailRecipient(
        isValidCorrespondenceEmail(draftRecipient)
          ? draftRecipient
          : normalizeCorrespondenceEmail(draftRef.current.professor.email),
      )
      setEmailAttachments(
        (item.attachments ?? []).map((attachment, index) => ({
          id: attachment.id ?? `${item.id}-attachment-${index}`,
          name: attachment.fileName,
          fileName: attachment.fileName,
          fileId: attachment.fileId,
          assetId: attachment.assetId,
          fileSize: attachment.fileSize,
          mimeType: attachment.mimeType,
        })),
      )
      const nextSchedule = defaultScheduledEmailTime()
      setScheduledSendDate(nextSchedule.date)
      setScheduledSendTime(nextSchedule.time)
      composerDeliveryIdRef.current = createComposerDeliveryId()
      setComposerOpen(true)
      communicationSelection.selectOnly(item.id)
      window.requestAnimationFrame(() => {
        correspondenceModeBarRef.current?.scrollIntoView({ block: 'start', inline: 'nearest' })
        composerBodyControllerRef.current?.focus({ atEnd: true })
      })
    })
  }

  const startEditingCommunication = (item: CommunicationItem) => {
    if (item.messageType === 'draft-email') {
      openSavedDraft(item)
      return
    }
    if (editingCommunicationId === item.id) {
      requestCloseItemEditor('communication')
      return
    }
    if (editingCommunicationId && communicationEditDirty) {
      requestCloseItemEditor('communication', () => startEditingCommunication(item))
      return
    }
    setEditingCommunicationId(item.id)
    const nextDraft = communicationEditDraftFrom(item)
    communicationEditInitialRef.current = JSON.stringify(nextDraft)
    setCommunicationEditDraft(nextDraft)
    communicationSelection.selectOnly(item.id)
  }

  const cancelEditingCommunication = () => {
    communicationEditInitialRef.current = null
    setEditingCommunicationId(null)
    setCommunicationEditDraft(null)
  }

  const updateCommunicationEditDraft = (patch: CommunicationPatchInput) => {
    setCommunicationEditDraft((current) => ({ ...(current ?? {}), ...patch }))
  }

  const swapCommunicationEditRoute = (item: CommunicationItem) => {
    if (!communicationEditDraft) return
    const currentFrom = communicationEditDraft.from ?? item.from ?? ''
    const currentTo = communicationEditDraft.to ?? item.to ?? ''
    updateCommunicationEditDraft({ from: currentTo, to: currentFrom })
    triggerRouteSwapAnimation(`communication-${item.id}`)
  }

  const saveCommunicationEdit = async (item: CommunicationItem) => {
    if (!communicationEditDraft || !onUpdateCommunication) return false
    const subject = (communicationEditDraft.subject ?? item.subject).trim()
    const summary = (communicationEditDraft.summary ?? item.summary).trim()
    if (!subject || !summary) return false
    const sourceApplicationId = application.id
    const saved = await Promise.resolve(
      onUpdateCommunication(item.id, {
        subject,
        summary,
        channel: communicationEditDraft.channel ?? item.channel,
        date: communicationEditDraft.date ?? item.date,
        time: communicationEditDraft.time ?? item.time ?? '',
        direction:
          communicationEditDraft.direction ?? item.direction ?? (item.channel === 'Email' ? 'incoming' : 'note'),
        messageType: communicationEditDraft.messageType ?? item.messageType ?? 'note',
        from: communicationEditDraft.from ?? item.from ?? '',
        to: communicationEditDraft.to ?? item.to ?? '',
      }),
    )
    if (saved === false) return false
    if (activeApplicationIdRef.current === sourceApplicationId) cancelEditingCommunication()
    return true
  }

  const removeScholarships = (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids)).filter((id) => !removingScholarshipIds.has(id))
    if (uniqueIds.length === 0) return
    queueDestroyAnimation(uniqueIds, setRemovingScholarshipIds, () => {
      if (onRemoveScholarships) onRemoveScholarships(uniqueIds)
      else uniqueIds.forEach((id) => onRemoveScholarship(id))
    })
    scholarshipSelection.clearSelection()
  }

  const toggleScholarshipExpanded = (id: string) => {
    setExpandedScholarships((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submitScholarshipDraft = async () => {
    const cleaned = cleanScholarshipDraft(scholarshipDraft)
    if (!cleaned.name) return false
    let saved: boolean | void
    try {
      saved = await onAddScholarship(cleaned)
    } catch {
      return false
    }
    if (saved === false) return false
    setScholarshipDraft(createScholarshipDraft(application.school.name))
    setScholarshipAddOpen(false)
    return true
  }

  const openScholarshipAdd = () => {
    setScholarshipDraft((current) =>
      current.name
      || current.amount
      || current.materials.length
      || current.tasks.length
      || current.timeline.length
        ? current
        : createScholarshipDraft(application.school.name),
    )
    setScholarshipAddOpen(true)
  }

  const requestCloseScholarshipAdd = (proceed?: () => void) => {
    if (!scholarshipAddOpen) {
      proceed?.()
      return
    }
    if (scholarshipAddDirty) {
      setPendingItemEditExit({ kind: 'scholarship-add', proceed })
      return
    }
    setScholarshipAddOpen(false)
    setScholarshipDraft(createScholarshipDraft(application.school.name))
    proceed?.()
  }

  const startEditingScholarship = (scholarship: ScholarshipItem) => {
    if (editingScholarshipId === scholarship.id) {
      requestCloseItemEditor('scholarship')
      return
    }
    if (editingScholarshipId && scholarshipEditDirty) {
      requestCloseItemEditor('scholarship', () => startEditingScholarship(scholarship))
      return
    }
    if (scholarshipSaveTimerRef.current !== null) {
      window.clearTimeout(scholarshipSaveTimerRef.current)
      scholarshipSaveTimerRef.current = null
    }
    setSavingScholarshipId(null)
    setEditingScholarshipId(scholarship.id)
    setScholarshipEditDraft(scholarshipToDraft(scholarship, application.school.name))
    setExpandedScholarships((current) => new Set(current).add(scholarship.id))
    scholarshipSelection.selectOnly(scholarship.id)
  }

  const cancelEditingScholarship = () => {
    if (scholarshipSaveTimerRef.current !== null) {
      window.clearTimeout(scholarshipSaveTimerRef.current)
      scholarshipSaveTimerRef.current = null
    }
    setSavingScholarshipId(null)
    setEditingScholarshipId(null)
    setScholarshipEditDraft(null)
  }

  const saveScholarshipEdit = async (id: string) => {
    if (!scholarshipEditDraft || !onUpdateScholarship || savingScholarshipId === id) return false
    const cleaned = cleanScholarshipDraft(scholarshipEditDraft)
    if (!cleaned.name) return false
    const sourceApplicationId = application.id
    setSavingScholarshipId(id)
    const saved = await Promise.resolve(onUpdateScholarship(id, cleaned))
    if (saved === false) {
      if (activeApplicationIdRef.current === sourceApplicationId) setSavingScholarshipId(null)
      return false
    }
    if (activeApplicationIdRef.current !== sourceApplicationId) return false
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    scholarshipSaveTimerRef.current = window.setTimeout(
      () => {
        if (activeApplicationIdRef.current !== sourceApplicationId) return
        scholarshipSaveTimerRef.current = null
        setSavingScholarshipId((current) => (current === id ? null : current))
        setEditingScholarshipId((current) => (current === id ? null : current))
        setScholarshipEditDraft(null)
      },
      reduceMotion ? 0 : 280,
    )
    return true
  }

  const cancelTimelineEdit = () => {
    setEditingEventId(null)
    setEditTitle('')
    setEditDate(today)
    setEditNote('')
  }

  const startEditingTimelineEvent = (event: { id: string; title: string; date: string; note: string }) => {
    if (editingEventId === event.id) {
      requestCloseItemEditor('timeline')
      return
    }
    if (editingEventId && timelineEditDirty) {
      requestCloseItemEditor('timeline', () => startEditingTimelineEvent(event))
      return
    }
    setEditingEventId(event.id)
    setEditTitle(event.title)
    setEditDate(event.date)
    setEditNote(event.note)
    setTimelineAddOpen(false)
  }

  const saveTimelineEdit = async () => {
    if (!editingEventId || !onUpdateTimelineEvent || !editTitle.trim()) return false
    const saved = await onUpdateTimelineEvent(editingEventId, editTitle.trim(), editDate, editNote)
    if (saved === false) return false
    cancelTimelineEdit()
    return true
  }

  const cancelItemEditor = (kind: 'communication' | 'scholarship' | 'timeline') => {
    if (kind === 'communication') cancelEditingCommunication()
    else if (kind === 'scholarship') cancelEditingScholarship()
    else cancelTimelineEdit()
  }

  const requestCloseItemEditor = (
    kind: 'communication' | 'scholarship' | 'timeline',
    proceed?: () => void,
    navigation = false,
  ) => {
    const dirty =
      kind === 'communication'
        ? communicationEditDirty
        : kind === 'scholarship'
          ? scholarshipEditDirty
          : timelineEditDirty
    if (dirty) {
      setPendingItemEditExit({ kind, proceed, navigation })
      return
    }
    cancelItemEditor(kind)
    proceed?.()
  }

  const continueAfterItemEditor = (exit: typeof pendingItemEditExit) => {
    if (exit?.navigation && isDirty && exit.proceed) {
      if (autoSaveEnabled && onFlushAutoSave) {
        void onFlushAutoSave().then((saved) => {
          if (saved) exit.proceed?.()
        })
      } else {
        setPendingDraftExit({ proceed: exit.proceed })
      }
      return
    }
    exit?.proceed?.()
  }

  const handlePendingItemEditSave = async () => {
    const exit = pendingItemEditExit
    if (!exit) return
    setPendingItemEditExit(null)
    let saved = false
    if (exit.kind === 'communication' && editingCommunication) {
      saved = await saveCommunicationEdit(editingCommunication)
    } else if (exit.kind === 'scholarship' && editingScholarship) {
      saved = await saveScholarshipEdit(editingScholarship.id)
    } else if (exit.kind === 'scholarship-add') {
      saved = await submitScholarshipDraft()
    } else if (exit.kind === 'timeline') {
      saved = await saveTimelineEdit()
    } else if (exit.kind === 'recommender-create') {
      saved = true
      for (const id of exit.ids ?? []) {
        if (!(await saveOverviewRecommender(id))) {
          saved = false
          break
        }
      }
    } else if (exit.kind === 'checklist-create') {
      saved = await savePendingChecklistCreate()
    }
    if (saved) continueAfterItemEditor(exit)
    else setPendingItemEditExit(exit)
  }

  const handlePendingItemEditDiscard = () => {
    const exit = pendingItemEditExit
    if (!exit) return
    setPendingItemEditExit(null)
    if (exit.kind === 'communication' || exit.kind === 'scholarship' || exit.kind === 'timeline') {
      cancelItemEditor(exit.kind)
    } else if (exit.kind === 'scholarship-add') {
      setScholarshipDraft(createScholarshipDraft(application.school.name))
      setScholarshipAddOpen(false)
    } else if (exit.kind === 'recommender-create') {
      const targets = new Set(exit.ids ?? [])
      replacePendingOverviewRecommenders(
        pendingOverviewRecommendersRef.current.filter((recommender) => !targets.has(recommender.id)),
      )
    } else if (exit.kind === 'checklist-create') {
      discardPendingChecklistCreate()
    }
    continueAfterItemEditor(exit)
  }

  const scholarshipMaterialStatusKey = (scholarshipId: string, materialId: string) => `${scholarshipId}:${materialId}`

  const updateScholarshipTrackables = (
    scholarship: ScholarshipItem,
    patch: Pick<ScholarshipFormDraft, 'materials' | 'tasks'>,
  ) => {
    if (!onUpdateScholarship) return
    const sourceApplicationId = application.id
    const { id, ...input } = scholarship
    const nextScholarship = { ...scholarship, ...patch }
    setOptimisticScholarships((current) => ({
      ...current,
      [id]: nextScholarship,
    }))
    void Promise.resolve(onUpdateScholarship(id, { ...input, ...patch })).finally(() => {
      if (activeApplicationIdRef.current !== sourceApplicationId) return
      setOptimisticScholarships((current) => {
        if (current[id] !== nextScholarship) return current
        const { [id]: _savedScholarship, ...next } = current
        return next
      })
    })
  }

  const updateScholarshipsStatus = (ids: string[], status: ScholarshipStatus) => {
    if (!onUpdateScholarship) return
    const sourceApplicationId = application.id
    const targetIds = new Set(ids)
    const updates = new Map(
      application.scholarships
        .filter((item) => targetIds.has(item.id))
        .map((storedItem) => {
          const item = optimisticScholarships[storedItem.id] ?? storedItem
          return [item.id, { ...item, status }] as const
        }),
    )
    if (updates.size === 0) return

    setOptimisticScholarships((current) => ({
      ...current,
      ...Object.fromEntries(updates),
    }))

    void Promise.all(
      Array.from(updates.values()).map(({ id, ...input }) => Promise.resolve(onUpdateScholarship(id, input))),
    ).finally(() => {
      if (activeApplicationIdRef.current !== sourceApplicationId) return
      setOptimisticScholarships((current) => {
        const next = { ...current }
        updates.forEach((updated, id) => {
          if (current[id] === updated) delete next[id]
        })
        return next
      })
    })
  }

  const setScholarshipMaterialStatus = (
    scholarship: ScholarshipItem,
    material: ScholarshipMaterialItem,
    nextStatus: MaterialStatus,
  ) => {
    const key = scholarshipMaterialStatusKey(scholarship.id, material.id)
    if (nextStatus === 'Submitted' && material.status !== 'Submitted') {
      setScholarshipMaterialPreviousStatuses((current) => ({
        ...current,
        [key]: material.status || 'Draft',
      }))
    } else if (nextStatus !== 'Submitted') {
      setScholarshipMaterialPreviousStatuses((current) => {
        const { [key]: _previousStatus, ...next } = current
        return next
      })
    }
    updateScholarshipTrackables(scholarship, {
      materials: (scholarship.materials ?? []).map((item) =>
        item.id === material.id ? { ...item, status: nextStatus } : item,
      ),
      tasks: scholarship.tasks ?? [],
    })
  }

  const toggleScholarshipMaterialCompletion = (scholarship: ScholarshipItem, material: ScholarshipMaterialItem) => {
    const key = scholarshipMaterialStatusKey(scholarship.id, material.id)
    const completed = material.status === 'Submitted'
    const nextStatus = completed ? (scholarshipMaterialPreviousStatuses[key] ?? 'Draft') : 'Submitted'
    setScholarshipMaterialStatus(scholarship, material, nextStatus)
  }

  const setScholarshipTaskStatus = (
    scholarship: ScholarshipItem,
    task: ScholarshipTaskItem,
    status: string,
  ) => {
    const done = checklistStatusKey(status) === checklistStatusKey('Done')
      ? true
      : checklistStatusKey(status) === checklistStatusKey('Open')
        ? false
        : task.done
    updateScholarshipTrackables(scholarship, {
      materials: scholarship.materials ?? [],
      tasks: (scholarship.tasks ?? []).map((item) => (item.id === task.id ? { ...item, done, status } : item)),
    })
  }

  const setScholarshipTaskDone = (scholarship: ScholarshipItem, task: ScholarshipTaskItem, done: boolean) => {
    setScholarshipTaskStatus(scholarship, task, done ? 'Done' : 'Open')
  }

  const toggleScholarshipTaskCompletion = (scholarship: ScholarshipItem, task: ScholarshipTaskItem) => {
    setScholarshipTaskDone(scholarship, task, !task.done)
  }

  const openScholarshipMaterialContextMenu = (
    event: MouseEvent<HTMLElement>,
    scholarship: ScholarshipItem,
    material: ScholarshipMaterialItem,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setExplorerMenu({
      x: event.clientX,
      y: event.clientY,
      title: localize(material.name),
      subtitle: tx('explorer.materialStatusMenuHint'),
      items: [
        {
          id: 'status',
          label: tx('explorer.changeStatus'),
          icon: <BadgeCheck size={14} aria-hidden="true" />,
          shortcut: 'S',
          accessKey: 's',
          submenu: {
            title: tx('explorer.changeStatus'),
            subtitle: tx('explorer.materialStatusMenuHint'),
            backLabel: tx('explorer.back'),
            items: materialStatuses.map((status) => ({
              id: `scholarship-material-status-${status}`,
              label: statusLabel(status, tx),
              radio: true,
              selected: material.status === status,
              statusTone: materialStatusMenuTone(status),
              statusSlug: statusCssSlug(status),
              onSelect: () => setScholarshipMaterialStatus(scholarship, material, status),
            })),
          },
        },
      ],
    })
  }

  const openScholarshipTaskContextMenu = (
    event: MouseEvent<HTMLElement>,
    scholarship: ScholarshipItem,
    task: ScholarshipTaskItem,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setExplorerMenu({
      x: event.clientX,
      y: event.clientY,
      title: localize(task.title),
      subtitle: tx('explorer.taskStatusMenuHint'),
      items: [
        {
          id: 'status',
          label: tx('explorer.changeStatus'),
          icon: <BadgeCheck size={14} aria-hidden="true" />,
          shortcut: 'S',
          accessKey: 's',
          submenu: {
            title: tx('explorer.changeStatus'),
            subtitle: tx('explorer.taskStatusMenuHint'),
            backLabel: tx('explorer.back'),
            items: taskStatuses.map((status) => ({
              id: `scholarship-task-status-${status}`,
              label: statusLabel(status, tx),
              radio: true,
              selected: checklistStatusKey(checklistTaskStatus(task)) === checklistStatusKey(status),
              statusTone: materialStatusMenuTone(status),
              statusSlug: statusCssSlug(status),
              onSelect: () => setScholarshipTaskStatus(scholarship, task, status),
            })),
          },
        },
      ],
    })
  }

  const addScholarshipMaterial = (form: ScholarshipFormDraft, updateForm: (draft: ScholarshipFormDraft) => void) => {
    updateForm({
      ...form,
      materials: [
        ...form.materials.filter((material) => scholarshipMaterialDraftHasContent(material, form.endDate)),
        {
          id: createLocalId('scholarship-material'),
          name: '',
          status: 'Draft',
          due: '',
          details: '',
        },
      ],
    })
  }

  const addScholarshipTask = (form: ScholarshipFormDraft, updateForm: (draft: ScholarshipFormDraft) => void) => {
    updateForm({
      ...form,
      tasks: [
        ...form.tasks.filter((task) => scholarshipTaskDraftHasContent(task, form.endDate)),
        {
          id: createLocalId('scholarship-task'),
          title: '',
          due: '',
          done: false,
          status: 'Open',
          details: '',
        },
      ],
    })
  }

  const scholarshipMaterialStatusCreateConfig = (
    form: ScholarshipFormDraft,
    updateForm: (draft: ScholarshipFormDraft) => void,
    material: ScholarshipMaterialItem,
  ): SelectCreateConfig<string> | undefined =>
    checklistStatusCreateConfig({
      onCreate: (value) => updateForm({
        ...form,
        materials: form.materials.map((item) => (item.id === material.id ? { ...item, status: value } : item)),
      }),
      onRename: (value, nextValue) => updateForm({
        ...form,
        materials: form.materials.map((item) => (item.id === material.id && checklistStatusKey(item.status) === checklistStatusKey(value)
          ? { ...item, status: nextValue }
          : item)),
      }),
      onDelete: (value) => updateForm({
        ...form,
        materials: form.materials.map((item) => (item.id === material.id && checklistStatusKey(item.status) === checklistStatusKey(value)
          ? { ...item, status: 'Draft' }
          : item)),
      }),
    })

  const scholarshipTaskStatusCreateConfig = (
    form: ScholarshipFormDraft,
    updateForm: (draft: ScholarshipFormDraft) => void,
    task: ScholarshipTaskItem,
  ): SelectCreateConfig<string> | undefined =>
    checklistStatusCreateConfig({
      onCreate: (value) => updateForm({
        ...form,
        tasks: form.tasks.map((item) => (item.id === task.id ? {
          ...item,
          status: value,
          ...(checklistStatusKey(value) === checklistStatusKey('Done') ? { done: true } : checklistStatusKey(value) === checklistStatusKey('Open') ? { done: false } : {}),
        } : item)),
      }),
      onRename: (value, nextValue) => updateForm({
        ...form,
        tasks: form.tasks.map((item) => (item.id === task.id && checklistStatusKey(checklistTaskStatus(item)) === checklistStatusKey(value)
          ? { ...item, status: nextValue }
          : item)),
      }),
      onDelete: (value) => updateForm({
        ...form,
        tasks: form.tasks.map((item) => (item.id === task.id && checklistStatusKey(checklistTaskStatus(item)) === checklistStatusKey(value)
          ? { ...item, status: 'Open', done: false }
          : item)),
      }),
    })

  const addScholarshipTimelineEvent = (
    form: ScholarshipFormDraft,
    updateForm: (draft: ScholarshipFormDraft) => void,
  ) => {
    const eventId = createLocalId('scholarship-event')
    recentScholarshipTimelineEventIdRef.current = eventId
    updateForm({
      ...form,
      timeline: [{ id: eventId, title: '', date: form.endDate, note: '' }, ...form.timeline],
    })
  }

  const removeManualTimelineEvents = (ids: string[]) => {
    const manualIds = ids.filter(
      (id) => !removingTimelineIds.has(id) && unifiedTimelineEvents.some((event) => event.id === id && event.manual),
    )
    if (manualIds.length === 0) return
    queueDestroyAnimation(manualIds, setRemovingTimelineIds, () => {
      if (onRemoveTimelineEvents) onRemoveTimelineEvents(manualIds)
      else manualIds.forEach((id) => onRemoveTimelineEvent?.(id))
    })
    timelineSelection.clearSelection()
  }

  const prepareJumpTarget = useCallback((target: Pick<DossierJumpIntent, 'tab' | 'targetId' | 'expand'>) => {
    if (target.tab === 'materials') {
      setChecklistSearch('')
      setMaterialFilter('all')
      setMaterialGroupFilter('all')
      setTaskFilter('all')
      if (target.expand?.kind === 'material') {
        const { id } = target.expand
        setExpandedMaterials((current) => new Set(current).add(id))
        setMaterialExpansionSyncVersion((version) => version + 1)
      } else if (target.expand?.kind === 'task') {
        const { id } = target.expand
        setExpandedChecklistTasks((current) => new Set(current).add(id))
        setTaskExpansionSyncVersion((version) => version + 1)
      }
    } else if (target.tab === 'mail') {
      setCorrespondenceView('all')
    } else if (target.tab === 'funding' && target.expand?.kind === 'scholarship') {
      const { id } = target.expand
      setExpandedScholarships((current) => new Set(current).add(id))
    }
  }, [])

  const findJumpTargetNode = useCallback((targetId: string, fallbackText?: string[]) => {
    const direct = document.getElementById(targetId)
    if (direct || !fallbackText?.length) return direct

    const parts = fallbackText.map((part) => part.trim()).filter(Boolean)
    if (parts.length === 0) return null
    return (
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '.timeline-event-card, .checklist-item, .correspondence-event-card, .funding-card, .section-card',
        ),
      ).find((node) => {
        const text = node.textContent ?? ''
        const matches = (candidates: string[]) =>
          candidates.length > 0 && candidates.every((part) => text.includes(part))
        return matches(parts) || matches(parts.slice(1))
      }) ?? null
    )
  }, [])

  const focusJumpTarget = useCallback(
    (targetId: string, fallbackText?: string[], onFinished?: () => void) => {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      const rootScroller = document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null
      const startedAt = performance.now()
      let findStartedAt: number | null = null
      let handoffFrame = 0
      let findFrame = 0
      let settleFrame = 0
      let highlightFrame = 0
      let highlightTimer = 0
      let activeNode: HTMLElement | null = null
      let scrollEventTarget: EventTarget | null = null
      let scrollEndListener: EventListener | null = null
      let focusStarted = false
      let finished = false
      let disposed = false

      const clearScrollWait = () => {
        if (settleFrame) window.cancelAnimationFrame(settleFrame)
        settleFrame = 0
        if (scrollEventTarget && scrollEndListener) {
          scrollEventTarget.removeEventListener('scrollend', scrollEndListener)
        }
        scrollEventTarget = null
        scrollEndListener = null
      }

      const clearFocusClasses = () => {
        activeNode?.classList.remove('search-highlight', 'jump-focus', 'jump-focus-prep')
      }

      const complete = () => {
        if (disposed || finished) return
        finished = true
        clearScrollWait()
        clearFocusClasses()
        onFinished?.()
      }

      const showFocus = () => {
        if (disposed || finished || focusStarted || !activeNode) return
        focusStarted = true
        clearScrollWait()
        highlightFrame = window.requestAnimationFrame(() => {
          if (disposed || finished || !activeNode) return
          activeNode.classList.add('jump-focus')
          // Two low-contrast accent breaths complete in 1.68s. Reduced-motion
          // keeps a static locator ring briefly instead of moving or flashing.
          highlightTimer = window.setTimeout(complete, reduceMotion ? 900 : 1740)
        })
      }

      const scrollToNode = (node: HTMLElement) => {
        activeNode = node
        clearFocusClasses()
        node.classList.add('jump-focus-prep')

        const scrollParent = findScrollableAncestor(node)
        const usesViewport = !scrollParent || scrollParent === rootScroller
        const targetRect = node.getBoundingClientRect()
        const scrollRect =
          !usesViewport && scrollParent ? scrollParent.getBoundingClientRect() : { top: 0, height: window.innerHeight }
        const viewportHeight = Math.max(1, scrollRect.height)
        const currentTop = () =>
          usesViewport ? window.scrollY || rootScroller?.scrollTop || 0 : (scrollParent?.scrollTop ?? 0)
        const maxTop = usesViewport
          ? Math.max(
              0,
              Math.max(
                document.documentElement.scrollHeight,
                document.body?.scrollHeight ?? 0,
                rootScroller?.scrollHeight ?? 0,
              ) - viewportHeight,
            )
          : scrollParent
            ? Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight)
            : 0
        const targetInset =
          targetRect.height >= viewportHeight - 48 ? 24 : Math.max(24, (viewportHeight - targetRect.height) / 2)
        const desiredTop = Math.min(maxTop, Math.max(0, currentTop() + targetRect.top - scrollRect.top - targetInset))
        const initialTop = currentTop()
        const distance = Math.abs(desiredTop - initialTop)
        const behavior: ScrollBehavior = reduceMotion ? 'auto' : 'smooth'

        const performScroll = () => {
          if (usesViewport && typeof window.scrollTo === 'function') {
            window.scrollTo({ top: desiredTop, behavior })
            return
          }
          if (scrollParent && typeof scrollParent.scrollTo === 'function') {
            scrollParent.scrollTo({ top: desiredTop, behavior })
            return
          }
          node.scrollIntoView?.({
            behavior,
            block: 'center',
            inline: 'nearest',
          })
        }

        if (reduceMotion || distance < 2) {
          if (distance >= 2) performScroll()
          showFocus()
          return
        }

        scrollEventTarget = usesViewport ? document : scrollParent
        scrollEndListener = () => showFocus()
        scrollEventTarget?.addEventListener('scrollend', scrollEndListener, {
          once: true,
        })

        let lastTop = initialTop
        let stableFrames = 0
        let hasMoved = false
        const scrollStartedAt = performance.now()
        const watchScrollSettle = () => {
          if (disposed || finished || focusStarted) return
          const nextTop = currentTop()
          const delta = Math.abs(nextTop - lastTop)
          const elapsed = performance.now() - scrollStartedAt
          hasMoved = hasMoved || delta > 0.5
          stableFrames = delta < 0.5 ? stableFrames + 1 : 0
          lastTop = nextTop
          const nearDestination = Math.abs(nextTop - desiredTop) < 1.5
          if ((stableFrames >= 3 && (nearDestination || hasMoved || elapsed >= 160)) || elapsed >= 1100) {
            showFocus()
            return
          }
          settleFrame = window.requestAnimationFrame(watchScrollSettle)
        }

        performScroll()
        settleFrame = window.requestAnimationFrame(watchScrollSettle)
      }

      const findTarget = () => {
        if (disposed || finished) return
        if (findStartedAt === null) findStartedAt = performance.now()
        const node = findJumpTargetNode(targetId, fallbackText)
        if (node) {
          scrollToNode(node)
          return
        }
        // Filters, disclosure rows, and deferred dossier content can mount one or
        // two frames after the tab. Retry briefly, then consume the stale intent
        // instead of leaving it armed for a future application.
        if (performance.now() - findStartedAt >= 900) {
          complete()
          return
        }
        findFrame = window.requestAnimationFrame(findTarget)
      }

      const waitForHandoff = () => {
        if (disposed || finished) return
        const transitionRoot = document.documentElement
        const handoffActive = Boolean(
          transitionRoot.dataset.atlasFallbackScope || transitionRoot.dataset.atlasTransitionScope,
        )
        if (reduceMotion || !handoffActive || performance.now() - startedAt >= 520) {
          findTarget()
          return
        }
        // Let the screen/tab/record handoff release before asking the same pane to
        // animate its scroll position; the two motions otherwise compete.
        handoffFrame = window.requestAnimationFrame(waitForHandoff)
      }

      handoffFrame = window.requestAnimationFrame(waitForHandoff)

      return () => {
        disposed = true
        window.cancelAnimationFrame(handoffFrame)
        window.cancelAnimationFrame(findFrame)
        window.cancelAnimationFrame(highlightFrame)
        clearScrollWait()
        if (highlightTimer) window.clearTimeout(highlightTimer)
        clearFocusClasses()
      }
    },
    [findJumpTargetNode],
  )

  const jumpTargetFromTimelineNav = useCallback(
    (nav: TimelineNav): Pick<DossierJumpIntent, 'tab' | 'targetId' | 'expand'> => {
      if (nav.tab === 'materials') {
        return {
          tab: 'materials',
          targetId: `${nav.kind}-${nav.id}`,
          expand: { kind: nav.kind, id: nav.id },
        }
      }
      if (nav.tab === 'mail') return { tab: 'mail', targetId: `communication-${nav.id}` }
      if (nav.tab === 'funding') {
        if ('feeId' in nav) return { tab: 'funding', targetId: `fee-${nav.feeId}` }
        return {
          tab: 'funding',
          targetId: `scholarship-${nav.scholarshipId}`,
          expand: { kind: 'scholarship', id: nav.scholarshipId },
        }
      }
      return { tab: 'dossier', targetId: 'dossier-config-card' }
    },
    [],
  )

  const navigateToTimelineSource = (nav: TimelineNav) => {
    requestLocalEditorExit(() => {
      const direction = directionForTab(nav.tab)
      prepareJumpTarget(jumpTargetFromTimelineNav(nav))
      setPendingTimelineNav(nav)
      setTabDirection(direction)
      onTab(nav.tab, direction)
    })
  }

  // Once a requested tab becomes active, scroll to and briefly ring the target
  // row/card so the user's eye lands on the destination, not the clicked source.
  useEffect(() => {
    if (!tabContentReady || !pendingTimelineNav || renderedTab !== pendingTimelineNav.tab) return undefined
    const nav = pendingTimelineNav
    const target = jumpTargetFromTimelineNav(nav)
    prepareJumpTarget(target)
    return focusJumpTarget(target.targetId, undefined, () => {
      setPendingTimelineNav((current) => (current === nav ? null : current))
    })
  }, [focusJumpTarget, jumpTargetFromTimelineNav, pendingTimelineNav, prepareJumpTarget, renderedTab, tabContentReady])

  useEffect(() => {
    if (
      !tabContentReady ||
      !jumpIntent ||
      jumpIntent.applicationId !== application.id ||
      consumedJumpTokenRef.current === jumpIntent.token ||
      renderedTab !== jumpIntent.tab
    ) {
      return undefined
    }
    prepareJumpTarget(jumpIntent)
    return focusJumpTarget(jumpIntent.targetId, jumpIntent.fallbackText, () => {
      consumedJumpTokenRef.current = jumpIntent.token
      onJumpIntentConsumed?.(jumpIntent.token)
    })
  }, [application.id, focusJumpTarget, jumpIntent, onJumpIntentConsumed, prepareJumpTarget, renderedTab, tabContentReady])

  const openMaterialContextMenu = (event: MouseEvent<HTMLElement>, material: MaterialItem) => {
    event.preventDefault()
    const ids = selectedMaterialIds(material.id)
    if (!materialSelection.selectedIds.has(material.id)) materialSelection.selectOnly(material.id)
    const targets = draft.materials.filter((item) => ids.includes(item.id))
    const single = targets.length === 1 ? targets[0] : null
    const statusItems = materialStatuses.map((status) => ({
      id: `status-${status}`,
      label: statusLabel(status, tx),
      radio: true as const,
      selected: single?.status === status,
      statusTone: materialStatusMenuTone(status),
      statusSlug: statusCssSlug(status),
      onSelect: () => updateMaterialsStatus(ids, status),
    }))
    setExplorerMenu({
      x: event.clientX,
      y: event.clientY,
      title: single ? localize(single.name) : format(tx('explorer.selectedCount'), { count: targets.length }),
      subtitle: tx('explorer.materialStatusMenuHint'),
      items: [
        {
          id: 'status',
          label: tx('explorer.changeStatus'),
          icon: <BadgeCheck size={14} aria-hidden="true" />,
          shortcut: 'S',
          accessKey: 's',
          submenu: {
            title: tx('explorer.changeStatus'),
            subtitle: tx('explorer.materialStatusMenuHint'),
            backLabel: tx('explorer.back'),
            items: statusItems,
          },
        },
        {
          id: 'expand',
          label: tx('explorer.expandSelected'),
          icon: <ChevronDown size={14} aria-hidden="true" />,
          shortcut: 'E',
          accessKey: 'e',
          onSelect: () => setMaterialsExpanded(ids, true),
        },
        {
          id: 'collapse',
          label: tx('explorer.collapseSelected'),
          icon: <ChevronDown size={14} aria-hidden="true" />,
          shortcut: 'X',
          accessKey: 'x',
          onSelect: () => setMaterialsExpanded(ids, false),
        },
        {
          id: 'preview',
          label: tx('filePreview.preview'),
          icon: <Eye size={14} aria-hidden="true" />,
          shortcut: 'P',
          accessKey: 'p',
          disabled: !single?.fileId || !onPreview,
          onSelect: () =>
            single?.fileId &&
            onPreview &&
            setAttachmentPreview({
              fileId: single.fileId,
              fileName: single.fileName ?? single.name,
              mimeType: single.mimeType,
            }),
        },
        {
          id: 'download',
          label: tx('explorer.download'),
          icon: <Download size={14} aria-hidden="true" />,
          shortcut: 'D',
          accessKey: 'd',
          disabled: !single?.fileId,
          onSelect: () => single?.fileId && onDownload(single.fileId, single.fileName ?? single.name),
        },
        {
          id: 'upload',
          label: tx('explorer.uploadAttachment'),
          icon: <UploadCloud size={14} aria-hidden="true" />,
          shortcut: 'U',
          accessKey: 'u',
          disabled: !single,
          onSelect: () => single && requestChecklistUpload({ kind: 'material', id: single.id }),
        },
        {
          id: 'copy',
          label: tx('explorer.copyName'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'C',
          accessKey: 'c',
          disabled: !single,
          onSelect: () => single && copyExplorerValue(single.name, tx('dossier.checklistItemTitle')),
        },
        {
          id: 'copy-details',
          label: tx('explorer.copyDetails'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: !single?.details,
          onSelect: () => single?.details && copyExplorerValue(single.details, tx('dossier.details')),
        },
        {
          id: 'delete',
          label: targets.length === 1 ? tx('explorer.delete') : tx('explorer.deleteSelected'),
          icon: <Trash2 size={14} aria-hidden="true" />,
          shortcut: 'Delete',
          accessKey: 'delete',
          tone: 'danger',
          onSelect: () => removeMaterials(ids),
        },
      ],
    })
  }

  const openTaskContextMenu = (event: MouseEvent<HTMLElement>, task: TaskItem) => {
    event.preventDefault()
    const ids = selectedTaskIds(task.id)
    if (!taskSelection.selectedIds.has(task.id)) taskSelection.selectOnly(task.id)
    const targets = draft.tasks.filter((item) => ids.includes(item.id))
    const single = targets.length === 1 ? targets[0] : null
    const taskStatusItems = [
      {
        id: 'open',
        label: tx('explorer.statusOpen'),
        radio: true as const,
        selected: single?.done === false,
        statusTone: 'neutral' as const,
        statusSlug: 'open',
        onSelect: () => updateTasksDone(ids, false),
      },
      {
        id: 'complete',
        label: tx('explorer.statusComplete'),
        radio: true as const,
        selected: single?.done === true,
        statusTone: 'success' as const,
        statusSlug: 'done',
        onSelect: () => updateTasksDone(ids, true),
      },
    ]
    setExplorerMenu({
      x: event.clientX,
      y: event.clientY,
      title: single ? localize(single.title) : format(tx('explorer.selectedCount'), { count: targets.length }),
      subtitle: tx('explorer.taskMenuHint'),
      items: [
        {
          id: 'status',
          label: tx('explorer.changeStatus'),
          icon: <BadgeCheck size={14} aria-hidden="true" />,
          shortcut: 'S',
          accessKey: 's',
          submenu: {
            title: tx('explorer.changeStatus'),
            subtitle: tx('explorer.taskStatusMenuHint'),
            backLabel: tx('explorer.back'),
            items: taskStatusItems,
          },
        },
        {
          id: 'expand',
          label: tx('explorer.expandSelected'),
          icon: <ChevronDown size={14} aria-hidden="true" />,
          shortcut: 'E',
          accessKey: 'e',
          onSelect: () => setTasksExpanded(ids, true),
        },
        {
          id: 'collapse',
          label: tx('explorer.collapseSelected'),
          icon: <ChevronDown size={14} aria-hidden="true" />,
          shortcut: 'X',
          accessKey: 'x',
          onSelect: () => setTasksExpanded(ids, false),
        },
        {
          id: 'preview',
          label: tx('filePreview.preview'),
          icon: <Eye size={14} aria-hidden="true" />,
          shortcut: 'P',
          accessKey: 'p',
          disabled: !single?.fileId || !onPreview,
          onSelect: () =>
            single?.fileId &&
            onPreview &&
            setAttachmentPreview({
              fileId: single.fileId,
              fileName: single.fileName ?? single.title,
              mimeType: single.mimeType,
            }),
        },
        {
          id: 'download',
          label: tx('explorer.download'),
          icon: <Download size={14} aria-hidden="true" />,
          shortcut: 'D',
          accessKey: 'd',
          disabled: !single?.fileId,
          onSelect: () => single?.fileId && onDownload(single.fileId, single.fileName ?? single.title),
        },
        {
          id: 'upload',
          label: tx('explorer.uploadAttachment'),
          icon: <UploadCloud size={14} aria-hidden="true" />,
          shortcut: 'U',
          accessKey: 'u',
          disabled: !single,
          onSelect: () => single && requestChecklistUpload({ kind: 'task', id: single.id }),
        },
        {
          id: 'copy-details',
          label: tx('explorer.copyDetails'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'C',
          accessKey: 'c',
          disabled: !single?.details,
          onSelect: () => single?.details && copyExplorerValue(single.details, tx('dossier.details')),
        },
        {
          id: 'delete',
          label: targets.length === 1 ? tx('explorer.delete') : tx('explorer.deleteSelected'),
          icon: <Trash2 size={14} aria-hidden="true" />,
          shortcut: 'Delete',
          accessKey: 'delete',
          tone: 'danger',
          onSelect: () => removeTasks(ids),
        },
      ],
    })
  }

  const openCommunicationContextMenu = (
    event: MouseEvent<HTMLElement>,
    item: ApplicationRecord['communications'][number],
  ) => {
    event.preventDefault()
    const ids = selectedCommunicationIds(item.id)
    if (!communicationSelection.selectedIds.has(item.id)) communicationSelection.selectOnly(item.id)
    const targets = visibleCommunications.filter((candidate) => ids.includes(candidate.id))
    const single = targets.length === 1 ? targets[0] : null
    const categoryTargetsAreEligible =
      targets.length > 0 &&
      targets.every((candidate) => candidate.channel === 'Email' && candidate.messageType !== 'draft-email')
    const aiClassificationTargetsAreEligible =
      targets.length > 0 && targets.every(isIncomingEmailForClassification)
    const classificationPending = targets.some((candidate) => classifyingCommunicationIds.has(candidate.id))
    const classificationThreatBlocked = targets.some((candidate) => Boolean(candidate.mailSecurity))
    const manualCategoryDisabled =
      isReadOnly || !onSetCommunicationCategory || !categoryTargetsAreEligible || classificationPending
    const aiClassificationDisabled =
      isReadOnly ||
      !onClassifyCommunications ||
      aiKeys.length === 0 ||
      !aiClassificationTargetsAreEligible ||
      classificationPending ||
      classificationThreatBlocked
    const addToInterviewPrepDisabled =
      isReadOnly ||
      !onAddToInterviewPrep ||
      !single ||
      !categoryTargetsAreEligible
    const aiClassificationLabel = classificationPending
      ? tx('dossier.mailClassificationAnalyzing')
      : classificationThreatBlocked
        ? tx('dossier.mailClassificationUnsafe')
        : aiKeys.length === 0
          ? tx('dossier.mailClassificationNoKey')
          : targets.length > 1
            ? tx('dossier.mailClassificationAiBulk')
            : tx('dossier.mailClassificationAi')
    setExplorerMenu({
      x: event.clientX,
      y: event.clientY,
      title: single ? localize(single.subject) : format(tx('explorer.selectedCount'), { count: targets.length }),
      subtitle: tx('explorer.correspondenceMenuHint'),
      items: [
        {
          id: 'mail-category',
          label: tx('dossier.mailClassification'),
          icon: <Tags size={14} aria-hidden="true" />,
          disabled: manualCategoryDisabled,
          submenu: {
            title: tx('dossier.mailClassification'),
            subtitle: tx('dossier.mailClassificationSubmenuHint'),
            backLabel: tx('explorer.back'),
            items: [
              // Multi-select: a message is often several things at once, so each
              // entry toggles and the menu stays open until the reader is done.
              ...mailCategoryChoices.map((option) => ({
                id: `mail-category-${option.id}`,
                label: option.label,
                radio: true,
                keepOpen: true,
                selected:
                  targets.length > 0 &&
                  targets.every((candidate) => effectiveMailCategories(candidate).includes(option.id)),
                statusTone: option.tone,
                statusSlug: mailCategorySlug(option.id),
                disabled: manualCategoryDisabled,
                onSelect: () => {
                  if (!onSetCommunicationCategory) return
                  // Toggle against what the first target already carries, so a
                  // mixed selection settles on one shared list.
                  const current = targets[0] ? effectiveMailCategories(targets[0]) : []
                  const next = current.includes(option.id)
                    ? current.filter((entry) => entry !== option.id)
                    : [...current, option.id]
                  void onSetCommunicationCategory(ids, next)
                },
              })),
              {
                id: 'mail-category-clear',
                label: tx('dossier.mailClassificationClearManual'),
                radio: true,
                selected:
                  targets.length > 0 && targets.every((candidate) => !hasManualMailCategory(candidate)),
                disabled:
                  manualCategoryDisabled ||
                  !targets.some((candidate) => hasManualMailCategory(candidate)),
                onSelect: () => {
                  if (!onSetCommunicationCategory) return
                  void onSetCommunicationCategory(ids, [])
                },
              },
            ],
          },
        },
        {
          id: 'mail-classify-ai',
          label: aiClassificationLabel,
          icon: classificationPending ? (
            <LoaderCircle className="spin-icon" size={14} aria-hidden="true" />
          ) : (
            <Sparkles size={14} aria-hidden="true" />
          ),
          disabled: aiClassificationDisabled,
          onSelect: () => {
            if (!onClassifyCommunications || !aiClassificationTargetsAreEligible) return
            void onClassifyCommunications(ids)
          },
        },
        {
          id: 'mail-add-interview',
          label: tx('dossier.mailAddToInterviewPrep'),
          icon: <GraduationCap size={14} aria-hidden="true" />,
          shortcut: 'I',
          accessKey: 'i',
          disabled: addToInterviewPrepDisabled,
          onSelect: () => {
            if (!single || !onAddToInterviewPrep) return
            void onAddToInterviewPrep({
              applicationId: application.id,
              communicationId: single.id,
              subject: localize(single.subject),
              school: application.school.name,
              program: application.program,
              advisor: application.professor.english,
            })
          },
        },
        {
          id: 'edit',
          label: tx('explorer.edit'),
          icon: <Pencil size={14} aria-hidden="true" />,
          shortcut: 'E',
          accessKey: 'e',
          disabled: !single || (single.messageType !== 'draft-email' && !onUpdateCommunication),
          onSelect: () => single && startEditingCommunication(single),
        },
        {
          id: 'copy-subject',
          label: tx('explorer.copySubject'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'S',
          accessKey: 's',
          disabled: !single?.subject,
          onSelect: () => single?.subject && copyExplorerValue(single.subject, tx('dossier.emailSubject')),
        },
        {
          id: 'copy',
          label: tx('explorer.copySummary'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'C',
          accessKey: 'c',
          disabled: !single,
          onSelect: () => single && copyExplorerValue(single.summary, tx('copySummary')),
        },
        {
          id: 'delete',
          label: targets.length === 1 ? tx('explorer.delete') : tx('explorer.deleteSelected'),
          icon: <Trash2 size={14} aria-hidden="true" />,
          shortcut: 'Delete',
          accessKey: 'delete',
          tone: 'danger',
          onSelect: () => removeCommunications(ids),
        },
      ],
    })
  }

  const openScholarshipContextMenu = (
    event: MouseEvent<HTMLElement>,
    scholarship: ApplicationRecord['scholarships'][number],
  ) => {
    event.preventDefault()
    const ids = selectedScholarshipIds(scholarship.id)
    if (!scholarshipSelection.selectedIds.has(scholarship.id)) scholarshipSelection.selectOnly(scholarship.id)
    const targets = application.scholarships.filter((item) => ids.includes(item.id))
    const single = targets.length === 1 ? targets[0] : null
    setExplorerMenu({
      x: event.clientX,
      y: event.clientY,
      title: single ? single.name : format(tx('explorer.selectedCount'), { count: targets.length }),
      subtitle: tx('explorer.fundingMenuHint'),
      items: [
        {
          id: 'status',
          label: tx('explorer.changeStatus'),
          icon: <BadgeCheck size={14} aria-hidden="true" />,
          shortcut: 'S',
          accessKey: 's',
          disabled: !onUpdateScholarship,
          submenu: {
            title: tx('explorer.changeStatus'),
            subtitle: tx('explorer.scholarshipStatusMenuHint'),
            backLabel: tx('explorer.back'),
            items: scholarshipStatusOrder.map((status) => ({
              id: `status-${status}`,
              label: tx(`dossier.scholarshipStatus.${status}`, status),
              radio: true,
              selected: single?.status === status,
              statusTone: scholarshipStatusMenuTone(status),
              statusSlug: statusCssSlug(status),
              onSelect: () => updateScholarshipsStatus(ids, status),
            })),
          },
        },
        {
          id: 'copy',
          label: tx('explorer.copyName'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'C',
          accessKey: 'c',
          disabled: !single,
          onSelect: () => single && copyExplorerValue(single.name, tx('dossier.scholarshipName')),
        },
        {
          id: 'edit',
          label: tx('explorer.edit'),
          icon: <Pencil size={14} aria-hidden="true" />,
          shortcut: 'E',
          accessKey: 'e',
          disabled: !single,
          onSelect: () => single && startEditingScholarship(single),
        },
        {
          id: 'copy-notes',
          label: tx('explorer.copyNotes'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'N',
          accessKey: 'n',
          disabled: !single?.notes,
          onSelect: () => single?.notes && copyExplorerValue(single.notes, tx('dossier.notes')),
        },
        {
          id: 'delete',
          label: targets.length === 1 ? tx('explorer.delete') : tx('explorer.deleteSelected'),
          icon: <Trash2 size={14} aria-hidden="true" />,
          shortcut: 'Delete',
          accessKey: 'delete',
          tone: 'danger',
          onSelect: () => removeScholarships(ids),
        },
      ],
    })
  }

  const openTimelineContextMenu = (
    event: MouseEvent<HTMLElement>,
    timelineEvent: (typeof unifiedTimelineEvents)[number],
  ) => {
    event.preventDefault()
    const ids = selectedTimelineIds(timelineEvent.id)
    if (!timelineSelection.selectedIds.has(timelineEvent.id)) timelineSelection.selectOnly(timelineEvent.id)
    const targets = unifiedTimelineEvents.filter((item) => ids.includes(item.id))
    const single = targets.length === 1 ? targets[0] : null
    const deletableIds = targets.filter((item) => item.manual).map((item) => item.id)
    setExplorerMenu({
      x: event.clientX,
      y: event.clientY,
      title: single ? localize(single.title) : format(tx('explorer.selectedCount'), { count: targets.length }),
      subtitle: tx('explorer.timelineMenuHint'),
      items: [
        {
          id: 'edit',
          label: tx('explorer.edit'),
          icon: <Pencil size={14} aria-hidden="true" />,
          shortcut: 'E',
          accessKey: 'e',
          disabled: !single?.manual || !onUpdateTimelineEvent,
          onSelect: () => {
            if (!single) return
            startEditingTimelineEvent(single)
          },
        },
        {
          id: 'copy',
          label: tx('explorer.copySummary'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'C',
          accessKey: 'c',
          disabled: !single?.note,
          onSelect: () => single && copyExplorerValue(single.note, tx('dossier.eventNote')),
        },
        {
          id: 'copy-date',
          label: tx('explorer.copyDate'),
          icon: <Copy size={14} aria-hidden="true" />,
          shortcut: 'T',
          accessKey: 't',
          disabled: !single?.date,
          onSelect: () => single && copyExplorerValue(formatDate(single.date, lang), tx('dossier.eventDate')),
        },
        {
          id: 'delete',
          label: targets.length === 1 ? tx('explorer.delete') : tx('explorer.deleteSelected'),
          icon: <Trash2 size={14} aria-hidden="true" />,
          shortcut: 'Delete',
          accessKey: 'delete',
          disabled: deletableIds.length === 0,
          tone: 'danger',
          onSelect: () => removeManualTimelineEvents(deletableIds),
        },
      ],
    })
  }

  const correspondenceTypeLabel = (item: ApplicationRecord['communications'][number]) => {
    const messageType = item.messageType as string
    const match = correspondenceKinds.find((k) => k.value === messageType)
    if (match) return tx(match.labelKey)
    if (messageType === 'scheduled-email') return tx('dossier.correspondenceTypes.scheduledEmail')
    if (messageType === 'draft-email') return tx('dossier.correspondenceTypes.draftEmail')
    return tx(`channel.${item.channel}`, item.channel)
  }

  const communicationDirection = (item: ApplicationRecord['communications'][number]) => communicationDirectionOf(item)

  const renderScholarshipForm = (
    form: ScholarshipFormDraft,
    updateForm: (draft: ScholarshipFormDraft) => void,
    formKey: string,
  ) => {
    const materialRowPrefix = `${formKey}:material:`
    const taskRowPrefix = `${formKey}:task:`
    const materialRowIds = form.materials.map((material) => `${materialRowPrefix}${material.id}`)
    const taskRowIds = form.tasks.map((task) => `${taskRowPrefix}${task.id}`)
    const timelineEvents = sortScholarshipTimelineNewestFirst(form.timeline)
    const startTrackableDrag = (event: DragStartEvent, kind: 'material' | 'task') => {
      const initialWidth = event.active.rect.current.initial?.width
      const initialHeight = event.active.rect.current.initial?.height
      const width = typeof initialWidth === 'number' && Number.isFinite(initialWidth) ? Math.round(initialWidth) : null
      const height = typeof initialHeight === 'number' && Number.isFinite(initialHeight) ? Math.round(initialHeight) : null
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      const activatorTarget = event.activatorEvent.target
      const sourceRow = activatorTarget instanceof Element
        ? activatorTarget.closest<HTMLElement>('.scholarship-mini-row')
        : null
      if (!sourceRow) return
      beginScholarshipDragPreview(
        {
          formKey,
          kind,
          element: createScholarshipDragPreviewElement(sourceRow),
          width,
          height,
        },
        reducedMotion,
      )
    }

    return (
      <div className="scholarship-form-body">
        <div className="scholarship-form-grid">
          <label>
            <span>{tx('dossier.scholarshipName')}</span>
            <input
              value={form.name}
              onChange={(event) => updateForm({ ...form, name: event.target.value })}
              placeholder={tx('dossier.scholarshipName')}
              required
            />
          </label>
          <label>
            <span>{tx('dossier.scholarshipAmount')}</span>
            <input
              value={form.amount}
              onChange={(event) => updateForm({ ...form, amount: event.target.value })}
              placeholder={tx('dossier.scholarshipAmountPlaceholder')}
            />
          </label>
          <label>
            <span>{tx('dossier.scholarshipSchool')}</span>
            <input
              value={form.school}
              onChange={(event) => updateForm({ ...form, school: event.target.value })}
              placeholder={application.school.name}
            />
          </label>
          <label>
            <span>{tx('dossier.scholarshipIssuer')}</span>
            <input
              value={form.issuer}
              onChange={(event) => updateForm({ ...form, issuer: event.target.value })}
              placeholder={tx('dossier.scholarshipIssuerPlaceholder')}
            />
          </label>
          <label>
            <span>{tx('dossier.status')}</span>
            <Select
              value={form.status}
              options={scholarshipStatusOptions}
              onChange={(status) => updateForm({ ...form, status })}
              size="small"
            />
          </label>
          <label>
            <span>{tx('dossier.scholarshipStart')}</span>
            <DatePicker
              value={form.startDate}
              onChange={(startDate) =>
                updateForm({
                  ...form,
                  startDate,
                  endDate: form.endDate || startDate,
                })
              }
              placeholder={tx('dossier.scholarshipStart')}
            />
          </label>
          <label>
            <span>{tx('dossier.scholarshipEnd')}</span>
            <DatePicker
              value={form.endDate}
              onChange={(endDate) => updateForm({ ...form, endDate })}
              placeholder={tx('dossier.scholarshipEnd')}
            />
          </label>
        </div>

        <div className="scholarship-notes-field">
          <span>{tx('dossier.notes')}</span>
          <MarkdownTextarea
            value={form.notes}
            onChange={(event) => updateForm({ ...form, notes: event.target.value })}
            placeholder={tx('dossier.scholarshipNotesPlaceholder')}
            aria-label={tx('dossier.notes')}
            rows={3}
          />
        </div>

        <div className="scholarship-subsections">
          <section className="scholarship-subsection">
            <div className="scholarship-subsection-head">
              <span>
                <FileText size={13} /> {tx('dossier.scholarshipMaterials')}
              </span>
              <button
                type="button"
                className="scholarship-subsection-add"
                onClick={() => addScholarshipMaterial(form, updateForm)}
              >
                <Plus size={12} /> {tx('dossier.addChecklistItem')}
              </button>
            </div>
            <DndContext
              sensors={dossierResourceFieldSensors}
              collisionDetection={scholarshipPointerCollision}
              onDragStart={(event) => startTrackableDrag(event, 'material')}
              onDragCancel={() => finishScholarshipDragPreview(true)}
              onDragEnd={(event) => {
                const materials = reorderScholarshipRows(form.materials, event, materialRowPrefix)
                const reordered = materials !== form.materials
                if (reordered) updateForm({ ...form, materials })
                if (!reordered || scholarshipDragReducedMotionRef.current) finishScholarshipDragPreview(true)
              }}
            >
              <SortableContext items={materialRowIds} strategy={verticalListSortingStrategy}>
                <div className={`scholarship-mini-list${form.materials.length === 0 ? ' is-empty' : ''}`}>
                  {form.materials.length === 0 ? (
                    <p className="scholarship-mini-empty">{tx('dossier.scholarshipNoMaterials')}</p>
                  ) : (
                    form.materials.map((material) => (
                      <SortableScholarshipRow
                        key={`${materialRowPrefix}${material.id}`}
                        id={`${materialRowPrefix}${material.id}`}
                        className="material-row"
                        handleLabel={`${tx('dossier.dragToReorder')}: ${material.name || tx('dossier.checklistNewTitle')}`}
                      >
                        <button
                          type="button"
                          className={`scholarship-check-btn${material.status === 'Submitted' ? ' on' : ''}`}
                          onClick={() => {
                            const nextStatus = material.status === 'Submitted' ? 'Draft' : 'Submitted'
                            updateForm({
                              ...form,
                              materials: form.materials.map((item) =>
                                item.id === material.id ? { ...item, status: nextStatus } : item,
                              ),
                            })
                          }}
                          aria-pressed={material.status === 'Submitted'}
                          aria-label={material.status === 'Submitted' ? tx('dossier.markIncomplete') : tx('dossier.markComplete')}
                        >
                          <AnimatedCheckmark checked={material.status === 'Submitted'} size={18} />
                        </button>
                        <ScholarshipRowTitleEditor
                          value={material.name}
                          onChange={(name) =>
                            updateForm({
                              ...form,
                              materials: form.materials.map((item) =>
                                item.id === material.id ? { ...item, name } : item,
                              ),
                            })
                          }
                          placeholder={tx('dossier.checklistNewTitle')}
                          label={`${tx('dossier.edit')}: ${material.name || tx('dossier.checklistNewTitle')}`}
                        />
                        <div className="scholarship-row-meta material-meta">
                          <label className="scholarship-row-field">
                            <span>{tx('dossier.status')}</span>
                            <Select
                              value={material.status}
                              options={materialStatusOptions}
                              onChange={(status) =>
                                updateForm({
                                  ...form,
                                  materials: form.materials.map((item) =>
                                    item.id === material.id ? { ...item, status } : item,
                                  ),
                                })
                              }
                              searchable
                              create={scholarshipMaterialStatusCreateConfig(form, updateForm, material)}
                              ariaLabel={tx('dossier.status')}
                              size="small"
                            />
                          </label>
                          <label className="scholarship-row-field">
                            <span>{tx('dossier.dueDate')}</span>
                            <DatePicker
                              value={material.due || ''}
                              onChange={(dueDate) =>
                                updateForm({
                                  ...form,
                                  materials: form.materials.map((item) =>
                                    item.id === material.id ? { ...item, due: dueDate } : item,
                                  ),
                                })
                              }
                              placeholder={tx('dossier.dueDate')}
                              allowClear
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          className="scholarship-row-remove"
                          onClick={() =>
                            updateForm({
                              ...form,
                              materials: form.materials.filter((item) => item.id !== material.id),
                            })
                          }
                          title={tx('dossier.remove')}
                          aria-label={tx('dossier.remove')}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </SortableScholarshipRow>
                    ))
                  )}
                </div>
              </SortableContext>
              <ScholarshipTrackableDragOverlay
                preview={scholarshipDragPreview}
                formKey={formKey}
                kind="material"
                reducedMotion={scholarshipDragReducedMotion}
                dropAnimation={scholarshipDropAnimation}
              />
            </DndContext>
          </section>

          <section className="scholarship-subsection">
            <div className="scholarship-subsection-head">
              <span>
                <CheckCircle2 size={13} /> {tx('dossier.scholarshipTasks')}
              </span>
              <button
                type="button"
                className="scholarship-subsection-add"
                onClick={() => addScholarshipTask(form, updateForm)}
              >
                <Plus size={12} /> {tx('dossier.addTask')}
              </button>
            </div>
            <DndContext
              sensors={dossierResourceFieldSensors}
              collisionDetection={scholarshipPointerCollision}
              onDragStart={(event) => startTrackableDrag(event, 'task')}
              onDragCancel={() => finishScholarshipDragPreview(true)}
              onDragEnd={(event) => {
                const tasks = reorderScholarshipRows(form.tasks, event, taskRowPrefix)
                const reordered = tasks !== form.tasks
                if (reordered) updateForm({ ...form, tasks })
                if (!reordered || scholarshipDragReducedMotionRef.current) finishScholarshipDragPreview(true)
              }}
            >
              <SortableContext items={taskRowIds} strategy={verticalListSortingStrategy}>
                <div className={`scholarship-mini-list${form.tasks.length === 0 ? ' is-empty' : ''}`}>
                  {form.tasks.length === 0 ? (
                    <p className="scholarship-mini-empty">{tx('dossier.scholarshipNoTasks')}</p>
                  ) : (
                    form.tasks.map((task) => {
                      const currentTaskStatus = checklistTaskStatus(task)
                      return (
                      <SortableScholarshipRow
                        key={`${taskRowPrefix}${task.id}`}
                        id={`${taskRowPrefix}${task.id}`}
                        className="task-row"
                        handleLabel={`${tx('dossier.dragToReorder')}: ${task.title || tx('dossier.taskPlaceholder')}`}
                      >
                        <button
                          type="button"
                          className={`scholarship-check-btn${task.done ? ' on' : ''}`}
                          onClick={() => {
                            const nextDone = !task.done
                            updateForm({
                              ...form,
                              tasks: form.tasks.map((item) =>
                                item.id === task.id ? { ...item, done: nextDone, status: nextDone ? 'Done' : 'Open' } : item,
                              ),
                            })
                          }}
                          aria-pressed={task.done}
                          aria-label={task.done ? tx('dossier.markIncomplete') : tx('dossier.markComplete')}
                        >
                          <AnimatedCheckmark checked={task.done} size={18} />
                        </button>
                        <ScholarshipRowTitleEditor
                          value={task.title}
                          onChange={(title) =>
                            updateForm({
                              ...form,
                              tasks: form.tasks.map((item) => (item.id === task.id ? { ...item, title } : item)),
                            })
                          }
                          placeholder={tx('dossier.taskPlaceholder')}
                          label={`${tx('dossier.edit')}: ${task.title || tx('dossier.taskPlaceholder')}`}
                          completed={task.done}
                        />
                        <div className="scholarship-row-meta task-meta">
                          <label className="scholarship-row-field">
                            <span>{tx('dossier.status')}</span>
                            <Select
                              value={currentTaskStatus}
                              options={taskStatusOptions}
                              onChange={(status) => updateForm({
                                ...form,
                                tasks: form.tasks.map((item) => (item.id === task.id
                                  ? {
                                      ...item,
                                      status,
                                      ...(checklistStatusKey(status) === checklistStatusKey('Done')
                                        ? { done: true }
                                        : checklistStatusKey(status) === checklistStatusKey('Open')
                                          ? { done: false }
                                          : {}),
                                    }
                                  : item)),
                              })}
                              searchable
                              create={scholarshipTaskStatusCreateConfig(form, updateForm, task)}
                              ariaLabel={tx('dossier.status')}
                              size="small"
                            />
                          </label>
                          <label className="scholarship-row-field">
                            <span>{tx('dossier.dueDate')}</span>
                            <DatePicker
                              value={task.due || ''}
                              onChange={(dueDate) =>
                                updateForm({
                                  ...form,
                                  tasks: form.tasks.map((item) =>
                                    item.id === task.id ? { ...item, due: dueDate } : item,
                                  ),
                                })
                              }
                              placeholder={tx('dossier.dueDate')}
                              allowClear
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          className="scholarship-row-remove"
                          onClick={() =>
                            updateForm({
                              ...form,
                              tasks: form.tasks.filter((item) => item.id !== task.id),
                            })
                          }
                          title={tx('dossier.remove')}
                          aria-label={tx('dossier.remove')}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </SortableScholarshipRow>
                      )
                    })
                  )}
                </div>
              </SortableContext>
              <ScholarshipTrackableDragOverlay
                preview={scholarshipDragPreview}
                formKey={formKey}
                kind="task"
                reducedMotion={scholarshipDragReducedMotion}
                dropAnimation={scholarshipDropAnimation}
              />
            </DndContext>
          </section>

          <section className="scholarship-subsection">
            <div className="scholarship-subsection-head">
              <span>
                <Clock size={13} /> {tx('dossier.scholarshipTimeline')}
              </span>
              <button
                type="button"
                className="scholarship-subsection-add"
                onClick={() => addScholarshipTimelineEvent(form, updateForm)}
              >
                <Plus size={12} /> {tx('dossier.addEvent')}
              </button>
            </div>
            <div
              className={`scholarship-mini-list scholarship-timeline-editor-list${form.timeline.length === 0 ? ' is-empty' : ''}`}
              role={form.timeline.length > 0 ? 'list' : undefined}
            >
              {form.timeline.length === 0 ? (
                <p className="scholarship-mini-empty">{tx('dossier.scholarshipNoTimeline')}</p>
              ) : (
                timelineEvents.map((event) => (
                  <ScholarshipTimelineEditorRow
                    key={`${formKey}:timeline:${event.id}`}
                    eventId={event.id}
                    entering={recentScholarshipTimelineEventIdRef.current === event.id}
                    onEntered={() => {
                      if (recentScholarshipTimelineEventIdRef.current === event.id) {
                        recentScholarshipTimelineEventIdRef.current = null
                      }
                    }}
                  >
                    <div className="scholarship-mini-row timeline-row">
                      <label className="scholarship-timeline-field scholarship-timeline-title-field">
                        <span className="scholarship-timeline-field-label">{tx('dossier.eventTitle')}</span>
                        <span className="scholarship-timeline-text-control">
                          <PencilLine size={12} aria-hidden="true" />
                          <input
                            data-timeline-title-input="true"
                            value={event.title}
                            onChange={(inputEvent) =>
                              updateForm({
                                ...form,
                                timeline: form.timeline.map((item) =>
                                  item.id === event.id
                                    ? {
                                        ...item,
                                        title: inputEvent.target.value,
                                      }
                                    : item,
                                ),
                              })
                            }
                            placeholder={tx('dossier.eventTitle')}
                          />
                        </span>
                      </label>
                      <label className="scholarship-timeline-field scholarship-timeline-date-field">
                        <span className="scholarship-timeline-field-label">{tx('dossier.eventDate')}</span>
                        <DatePicker
                          value={event.date || form.endDate}
                          onChange={(eventDate) =>
                            updateForm({
                              ...form,
                              timeline: form.timeline.map((item) =>
                                item.id === event.id ? { ...item, date: eventDate } : item,
                              ),
                            })
                          }
                          placeholder={tx('dossier.eventDate')}
                        />
                      </label>
                      <label className="scholarship-timeline-field scholarship-timeline-note-field">
                        <span className="scholarship-timeline-field-label">{tx('dossier.eventNote')}</span>
                        <span className="scholarship-timeline-text-control">
                          <PencilLine size={12} aria-hidden="true" />
                          <input
                            value={event.note ?? ''}
                            onChange={(inputEvent) =>
                              updateForm({
                                ...form,
                                timeline: form.timeline.map((item) =>
                                  item.id === event.id ? { ...item, note: inputEvent.target.value } : item,
                                ),
                              })
                            }
                            placeholder={tx('dossier.eventNote')}
                          />
                        </span>
                      </label>
                      <button
                        type="button"
                        className="scholarship-row-remove"
                        onClick={() =>
                          updateForm({
                            ...form,
                            timeline: form.timeline.filter((item) => item.id !== event.id),
                          })
                        }
                        title={tx('dossier.remove')}
                        aria-label={tx('dossier.remove')}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </div>
                  </ScholarshipTimelineEditorRow>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    )
  }

  const renderDossierResourceFieldInput = (field: DossierResourceField, updateValue: (value: string) => void) => {
    const href =
      field.type === 'url'
        ? normalizedExternalHref(field.value)
        : field.type === 'email'
          ? mailtoHref(field.value)
          : field.type === 'phone'
            ? phoneHref(field.value)
            : ''

    if (field.type === 'textarea') {
      return (
        <MarkdownTextarea
          value={field.value}
          onChange={(event) => updateValue(event.target.value)}
          placeholder={tx('dossier.resourceValuePlaceholder')}
          rows={4}
        />
      )
    }

    if (field.type === 'date') {
      return (
        <DatePicker value={field.value} onChange={updateValue} placeholder={tx('dossier.resourceDatePlaceholder')} />
      )
    }

    return (
      <div className="resource-value-input-row">
        <input
          type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
          value={field.value}
          onChange={(event) => updateValue(event.target.value)}
          placeholder={tx(`dossier.resourcePlaceholders.${field.type}`, tx('dossier.resourceValuePlaceholder'))}
        />
        {href ? (
          <a
            href={href}
            target={field.type === 'url' ? '_blank' : undefined}
            rel={field.type === 'url' ? 'noopener noreferrer' : undefined}
            className="icon-action resource-field-open"
            title={tx(field.type === 'url' ? 'dossier.openLink' : 'dossier.resourceOpenContact')}
            aria-label={tx(field.type === 'url' ? 'dossier.openLink' : 'dossier.resourceOpenContact')}
          >
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        ) : null}
        {field.value.trim() ? (
          <CopyButton
            value={field.value}
            label={field.label || tx('dossier.resourceFieldUntitled')}
            onNotify={onNotify}
          />
        ) : null}
      </div>
    )
  }

  const renderDossierResourceValueField = (card: DossierResourceCard, field: DossierResourceField) => {
    const tags = field.type === 'tags' ? resourceTags(field.value) : []
    const type = isDossierResourceFieldType(field.type) ? field.type : 'text'
    const width = normalizeDossierResourceFieldWidth(field.width, type)
    return (
      <label key={field.id} className={`resource-value-field type-${field.type} width-${width}`}>
        <span>{localizeDossierResourceFieldLabel(field, tx) || tx('dossier.resourceFieldUntitled')}</span>
        {renderDossierResourceFieldInput(field, (value) => updateDossierResourceField(card.id, field.id, { value }))}
        {tags.length > 0 ? (
          <div className="resource-tag-preview" aria-label={tx('dossier.tags')}>
            {tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
      </label>
    )
  }

  const renderDossierResourceSettingsField = (field: DossierResourceField, index: number, total: number) => {
    const type = isDossierResourceFieldType(field.type) ? field.type : 'text'
    const width = normalizeDossierResourceFieldWidth(field.width, type)
    const widthLocked = type === 'textarea'

    return (
      <SortableResourceFieldRow
        key={field.id}
        id={field.id}
        handleLabel={tx('dossier.dragToReorder')}
        recent={recentDossierResourceFieldId === field.id}
      >
        <div className="resource-design-field-content">
          <div className="resource-design-field-main">
            <label className="resource-field-name-control">
              <span>{tx('dossier.resourceFieldLabelPlaceholder')}</span>
              <input
                className="resource-field-label-input"
                value={field.label}
                onChange={(event) =>
                  updateDossierResourceSettingsField(field.id, {
                    label: event.target.value,
                  })
                }
                placeholder={tx('dossier.resourceFieldLabelPlaceholder')}
                aria-label={tx('dossier.resourceFieldLabelPlaceholder')}
              />
            </label>
            <label className="resource-field-type-control">
              <span>{tx('dossier.resourceFieldType')}</span>
              <Select<DossierResourceFieldType>
                value={type}
                options={dossierResourceFieldTypeOptions}
                onChange={(nextType) =>
                  updateDossierResourceSettingsField(field.id, {
                    type: nextType,
                  })
                }
                ariaLabel={tx('dossier.resourceFieldType')}
                size="small"
              />
            </label>
          </div>

          <div className="resource-design-field-controls">
            {widthLocked ? (
              <div
                className="resource-field-layout-locked"
                aria-label={tx('dossier.resourceLongTextFullWidth')}
                title={tx('dossier.resourceLongTextFullWidth')}
              >
                <LockKeyhole size={12} aria-hidden="true" />
                <span>{tx('dossier.resourceFieldWidths.full')}</span>
                <em>{tx('dossier.resourceLongTextFullWidth')}</em>
              </div>
            ) : (
              <div
                className={`resource-field-layout-toggle is-${width}`}
                role="radiogroup"
                aria-label={tx('dossier.resourceFieldLayout')}
              >
                {dossierResourceFieldWidths.map((preset) => {
                  const Icon = preset === 'half' ? Columns2 : Rows2
                  return (
                    <button
                      key={preset}
                      type="button"
                      className={width === preset ? 'active' : ''}
                      onClick={() =>
                        updateDossierResourceSettingsField(field.id, {
                          width: preset,
                        })
                      }
                      role="radio"
                      aria-checked={width === preset}
                      title={tx(`dossier.resourceFieldWidths.${preset}`)}
                    >
                      <Icon size={13} aria-hidden="true" />
                      <span>{tx(`dossier.resourceFieldWidths.${preset}`)}</span>
                    </button>
                  )
                })}
              </div>
            )}

            <div className="resource-field-row-actions">
              <div className="resource-field-order-actions">
                <button
                  type="button"
                  onClick={() => moveDossierResourceSettingsField(field.id, -1)}
                  disabled={index === 0}
                  title={tx('dossier.resourceMoveFieldUp')}
                  aria-label={tx('dossier.resourceMoveFieldUp')}
                >
                  <ArrowUp size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => moveDossierResourceSettingsField(field.id, 1)}
                  disabled={index === total - 1}
                  title={tx('dossier.resourceMoveFieldDown')}
                  aria-label={tx('dossier.resourceMoveFieldDown')}
                >
                  <ArrowDown size={13} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                className="resource-mini-btn resource-delete-btn"
                onClick={() => removeDossierResourceSettingsField(field.id)}
                title={tx('dossier.remove')}
                aria-label={tx('dossier.remove')}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </SortableResourceFieldRow>
    )
  }

  const renderDossierResourceCard = (card: DossierResourceCard) => {
    const Icon = dossierResourceIconMap[card.icon] ?? Link
    const isExpanded = expandedDossierResourceCards.has(card.id)
    const isEditingSettings = editingDossierResourceCardId === card.id && dossierResourceSettingsDraft !== null
    const settingsDraft = isEditingSettings ? dossierResourceSettingsDraft : null
    const isNew = recentDossierResourceCardId === card.id
    const color = normalizeDossierResourceColor(card.color)
    const width = normalizeDossierResourceCardWidth(settingsDraft?.width ?? card.width)
    const fields = Array.isArray(card.fields) ? card.fields : []
    const previews = fields
      .map((field) => ({
        id: field.id,
        label: localizeDossierResourceFieldLabel(field, tx) || tx('dossier.resourceFieldUntitled'),
        value: localize(resourceFieldSummary(field)),
      }))
      .filter((preview) => preview.value)
      .slice(0, 2)
    const cardIndex = dossierResourceCards.findIndex((item) => item.id === card.id)
    const canMoveUp = cardIndex > 0
    const canMoveDown = cardIndex >= 0 && cardIndex < dossierResourceCards.length - 1
    const iconQuery = dossierResourceIconSearch.trim().toLocaleLowerCase()
    const SettingsIcon = settingsDraft ? (dossierResourceIconMap[settingsDraft.icon] ?? Link) : Link
    const selectedIconPreset = settingsDraft
      ? dossierResourceIconPresets.find((preset) => preset.id === settingsDraft.icon)
      : null
    const selectedIconLabel = selectedIconPreset
      ? tx(selectedIconPreset.labelKey, selectedIconPreset.label)
      : tx('dossier.resourceIcon')
    const selectedColorPreset = settingsDraft
      ? dossierResourceColors.find((preset) => preset.value === settingsDraft.color)
      : null
    const selectedColorLabel = selectedColorPreset ? tx(selectedColorPreset.labelKey) : tx('dossier.resourceColor')
    const handleResourceCardToggle = () => {
      if (isEditingSettings) {
        requestCloseDossierResourceSettings()
        return
      }
      toggleDossierResourceCard(card.id)
    }

    return (
      <div
        key={card.id}
        data-resource-card-id={card.id}
        data-resource-layout-key={`card-${card.id}`}
        className={`resource-card width-${width} tone-${color} ${isExpanded ? 'expanded' : ''} ${isEditingSettings ? 'editing-settings' : ''} ${isNew ? 'resource-card-new' : ''} ${dossierResourceDrag?.id === card.id ? 'dragging' : ''} ${dossierResourceDropTarget?.id === card.id ? `drop-target drop-${dossierResourceDropTarget.position}` : ''}`}
        style={{
          '--resource-card-order': `${Math.max(cardIndex, 0) * 2}`,
            ...(dossierResourceDragStyle(card.id) ?? {}),
          } as CSSProperties
        }
      >
        <div
          className="resource-card-summary"
          role="button"
          tabIndex={0}
          onClick={handleResourceCardToggle}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              handleResourceCardToggle()
            }
          }}
          aria-expanded={isExpanded}
        >
          <button
            type="button"
            className="resource-drag-handle"
            onPointerDown={(event) => startDossierResourceDrag(event, card.id)}
            onClick={(event) => event.stopPropagation()}
            title={tx('dossier.dragToReorder')}
            aria-label={tx('dossier.dragToReorder')}
          >
            <GripVertical size={14} aria-hidden="true" />
          </button>
          <div className="resource-card-icon" aria-hidden="true">
            <Icon size={17} />
          </div>
          <div className="resource-card-copy">
            <div className="resource-card-title-line">
              <strong>{localizeDossierResourceCardTitle(card, tx) || tx('dossier.resourceUntitledCard')}</strong>
              <span className="resource-card-field-count">
                {format(tx('dossier.resourceFieldCount'), {
                  count: fields.length,
                })}
              </span>
            </div>
          </div>
          {!isExpanded && !isEditingSettings && previews.length > 0 ? (
            <div className="resource-card-preview-grid">
              {previews.map((preview) => (
                <span key={preview.id} className="resource-card-preview-item">
                  <span className="resource-card-preview-label">{preview.label}</span>
                  <span className="resource-card-preview-value" title={preview.value}>
                    {preview.value}
                  </span>
                </span>
              ))}
            </div>
          ) : null}
          <div className="resource-card-actions" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="resource-mini-btn"
              onClick={() => moveDossierResourceCard(card.id, -1)}
              disabled={!canMoveUp}
              title={tx('dossier.resourceMoveCardUp')}
              aria-label={tx('dossier.resourceMoveCardUp')}
            >
              <ArrowUp size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="resource-mini-btn"
              onClick={() => moveDossierResourceCard(card.id, 1)}
              disabled={!canMoveDown}
              title={tx('dossier.resourceMoveCardDown')}
              aria-label={tx('dossier.resourceMoveCardDown')}
            >
              <ArrowDown size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`resource-mini-btn ${isEditingSettings ? 'active' : ''}`}
              onClick={() =>
                isEditingSettings ? requestCloseDossierResourceSettings() : startEditingDossierResourceCard(card)
              }
              title={tx('dossier.edit')}
              aria-label={tx('dossier.edit')}
            >
              <Pencil size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="resource-mini-btn resource-delete-btn"
              onClick={() => removeDossierResourceCard(card.id)}
              title={tx('dossier.remove')}
              aria-label={tx('dossier.remove')}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`resource-expand-btn ${isExpanded ? 'open' : ''}`}
              onClick={handleResourceCardToggle}
              aria-label={isExpanded ? tx('dossier.collapse') : tx('dossier.expand')}
              aria-expanded={isExpanded}
            >
              <ChevronDown size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        <CollapsiblePanel
          open={isExpanded || isEditingSettings}
          className="resource-card-detail"
          innerClassName="resource-card-detail-inner"
          keepMounted
        >
          {settingsDraft ? (
            <div className="resource-settings-panel">
              <div className="resource-settings-identity">
                <AnchoredPopover
                  triggerAriaLabel={`${tx('dossier.resourceAppearance')}: ${selectedIconLabel}, ${selectedColorLabel}`}
                  popoverAriaLabel={tx('dossier.resourceAppearance')}
                  triggerClassName={`resource-icon-color-trigger tone-${settingsDraft.color}`}
                  popoverClassName={`resource-appearance-popover resource-combined-appearance-popover tone-${settingsDraft.color}`}
                  width={324}
                  estimatedHeight={490}
                  onOpenChange={(pickerOpen) => {
                    if (!pickerOpen) setDossierResourceIconSearch('')
                  }}
                  trigger={
                    <span className="resource-appearance-trigger-icon" aria-hidden="true">
                      <SettingsIcon size={17} />
                    </span>
                  }
                >
                  {() => (
                    <>
                      <div className="resource-appearance-popover-head">
                        <strong>{tx('dossier.resourceAppearance')}</strong>
                        <span>{tx('dossier.resourceAppearanceHint')}</span>
                      </div>
                      <label className="resource-icon-search">
                        <span className="sr-only">{tx('dossier.resourceIconSearchPlaceholder')}</span>
                        <div>
                          <Search size={13} aria-hidden="true" />
                          <input
                            data-popover-autofocus
                            value={dossierResourceIconSearch}
                            onChange={(event) => setDossierResourceIconSearch(event.target.value)}
                            placeholder={tx('dossier.resourceIconSearchPlaceholder')}
                            aria-label={tx('dossier.resourceIconSearchPlaceholder')}
                          />
                          {dossierResourceIconSearch.trim() ? (
                            <button
                              type="button"
                              className="resource-search-clear"
                              onClick={() => setDossierResourceIconSearch('')}
                              aria-label={tx('datePicker.clear')}
                            >
                              <X size={12} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      </label>
                      <div className="resource-icon-grid">
                        {filteredDossierResourceIconPresets.map((preset) => {
                          const PresetIcon = dossierResourceIconMap[preset.id] ?? Link
                          const label = tx(preset.labelKey, preset.label)
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              className={settingsDraft.icon === preset.id ? 'active' : ''}
                              onClick={() =>
                                updateDossierResourceSettingsDraft((current) => ({
                                  ...current,
                                  icon: preset.id,
                                }))
                              }
                              title={label}
                              aria-label={label}
                              aria-pressed={settingsDraft.icon === preset.id}
                            >
                              <PresetIcon size={16} aria-hidden="true" />
                              {settingsDraft.icon === preset.id ? (
                                <Check size={10} aria-hidden="true" className="resource-icon-selected-check" />
                              ) : null}
                            </button>
                          )
                        })}
                        {filteredDossierResourceIconPresets.length === 0 ? (
                          <p className="resource-inline-empty">
                            {format(tx('dossier.resourceNoIconMatches'), {
                              query: iconQuery,
                            })}
                          </p>
                        ) : null}
                      </div>
                      <div className="resource-combined-color-section">
                        <span className="resource-config-label">{tx('dossier.resourceColor')}</span>
                        <div className="resource-color-grid">
                          {dossierResourceColors.map((preset) => (
                            <button
                              key={preset.value}
                              type="button"
                              className={`tone-${preset.value} ${settingsDraft.color === preset.value ? 'active' : ''}`}
                              onClick={() =>
                                updateDossierResourceSettingsDraft((current) => ({
                                  ...current,
                                  color: preset.value,
                                }))
                              }
                              title={tx(preset.labelKey)}
                              aria-label={tx(preset.labelKey)}
                              aria-pressed={settingsDraft.color === preset.value}
                            >
                              <span aria-hidden="true" />
                              <em>{tx(preset.labelKey)}</em>
                              {settingsDraft.color === preset.value ? <Check size={11} aria-hidden="true" /> : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </AnchoredPopover>

                <label className="resource-settings-title">
                  <span>{tx('dossier.resourceCardTitle')}</span>
                  <input
                    value={settingsDraft.title}
                    onChange={(event) =>
                      updateDossierResourceSettingsDraft((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder={tx('dossier.resourceCardNamePlaceholder')}
                    aria-label={tx('dossier.resourceCardNamePlaceholder')}
                  />
                </label>
                <div className="resource-appearance-control resource-width-control resource-identity-width-control">
                  <span className="resource-config-label">{tx('dossier.resourceCardWidth')}</span>
                  <div
                    className={`resource-segmented is-${normalizeDossierResourceCardWidth(settingsDraft.width)}`}
                    role="radiogroup"
                    aria-label={tx('dossier.resourceCardWidth')}
                  >
                    {dossierResourceCardWidths.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={normalizeDossierResourceCardWidth(settingsDraft.width) === preset ? 'active' : ''}
                        onClick={() =>
                          animateDossierResourceLayout(() =>
                            updateDossierResourceSettingsDraft((current) => ({
                              ...current,
                              width: preset,
                            })),
                          )
                        }
                        aria-checked={normalizeDossierResourceCardWidth(settingsDraft.width) === preset}
                        role="radio"
                      >
                        {tx(`dossier.resourceCardWidths.${preset}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="resource-fields-head">
                <span>{tx('dossier.resourceFields')}</span>
                <span className="resource-count-badge">{settingsDraft.fields.length}</span>
              </div>

              <DndContext
                sensors={dossierResourceFieldSensors}
                collisionDetection={closestCenter}
                onDragEnd={reorderDossierResourceSettingsField}
              >
                <SortableContext
                  items={settingsDraft.fields.map((field) => field.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="resource-design-field-list">
                    {settingsDraft.fields.length > 0 ? (
                      settingsDraft.fields.map((field, index) =>
                        renderDossierResourceSettingsField(field, index, settingsDraft.fields.length),
                      )
                    ) : (
                      <div className="resource-empty-fields">
                        <NotebookTabs size={20} aria-hidden="true" />
                        <span>{tx('dossier.resourceNoFields')}</span>
                      </div>
                    )}
                  </div>
                </SortableContext>
              </DndContext>

              <div className="resource-field-add">
                {dossierResourceFieldTypes.map((type) => (
                  <button key={type} type="button" onClick={() => addDossierResourceSettingsField(type)}>
                    <Plus size={12} aria-hidden="true" />
                    {tx(`dossier.resourceFieldTypes.${type}`)}
                  </button>
                ))}
              </div>

              <div className="resource-settings-footer">
                <p>{tx('dossier.resourceSaveHint')}</p>
                <div className="resource-settings-actions">
                  <button
                    type="button"
                    className="quiet-action compact-action"
                    onClick={() => requestCloseDossierResourceSettings()}
                  >
                    <X size={13} aria-hidden="true" /> {tx('dossier.cancel')}
                  </button>
                  <button
                    type="button"
                    className="primary-action compact-action"
                    onClick={saveDossierResourceCardSettings}
                  >
                    <Save size={13} aria-hidden="true" /> {tx('dossier.save')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="resource-content-panel">
              {fields.length > 0 ? (
                <div className="resource-content-grid">
                  {fields.map((field) => renderDossierResourceValueField(card, field))}
                </div>
              ) : (
                <div className="resource-empty-fields">
                  <NotebookTabs size={20} aria-hidden="true" />
                  <span>{tx('dossier.resourceNoFields')}</span>
                  <button
                    type="button"
                    className="quiet-action compact-action"
                    onClick={() => startEditingDossierResourceCard(card)}
                  >
                    <Pencil size={13} aria-hidden="true" /> {tx('dossier.edit')}
                  </button>
                </div>
              )}
            </div>
          )}
        </CollapsiblePanel>
      </div>
    )
  }

  const renderDossierResourceCardList = () => {
    const renderAddCard = () => (
      <button
        key="resource-add-card"
        type="button"
        className="resource-add-card"
        data-resource-layout-key="add-card"
        style={
          {
            '--resource-card-order': `${dossierResourceCards.length * 2 + 2}`,
          } as CSSProperties
        }
        onClick={addDossierResourceCard}
      >
        <span className="resource-add-card-icon" aria-hidden="true">
          <Plus size={16} />
        </span>
        <strong>{tx('dossier.resourceAddCard')}</strong>
        <em>{tx('dossier.resourceAddCardHint')}</em>
      </button>
    )
    const renderCardWithSlots = (card: DossierResourceCard) => (
      <Fragment key={`resource-card-fragment-${card.id}`}>
        {renderDossierResourceDropSlot(card.id, 'before')}
        {renderDossierResourceCard(card)}
        {renderDossierResourceDropSlot(card.id, 'after')}
      </Fragment>
    )
    const blocks: ReactNode[] = []
    let leftColumn: ReactNode[] = []
    let rightColumn: ReactNode[] = []

    const flushColumns = () => {
      if (leftColumn.length === 0 && rightColumn.length === 0) return
      const left = leftColumn
      const right = rightColumn
      blocks.push(
        <div key={`resource-card-run-${blocks.length}`} className="resource-card-run">
          <div className="resource-card-column">{left}</div>
          <div className="resource-card-column">{right}</div>
        </div>,
      )
      leftColumn = []
      rightColumn = []
    }

    dossierResourceCards.forEach((card) => {
      const previewWidth = editingDossierResourceCardId === card.id ? dossierResourceSettingsDraft?.width : card.width
      if (normalizeDossierResourceCardWidth(previewWidth) === 'full') {
        flushColumns()
        blocks.push(renderCardWithSlots(card))
        return
      }
      if (leftColumn.length <= rightColumn.length) leftColumn.push(renderCardWithSlots(card))
      else rightColumn.push(renderCardWithSlots(card))
    })

    if (leftColumn.length <= rightColumn.length) leftColumn.push(renderAddCard())
    else rightColumn.push(renderAddCard())
    flushColumns()

    return blocks
  }

  const aiAttachmentCandidates = useMemo(
    () => buildDossierAiAttachmentCandidates(application, profileAssets),
    [application, profileAssets],
  )

  const applyAiAttachmentPlan = (selections: AiDraftAttachmentSelection[]) => {
    const candidateById = new Map(aiAttachmentCandidates.map((candidate) => [candidate.id, candidate]))
    const nextSelections = Array.from(
      new Map(selections.map((selection) => [selection.attachmentId, selection])).values(),
    ).flatMap((selection) => {
      const candidate = candidateById.get(selection.attachmentId)
      if (!candidate) return []
      return [
        {
          candidate,
          fileName: selection.fileName.trim() || candidate.name,
        },
      ]
    })
    setEmailAttachments((current) => {
      const manualAttachments = current.filter((attachment) => !attachment.aiCandidateId)
      const manualFileIds = new Set(
        manualAttachments.flatMap((attachment) => (attachment.fileId ? [attachment.fileId] : [])),
      )
      const existingAiByCandidateId = new Map(
        current
          .filter((attachment) => attachment.aiCandidateId)
          .map((attachment) => [attachment.aiCandidateId!, attachment]),
      )
      const plannedAttachments = nextSelections.flatMap(({ candidate, fileName }) => {
        // A user's manually attached copy remains authoritative and is never
        // replaced merely because the model selected the same saved file.
        if (manualFileIds.has(candidate.fileId)) return []
        const existing = existingAiByCandidateId.get(candidate.id)
        if (existing) {
          const assetId = candidate.source === 'profile' ? candidate.sourceId : undefined
          const changed =
            existing.name !== fileName ||
            existing.fileName !== fileName ||
            existing.fileId !== candidate.fileId ||
            existing.fileSize !== candidate.fileSize ||
            existing.mimeType !== candidate.mimeType ||
            existing.assetId !== assetId
          if (!changed) return [existing]
          return [
            {
              ...existing,
              name: fileName,
              fileName,
              fileId: candidate.fileId,
              fileSize: candidate.fileSize,
              mimeType: candidate.mimeType,
              assetId,
              aiCandidateId: candidate.id,
              aiAttachedByTool: true,
              aiMotionRevision: (existing.aiMotionRevision ?? 0) + 1,
              aiMotionKind: 'update' as const,
            },
          ]
        }
        return [
          {
            id: createLocalId('att'),
            name: fileName,
            fileName,
            fileId: candidate.fileId,
            fileSize: candidate.fileSize,
            mimeType: candidate.mimeType,
            assetId: candidate.source === 'profile' ? candidate.sourceId : undefined,
            aiCandidateId: candidate.id,
            aiAttachedByTool: true,
            aiMotionRevision: 1,
            aiMotionKind: 'enter' as const,
          },
        ]
      })
      return [...manualAttachments, ...plannedAttachments]
    })
  }

  const aiInspectorHost = typeof document === 'undefined' ? null : document.getElementById('ai-inspector-host')
  const aiDraftPanel = onAiDraft ? (
    <AiDraftPanel
      open={aiPanelOpen}
      applicationId={application.id}
      aiKeys={aiKeys}
      mode={aiDraftMode}
      replyToId={aiReplyToId}
      currentDraft={{ subject: emailSubject, body: emailBody }}
      draftSessionKey={aiDraftSessionKey}
      onClose={() => setAiPanelOpen(false)}
      onDraft={onAiDraft}
      onDraftChange={({ subject, body }) => {
        if (subject) setEmailSubject(subject)
        if (body !== undefined) setEmailBody(body)
      }}
      onAttachmentPlanChange={applyAiAttachmentPlan}
      onGeneratingChange={handleEmailAiGeneratingChange}
      onDraftRestoreChange={setEmailAiRestoreAnimating}
      onNotify={onNotify}
    />
  ) : null

  // Keep the tab-strip callback identity stable so draft/editor state changes
  // do not make the navigation chrome reconcile again. The ref still points
  // at the latest editor-exit guard and tab direction calculation.
  dossierTabSelectRef.current = (nextTab, markOptimistic) => {
    const direction = directionForTab(nextTab)
    requestLocalEditorExit(() => {
      if (composerOpen) {
        if (!clearEmailComposer()) return
        setComposerOpen(false)
      }
      markOptimistic()
      setTabDirection(direction)
      onTab(nextTab, direction)
    })
  }
  const onDossierTabSelect = useCallback((nextTab: DetailTab, markOptimistic: () => void) => {
    dossierTabSelectRef.current(nextTab, markOptimistic)
  }, [])

  return (
    <section className="dossier-pane content-flow-enter" aria-label={tx('dialog.title')} data-tour="dossier-pane">
      {/* Header */}
      <header className="dossier-header">
        <div className="dossier-header-identity">
          {!isReadOnly && onResolveSchoolLogo && onUploadSchoolLogo && onRemoveSchoolLogo ? (
            <SchoolLogoManager
              schoolName={application.school.name}
              website={draft.school.website}
              logo={application.school.logo}
              autoDetectEnabled={application.school.logoAutoDetect !== false}
              onResolve={onResolveSchoolLogo}
              onUpload={onUploadSchoolLogo}
              onRemove={onRemoveSchoolLogo}
            />
          ) : (
            <SchoolLogoMark schoolName={application.school.name} logo={application.school.logo} variant="header" />
          )}
          <div className="dossier-header-copy">
            <span className="eyebrow">
              {application.program}
              {applicationOwnerName ? (
                <span className="dossier-owner-chip">
                  {format(tx('dossier.byOwner'), {
                    name: applicationOwnerName,
                  })}
                </span>
              ) : null}
            </span>
            <h2>{application.school.name}</h2>
            <p>{application.professor.english}</p>
          </div>
        </div>
        {(!isReadOnly && isOwnApplication) || canShare || canDelete || onCloseApplication ? (
          <div className="dossier-actions">
            {!isReadOnly && isOwnApplication && onEnrich ? (
              <button
                type="button"
                className="quiet-action dossier-enrich-action"
                onClick={onEnrich}
                aria-label={tx('dossier.enrichApplication', 'Enrich application')}
                title={tx('dossier.enrichApplication', 'Enrich application')}
              >
                <Sparkles size={14} /> <span className="dossier-action-label">{tx('dossier.enrichApplication', 'Enrich application')}</span>
              </button>
            ) : null}
            {canShare ? (
              <button
                type="button"
                className="quiet-action dossier-share-action"
                onClick={() => onShare()}
                aria-label={tx('dossier.share')}
                title={tx('dossier.share')}
              >
                <Link size={14} /> <span className="dossier-action-label">{tx('dossier.share')}</span>
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                className="danger-action dossier-delete-action"
                onClick={onDelete}
                aria-label={tx('dossier.delete')}
                title={tx('dossier.delete')}
              >
                <Trash2 size={14} /> <span className="dossier-action-label">{tx('dossier.delete')}</span>
              </button>
            ) : null}
            {onCloseApplication ? (
              <button
                type="button"
                className="icon-action dossier-close-application"
                onClick={onCloseApplication}
                aria-label={tx('dossier.closeApplication')}
                title={tx('dossier.closeApplication')}
              >
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {isReadOnly ? (
        <div className="dossier-readonly-banner" role="status">
          <Eye size={14} aria-hidden="true" /> {readOnlyBanner ?? tx('dossier.readOnlyBanner')}
        </div>
      ) : null}

      {shouldShowTeamVisibility ? (
        <section
          className={`dossier-team-visibility ${pendingTeamTransfer ? 'is-pending' : isTeamVisible ? 'is-visible' : 'is-private'}`}
          aria-label={tx('dossier.teamVisibilityTitle')}
        >
          <span className="dossier-team-visibility-icon" aria-hidden="true">
            <UsersRound size={15} />
          </span>
          <span>
            <strong>{teamVisibilityTitle}</strong>
            <em>{teamVisibilityDesc}</em>
          </span>
          {canManageTeamVisibility && onToggleTeamVisibility ? (
            <button
              type="button"
              className={isTeamVisible ? 'quiet-action compact-action' : 'primary-action compact-action'}
              disabled={saving || isDirty || Boolean(pendingTeamTransfer && !isDirectManagedTransfer)}
              onClick={() => setTeamTransferDirection(isTeamVisible ? 'leave' : 'join')}
              title={isDirty ? tx('dossier.teamVisibilitySaveFirst') : undefined}
            >
              {isDirectManagedTransfer && isTeamVisible
                ? tx('dossier.teamVisibilityMoveToPersonal')
                : pendingTeamTransfer
                  ? tx('dossier.teamVisibilityPending')
                  : isTeamVisible
                    ? tx('dossier.teamVisibilityMakePrivate')
                    : tx('dossier.teamVisibilityShare')}
            </button>
          ) : (
            <small>{tx('dossier.teamVisibilityReadOnly')}</small>
          )}
          {canManageTeamVisibility && isDirty ? <p>{tx('dossier.teamVisibilitySaveFirst')}</p> : null}
        </section>
      ) : null}

      {teamTransferDirection && onPreflightTeamTransfer && onToggleTeamVisibility ? (
        <ApplicationTransferDialog
          open
          application={application}
          direction={teamTransferDirection}
          approvalRequired={teamTransferRequiresApproval}
          organizations={teamTransferOrganizations}
          onPreflight={(teamId) => onPreflightTeamTransfer(teamTransferDirection === 'join', teamId)}
          onSubmit={(teamId) => onToggleTeamVisibility(teamTransferDirection === 'join', teamId)}
          onClose={() => setTeamTransferDirection(null)}
        />
      ) : null}

      {/* Tab strip */}
      <DossierTabStrip
        detailTabs={detailTabs}
        tab={tab}
        tabStripRef={tabStripRef}
        setTabButtonRef={setDossierTabButtonRef}
        tx={tx}
        onSelect={onDossierTabSelect}
      />

      <div
        key={renderedTab}
        className={`dossier-content dossier-tab-panel ${tabDirection === 'forward' ? 'from-next' : 'from-prev'}`}
        data-dossier-tab={renderedTab}
        data-tab-pending={tab !== renderedTab ? 'true' : undefined}
      >
        {/* Read-only uses a class + commitDraft guard so downloads/copy still work (fieldset[disabled] would block them). */}
        <fieldset className={`dossier-fieldset${isReadOnly ? ' is-readonly' : ''}`}>
          {/* ================================================================
             DOSSIER — Comprehensive Summary
             ================================================================ */}
          {renderedTab === 'dossier' && (
            <div className="dossier-summary">
              <div className="summary-stat-bar" data-tour="dossier-summary">
                <div className="summary-stat">
                  <span className="eyebrow">{tx('dossier.deadline')}</span>
                  <strong
                    style={{
                      color:
                        urgency === 'urgent'
                          ? 'var(--danger)'
                          : urgency === 'warning'
                            ? 'var(--warning)'
                            : 'var(--text)',
                    }}
                  >
                    {formatDate(draft.deadline, lang)}
                  </strong>
                  <small>
                    {!draft.deadline
                      ? '—'
                      : due === 0
                        ? tx('dossier.today')
                        : due > 0
                          ? format(tx('dossier.daysLeft'), { count: due })
                          : format(tx('dossier.daysPast'), {
                              count: Math.abs(due),
                            })}
                  </small>
                </div>
                <div className="summary-stat">
                  <span className="eyebrow">{tx('dossier.status')}</span>
                  <StatusPill status={draft.status} />
                </div>
                <div className="summary-stat">
                  <span className="eyebrow">{tx('dossier.priority')}</span>
                  <div className="summary-priority-bar">
                    <div className={`summary-priority-fill ${priorityLevelTone}`} />
                    <strong>{tx(`settings.${priorityLevel.key}`)}</strong>
                  </div>
                </div>
                <div className="summary-stat">
                  <span className="eyebrow">{tx('dossier.progress')}</span>
                  <strong>{draft.progress}%</strong>
                </div>
              </div>

              <div className="dossier-cards">
                <section className="section-card dossier-core-card expanded" data-tour="dossier-fields">
                  {renderDossierCoreSummary(Building2, tx('dossier.school'))}
                  <CollapsiblePanel
                    open
                    className="dossier-core-collapse"
                    innerClassName="dossier-core-collapse-inner"
                    keepMounted
                  >
                    <div className="field-stack">
                      <label>
                        <span>
                          {tx('dossier.schoolName')} <span className="field-required-mark">*</span>
                        </span>
                        <div className="input-with-copy">
                          <input
                            required
                            value={draft.school.name}
                            onChange={(e) =>
                              commitDraft({
                                ...draftRef.current,
                                school: {
                                  ...draftRef.current.school,
                                  name: e.target.value,
                                },
                              })
                            }
                          />
                          <CopyButton
                            value={draft.school.name}
                            label={tx('inspector.copySchool')}
                            className="copy-inside"
                            onNotify={onNotify}
                          />
                        </div>
                      </label>
                      <label>
                        <span>
                          {tx('dossier.program')} <span className="field-required-mark">*</span>
                        </span>
                        <div className="input-with-copy">
                          <input
                            required
                            value={draft.program}
                            onChange={(e) =>
                              commitDraft({
                                ...draftRef.current,
                                program: e.target.value,
                              })
                            }
                          />
                          <CopyButton
                            value={draft.program}
                            label={tx('inspector.copyProgram')}
                            className="copy-inside"
                            onNotify={onNotify}
                          />
                        </div>
                      </label>
                      <label>
                        <span>{tx('dossier.country')}</span>
                        <CountrySelect
                          value={draft.school.country}
                          onChange={(country) =>
                            commitDraft(
                              {
                                ...draftRef.current,
                                school: { ...draftRef.current.school, country },
                              },
                              'immediate',
                            )
                          }
                          ariaLabel={tx('dossier.country')}
                          placeholder={tx('dossier.countryPlaceholder')}
                        />
                      </label>
                      <label data-field-path="school.website">
                        <span>{tx('dossier.schoolWebsite')}</span>
                        <div className="dossier-link-field">
                          <input
                            inputMode="url"
                            pattern={WEB_ADDRESS_PATTERN}
                            title={tx('dossier.linkFormatHint')}
                            value={draft.school.website}
                            onChange={(e) =>
                              commitDraft({
                                ...draftRef.current,
                                school: {
                                  ...draftRef.current.school,
                                  website: e.target.value,
                                },
                              })
                            }
                          />
                          <DossierExternalLinkAction value={draft.school.website} label={tx('dossier.openLink')} />
                          <CopyButton
                            value={draft.school.website}
                            label={tx('dossier.schoolWebsite')}
                            onNotify={onNotify}
                          />
                        </div>
                      </label>
                    </div>
                  </CollapsiblePanel>
                </section>

                <section className="section-card dossier-core-card expanded">
                  {renderDossierCoreSummary(User, tx('dossier.professor'))}
                  <CollapsiblePanel
                    open
                    className="dossier-core-collapse"
                    innerClassName="dossier-core-collapse-inner"
                    keepMounted
                  >
                    <div className="field-stack">
                      <label>
                        <span>
                          {tx('dossier.professor')} <span className="field-required-mark">*</span>
                        </span>
                        <div className="input-with-copy">
                          <input
                            required
                            value={draft.professor.english}
                            onChange={(e) =>
                              commitDraft({
                                ...draftRef.current,
                                professor: {
                                  ...draftRef.current.professor,
                                  english: e.target.value,
                                },
                              })
                            }
                            placeholder={tx('dossier.professorNamePlaceholder')}
                          />
                          <CopyButton
                            value={draft.professor.english}
                            label={tx('inspector.copyProfessor')}
                            className="copy-inside"
                            onNotify={onNotify}
                          />
                        </div>
                      </label>
                      <label>
                        <span>
                          {tx('dossier.email')} <span className="field-required-mark">*</span>
                        </span>
                        <div className="input-with-copy">
                          <input
                            required
                            type="email"
                            value={draft.professor.email}
                            onChange={(e) =>
                              commitDraft({
                                ...draftRef.current,
                                professor: {
                                  ...draftRef.current.professor,
                                  email: e.target.value,
                                },
                              })
                            }
                          />
                          <CopyButton
                            value={draft.professor.email}
                            label={tx('inspector.copyEmail')}
                            className="copy-inside"
                            onNotify={onNotify}
                          />
                        </div>
                      </label>
                      <div className="field-grid field-grid-pair">
                        <label data-field-path="professor.phone">
                          <span>{tx('dossier.phone')}</span>
                          <div className="input-with-copy">
                            <input
                              value={draft.professor.phone}
                              onChange={(e) =>
                                commitDraft({
                                  ...draftRef.current,
                                  professor: {
                                    ...draftRef.current.professor,
                                    phone: e.target.value,
                                  },
                                })
                              }
                            />
                            <CopyButton
                              value={draft.professor.phone}
                              label={tx('dossier.phone')}
                              className="copy-inside"
                              onNotify={onNotify}
                            />
                          </div>
                        </label>
                        <label data-field-path="professor.social">
                          <span>{tx('dossier.social')}</span>
                          <div className="input-with-copy">
                            <input
                              value={draft.professor.social}
                              onChange={(e) =>
                                commitDraft({
                                  ...draftRef.current,
                                  professor: {
                                    ...draftRef.current.professor,
                                    social: e.target.value,
                                  },
                                })
                              }
                            />
                            <CopyButton
                              value={draft.professor.social}
                              label={tx('dossier.social')}
                              className="copy-inside"
                              onNotify={onNotify}
                            />
                          </div>
                        </label>
                      </div>
                      <label data-field-path="professor.homepage">
                        <span>{tx('dossier.homepage')}</span>
                        <div className="dossier-link-field">
                          <input
                            inputMode="url"
                            pattern={WEB_ADDRESS_PATTERN}
                            title={tx('dossier.linkFormatHint')}
                            value={draft.professor.homepage}
                            onChange={(e) =>
                              commitDraft({
                                ...draftRef.current,
                                professor: {
                                  ...draftRef.current.professor,
                                  homepage: e.target.value,
                                },
                              })
                            }
                          />
                          <DossierExternalLinkAction value={draft.professor.homepage} label={tx('dossier.openLink')} />
                          <CopyButton
                            value={draft.professor.homepage}
                            label={tx('dossier.homepage')}
                            onNotify={onNotify}
                          />
                        </div>
                      </label>
                    </div>
                  </CollapsiblePanel>
                </section>

                {tabContentReady ? (
                  <>
                    <section
                      className={`section-card dossier-core-card expanded${
                        isHeavyContentRevealing ? ' dossier-progressive-entry dossier-progressive-entry-first' : ''
                      }`}
                    >
                      {renderDossierCoreSummary(BookOpen, tx('dossier.research'))}
                      <CollapsiblePanel
                        open
                        className="dossier-core-collapse"
                        innerClassName="dossier-core-collapse-inner"
                        keepMounted
                      >
                        <div className="textarea-field dossier-research-direction-field">
                          <span>
                            {tx('dossier.researchDirection')} <span className="field-required-mark">*</span>
                          </span>
                          <MarkdownTextarea
                            required
                            value={localize(draft.professor.research)}
                            onChange={(e) =>
                              commitDraft({
                                ...draftRef.current,
                                professor: {
                                  ...draftRef.current.professor,
                                  research: e.target.value,
                                },
                              })
                            }
                            rows={3}
                            aria-label={tx('dossier.researchDirection')}
                          />
                        </div>
                        <div className="textarea-field">
                          <span>{tx('dossier.labGroup')}</span>
                          <MarkdownTextarea
                            value={localize(draft.professor.lab)}
                            onChange={(e) =>
                              commitDraft({
                                ...draftRef.current,
                                professor: {
                                  ...draftRef.current.professor,
                                  lab: e.target.value,
                                },
                              })
                            }
                            rows={2}
                            aria-label={tx('dossier.labGroup')}
                          />
                        </div>
                        <div className="field-stack">
                          <label data-field-path="professor.labUrl">
                            <span>{tx('dossier.labLink')}</span>
                            <div className="dossier-link-field">
                              <input
                                type="url"
                                inputMode="url"
                                value={draft.professor.labUrl ?? ''}
                                onChange={(e) =>
                                  commitDraft({
                                    ...draftRef.current,
                                    professor: {
                                      ...draftRef.current.professor,
                                      labUrl: e.target.value,
                                    },
                                  })
                                }
                              />
                              <DossierExternalLinkAction
                                value={draft.professor.labUrl ?? ''}
                                label={tx('dossier.openLink')}
                              />
                              <CopyButton
                                value={draft.professor.labUrl ?? ''}
                                label={tx('dossier.labLink')}
                                onNotify={onNotify}
                              />
                            </div>
                          </label>
                          <label data-field-path="professor.projectUrl">
                            <span>{tx('dossier.projectLink')}</span>
                            <div className="dossier-link-field">
                              <input
                                type="url"
                                inputMode="url"
                                value={draft.professor.projectUrl ?? ''}
                                onChange={(e) =>
                                  commitDraft({
                                    ...draftRef.current,
                                    professor: {
                                      ...draftRef.current.professor,
                                      projectUrl: e.target.value,
                                    },
                                  })
                                }
                              />
                              <DossierExternalLinkAction
                                value={draft.professor.projectUrl ?? ''}
                                label={tx('dossier.openLink')}
                              />
                              <CopyButton
                                value={draft.professor.projectUrl ?? ''}
                                label={tx('dossier.projectLink')}
                                onNotify={onNotify}
                              />
                            </div>
                          </label>
                        </div>
                      </CollapsiblePanel>
                    </section>

                    <section
                      className={`section-card dossier-core-card expanded${
                        isHeavyContentRevealing ? ' dossier-progressive-entry dossier-progressive-entry-second' : ''
                      }`}
                      id="dossier-config-card"
                      data-tour="dossier-config"
                    >
                      {renderDossierCoreSummary(Hash, tx('dossier.config'))}
                      <CollapsiblePanel
                        open
                        className="dossier-core-collapse"
                        innerClassName="dossier-core-collapse-inner"
                        keepMounted
                      >
                        <div className="field-stack">
                          <label>
                            <span>{tx('dossier.deadline')}</span>
                            <DatePicker
                              value={draft.deadline}
                              onChange={(v) => commitDraft({ ...draftRef.current, deadline: v }, 'immediate')}
                              placeholder={tx('dossier.selectDeadline')}
                            />
                          </label>
                          <label>
                            <span>{tx('dossier.status')}</span>
                            <Select
                              value={draft.status}
                              options={applicationStatusOptions}
                              onChange={(value) => commitDraft({ ...draftRef.current, status: value }, 'immediate')}
                              create={applicationStatusCreateConfig}
                              ariaLabel={tx('dossier.status')}
                            />
                          </label>
                          <label>
                            <span>{tx('dossier.priority')}</span>
                            <PrioritySlider
                              value={draft.priority}
                              onChange={(v) => commitDraft({ ...draftRef.current, priority: v }, 'immediate')}
                            />
                          </label>
                          <label>
                            <span>{tx('dossier.tags')}</span>
                            <input
                              value={newTag}
                              onChange={(e) => setNewTag(e.target.value)}
                              placeholder={tx('dossier.addTag')}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newTag.trim()) {
                                  e.preventDefault()
                                  commitDraft(
                                    {
                                      ...draftRef.current,
                                      tags: [...draftRef.current.tags, newTag.trim()],
                                    },
                                    'immediate',
                                  )
                                  setNewTag('')
                                }
                              }}
                            />
                            {draft.tags.length > 0 && (
                              <div className="tag-list">
                                {draft.tags.map((tag) => (
                                  <span key={tag} className="tag-chip">
                                    {localize(tag)}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        commitDraft(
                                          {
                                            ...draftRef.current,
                                            tags: draftRef.current.tags.filter((t) => t !== tag),
                                          },
                                          'immediate',
                                        )
                                      }
                                      aria-label={`${tx('dossier.removeTag')} ${localize(tag)}`}
                                    >
                                      <X size={10} />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </label>
                        </div>
                      </CollapsiblePanel>
                    </section>

                    <div className="dossier-overview-recommender-notes">
                      <section className="section-card dossier-recommender-overview-card">
                        <ApplicationRecommendersPanel
                          id="application-recommenders"
                          recommenders={overviewRecommenders}
                          options={personalRecommenderOptions}
                          disabled={isReadOnly}
                          onAdd={addOverviewRecommender}
                          onUpdate={updateOverviewRecommender}
                          onSave={saveOverviewRecommender}
                          onRemove={removeOverviewRecommender}
                          onRequestClose={requestCloseOverviewRecommender}
                        />
                      </section>

                      <section className="section-card dossier-notes-card">
                        <div className="section-title">
                          <MessageSquare size={15} />
                          <h3>{tx('dossier.notes')}</h3>
                        </div>
                        <MarkdownTextarea
                          className="plain-textarea"
                          value={localize(draft.result)}
                          onChange={(e) =>
                            commitDraft({
                              ...draftRef.current,
                              result: e.target.value,
                            })
                          }
                          placeholder={tx('dossier.notesPlaceholder')}
                        />
                      </section>
                    </div>
                  </>
                ) : (
                  <div className="dossier-secondary-deferred" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </div>

              <section className="resource-panel">
                <div
                  className={`resource-card-list${
                    isHeavyContentRevealing ? ' dossier-progressive-entry dossier-progressive-entry-resource' : ''
                  }`}
                  ref={dossierResourceListRef}
                >
                  {tabContentReady ? (
                    renderDossierResourceCardList()
                  ) : (
                    <div className="resource-card-list-deferred" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* ================================================================
             CHECKLIST — Clean collapsible material checklist
             ================================================================ */}
          {renderedTab === 'materials' && (
            <div className="checklist-page" aria-busy={!tabContentReady || undefined}>
              <div className="checklist-hero">
                <div className="checklist-hero-info">
                  <div className="checklist-hero-title-row">
                    <h3>{tx('dossier.checklistTitle')}</h3>
                    <InfoTooltip
                      className="checklist-hero-help"
                      content={
                        checklistMaterials.length === 0
                          ? tx('dossier.noMaterials')
                          : format(tx('dossier.checklistReminderHint'), {
                              email: notificationTarget,
                            })
                      }
                    />
                  </div>
                  <p>
                    {checklistMaterials.length === 0
                      ? tx('dossier.noMaterials')
                      : format(tx('dossier.checklistReminderHint'), {
                          email: notificationTarget,
                        })}
                  </p>
                </div>
                <div className="checklist-hero-actions">
                  <div
                    className="checklist-progress-ring"
                    role="progressbar"
                    aria-label={tx('dossier.checklistTitle')}
                    aria-valuemin={0}
                    aria-valuemax={Math.max(1, checklistMaterials.length)}
                    aria-valuenow={completedChecklistCount}
                    style={
                      {
                        '--checklist-progress': `${checklistMaterials.length ? (completedChecklistCount / checklistMaterials.length) * 100 : 0}%`,
                      } as CSSProperties
                    }
                  >
                    <svg width="44" height="44" viewBox="0 0 44 44">
                      <circle cx="22" cy="22" r="18" fill="none" stroke="var(--border)" strokeWidth="4" />
                      <circle
                        cx="22"
                        cy="22"
                        r="18"
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray={`${checklistMaterials.length ? (completedChecklistCount / checklistMaterials.length) * 113.1 : 0} 113.1`}
                        transform="rotate(-90 22 22)"
                        style={{
                          transition: 'stroke-dasharray 0.6s var(--ease-out)',
                        }}
                      />
                    </svg>
                    <span>
                      {completedChecklistCount}/{checklistMaterials.length}
                    </span>
                  </div>
                  {(reminderChecklistCount > 0 || reminderFilterActive) && (
                    <ChecklistReminderFilterButton
                      active={reminderFilterActive}
                      count={reminderChecklistCount}
                      label={
                        reminderFilterActive ? tx('dossier.reminderFilterOn', 'Reminders') : tx('dossier.withReminder')
                      }
                      actionLabel={
                        reminderFilterActive
                          ? tx('dossier.reminderFilterClear', 'Show all checklist items')
                          : tx('dossier.reminderFilterApply', 'Show only items with reminders')
                      }
                      onToggle={toggleReminderFilter}
                    />
                  )}
                  <button type="button" className="quiet-action checklist-hero-add-btn" onClick={createChecklistItem}>
                    <Plus size={14} /> <span className="checklist-action-label">{tx('dossier.addChecklistItem')}</span>
                  </button>
                </div>
              </div>

              {checklistUploadOpen
                ? createPortal(
                    <div
                      className={`checklist-upload-layer${checklistUploadExiting ? ' exiting' : ''}`}
                      role="presentation"
                      onMouseDown={(event) => {
                        if (event.target === event.currentTarget && !checklistUploadExiting) closeChecklistUpload()
                      }}
                    >
                      <div
                        ref={checklistUploadDialogRef}
                        className="checklist-upload-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-label={tx('dossier.uploadDialogTitle')}
                      >
                        <div className="checklist-upload-head">
                          <div>
                            <span className="eyebrow">{tx('dossier.attachment')}</span>
                            <h4>{tx('dossier.uploadDialogTitle')}</h4>
                          </div>
                          <button
                            type="button"
                            className="checklist-icon-control"
                            onClick={() => closeChecklistUpload()}
                            aria-label={tx('close')}
                            disabled={checklistUploadExiting}
                          >
                            <X size={14} />
                          </button>
                        </div>

                        <FileDropzone
                          key={
                            checklistUploadTarget
                              ? `${checklistUploadTarget.kind}:${checklistUploadTarget.id}`
                              : 'upload'
                          }
                          className="checklist-upload-dropzone"
                          title={tx('dossier.uploadDropTitle')}
                          hint={tx('dossier.uploadDropHint')}
                          allowedTypes={effectiveUploadAllowedTypes}
                          maxFileSize={MAX_UPLOAD_FILE_SIZE}
                          maxFiles={MAX_UPLOAD_FILES_PER_BATCH}
                          existingFileCount={uploadDraftFiles.length}
                          disabled={uploadSubmitting || checklistUploadExiting}
                          onFiles={addUploadDraftFiles}
                        />

                        <div className="checklist-upload-section">
                          <div className="checklist-upload-section-head">
                            <span>{tx('dossier.allowedFileTypes')}</span>
                            <button
                              type="button"
                              className={`checklist-offset-chip ${uploadAllowedPresetIds.length === 0 && !uploadCustomTypes.trim() ? 'active' : ''}`}
                              onClick={() => {
                                setUploadAllowedPresetIds([])
                                setUploadCustomTypes('')
                                setUploadTypeError('')
                              }}
                            >
                              {tx('dossier.fileTypeAny')}
                            </button>
                          </div>
                          <div className="checklist-menu-chips">
                            {uploadTypePresets.map((preset) => {
                              const title = preset.custom
                                ? tx('dossier.customFileTypesHint')
                                : format(tx('dossier.fileTypePresetHint'), {
                                    types: preset.accept.join(', '),
                                  })
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  className={`checklist-offset-chip ${uploadAllowedPresetIds.includes(preset.id) ? 'active' : ''}`}
                                  onClick={() => toggleUploadPreset(preset.id)}
                                  title={title}
                                >
                                  {tx(preset.labelKey)}
                                </button>
                              )
                            })}
                          </div>
                          <CollapsiblePanel
                            open={uploadCustomTypesOpen}
                            className="checklist-upload-custom-collapse"
                            innerClassName="checklist-upload-custom-inner"
                            keepMounted
                          >
                            <label className="checklist-menu-field">
                              <span>{tx('dossier.customFileTypes')}</span>
                              <input
                                value={uploadCustomTypes}
                                onChange={(event) => setUploadCustomTypes(event.target.value)}
                                placeholder={tx('dossier.customFileTypesPlaceholder')}
                                aria-label={tx('dossier.customFileTypes')}
                              />
                              <small>{tx('dossier.customFileTypesHint')}</small>
                            </label>
                          </CollapsiblePanel>
                          {uploadTypeMessage ? (
                            <small className="checklist-upload-conflict">
                              <AlertCircle size={11} aria-hidden="true" /> {uploadTypeMessage}
                            </small>
                          ) : null}
                        </div>

                        <div className="checklist-upload-section checklist-upload-name-section">
                          <label className="checklist-menu-field">
                            <span>{tx('dossier.uploadBaseName')}</span>
                            <input
                              value={uploadBaseName}
                              onChange={(event) => setUploadBaseName(event.target.value)}
                              placeholder={tx('dossier.uploadBaseNamePlaceholder')}
                              aria-label={tx('dossier.uploadBaseName')}
                            />
                            <small>{tx('dossier.uploadBaseNameHint')}</small>
                          </label>
                        </div>

                        <div className="checklist-upload-section">
                          <label className={`checklist-reservation-toggle ${uploadReservationEnabled ? 'active' : ''}`}>
                            <input
                              type="checkbox"
                              checked={uploadReservationEnabled}
                              disabled={!checklistUploadTarget}
                              onChange={(event) => setUploadReservationEnabled(event.target.checked)}
                            />
                            <span className="checklist-reservation-check" aria-hidden="true">
                              {uploadReservationEnabled ? <CheckCircle2 size={14} /> : <UploadCloud size={13} />}
                            </span>
                            <span>
                              <strong>
                                {tx('dossier.reserveUpload')}
                                <em>
                                  {uploadReservationEnabled
                                    ? tx('dossier.uploadReservationOn')
                                    : tx('dossier.uploadReservationOff')}
                                </em>
                              </strong>
                              <small>
                                {tx(
                                  checklistUploadTarget
                                    ? 'dossier.reserveUploadHint'
                                    : 'dossier.reserveUploadNeedsItem',
                                )}
                              </small>
                            </span>
                          </label>
                        </div>

                        {uploadDraftFiles.length > 0 && (
                          <div className="checklist-upload-file-list">
                            {uploadDraftFiles.map((draftFile, index) => {
                              const usingBaseName = Boolean(uploadBaseName.trim())
                              const finalName =
                                uploadDraftFinalNames[index] ??
                                buildUploadFileName(
                                  draftFile.file,
                                  uploadBaseName,
                                  index,
                                  uploadDraftFiles.length,
                                  draftFile.name,
                                  draftFile.extension,
                                )
                              const hasConflict = duplicateUploadNames.has(normalizeUploadFileName(finalName))
                              return (
                                <div
                                  key={draftFile.id}
                                  className={`checklist-upload-file-row ${usingBaseName ? 'readonly' : ''} ${hasConflict ? 'conflict' : ''}`}
                                >
                                  <span>{index + 1}</span>
                                  <div className="checklist-upload-name-cell">
                                    {usingBaseName ? (
                                      <div className="checklist-upload-name-preview">
                                        <strong>{finalName}</strong>
                                        <small>
                                          {draftFile.file.name} · {formatFileSize(draftFile.file.size)}
                                        </small>
                                      </div>
                                    ) : (
                                      <input
                                        value={draftFile.name}
                                        onChange={(event) =>
                                          setUploadDraftFiles((current) =>
                                            current.map((item) =>
                                              item.id === draftFile.id
                                                ? {
                                                    ...item,
                                                    name: event.target.value,
                                                  }
                                                : item,
                                            ),
                                          )
                                        }
                                        onBlur={() =>
                                          setUploadDraftFiles((current) =>
                                            current.map((item) => {
                                              if (item.id !== draftFile.id) return item
                                              const nextName = buildUploadFileName(
                                                item.file,
                                                '',
                                                0,
                                                1,
                                                item.name,
                                                item.extension,
                                              )
                                              return item.name === nextName ? item : { ...item, name: nextName }
                                            }),
                                          )
                                        }
                                        aria-label={tx('dossier.uploadFileName')}
                                      />
                                    )}
                                    {hasConflict ? (
                                      <small className="checklist-upload-conflict">
                                        <AlertCircle size={11} aria-hidden="true" /> {tx('dossier.duplicateUploadName')}
                                      </small>
                                    ) : null}
                                  </div>
                                  <button
                                    type="button"
                                    className="checklist-icon-control"
                                    onClick={() =>
                                      setUploadDraftFiles((current) =>
                                        current.filter((item) => item.id !== draftFile.id),
                                      )
                                    }
                                    aria-label={tx('dossier.remove')}
                                  >
                                    <X size={13} />
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        <div className="checklist-upload-actions">
                          {checklistUploadTarget && canShare ? (
                            <button
                              type="button"
                              className="quiet-action"
                              onClick={shareChecklistUpload}
                              disabled={checklistUploadExiting || uploadSubmitting}
                            >
                              <ExternalLink size={13} /> {tx('dossier.shareUpload')}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={`primary-action ${hasUploadNameConflict || hasUploadTypeMismatch ? 'blocked' : ''}`}
                            onClick={() => {
                              void submitChecklistUpload()
                            }}
                            disabled={
                              uploadSubmitting ||
                              hasUploadNameConflict ||
                              hasUploadTypeMismatch ||
                              (uploadDraftFiles.length === 0 && !(uploadReservationEnabled && checklistUploadTarget))
                            }
                            aria-disabled={hasUploadNameConflict || hasUploadTypeMismatch}
                            aria-busy={uploadSubmitting || undefined}
                            title={
                              hasUploadNameConflict
                                ? tx('dossier.uploadNameConflict')
                                : hasUploadTypeMismatch
                                  ? uploadTypeMessage
                                  : undefined
                            }
                          >
                            {uploadSubmitting ? (
                              <PendingLabel label={tx('working')} />
                            ) : (
                              <>
                                <UploadCloud size={13} />{' '}
                                {uploadDraftFiles.length > 0 ? tx('dossier.uploadNow') : tx('dossier.saveUploadPlan')}
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>,
                    document.body,
                  )
                : null}

              <div className="checklist-manage-bar" aria-label={tx('dossier.checklistTools')}>
                <div className="checklist-manage-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    value={checklistSearch}
                    onChange={(event) => setChecklistSearch(event.target.value)}
                    placeholder={tx('dossier.searchChecklistPlaceholder')}
                    aria-label={tx('dossier.searchChecklistPlaceholder')}
                  />
                  {checklistSearch.trim() ? (
                    <button
                      type="button"
                      className="checklist-icon-control"
                      onClick={() => setChecklistSearch('')}
                      aria-label={tx('datePicker.clear')}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>

                <button
                  type="button"
                  className={`checklist-mobile-tools-toggle${checklistToolsOpen ? ' open' : ''}`}
                  aria-expanded={checklistToolsOpen}
                  aria-controls="checklist-tool-panel"
                  onClick={() => setChecklistToolsOpen((current) => !current)}
                >
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  <span>{tx('dossier.checklistTools')}</span>
                  {checklistToolFilterCount > 0 ? (
                    <strong className="checklist-mobile-tools-count">{checklistToolFilterCount}</strong>
                  ) : null}
                  <ChevronDown className="checklist-mobile-tools-chevron" size={14} aria-hidden="true" />
                </button>

                <CollapsiblePanel
                  id="checklist-tool-panel"
                  open={!checklistToolsCompact || checklistToolsOpen}
                  className="checklist-tool-collapse"
                  innerClassName="checklist-tool-collapse-inner"
                  openMs={260}
                  closeMs={220}
                  keepMounted
                >
                  <div className="checklist-tool-grid">
                    <div className="checklist-tool-group">
                      <div className="checklist-tool-label">
                        <FileText size={13} aria-hidden="true" />
                        <span>{tx('dossier.materialTools')}</span>
                        <em>
                          {format(tx('dossier.visibleCount'), {
                            visible: tabContentReady ? visibleMaterials.length : checklistMaterials.length,
                            total: checklistMaterials.length,
                          })}
                        </em>
                      </div>
                      <Select<MaterialFilter>
                        value={materialFilter}
                        options={materialFilterOptions}
                        onChange={(value) => {
                          setMaterialFilter(value)
                          if (value === 'with-reminder' || materialFilter === 'with-reminder') {
                            setTaskFilter(
                              value === 'with-reminder'
                                ? 'with-reminder'
                                : taskFilter === 'with-reminder'
                                  ? 'all'
                                  : taskFilter,
                            )
                            setChecklistFilterAnimKey((key) => key + 1)
                          }
                        }}
                        ariaLabel={tx('dossier.materialFilter')}
                        size="small"
                      />
                      <Select
                        value={materialGroupFilter}
                        options={materialGroupOptions}
                        onChange={setMaterialGroupFilter}
                        ariaLabel={tx('dossier.materialGroupFilter')}
                        size="small"
                      />
                      <Select<MaterialSort>
                        value={materialSort}
                        options={materialSortOptions}
                        onChange={setMaterialSort}
                        ariaLabel={tx('dossier.materialSort')}
                        size="small"
                      />
                    </div>

                    <div className="checklist-tool-group">
                      <div className="checklist-tool-label">
                        <CheckCircle2 size={13} aria-hidden="true" />
                        <span>{tx('dossier.taskTools')}</span>
                        <em>
                          {format(tx('dossier.visibleCount'), {
                            visible: tabContentReady ? visibleTasks.length : draft.tasks.length,
                            total: draft.tasks.length,
                          })}
                        </em>
                      </div>
                      <Select<TaskFilter>
                        value={taskFilter}
                        options={taskFilterOptions}
                        onChange={(value) => {
                          setTaskFilter(value)
                          if (value === 'with-reminder' || taskFilter === 'with-reminder') {
                            setMaterialFilter(
                              value === 'with-reminder'
                                ? 'with-reminder'
                                : materialFilter === 'with-reminder'
                                  ? 'all'
                                  : materialFilter,
                            )
                            setChecklistFilterAnimKey((key) => key + 1)
                          }
                        }}
                        ariaLabel={tx('dossier.taskFilter')}
                        size="small"
                      />
                      <Select<TaskSort>
                        value={taskSort}
                        options={taskSortOptions}
                        onChange={setTaskSort}
                        ariaLabel={tx('dossier.taskSort')}
                        size="small"
                      />
                      <InlinePresence
                        present={hasChecklistFilters}
                        className="checklist-clear-filters-presence"
                        parentGap="8px"
                        durationMs={300}
                      >
                        <button
                          type="button"
                          className="quiet-action compact-action"
                          tabIndex={hasChecklistFilters ? 0 : -1}
                          {...(hasChecklistFilters ? {} : { 'aria-hidden': true })}
                          onClick={() => {
                            clearChecklistFilters()
                            if (checklistToolsCompact) setChecklistToolsOpen(false)
                          }}
                        >
                          <X size={13} aria-hidden="true" /> {tx('dossier.clearChecklistFilters')}
                        </button>
                      </InlinePresence>
                    </div>
                  </div>
                </CollapsiblePanel>
              </div>

              <ExplorerSelectionBar
                visible={materialSelection.selectedCount > 1}
                label={format(tx('explorer.selectedCount'), {
                  count: materialSelection.selectedCount,
                })}
                clearLabel={tx('explorer.clearSelection')}
                onClear={materialSelection.clearSelection}
                actions={[
                  {
                    id: 'complete',
                    label: tx('explorer.markComplete'),
                    icon: <CheckCircle2 size={13} aria-hidden="true" />,
                    onClick: () => updateMaterialsStatus(materialSelection.selectedIdList, 'Submitted'),
                  },
                  {
                    id: 'expand',
                    label: tx('explorer.expandSelected'),
                    icon: <ChevronDown size={13} aria-hidden="true" />,
                    onClick: () => setMaterialsExpanded(materialSelection.selectedIdList, true),
                  },
                  {
                    id: 'delete',
                    label: tx('explorer.deleteSelected'),
                    icon: <Trash2 size={13} aria-hidden="true" />,
                    tone: 'danger',
                    onClick: () => removeMaterials(materialSelection.selectedIdList),
                  },
                ]}
              />

              {tabContentReady && checklistMaterials.length > 0 && visibleMaterials.length === 0 ? (
                <div className="checklist-empty compact">
                  <div className="checklist-empty-icon">
                    <Search size={24} />
                  </div>
                  <span>{tx('dossier.noMatchingMaterials')}</span>
                </div>
              ) : null}

              {tabContentReady ? (
                <div
                  className={`checklist-groups${checklistFilterAnimKey > 0 ? ' checklist-filter-animating' : ''}`}
                  key={`checklist-materials-${checklistFilterAnimKey}`}
                >
                  {groupedChecklist.map(({ group, items }) => (
                    <div key={group} className="checklist-group">
                      <div
                        className="checklist-group-header"
                        data-checklist-group-header={group}
                      >
                        <span>{groupLabel(group)}</span>
                        <span className="checklist-group-count">{items.length}</span>
                      </div>
                      {items.map((mat, materialIndex) => {
                        const submitted = mat.status === 'Submitted'
                        const isPendingCreate = pendingChecklistCreate?.kind === 'material'
                          && pendingChecklistCreate.id === mat.id
                        const externallyExpanded = expandedMaterials.has(mat.id)
                        const isRemoving = removingMaterialIds.has(mat.id)
                        const materialAttachments = attachmentRows(mat)
                        const materialAttachmentLabel =
                          materialAttachments.length > 1
                            ? format(tx('dossier.attachmentCount'), {
                                count: materialAttachments.length,
                              })
                            : materialAttachments[0]?.file
                        const materialDownloadTarget =
                          materialAttachments.find((row) => row.current) ?? materialAttachments[0]
                        const materialFilterStyle =
                          checklistFilterAnimKey > 0
                            ? ({
                                '--filter-stagger': materialIndex,
                              } as CSSProperties)
                            : undefined

                        return (
                          <ChecklistDisclosureItem
                            key={mat.id}
                            id={`material-${mat.id}`}
                            kind="material"
                            itemId={mat.id}
                            group={group}
                            tour={mat.id === 'tour-cv' ? 'checklist-material' : undefined}
                            externalOpen={externallyExpanded}
                            syncVersion={materialExpansionSyncVersion}
                            className={(isExpanded) =>
                              `checklist-item ${submitted ? 'done' : ''} ${isExpanded ? 'expanded' : ''} ${isRemoving ? 'is-removing' : ''} ${isPendingCreate ? 'is-pending-create' : ''} ${materialSelection.selectedCount > 1 && materialSelection.selectedIds.has(mat.id) ? 'explorer-selected' : ''} ${recentChecklistItem?.kind === 'material' && recentChecklistItem.id === mat.id ? 'checklist-item-new' : ''} ${materialGroupArrivalIds.has(mat.id) ? 'checklist-item-group-arrival' : ''} ${checklistFilterAnimKey > 0 ? 'checklist-filter-enter' : ''}`
                            }
                            style={materialFilterStyle}
                            ariaSelected={materialSelection.selectedIds.has(mat.id)}
                            onContextMenu={(event) => openMaterialContextMenu(event, mat)}
                            onOpenChange={(open) => {
                              if (!open && materialVisualGroupPins[mat.id]) releaseMaterialGroupPin(mat.id)
                            }}
                          >
                            {(isExpanded, toggleExpanded) => (
                              <>
                                <div className="checklist-item-main">
                                  <button
                                    type="button"
                                    className={`checklist-drag-handle ${materialSort !== 'manual' || isPendingCreate ? 'disabled' : ''}`}
                                    onClick={(event) => event.stopPropagation()}
                                    onPointerDown={(event) => {
                                      if (!isPendingCreate) startChecklistDrag(event, 'material', mat.id)
                                    }}
                                    title={
                                      materialSort === 'manual'
                                        ? tx('dossier.dragToReorder')
                                        : tx('dossier.reorderDisabledHint')
                                    }
                                    aria-label={
                                      materialSort === 'manual'
                                        ? tx('dossier.dragToReorder')
                                        : tx('dossier.reorderDisabledHint')
                                    }
                                    aria-disabled={materialSort !== 'manual' || isPendingCreate}
                                  >
                                    <GripVertical size={14} aria-hidden="true" />
                                  </button>
                                  <ChecklistCompletionButton
                                    checked={submitted}
                                    uncheckedClassName={
                                      mat.status === 'Missing' || materialPreviousStatuses[mat.id] === 'Missing'
                                        ? 'missing'
                                        : undefined
                                    }
                                    completeLabel={tx('dossier.markComplete')}
                                    incompleteLabel={tx('dossier.markIncomplete')}
                                    onChange={(nextSubmitted) => toggleMaterialCompletion(mat, nextSubmitted)}
                                  />
                                  <div
                                    className="checklist-item-body"
                                    onClick={(event) => {
                                      if (hasExplorerSelectionModifier(event)) {
                                        event.stopPropagation()
                                        materialSelection.applyGesture(mat.id, event)
                                        return
                                      }
                                      requestChecklistItemToggle('material', mat.id, isExpanded, toggleExpanded)
                                      // A primary tap is an expand/collapse gesture on phones.
                                      // Avoid rerendering the entire dossier solely to maintain
                                      // an invisible single-item Explorer selection there.
                                      if (
                                        materialSelection.selectedCount > 1 ||
                                        !(window.matchMedia?.('(pointer: coarse)').matches ?? false)
                                      ) {
                                        startTransition(() => materialSelection.selectOnly(mat.id))
                                      }
                                    }}
                                  >
                                    <span className="checklist-item-title-wrap">
                                      <input
                                        className="checklist-item-title"
                                        value={localize(mat.name)}
                                        placeholder={tx('dossier.newMaterial')}
                                        onChange={(e) => {
                                          e.stopPropagation()
                                          updateMaterial(mat.id, {
                                            name: e.target.value,
                                          })
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          if (hasExplorerSelectionModifier(e)) materialSelection.applyGesture(mat.id, e)
                                        }}
                                        aria-label={tx('dossier.checklistItemTitle')}
                                      />
                                      <span className="checklist-item-title-visual" aria-hidden="true">
                                        {localize(mat.name)}
                                      </span>
                                    </span>
                                    <div className="checklist-item-chips">
                                      <span className="checklist-type-chip">{materialTypeLabel(mat.type)}</span>
                                      <MaterialPill status={mat.status} />
                                      <span className="checklist-group-chip">
                                        {groupLabel(mat.group || 'Core materials')}
                                      </span>
                                      {mat.reminderEnabled && (
                                        <span className="checklist-file-chip">
                                          <Bell size={10} /> {materialReminderSummary(mat)}
                                        </span>
                                      )}
                                      {materialAttachmentLabel && (
                                        <span className="checklist-file-chip">
                                          <Paperclip size={10} /> {materialAttachmentLabel}
                                        </span>
                                      )}
                                      {mat.uploadReserved && materialAttachments.length === 0 && (
                                        <span className="checklist-file-chip">
                                          <UploadCloud size={10} /> {tx('dossier.uploadReserved')}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="checklist-item-right">
                                    {isPendingCreate ? (
                                      <button
                                        type="button"
                                        className="checklist-mini-btn checklist-create-save"
                                        disabled={savingPendingChecklistCreate || !mat.name.trim()}
                                        aria-busy={savingPendingChecklistCreate || undefined}
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          void savePendingChecklistCreate()
                                        }}
                                        title={tx('dossier.save')}
                                        aria-label={tx('dossier.save')}
                                      >
                                        <Save size={13} aria-hidden="true" />
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="checklist-mini-btn"
                                      disabled={isPendingCreate}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        requestChecklistUpload({
                                          kind: 'material',
                                          id: mat.id,
                                        })
                                      }}
                                      title={tx('dossier.uploadAttachment')}
                                    >
                                      <UploadCloud size={13} />
                                    </button>
                                    {materialDownloadTarget?.fileId && onPreview && (
                                      <button
                                        type="button"
                                        className="checklist-mini-btn"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setAttachmentPreview({
                                            fileId: materialDownloadTarget.fileId!,
                                            fileName: materialDownloadTarget.file || mat.name,
                                            mimeType: materialDownloadTarget.mimeType,
                                          })
                                        }}
                                        title={tx('filePreview.preview')}
                                        aria-label={tx('filePreview.preview')}
                                      >
                                        <Eye size={13} />
                                      </button>
                                    )}
                                    {materialDownloadTarget?.fileId && (
                                      <button
                                        type="button"
                                        className="checklist-mini-btn"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          onDownload(
                                            materialDownloadTarget.fileId,
                                            materialDownloadTarget.file || mat.name,
                                          )
                                        }}
                                        title={tx('dossier.download')}
                                      >
                                        <Download size={13} />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="checklist-mini-btn checklist-delete-btn"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        removeMaterials([mat.id])
                                      }}
                                      title={tx('dossier.remove')}
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      className={`checklist-expand-btn ${isExpanded ? 'open' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        requestChecklistItemToggle('material', mat.id, isExpanded, toggleExpanded)
                                      }}
                                      aria-label={isExpanded ? tx('dossier.collapse') : tx('dossier.expand')}
                                      aria-expanded={isExpanded}
                                    >
                                      <span className="checklist-expand-glyph" aria-hidden="true">
                                        <ChevronDown size={15} />
                                      </span>
                                    </button>
                                  </div>
                                </div>
                                <CollapsiblePanel
                                  open={isExpanded}
                                  className="checklist-item-detail"
                                  innerClassName="checklist-item-detail-inner"
                                >
                                  <div className="checklist-detail-grid checklist-material-fields">
                                    <label>
                                      <span>{tx('dossier.materialType')}</span>
                                      <Select
                                        value={mat.type}
                                        options={materialTypeOptions}
                                        onChange={(value) =>
                                          updateMaterial(mat.id, {
                                            type: value,
                                          })
                                        }
                                        searchable
                                        create={materialTaxonomyCreateConfig('type', mat, isExpanded)}
                                        ariaLabel={tx('dossier.materialType')}
                                        size="small"
                                      />
                                    </label>
                                    <label>
                                      <span>{tx('dossier.group')}</span>
                                      <Select
                                        value={mat.group || 'Core materials'}
                                        options={checklistGroupOptions}
                                        onChange={(value) => changeMaterialGroup(mat, value, isExpanded)}
                                        searchable
                                        create={materialTaxonomyCreateConfig('group', mat, isExpanded)}
                                        ariaLabel={tx('dossier.group')}
                                        size="small"
                                      />
                                    </label>
                                    <label>
                                      <span>{tx('dossier.status')}</span>
                                      <Select
                                        value={mat.status}
                                        options={materialStatusOptions}
                                        onChange={(value) =>
                                          updateMaterial(mat.id, {
                                            status: value,
                                          })
                                        }
                                        searchable
                                        create={materialTaxonomyCreateConfig('status', mat, isExpanded)}
                                        ariaLabel={tx('dossier.status')}
                                        size="small"
                                      />
                                    </label>
                                  </div>
                                  <div className="checklist-config-row">
                                    {renderMaterialReminderControl(mat)}
                                    {!isPendingCreate ? renderAttachmentControl('material', mat, mat.name) : null}
                                  </div>
                                  {!isPendingCreate ? renderAttachmentTable('material', mat, mat.name) : null}
                                  <div className="checklist-details-field">
                                    <span>{tx('dossier.details')}</span>
                                    <MarkdownTextarea
                                      value={localize(mat.details ?? '')}
                                      onChange={(e) =>
                                        updateMaterial(mat.id, {
                                          details: e.target.value,
                                        })
                                      }
                                      placeholder={tx('dossier.checklistDetailsPlaceholder')}
                                      aria-label={tx('dossier.details')}
                                      rows={3}
                                    />
                                  </div>
                                </CollapsiblePanel>
                              </>
                            )}
                          </ChecklistDisclosureItem>
                        )
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <DossierDeferredRows className="checklist-list-deferred" />
              )}

              {tabContentReady ? (
                <section className="checklist-task-section">
                  <div className="checklist-group-header">
                    <span>{tx('dossier.taskChecklistTitle')}</span>
                    <div className="checklist-header-actions">
                      <span className="checklist-group-count">{draft.tasks.filter((task) => !task.done).length}</span>
                      <button type="button" className="quiet-action compact-action checklist-add-task-btn" onClick={createChecklistTask}>
                        <Plus size={13} /> <span className="checklist-action-label">{tx('dossier.addTask')}</span>
                      </button>
                    </div>
                  </div>

                  <ExplorerSelectionBar
                    visible={taskSelection.selectedCount > 1}
                    label={format(tx('explorer.selectedCount'), {
                      count: taskSelection.selectedCount,
                    })}
                    clearLabel={tx('explorer.clearSelection')}
                    onClear={taskSelection.clearSelection}
                    actions={[
                      {
                        id: 'complete',
                        label: tx('explorer.markComplete'),
                        icon: <CheckCircle2 size={13} aria-hidden="true" />,
                        onClick: () => updateTasksDone(taskSelection.selectedIdList, true),
                      },
                      {
                        id: 'expand',
                        label: tx('explorer.expandSelected'),
                        icon: <ChevronDown size={13} aria-hidden="true" />,
                        onClick: () => setTasksExpanded(taskSelection.selectedIdList, true),
                      },
                      {
                        id: 'delete',
                        label: tx('explorer.deleteSelected'),
                        icon: <Trash2 size={13} aria-hidden="true" />,
                        tone: 'danger',
                        onClick: () => removeTasks(taskSelection.selectedIdList),
                      },
                    ]}
                  />

                  <div
                    className={`checklist-task-list${checklistFilterAnimKey > 0 ? ' checklist-filter-animating' : ''}`}
                    key={`checklist-tasks-${checklistFilterAnimKey}`}
                  >
                    {draft.tasks.length === 0 ? (
                      <div className="checklist-empty compact">
                        <div className="checklist-empty-icon">
                          <CheckCircle2 size={24} />
                        </div>
                        <span>{tx('dossier.noTasksHint')}</span>
                      </div>
                    ) : visibleTasks.length === 0 ? (
                      <div className="checklist-empty compact checklist-filter-enter">
                        <div className="checklist-empty-icon">
                          <Search size={24} />
                        </div>
                        <span>{tx('dossier.noMatchingTasks')}</span>
                      </div>
                    ) : (
                      visibleTasks.map((task, taskIndex) => {
                        const currentTaskStatus = checklistTaskStatus(task)
                        const isPendingCreate = pendingChecklistCreate?.kind === 'task'
                          && pendingChecklistCreate.id === task.id
                        const externallyExpanded = expandedChecklistTasks.has(task.id)
                        const isRemoving = removingTaskIds.has(task.id)
                        const taskAttachments = attachmentRows(task)
                        const taskAttachmentLabel =
                          taskAttachments.length > 1
                            ? format(tx('dossier.attachmentCount'), {
                                count: taskAttachments.length,
                              })
                            : taskAttachments[0]?.file
                        const taskDownloadTarget = taskAttachments.find((row) => row.current) ?? taskAttachments[0]
                        const taskFilterStyle =
                          checklistFilterAnimKey > 0
                            ? ({
                                '--filter-stagger': taskIndex,
                              } as CSSProperties)
                            : undefined
                        return (
                          <ChecklistDisclosureItem
                            key={task.id}
                            id={`task-${task.id}`}
                            kind="task"
                            itemId={task.id}
                            externalOpen={externallyExpanded}
                            syncVersion={taskExpansionSyncVersion}
                            className={(isExpanded) =>
                              `checklist-item checklist-task-item ${task.done ? 'done' : ''} ${isExpanded ? 'expanded' : ''} ${isRemoving ? 'is-removing' : ''} ${isPendingCreate ? 'is-pending-create' : ''} ${taskSelection.selectedCount > 1 && taskSelection.selectedIds.has(task.id) ? 'explorer-selected' : ''} ${recentChecklistItem?.kind === 'task' && recentChecklistItem.id === task.id ? 'checklist-item-new' : ''} ${checklistFilterAnimKey > 0 ? 'checklist-filter-enter' : ''}`
                            }
                            style={taskFilterStyle}
                            ariaSelected={taskSelection.selectedIds.has(task.id)}
                            onContextMenu={(event) => openTaskContextMenu(event, task)}
                          >
                            {(isExpanded, toggleExpanded) => (
                              <>
                                <div
                                  className="checklist-item-main"
                                  data-tour={task.id === 'tour-task-outline' ? 'checklist-task' : undefined}
                                >
                                  <button
                                    type="button"
                                    className={`checklist-drag-handle ${taskSort !== 'manual' || isPendingCreate ? 'disabled' : ''}`}
                                    onClick={(event) => event.stopPropagation()}
                                    onPointerDown={(event) => {
                                      if (!isPendingCreate) startChecklistDrag(event, 'task', task.id)
                                    }}
                                    title={
                                      taskSort === 'manual'
                                        ? tx('dossier.dragToReorder')
                                        : tx('dossier.reorderDisabledHint')
                                    }
                                    aria-label={
                                      taskSort === 'manual'
                                        ? tx('dossier.dragToReorder')
                                        : tx('dossier.reorderDisabledHint')
                                    }
                                    aria-disabled={taskSort !== 'manual' || isPendingCreate}
                                  >
                                    <GripVertical size={14} aria-hidden="true" />
                                  </button>
                                  <ChecklistCompletionButton
                                    checked={task.done}
                                    completeLabel={tx('dossier.markComplete')}
                                    incompleteLabel={tx('dossier.markIncomplete')}
                                    onChange={(nextDone) => {
                                      const nextStatus = nextDone ? 'Done' : 'Open'
                                      if (autoSaveEnabled) {
                                        updateTaskDraft(task.id, { done: nextDone, status: nextStatus }, 'immediate')
                                      } else {
                                        updateTaskDraft(task.id, { done: nextDone, status: nextStatus }, 'external')
                                        if (!isPendingCreate) onToggleTask(task.id, nextDone, nextStatus)
                                      }
                                    }}
                                  />
                                  <div
                                    className="checklist-item-body"
                                    onClick={(event) => {
                                      if (hasExplorerSelectionModifier(event)) {
                                        event.stopPropagation()
                                        taskSelection.applyGesture(task.id, event)
                                        return
                                      }
                                      requestChecklistItemToggle('task', task.id, isExpanded, toggleExpanded)
                                      if (
                                        taskSelection.selectedCount > 1 ||
                                        !(window.matchMedia?.('(pointer: coarse)').matches ?? false)
                                      ) {
                                        startTransition(() => taskSelection.selectOnly(task.id))
                                      }
                                    }}
                                  >
                                    <span className="checklist-item-title-wrap">
                                      <input
                                        className="checklist-item-title"
                                        value={localize(task.title)}
                                        placeholder={tx('dossier.newTask')}
                                        onChange={(e) =>
                                          updateTaskDraft(task.id, {
                                            title: e.target.value,
                                          })
                                        }
                                        onBlur={() => {
                                          if (!autoSaveEnabled && !isPendingCreate)
                                            onUpdateTask?.(task.id, {
                                              title: task.title,
                                            })
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          if (hasExplorerSelectionModifier(e)) taskSelection.applyGesture(task.id, e)
                                        }}
                                        aria-label={tx('dossier.taskPlaceholder')}
                                      />
                                      <span className="checklist-item-title-visual" aria-hidden="true">
                                        {localize(task.title)}
                                      </span>
                                    </span>
                                    <div className="checklist-item-chips">
                                      <span className="checklist-type-chip">{tx('dossier.tasks')}</span>
                                      <span className={`checklist-status-chip status-${statusCssSlug(currentTaskStatus)}`}>
                                        {statusLabel(currentTaskStatus, tx)}
                                      </span>
                                      {task.due ? <span className="checklist-group-chip">{formatDate(task.due, lang)}</span> : null}
                                      {task.reminderEnabled ? (
                                        <span className="checklist-file-chip">
                                          <Bell size={10} /> {taskReminderSummary(task)}
                                        </span>
                                      ) : null}
                                      {taskAttachmentLabel ? (
                                        <span className="checklist-file-chip">
                                          <Paperclip size={10} /> {taskAttachmentLabel}
                                        </span>
                                      ) : null}
                                      {task.attachmentRequired && taskAttachments.length === 0 ? (
                                        <span className="checklist-file-chip">
                                          <Paperclip size={10} /> {tx('dossier.needsAttachment')}
                                        </span>
                                      ) : null}
                                      {task.uploadReserved && taskAttachments.length === 0 ? (
                                        <span className="checklist-file-chip">
                                          <UploadCloud size={10} /> {tx('dossier.uploadReserved')}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="checklist-item-right">
                                    {isPendingCreate ? (
                                      <button
                                        type="button"
                                        className="checklist-mini-btn checklist-create-save"
                                        disabled={savingPendingChecklistCreate || !task.title.trim()}
                                        aria-busy={savingPendingChecklistCreate || undefined}
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          void savePendingChecklistCreate()
                                        }}
                                        title={tx('dossier.save')}
                                        aria-label={tx('dossier.save')}
                                      >
                                        <Save size={13} aria-hidden="true" />
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="checklist-mini-btn"
                                      disabled={isPendingCreate}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        requestChecklistUpload({
                                          kind: 'task',
                                          id: task.id,
                                        })
                                      }}
                                      title={tx('dossier.uploadAttachment')}
                                    >
                                      <UploadCloud size={13} />
                                    </button>
                                    {taskDownloadTarget?.fileId && onPreview && (
                                      <button
                                        type="button"
                                        className="checklist-mini-btn"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setAttachmentPreview({
                                            fileId: taskDownloadTarget.fileId!,
                                            fileName: taskDownloadTarget.file || task.title,
                                            mimeType: taskDownloadTarget.mimeType,
                                          })
                                        }}
                                        title={tx('filePreview.preview')}
                                        aria-label={tx('filePreview.preview')}
                                      >
                                        <Eye size={13} />
                                      </button>
                                    )}
                                    {taskDownloadTarget?.fileId && (
                                      <button
                                        type="button"
                                        className="checklist-mini-btn"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          onDownload(taskDownloadTarget.fileId, taskDownloadTarget.file || task.title)
                                        }}
                                        title={tx('dossier.download')}
                                      >
                                        <Download size={13} />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="checklist-mini-btn checklist-delete-btn"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        removeTasks([task.id])
                                      }}
                                      title={tx('dossier.remove')}
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      className={`checklist-expand-btn ${isExpanded ? 'open' : ''}`}
                                      data-tour={task.id === 'tour-task-outline' ? 'checklist-task-expand' : undefined}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        requestChecklistItemToggle('task', task.id, isExpanded, toggleExpanded)
                                      }}
                                      aria-label={isExpanded ? tx('dossier.collapse') : tx('dossier.expand')}
                                      aria-expanded={isExpanded}
                                    >
                                      <span className="checklist-expand-glyph" aria-hidden="true">
                                        <ChevronDown size={15} />
                                      </span>
                                    </button>
                                  </div>
                                </div>
                                <CollapsiblePanel
                                  open={isExpanded}
                                  className="checklist-item-detail"
                                  innerClassName="checklist-item-detail-inner"
                                >
                                  <div className="checklist-detail-grid">
                                    <label>
                                      <span>{tx('dossier.status')}</span>
                                      <Select
                                        value={currentTaskStatus}
                                        options={taskStatusSelectConfig.options}
                                        onChange={(value) => updateTaskStatus(task.id, value)}
                                        searchable
                                        create={taskStatusSelectConfig.create(task)}
                                        ariaLabel={tx('dossier.status')}
                                        size="small"
                                      />
                                    </label>
                                    <label>
                                      <span>{tx('dossier.dueDate')}</span>
                                      <DatePicker
                                        value={task.due}
                                        onChange={(value) => {
                                          if (autoSaveEnabled) {
                                            updateTaskDraft(task.id, { due: value }, 'immediate')
                                          } else {
                                            updateTaskDraft(task.id, { due: value }, 'external')
                                            if (!isPendingCreate) onUpdateTask?.(task.id, {
                                              due: value,
                                            })
                                          }
                                        }}
                                        placeholder={tx('dossier.dueDate')}
                                        allowClear
                                      />
                                    </label>
                                  </div>
                                  <div className="checklist-config-row">
                                    {renderTaskReminderControl(task)}
                                    {!isPendingCreate ? renderAttachmentControl('task', task, task.title) : null}
                                  </div>
                                  {!isPendingCreate ? renderAttachmentTable('task', task, task.title) : null}
                                  <div className="checklist-details-field">
                                    <span>{tx('dossier.details')}</span>
                                    <MarkdownTextarea
                                      value={localize(task.details ?? '')}
                                      onChange={(e) =>
                                        updateTaskDraft(task.id, {
                                          details: e.target.value,
                                        })
                                      }
                                      onBlur={() => {
                                        if (!autoSaveEnabled && !isPendingCreate)
                                          onUpdateTask?.(task.id, {
                                            details: task.details ?? '',
                                          })
                                      }}
                                      placeholder={tx('dossier.taskDetailsPlaceholder')}
                                      aria-label={tx('dossier.details')}
                                      rows={3}
                                    />
                                  </div>
                                </CollapsiblePanel>
                              </>
                            )}
                          </ChecklistDisclosureItem>
                        )
                      })
                    )}
                  </div>
                </section>
              ) : (
                <section className="checklist-task-section checklist-task-section-deferred" aria-hidden="true">
                  <div className="checklist-group-header">
                    <span>{tx('dossier.taskChecklistTitle')}</span>
                    <span className="checklist-group-count">{draft.tasks.filter((task) => !task.done).length}</span>
                  </div>
                  <div className="checklist-task-list-deferred">
                    <span />
                    <span />
                    <span />
                  </div>
                </section>
              )}

              {checklistMaterials.length === 0 && (
                <div className="checklist-empty">
                  <div className="checklist-empty-icon">
                    <FileText size={28} />
                  </div>
                  <span>{tx('dossier.noMaterials')}</span>
                  <button type="button" className="quiet-action" onClick={createChecklistItem}>
                    <Plus size={14} /> {tx('dossier.addChecklistItem')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ================================================================
             CORRESPONDENCE — 4-mode communication timeline
             ================================================================ */}
          {renderedTab === 'mail' && (
            <div className="correspondence-page" aria-busy={!tabContentReady || undefined}>
              <div className="correspondence-hero">
                <div className="correspondence-hero-info">
                  <span className="eyebrow">{tx('dossier.correspondenceEyebrow')}</span>
                  <div className="correspondence-hero-title-row">
                    <h3>{tx('dossier.tabs.mail')}</h3>
                    <span className="correspondence-hero-count">
                      {format(tx('dossier.correspondenceCountHint'), {
                        count: nonDraftCommunications.length,
                      })}
                    </span>
                  </div>
                  {nonDraftCommunications.length === 0 && (
                    <p>{tx('dossier.noCommunications')}</p>
                  )}
                </div>
              </div>

              <div
                className="correspondence-view-controls"
                data-filter-controls={correspondenceView === 'all' ? 'visible' : 'hidden'}
              >
                {canUseDrafts && (
                  <div
                    ref={correspondenceViewRowRef}
                    className="correspondence-view-row"
                    role="tablist"
                    aria-label={tx('dossier.correspondenceView')}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={correspondenceView === 'all'}
                      className={correspondenceView === 'all' ? 'active' : ''}
                      onClick={() => setCorrespondenceView('all')}
                      ref={(node) => {
                        correspondenceViewButtonRefs.current.all = node
                      }}
                    >
                      <MessageSquare size={13} aria-hidden="true" />
                      <span>{tx('dossier.allCorrespondence')}</span>
                      <em>{nonDraftCommunications.length}</em>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={correspondenceView === 'drafts'}
                      className={correspondenceView === 'drafts' ? 'active' : ''}
                      onClick={() => setCorrespondenceView('drafts')}
                      ref={(node) => {
                        correspondenceViewButtonRefs.current.drafts = node
                      }}
                    >
                      <Archive size={13} aria-hidden="true" />
                      <span>{tx('dossier.draftInbox')}</span>
                      <em>{draftCommunications.length}</em>
                    </button>
                  </div>
                )}
                <InlinePresence
                  as="div"
                  present={correspondenceView === 'all'}
                  className="correspondence-category-filter-presence"
                  durationMs={280}
                  parentGap="12px"
                >
                  <div className="correspondence-category-filter">
                    <Tags size={13} aria-hidden="true" />
                    <Select<CommunicationCategoryFilter>
                      value={communicationCategoryFilters[0] ?? 'all'}
                      options={communicationCategoryFilterOptions}
                      onChange={(value) => setCommunicationCategoryFilters([value])}
                      multiple
                      selectedValues={communicationCategoryFilters}
                      onMultiChange={(values) => {
                        const nextValues = [...new Set(values)]
                        setCommunicationCategoryFilters((currentValues) => {
                          if (!nextValues.includes('all')) {
                            return nextValues.length > 0 ? nextValues : ['all']
                          }
                          // “All” is a toggle in the shared multi-select. If
                          // it was already active, clicking a real category
                          // should leave only that category; if it was not,
                          // clicking “All” should clear the other filters.
                          if (currentValues.includes('all')) {
                            const specificValues = nextValues.filter((value) => value !== 'all')
                            return specificValues.length > 0 ? specificValues : ['all']
                          }
                          return ['all']
                        })
                      }}
                      multipleSelectedLabel={communicationCategoryFilterLabel}
                      ariaLabel={tx('dossier.mailCategoryFilter')}
                      size="small"
                      searchable
                      disabled={correspondenceView !== 'all'}
                      create={mailCategoryCreateConfig}
                    />
                    {onClassifyCommunications && hasClassifiableEmails ? (
                      <button
                        type="button"
                        className="correspondence-ai-all-btn quiet-action"
                        disabled={
                          correspondenceView !== 'all'
                          || isReadOnly
                          || aiKeys.length === 0
                          || allEmailClassificationIds.length === 0
                        }
                        onClick={() => {
                          if (allEmailClassificationIds.length === 0) return
                          void onClassifyCommunications(allEmailClassificationIds)
                        }}
                        title={aiKeys.length === 0 ? tx('dossier.mailClassificationNoKey') : undefined}
                        aria-label={tx('dossier.mailClassificationAiAll')}
                      >
                        {allEmailClassificationPending ? (
                          <LoaderCircle className="spin-icon" size={13} aria-hidden="true" />
                        ) : (
                          <Sparkles size={13} aria-hidden="true" />
                        )}
                        <span>
                          {allEmailClassificationPending
                            ? tx('dossier.mailClassificationAnalyzing')
                            : tx('dossier.mailClassificationAiAll')}
                        </span>
                      </button>
                    ) : null}
                  </div>
                </InlinePresence>
              </div>

              <div className="correspondence-mode-toolbar">
                <div
                  ref={correspondenceModeBarRef}
                  className="correspondence-mode-bar"
                  role="tablist"
                  aria-label={tx('dossier.messageType')}
                  data-tour="correspondence-modes"
                >
                  {[
                    {
                      mode: 'draft-email' as const,
                      icon: PenLine,
                      labelKey: 'dossier.correspondenceModes.draftEmail',
                    },
                    {
                      mode: 'record-email' as const,
                      icon: Mail,
                      labelKey: 'dossier.correspondenceModes.recordEmail',
                    },
                    {
                      mode: 'record-message' as const,
                      icon: MessageCircle,
                      labelKey: 'dossier.correspondenceModes.recordMessage',
                    },
                    {
                      mode: 'note' as const,
                      icon: StickyNote,
                      labelKey: 'dossier.correspondenceModes.note',
                    },
                  ].map(({ mode, icon: ModeIcon, labelKey }) => (
                    <button
                      key={mode}
                      type="button"
                      role="tab"
                      aria-selected={composerOpen && correspondenceMode === mode}
                      aria-expanded={composerOpen && correspondenceMode === mode}
                      data-tour={mode === 'draft-email' ? 'correspondence-draft-mode' : undefined}
                      className={composerOpen && correspondenceMode === mode ? 'active' : ''}
                      onClick={() => openCorrespondenceMode(mode)}
                      ref={(node) => {
                        correspondenceModeButtonRefs.current[mode] = node
                      }}
                    >
                      <ModeIcon size={14} />
                      <span>{tx(labelKey)}</span>
                    </button>
                  ))}
                </div>
                {!isReadOnly ? (
                  <CorrespondenceRecipientSettings
                    emails={trackedRecipientEmails}
                    primaryEmail={draft.professor.email}
                    activeEmail={selectedRecipient}
                    onSelect={setEmailRecipient}
                    onAdd={addTrackedRecipient}
                    onRemove={removeTrackedRecipient}
                  />
                ) : null}
              </div>

              <CollapsiblePanel open={composerOpen} className="correspondence-composer-collapse">
                {/* MODE 1: Draft Email */}
                {correspondenceMode === 'draft-email' && (
                  <div
                    key="draft-email"
                    className={`correspondence-composer composer-mode-panel draft-composer ${aiPanelOpen && !aiInspectorHost ? 'ai-inspector-open' : ''}`}
                  >
                    <div className="composer-head">
                      <div className="composer-title">
                        <PenLine size={15} />
                        <span>{tx('dossier.correspondenceModes.draftEmail')}</span>
                      </div>
                      <div className="composer-head-actions">
                        {onAiDraft ? (
                          <button
                            type="button"
                            className={`composer-ai-trigger ${aiPanelOpen ? 'active' : ''}`}
                            onClick={() => openAiDraft()}
                            aria-expanded={aiPanelOpen}
                            data-tour="composer-ai-trigger"
                            disabled={composerBusy !== null}
                          >
                            <Sparkles size={13} aria-hidden="true" /> {tx('dossier.aiOpen')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="composer-close-btn"
                          onClick={closeComposer}
                          aria-label={tx('dossier.closeComposer')}
                          title={tx('dossier.closeComposer')}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <div className="draft-composer-workspace">
                      <div
                        className="draft-composer-main"
                        aria-busy={composerBusy !== null || emailInsertAnimating || undefined}
                        inert={composerBusy !== null || emailInsertAnimating || undefined}
                      >
                        <div className="composer-delivery-group" role="group" aria-label={tx('dossier.emailRoute')}>
                          <div className="composer-route-info draft-route-info">
                            <div>
                              <span>{tx('dossier.emailFrom')}</span>
                              <strong>{correspondenceFrom || tx('dossier.emailNotConfigured')}</strong>
                            </div>
                            <span className="composer-route-connector" aria-hidden="true">
                              <span className="composer-route-flight">
                                <Mail size={12} strokeWidth={2} />
                              </span>
                            </span>
                            <ComposerRecipientControl
                              value={correspondenceTo}
                              trackedEmails={trackedRecipientEmails}
                              primaryEmail={draft.professor.email}
                              onChange={(recipient) => {
                                setEmailRecipient(recipient)
                                persistEmailComposerRecovery({ recipient })
                              }}
                            />
                          </div>
                          <div className="composer-status-row" aria-label={tx('dossier.emailComposerStatus')}>
                            <span className={`composer-status-chip ${emailSubjectReady ? 'ready' : 'warning'}`}>
                              {emailSubjectReady ? (
                                <CheckCircle2 size={12} aria-hidden="true" />
                              ) : (
                                <Circle size={12} aria-hidden="true" />
                              )}
                              {emailSubjectReady ? tx('dossier.emailSubjectReady') : tx('dossier.emailNeedsSubject')}
                            </span>
                            <span className={`composer-status-chip ${emailBodyReady ? 'ready' : 'warning'}`}>
                              {emailBodyReady ? (
                                <CheckCircle2 size={12} aria-hidden="true" />
                              ) : (
                                <Circle size={12} aria-hidden="true" />
                              )}
                              {emailBodyReady ? tx('dossier.emailBodyReady') : tx('dossier.emailNeedsBody')}
                            </span>
                            <span className={`composer-status-chip ${emailAttachments.length > 0 ? 'ready' : 'muted'}`}>
                              <Paperclip size={12} aria-hidden="true" />
                              {emailAttachments.length > 0
                                ? format(tx('dossier.attachmentCount'), {
                                    count: emailAttachments.length,
                                  })
                                : tx('dossier.emailNoAttachments')}
                            </span>
                          </div>
                        </div>
                        <div className="composer-writing-fields">
                        <div
                          className={`composer-field composer-subject-field ${
                      emailAiGenerating
                        ? 'ai-writing'
                        : emailAiRestoreAnimating
                          ? 'ai-restoring'
                          : emailAiSettling
                            ? 'ai-settling'
                            : ''
                    }`.trim()}
                        >
                          <label>{tx('dossier.emailSubject')}</label>
                          <div className="composer-subject-control">
                            <input
                              value={emailSubject}
                              onChange={(event) => {
                                setEmailSubject(event.target.value)
                                persistEmailComposerRecovery({ subject: event.target.value })
                              }}
                              placeholder={tx('dossier.emailSubjectPlaceholder')}
                              aria-label={tx('dossier.emailSubject')}
                              aria-busy={emailAiGenerating}
                              disabled={composerFieldsDisabled}
                            />
                            <Sparkles className="composer-subject-ai-mark" size={13} aria-hidden="true" />
                          </div>
                        </div>
                        <InlinePresence present={emailAiGenerating} className="composer-ai-writing-slot">
                          <span className="composer-ai-writing-status" role="status" aria-live="polite">
                            <Sparkles size={12} aria-hidden="true" />
                            <span>{tx('dossier.aiDrafting')}</span>
                            <i aria-hidden="true">
                              <i />
                              <i />
                              <i />
                            </i>
                          </span>
                        </InlinePresence>
                        <MarkdownTextarea
                          controllerRef={composerBodyControllerRef}
                          preservePlainLineBreaks
                          className={`composer-body ${
                      emailAiGenerating || emailInsertAnimating
                        ? 'ai-writing'
                        : emailAiRestoreAnimating
                          ? 'ai-restoring'
                          : emailAiSettling
                            ? 'ai-settling'
                            : ''
                    }`.trim()}
                          value={emailBody}
                          onChange={(event) => {
                            if (emailInsertAnimating && !composerControllerWriteRef.current) {
                              clearEmailInsertAnimation()
                            }
                            setEmailBody(event.target.value)
                            persistEmailComposerRecovery({ body: event.target.value })
                          }}
                          placeholder={tx('dossier.emailBodyPlaceholder')}
                          aria-busy={emailAiGenerating || emailInsertAnimating}
                          disabled={composerFieldsDisabled}
                          rows={10}
                        />
                        </div>
                        {replyTargetCommunication ? (
                          <section
                            key={replyTargetCommunication.id}
                            className={`composer-reply-context${replyContextExpanded ? ' expanded' : ''}`}
                            aria-labelledby={`reply-context-subject-${replyTargetCommunication.id}`}
                            data-reply-context-id={replyTargetCommunication.id}
                          >
                            <button
                              type="button"
                              className="composer-reply-context-toggle"
                              aria-expanded={replyContextExpanded}
                              aria-controls={`reply-context-detail-${replyTargetCommunication.id}`}
                              onClick={() => setReplyContextExpanded((current) => !current)}
                            >
                              <UserAvatar
                                avatarUrl={replyTargetAvatarIdentity?.avatarUrl}
                                name={replyTargetAvatarIdentity?.name ?? professorAvatarName}
                                email={replyTargetAvatarIdentity?.email ?? draft.professor.email}
                                className="composer-reply-context-avatar"
                              />
                              <span className="composer-reply-context-copy">
                                <span className="composer-reply-context-meta">
                                  <span className="composer-reply-context-eyebrow">
                                    <Reply size={11} aria-hidden="true" />
                                    {tx('dossier.replyContextEyebrow')}
                                  </span>
                                  <span className="composer-reply-context-professor">
                                    {replyTargetAvatarIdentity?.displayEmail || professorDisplayName}
                                  </span>
                                  <time dateTime={replyTargetTimestamp?.dateTime}>{replyTargetTimestamp?.label}</time>
                                </span>
                                <span className="composer-reply-context-subject-row">
                                  <span>{tx('dossier.replyContextOriginalEmail')}</span>
                                  <strong id={`reply-context-subject-${replyTargetCommunication.id}`}>
                                    {localize(replyTargetCommunication.subject) || tx('dossier.untitledMessage')}
                                  </strong>
                                </span>
                              </span>
                              <ChevronDown className="composer-reply-context-chevron" size={15} aria-hidden="true" />
                            </button>
                            <CollapsiblePanel
                              id={`reply-context-detail-${replyTargetCommunication.id}`}
                              open={replyContextExpanded}
                              className="composer-reply-context-collapse"
                              openMs={320}
                              closeMs={240}
                            >
                              <div className="composer-reply-context-detail">
                                {replyTargetCommunication.from || replyTargetCommunication.to ? (
                                  <p className="composer-reply-context-route">
                                    {replyTargetCommunication.from || tx('dossier.emailNotConfigured')}
                                    <ArrowUpRight size={12} aria-hidden="true" />
                                    {replyTargetCommunication.to || tx('dossier.emailNotConfigured')}
                                  </p>
                                ) : null}
                                <MarkdownContent
                                  value={
                                    replyTargetCommunication.messageType !== 'fetched-email' &&
                                    replyTargetCommunication.bodyHtml
                                      ? replyTargetCommunication.bodyHtml
                                      : localize(replyTargetCommunication.summary)
                                  }
                                  className="composer-reply-context-message"
                                  format={
                                    replyTargetCommunication.messageType === 'fetched-email'
                                      ? 'plain'
                                      : replyTargetCommunication.bodyHtml
                                        ? 'html'
                                        : replyTargetCommunication.bodyFormat
                                  }
                                />
                                {(replyTargetCommunication.attachments ?? []).length > 0 ? (
                                  <div
                                    className="composer-reply-context-attachments"
                                    aria-label={tx('dossier.attachments')}
                                  >
                                    {(replyTargetCommunication.attachments ?? []).map((attachment, index) => (
                                      <span key={attachment.id ?? `${attachment.fileName}-${index}`}>
                                        <Paperclip size={10} aria-hidden="true" />
                                        {attachment.fileName}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </CollapsiblePanel>
                          </section>
                        ) : null}
                        <div className="composer-attachments">
                          <div className="composer-attachment-list">
                            {emailAttachments.map((att) => (
                              <span
                                key={`${att.id}:${att.aiMotionRevision ?? 0}`}
                                className={`tag-chip${att.aiAttachedByTool ? ' ai-tool-attached' : ''}${att.aiMotionKind === 'update' ? ' ai-tool-updated' : ''}`}
                                data-ai-motion={att.aiMotionKind}
                              >
                                <Paperclip size={10} />
                                {renamingAttachmentId === att.id ? (
                                  <input
                                    autoFocus
                                    className="tag-chip-rename-input"
                                    value={renameAttachmentValue}
                                    onChange={(e) => setRenameAttachmentValue(e.target.value)}
                                    onBlur={() => commitRenameAttachment(att.id)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        commitRenameAttachment(att.id)
                                      }
                                      if (e.key === 'Escape') setRenamingAttachmentId(null)
                                    }}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className="tag-chip-name"
                                    onDoubleClick={() => startRenameAttachment(att.id, att.name)}
                                    title={tx('dossier.renameFileHint', 'Double-click to rename')}
                                  >
                                    {att.name}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => removeAttachment(att.id)}
                                  aria-label={tx('dossier.remove')}
                                >
                                  <X size={10} />
                                </button>
                              </span>
                            ))}
                          </div>
                          <FileDropzone
                            className="composer-file-dropzone"
                            compact
                            title={tx('dossier.attachments')}
                            allowedTypes={DEFAULT_UPLOAD_ALLOWED_TYPES}
                            maxFileSize={MAX_UPLOAD_FILE_SIZE}
                            maxFiles={MAX_MAIL_ATTACHMENT_FILES}
                            existingFileCount={localEmailAttachmentCount}
                            onFiles={addEmailAttachmentFiles}
                          />
                          <div className="composer-attachment-actions">
                            <AssetInsertMenu
                              assets={profileAssets}
                              initialSelection={lastInsertSelection ?? undefined}
                              contentLanguages={contentLanguagesFromSettings(session.user.settings)}
                              onInsert={insertAssets}
                            />
                          </div>
                        </div>
                        <div className="composer-actions">
                          {canSendMail ? (
                          <button
                            type="button"
                            className="primary-action composer-action"
                            onClick={handleSendEmail}
                            disabled={!hasComposerContent || composerFieldsDisabled}
                          >
                            <Send size={13} /> {tx('dossier.sendEmailNow')}
                          </button>
                          ) : null}
                          {canUseDrafts ? (
                            <>
                              {canSendMail && emailSubjectReady && !composerFieldsDisabled ? (
                                <AnchoredPopover
                                  trigger={
                                    <>
                                      <Clock size={13} aria-hidden="true" /> {tx('dossier.scheduleSend')}
                                    </>
                                  }
                                  triggerAriaLabel={tx('dossier.scheduleSend')}
                                  popoverAriaLabel={tx('dossier.emailSchedule')}
                                  triggerClassName="quiet-action composer-schedule-trigger composer-action"
                                  popoverClassName="composer-schedule-popover"
                                  width={300}
                                  estimatedHeight={250}
                                  align="end"
                                  onOpenChange={handleSchedulePopoverOpen}
                                >
                                  {(close) => (
                                    <div className="composer-schedule-sheet">
                                      <div className="composer-schedule-head">
                                        <span className="composer-schedule-mark">
                                          <Clock size={14} aria-hidden="true" />
                                        </span>
                                        <span>
                                          <strong>{tx('dossier.scheduleSend')}</strong>
                                          <small>{tx('dossier.scheduleSendHint')}</small>
                                        </span>
                                      </div>
                                      <div className="composer-schedule-fields">
                                        <label>
                                          <span>{tx('dossier.emailScheduleDate')}</span>
                                          <DatePicker
                                            value={scheduledSendDate}
                                            onChange={(date) => {
                                              setScheduledSendDate(date)
                                              persistEmailComposerRecovery({ scheduledDate: date })
                                            }}
                                            timeValue={scheduledSendTime}
                                            onTimeChange={(time) => {
                                              setScheduledSendTime(time)
                                              persistEmailComposerRecovery({ scheduledTime: time })
                                            }}
                                            timeAriaLabel={tx('dossier.messageClock')}
                                            min={today}
                                            placeholder={tx('dossier.emailScheduleDate')}
                                          />
                                        </label>
                                      </div>
                                      <p
                                        className={`composer-schedule-summary${scheduledSendIsFuture ? '' : ' invalid'}`}
                                      >
                                        {scheduledSendIsFuture
                                          ? format(tx('dossier.emailScheduledFor'), {
                                              date: `${formatDate(scheduledSendDate, lang)} ${scheduledSendTime}`,
                                            })
                                          : tx('dossier.scheduleMustBeFuture')}
                                      </p>
                                      <button
                                        type="button"
                                        className="primary-action composer-schedule-confirm"
                                        onClick={() => {
                                          void handleScheduleEmail(close)
                                        }}
                                        disabled={!scheduledSendAt || !scheduledSendIsFuture || composerFieldsDisabled}
                                      >
                                        <Clock size={13} aria-hidden="true" />
                                        {tx('dossier.scheduleSend')}
                                      </button>
                                    </div>
                                  )}
                                </AnchoredPopover>
                              ) : canSendMail ? (
                                <button type="button" className="quiet-action composer-action" disabled>
                                  <Clock size={13} aria-hidden="true" /> {tx('dossier.scheduleSend')}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="quiet-action save-action composer-action"
                                onClick={handleSaveDraft}
                                disabled={!hasComposerContent || composerFieldsDisabled}
                              >
                                <Save size={13} /> {tx('dossier.saveDraft')}
                              </button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="warning-action composer-action" onClick={closeComposer}>
                                <Trash2 size={13} /> {tx('dossier.discardComposer')}
                              </button>
                              <button
                                type="button"
                                className="quiet-action save-action locked-draft-action composer-action"
                                onClick={() => onOpenUpgrade?.('draft-mailbox', 'draft-mailbox', 'free')}
                                aria-label={`${tx('dossier.saveDraft')}: ${tx('apiErrors.PRO_REQUIRED_DRAFTS')}`}
                                title={tx('apiErrors.PRO_REQUIRED_DRAFTS')}
                              >
                                <LockKeyhole size={13} aria-hidden="true" /> {tx('dossier.saveDraft')}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {aiDraftPanel
                        ? aiInspectorHost
                          ? createPortal(aiDraftPanel, aiInspectorHost)
                          : aiDraftPanel
                        : null}
                    </div>
                  </div>
                )}

                {/* MODE 2: Record Email */}
                {correspondenceMode === 'record-email' && (
                  <div key="record-email" className="correspondence-composer composer-mode-panel record-composer">
                    <div className="composer-head">
                      <div className="composer-title">
                        <Mail size={15} />
                        <span>{tx('dossier.correspondenceModes.recordEmail')}</span>
                      </div>
                      <button
                        type="button"
                        className="composer-close-btn"
                        onClick={closeComposer}
                        aria-label={tx('dossier.closeComposer')}
                        title={tx('dossier.closeComposer')}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                    <RecordDirectionToggle
                      value={recordDirection}
                      receivedIcon={Mail}
                      sentLabel={tx('dossier.direction.sent')}
                      receivedLabel={tx('dossier.direction.received')}
                      ariaLabel={tx('dossier.messageType')}
                      onChange={(direction) => applyRecordDirection(direction, 'email')}
                    />
                    <div
                      className={`composer-route-info editable record-route-info ${
                        activeRouteSwap === 'record' ? 'route-swapping' : ''
                      }`}
                    >
                      <label>
                        <span>{tx('dossier.emailFrom')}</span>
                        <input
                          value={recordFromOverride ?? correspondenceFrom}
                          onChange={(e) => setRecordFromOverride(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="route-swap-btn"
                        onClick={swapRecordRoute}
                        aria-label={tx('dossier.swapMailboxes')}
                        title={tx('dossier.swapMailboxes')}
                      >
                        <ArrowRightLeft size={14} aria-hidden="true" />
                      </button>
                      <label>
                        <span>{tx('dossier.emailTo')}</span>
                        <input
                          value={recordToOverride ?? correspondenceTo}
                          onChange={(e) => setRecordToOverride(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="composer-field record-subject-field">
                      <label>{tx('dossier.emailSubject')}</label>
                      <div className="record-subject-control">
                        <input
                          value={emailSubject}
                          onChange={(e) => setEmailSubject(e.target.value)}
                          placeholder={tx('dossier.recordEmailSubjectPlaceholder')}
                          aria-label={tx('dossier.emailSubject')}
                        />
                      </div>
                    </div>
                    <MarkdownTextarea
                      className="composer-body record-body"
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      placeholder={tx('dossier.recordEmailSummaryPlaceholder')}
                      rows={5}
                    />
                    <div className="composer-actions record-composer-actions">
                      <div className="composer-field record-time-field">
                        <label>
                          {tx(recordDirection === 'sent' ? 'dossier.messageSentTime' : 'dossier.messageReceivedTime')}
                        </label>
                        <div className="composer-time-row record-composer-time">
                          <DatePicker
                            value={emailScheduleDate}
                            onChange={setEmailScheduleDate}
                            timeValue={emailScheduleTime}
                            onTimeChange={setEmailScheduleTime}
                            timeAriaLabel={tx('dossier.messageClock')}
                            placeholder={tx('dossier.emailScheduleDate')}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        className="primary-action"
                        onClick={() => {
                          if (!emailSubject.trim() && !emailBody.trim()) return
                          void persistRecordedCommunication(
                            buildCommunicationInput(correspondenceKind, emailSubject, emailBodyForCommunication, {
                              from: recordFromOverride ?? correspondenceFrom,
                              to: recordToOverride ?? correspondenceTo,
                            }),
                          )
                        }}
                      >
                        <Plus size={14} /> {tx('dossier.addCorrespondence')}
                      </button>
                    </div>
                  </div>
                )}

                {/* MODE 3: Record Message */}
                {correspondenceMode === 'record-message' && (
                  <div key="record-message" className="correspondence-composer composer-mode-panel record-composer">
                    <div className="composer-head">
                      <div className="composer-title">
                        <MessageCircle size={15} />
                        <span>{tx('dossier.correspondenceModes.recordMessage')}</span>
                      </div>
                      <button
                        type="button"
                        className="composer-close-btn"
                        onClick={closeComposer}
                        aria-label={tx('dossier.closeComposer')}
                        title={tx('dossier.closeComposer')}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                    <RecordDirectionToggle
                      value={recordDirection}
                      receivedIcon={MessageSquare}
                      sentLabel={tx('dossier.direction.sent')}
                      receivedLabel={tx('dossier.direction.received')}
                      ariaLabel={tx('dossier.messageType')}
                      onChange={(direction) => applyRecordDirection(direction, 'message')}
                    />
                    <div className="composer-field record-subject-field">
                      <label>{tx('dossier.emailSubject')}</label>
                      <div className="record-subject-control">
                        <input
                          value={emailSubject}
                          onChange={(e) => setEmailSubject(e.target.value)}
                          placeholder={tx('dossier.messageSubjectPlaceholder')}
                          aria-label={tx('dossier.emailSubject')}
                        />
                      </div>
                    </div>
                    <MarkdownTextarea
                      className="composer-body record-body"
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      placeholder={tx('dossier.messageSummaryPlaceholder')}
                      rows={5}
                    />
                    <div className="composer-actions record-composer-actions">
                      <div className="composer-field record-time-field">
                        <label>
                          {tx(recordDirection === 'sent' ? 'dossier.messageSentTime' : 'dossier.messageReceivedTime')}
                        </label>
                        <div className="composer-time-row record-composer-time">
                          <DatePicker
                            value={emailScheduleDate}
                            onChange={setEmailScheduleDate}
                            timeValue={emailScheduleTime}
                            onTimeChange={setEmailScheduleTime}
                            timeAriaLabel={tx('dossier.messageClock')}
                            placeholder={tx('dossier.emailScheduleDate')}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        className="primary-action"
                        onClick={() => {
                          if (!emailSubject.trim() && !emailBody.trim()) return
                          void persistRecordedCommunication(
                            buildCommunicationInput(correspondenceKind, emailSubject, emailBodyForCommunication),
                          )
                        }}
                      >
                        <Plus size={14} /> {tx('dossier.addCorrespondence')}
                      </button>
                    </div>
                  </div>
                )}

                {/* MODE 4: Note */}
                {correspondenceMode === 'note' && (
                  <div key="note" className="correspondence-composer composer-mode-panel note-composer">
                    <div className="composer-head">
                      <div className="composer-title">
                        <StickyNote size={15} />
                        <span>{tx('dossier.correspondenceModes.note')}</span>
                      </div>
                      <button
                        type="button"
                        className="composer-close-btn"
                        onClick={closeComposer}
                        aria-label={tx('dossier.closeComposer')}
                        title={tx('dossier.closeComposer')}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                    <MarkdownTextarea
                      className="composer-body note-body"
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      placeholder={tx('dossier.noteContentPlaceholder')}
                      rows={6}
                    />
                    <div className="composer-actions note-composer-actions">
                      <div className="composer-time-row note-composer-time">
                        <DatePicker
                          value={emailScheduleDate}
                          onChange={setEmailScheduleDate}
                          timeValue={emailScheduleTime}
                          onTimeChange={setEmailScheduleTime}
                          timeAriaLabel={tx('dossier.messageClock')}
                          placeholder={tx('dossier.messageTime')}
                        />
                      </div>
                      <button
                        type="button"
                        className="primary-action"
                        onClick={() => {
                          if (!emailBody.trim()) return
                          void persistRecordedCommunication(
                            buildCommunicationInput(
                              'note',
                              formatDate(emailScheduleDate, lang),
                              emailBodyForCommunication,
                            ),
                          )
                        }}
                      >
                        <Plus size={14} /> {tx('dossier.saveNote')}
                      </button>
                    </div>
                  </div>
                )}
              </CollapsiblePanel>

              {pendingRecipientSend ? (
                <RecipientTrackingDialog
                  recipient={normalizeCorrespondenceEmail(pendingRecipientSend.payload.to)}
                  onDecision={handleRecipientTrackingDecision}
                />
              ) : null}

              {pendingComposerExit && (
                <ModalPortal>
                  <div
                    className={`dialog-layer composer-exit-layer${composerExitExiting ? ' exiting' : ''}`}
                    onClick={(event) => {
                      if (event.target === event.currentTarget) requestComposerExitClose()
                    }}
                  >
                    <section
                      ref={composerExitDialogRef}
                      className="composer-exit-dialog"
                      role="alertdialog"
                      aria-modal="true"
                      aria-labelledby="composer-exit-title"
                      aria-describedby="composer-exit-message"
                    >
                      <div className="composer-exit-icon">
                        <AlertCircle size={22} aria-hidden="true" />
                      </div>
                      <div className="composer-exit-copy">
                        <h3 id="composer-exit-title">
                          {tx(
                            correspondenceMode === 'draft-email'
                              ? 'dossier.draftEmailExitTitle'
                              : 'dossier.unsavedComposerTitle',
                          )}
                        </h3>
                        <p id="composer-exit-message">
                          {tx(
                            correspondenceMode === 'draft-email'
                              ? 'dossier.draftEmailExitMessage'
                              : 'dossier.unsavedComposerMessage',
                          )}
                        </p>
                      </div>
                      <div className="composer-exit-actions">
                        {correspondenceMode === 'draft-email' ? (
                          <>
                            <button
                              type="button"
                              className="primary-action"
                              onClick={() =>
                                requestComposerExitClose(() => {
                                  void handlePendingComposerSend()
                                })
                              }
                            >
                              <Send size={14} aria-hidden="true" /> {tx('dossier.sendComposer')}
                            </button>
                            {canUseDrafts && (
                              <button
                                type="button"
                                className="quiet-action"
                                onClick={() =>
                                  requestComposerExitClose(() => {
                                    void handlePendingComposerDraft()
                                  })
                                }
                              >
                                <FileText size={14} aria-hidden="true" /> {tx('dossier.saveDraft')}
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="primary-action save-action"
                              onClick={() =>
                                requestComposerExitClose(() => {
                                  void handlePendingComposerSave()
                                })
                              }
                            >
                              <Save size={14} aria-hidden="true" /> {tx('dossier.saveComposer')}
                            </button>
                            {canUseDrafts && (
                              <button
                                type="button"
                                className="quiet-action"
                                onClick={() =>
                                  requestComposerExitClose(() => {
                                    void handlePendingComposerDraft()
                                  })
                                }
                              >
                                <FileText size={14} aria-hidden="true" /> {tx('dossier.saveAsDraft')}
                              </button>
                            )}
                          </>
                        )}
                        <button
                          type="button"
                          className="warning-action"
                          onClick={() => requestComposerExitClose(handlePendingComposerDiscard)}
                        >
                          <Trash2 size={14} aria-hidden="true" /> {tx('dossier.discardComposer')}
                        </button>
                        <button type="button" className="quiet-action" onClick={() => requestComposerExitClose()}>
                          <X size={14} aria-hidden="true" /> {tx('cancel')}
                        </button>
                      </div>
                    </section>
                  </div>
                </ModalPortal>
              )}

              {/* Communication timeline */}
              <div
                key={correspondenceView}
                className={`correspondence-view-panel ${correspondenceView === 'drafts' ? 'from-next' : 'from-prev'}`}
              >
                {!tabContentReady ? (
                  <DossierDeferredRows className="correspondence-list-deferred" />
                ) : visibleCommunications.length === 0 ? (
                  <div className="correspondence-empty-state">
                    <div className="correspondence-empty-icon">
                      {correspondenceView === 'drafts' ? (
                        <Archive size={28} />
                      ) : hasActiveCommunicationCategoryFilter && nonDraftCommunications.length > 0 ? (
                        <Tags size={28} />
                      ) : (
                        <MessageSquare size={28} />
                      )}
                    </div>
                    <span>
                      {tx(
                        correspondenceView === 'drafts'
                          ? 'dossier.noDrafts'
                          : hasActiveCommunicationCategoryFilter && nonDraftCommunications.length > 0
                            ? 'dossier.noMailCategoryResults'
                            : 'dossier.noCommunications',
                      )}
                    </span>
                    <p>
                      {tx(
                        correspondenceView === 'drafts'
                          ? 'dossier.noDraftsHint'
                          : hasActiveCommunicationCategoryFilter && nonDraftCommunications.length > 0
                            ? 'dossier.noMailCategoryResultsHint'
                            : 'dossier.noCommunicationsHint',
                      )}
                    </p>
                  </div>
                ) : (
                  <>
                    <ExplorerSelectionBar
                      visible={communicationSelection.selectedCount > 1}
                      label={format(tx('explorer.selectedCount'), {
                        count: communicationSelection.selectedCount,
                      })}
                      clearLabel={tx('explorer.clearSelection')}
                      onClear={communicationSelection.clearSelection}
                      actions={[
                        {
                          id: 'classify-ai',
                          label: selectedCommunicationsAreClassifying
                            ? tx('dossier.mailClassificationAnalyzing')
                            : tx('dossier.mailClassificationAiBulk'),
                          icon: selectedCommunicationsAreClassifying ? (
                            <LoaderCircle className="spin-icon" size={13} aria-hidden="true" />
                          ) : (
                            <Sparkles size={13} aria-hidden="true" />
                          ),
                          disabled:
                            isReadOnly ||
                            !onClassifyCommunications ||
                            aiKeys.length === 0 ||
                            !selectedCommunicationsCanClassify,
                          onClick: () => {
                            if (!onClassifyCommunications) return
                            void onClassifyCommunications(communicationSelection.selectedIdList)
                          },
                        },
                        {
                          id: 'delete',
                          label: tx('explorer.deleteSelected'),
                          icon: <Trash2 size={13} aria-hidden="true" />,
                          tone: 'danger',
                          onClick: () => removeCommunications(communicationSelection.selectedIdList),
                        },
                      ]}
                    />
                    <div className="correspondence-timeline">
                      {renderedCommunications.map((item) => {
                        const dir = communicationDirection(item)
                        const timestamp = communicationTimestamp(item, lang)
                        const isNote = item.messageType === 'note' || item.channel === 'Note'
                        const isDraft = item.messageType === 'draft-email'
                        const isImportedEmail = item.messageType === 'fetched-email'
                        const mailSecurity = item.mailSecurity
                        const dangerousMail = mailSecurity?.level === 'danger'
                        const mailCategoryList = effectiveMailCategories(item)
                        const mailCategoryIsManual = hasManualMailCategory(item)
                        const mailClassification = item.mailClassification
                        const mailClassificationPending = classifyingCommunicationIds.has(item.id)
                        const mailClassificationDetails = mailClassification
                          ? format(
                              tx(
                                mailCategoryIsManual
                                  ? 'dossier.mailClassificationManualDetails'
                                  : 'dossier.mailClassificationDetails',
                              ),
                              {
                                category: classificationCategoryLabels(item),
                                confidence: mailConfidencePercent(mailClassification.confidence),
                                summary: mailClassification.summary,
                              },
                            )
                          : ''
                        const isRemoving = removingCommunicationIds.has(item.id)
                        const isEditing = editingCommunicationId === item.id
                        const editDraft =
                          isEditing && communicationEditDraft
                            ? communicationEditDraft
                            : communicationEditDraftFrom(item)
                        const avatarIdentity = correspondenceAvatarIdentity(
                          item,
                          professorAvatarName,
                          draft.professor.email,
                          accountCorrespondenceIdentity,
                        )
                        const senderLabel =
                          dir === 'outgoing'
                            ? tx('dossier.messageSenderMe')
                            : dir === 'incoming'
                              ? avatarIdentity.displayEmail || professorDisplayName
                              : tx('dossier.messageSenderMe')
                        return (
                          <div
                            key={item.id}
                            className={`correspondence-event ${dir} ${isNote ? 'is-note' : ''} ${isDraft ? 'is-draft' : ''} ${isRemoving ? 'is-removing' : ''}`}
                          >
                            <div className="correspondence-event-rail">
                              <span className={`correspondence-event-dot ${dir} ${isNote ? 'note' : ''}`}>
                                <UserAvatar
                                  avatarUrl={avatarIdentity.avatarUrl}
                                  name={avatarIdentity.name}
                                  email={avatarIdentity.email}
                                  className="correspondence-event-avatar"
                                />
                              </span>
                            </div>
                            <article
                              id={`communication-${item.id}`}
                              className={`correspondence-event-card ${isNote ? 'note-card' : ''} ${isDraft ? 'draft-card' : ''} ${isEditing ? 'editing' : ''} ${communicationSelection.selectedCount > 1 && communicationSelection.selectedIds.has(item.id) ? 'explorer-selected' : ''}`}
                              data-tour={item.id === 'tour-comm-1' ? 'communication-card' : undefined}
                              aria-selected={communicationSelection.selectedIds.has(item.id)}
                              aria-busy={mailClassificationPending || undefined}
                              onClick={(event) => {
                                if (isDraft && !hasExplorerSelectionModifier(event)) {
                                  openSavedDraft(item)
                                  return
                                }
                                communicationSelection.applyGesture(item.id, event)
                              }}
                              onContextMenu={(event) => openCommunicationContextMenu(event, item)}
                            >
                              <div className="correspondence-event-head">
                                <span className="correspondence-event-type">
                                  <span className="correspondence-event-sender">{senderLabel}</span>
                                  <span>{correspondenceTypeLabel(item)}</span>
                                  {mailClassificationPending ? (
                                    <span className="correspondence-mail-category tone-neutral category-pending is-pending">
                                      <LoaderCircle className="spin-icon" size={10} aria-hidden="true" />
                                      {tx('dossier.mailClassificationAnalyzing')}
                                    </span>
                                  ) : mailCategoryList.map((categoryId) => (
                                    <span
                                      key={categoryId}
                                      className={`correspondence-mail-category tone-${resolveMailCategoryTone(categoryId, customMailCategories)} category-${mailCategorySlug(categoryId)}${mailCategoryIsManual ? ' is-manual' : ''}`}
                                    >
                                      {resolveMailCategoryLabel(categoryId, customMailCategories, tx)}
                                    </span>
                                  ))}
                                  {mailClassificationDetails ? (
                                    <span
                                      className="correspondence-mail-category-info"
                                      onClick={(event) => event.stopPropagation()}
                                      onPointerDown={(event) => event.stopPropagation()}
                                    >
                                      <InfoTooltip
                                        content={mailClassificationDetails}
                                        label={tx('dossier.mailClassificationInfoLabel')}
                                        className="compact"
                                      />
                                    </span>
                                  ) : null}
                                </span>
                                <time className="correspondence-event-time" dateTime={timestamp.dateTime}>
                                  {timestamp.label}
                                </time>
                              </div>
                              <strong>{localize(item.subject)}</strong>
                              {(item.from || item.to) && !isNote ? (
                                <p className="correspondence-event-route">
                                  {item.from || tx('dossier.emailNotConfigured')} →{' '}
                                  {item.to || tx('dossier.emailNotConfigured')}
                                </p>
                              ) : null}
                              {mailSecurity ? (
                                <div
                                  className={`correspondence-mail-security ${mailSecurity.level}`}
                                  role={dangerousMail ? 'alert' : 'status'}
                                >
                                  <ShieldAlert size={15} aria-hidden="true" />
                                  <span>
                                    <b>
                                      {tx(
                                        dangerousMail
                                          ? 'dossier.mailThreatDangerTitle'
                                          : 'dossier.mailThreatCautionTitle',
                                      )}
                                    </b>
                                    <span>
                                      {tx(
                                        dangerousMail
                                          ? 'dossier.mailThreatDangerMessage'
                                          : 'dossier.mailThreatCautionMessage',
                                      )}
                                    </span>
                                    {mailSecurity.quarantinedAttachmentCount > 0 ? (
                                      <em>
                                        {format(tx('dossier.mailThreatAttachmentsQuarantined'), {
                                          count: mailSecurity.quarantinedAttachmentCount,
                                        })}
                                      </em>
                                    ) : null}
                                  </span>
                                </div>
                              ) : null}
                              <MarkdownContent
                                value={!isImportedEmail && item.bodyHtml ? item.bodyHtml : localize(item.summary)}
                                className="correspondence-event-body"
                                format={isImportedEmail ? 'plain' : item.bodyHtml ? 'html' : item.bodyFormat}
                              />
                              {(item.attachments ?? []).length > 0 ? (
                                <div
                                  className="correspondence-event-attachments"
                                  aria-label={tx('dossier.attachments')}
                                >
                                  {(item.attachments ?? []).map((attachment, index) => (
                                    <span key={attachment.id ?? `${attachment.fileName}-${index}`}>
                                      <Paperclip size={10} aria-hidden="true" />
                                      {attachment.fileName}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              <div
                                className="correspondence-event-actions"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {onAiDraft && dir === 'incoming' && item.channel === 'Email' && !mailSecurity ? (
                                  <button
                                    type="button"
                                    className="correspondence-ai-reply-btn"
                                    onClick={() => openAiDraft(item)}
                                    title={format(tx('dossier.replyToMessage'), {
                                      subject: localize(item.subject) || tx('dossier.untitledMessage'),
                                    })}
                                    aria-label={format(tx('dossier.replyToMessage'), {
                                      subject: localize(item.subject) || tx('dossier.untitledMessage'),
                                    })}
                                  >
                                    <Reply size={13} aria-hidden="true" />
                                  </button>
                                ) : null}
                                <CopyButton
                                  value={item.bodyText || item.summary}
                                  label={tx('copySummary')}
                                  size={12}
                                  onNotify={onNotify}
                                />
                                {!item.bodyHtml ? (
                                  <button
                                    type="button"
                                    className={`correspondence-edit-btn${isEditing ? ' active' : ''}`}
                                    onClick={() => startEditingCommunication(item)}
                                    title={isEditing ? tx('dossier.cancelEdit') : tx('explorer.edit')}
                                    aria-label={isEditing ? tx('dossier.cancelEdit') : tx('explorer.edit')}
                                    aria-expanded={isDraft ? composerOpen && activeComposerDraftId === item.id : isEditing}
                                    disabled={!isDraft && !onUpdateCommunication}
                                  >
                                    <span className="correspondence-edit-icon-stage" aria-hidden="true">
                                      <Pencil className="edit-icon" size={12} />
                                      <X className="collapse-icon" size={13} />
                                    </span>
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="correspondence-delete-btn"
                                  onClick={() => setConfirmRemoveCommunicationId(item.id)}
                                  title={tx('dossier.delete')}
                                  aria-label={tx('dossier.delete')}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                              <CollapsiblePanel
                                open={isEditing && !item.bodyHtml && !isDraft}
                                className="correspondence-edit-collapse"
                                openMs={360}
                                closeMs={280}
                              >
                                <div className="correspondence-edit-panel" onClick={(event) => event.stopPropagation()}>
                                  <div className="composer-field">
                                    <label>{tx('dossier.emailSubject')}</label>
                                    <input
                                      value={editDraft.subject ?? item.subject}
                                      onChange={(event) =>
                                        updateCommunicationEditDraft({
                                          subject: event.target.value,
                                        })
                                      }
                                      placeholder={tx('dossier.emailSubjectPlaceholder')}
                                      readOnly={Boolean(item.bodyHtml)}
                                    />
                                  </div>
                                  <div className="composer-field">
                                    <label>
                                      {tx(
                                        dir === 'outgoing'
                                          ? 'dossier.messageSentTime'
                                          : dir === 'incoming'
                                            ? 'dossier.messageReceivedTime'
                                            : 'dossier.messageTime',
                                      )}
                                    </label>
                                    {communicationAbsoluteTime(item) ? (
                                      <span className="composer-value">{timestamp.label}</span>
                                    ) : (
                                      <div className="composer-time-row">
                                        <DatePicker
                                          value={editDraft.date ?? item.date}
                                          onChange={(date) =>
                                            updateCommunicationEditDraft({
                                              date,
                                            })
                                          }
                                          timeValue={editDraft.time ?? item.time ?? ''}
                                          onTimeChange={(time) =>
                                            updateCommunicationEditDraft({
                                              time,
                                            })
                                          }
                                          timeAriaLabel={tx('dossier.messageClock')}
                                          placeholder={tx('dossier.emailScheduleDate')}
                                        />
                                      </div>
                                    )}
                                  </div>
                                  {!isNote && (
                                    <div
                                      className={`composer-route-info editable ${activeRouteSwap === `communication-${item.id}` ? 'route-swapping' : ''}`}>
                                  <label><span>{tx('dossier.emailFrom')}</span>
                                    <input
                                      value={editDraft.from ?? item.from ?? ''}
                                      onChange={(event) => updateCommunicationEditDraft({ from: event.target.value })}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="route-swap-btn"
                                    onClick={() => swapCommunicationEditRoute(item)}
                                    aria-label={tx('dossier.swapMailboxes')}
                                    title={tx('dossier.swapMailboxes')}
                                  >
                                    <ArrowRightLeft size={14} aria-hidden="true" />
                                  </button>
                                  <label><span>{tx('dossier.emailTo')}</span>
                                    <input
                                      value={editDraft.to ?? item.to ?? ''}
                                      onChange={(event) => updateCommunicationEditDraft({ to: event.target.value })}
                                    />
                                  </label>
                                </div>
                              )}
                              <MarkdownTextarea
                                className="composer-body record-body"
                                value={editDraft.summary ?? item.summary}
                                onChange={(event) => updateCommunicationEditDraft({ summary: event.target.value })}
                                placeholder={tx('dossier.messageSummaryPlaceholder')}
                                rows={5}
                                readOnly={Boolean(item.bodyHtml)}
                              />
                              <div className="correspondence-edit-actions">
                                <button type="button" className="primary-action save-action" onClick={() => { void saveCommunicationEdit(item) }}>
                                  <Save size={13} aria-hidden="true" /> {tx('dossier.saveCommunication')}
                                </button>
                                <button type="button" className="quiet-action" onClick={() => requestCloseItemEditor('communication')}>
                                  <X size={13} aria-hidden="true" /> {tx('dossier.cancelEdit')}
                                </button>
                              </div>
                            </div>
                          </CollapsiblePanel>
                        </article>
                      </div>
                    )
                  })}
                  {renderedCommunications.length < visibleCommunications.length ? (
                    <button
                      type="button"
                      className="quiet-action compact-action correspondence-load-more"
                      onClick={() =>
                        setCommunicationRenderLimit((current) => Math.min(visibleCommunications.length, current + 50))
                      }
                    >
                      {tx('dossier.showMore')}
                    </button>
                  ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ================================================================
             FUNDING — Scholarships
             ================================================================ */}
        {renderedTab === 'funding' && (
          <div className="funding-page" aria-busy={!tabContentReady || undefined}>
            <div className="funding-hero">
              <div className="funding-hero-info">
                <span className="eyebrow">{tx('dossier.fundingEyebrow')}</span>
                <h3>{tx('dossier.tabs.funding')}</h3>
                <p>
                  {application.scholarships.length === 0
                    ? tx('dossier.noScholarshipsHint')
                    : format(tx('dossier.scholarshipCountHint'), { count: application.scholarships.length })}
                </p>
              </div>
              <button
                type="button"
                  className={`primary-action funding-add-btn ${scholarshipAddOpen ? 'active' : ''}`}
                  onClick={() => {
                    if (scholarshipAddOpen) requestCloseScholarshipAdd()
                    else openScholarshipAdd()
                  }}
                  aria-expanded={scholarshipAddOpen}
                >
                  <Plus size={15} /> {tx('dossier.addScholarship')}
                </button>
              </div>

              <CollapsiblePanel open={scholarshipAddOpen} className="scholarship-add-panel-wrap" keepMounted>
                <form
                  className="scholarship-add-panel"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void submitScholarshipDraft()
                  }}
                >
                  {renderScholarshipForm(scholarshipDraft, setScholarshipDraft, 'new')}
                  <div className="scholarship-form-actions">
                    <button type="submit" className="primary-action" disabled={!scholarshipDraft.name.trim()}>
                      <Plus size={14} /> {tx('dossier.addScholarship')}
                    </button>
                    <button
                      type="button"
                      className="ghost-action"
                      onClick={() => requestCloseScholarshipAdd()}
                    >
                      {tx('dossier.cancelEdit')}
                    </button>
                  </div>
                </form>
              </CollapsiblePanel>

              <ExplorerSelectionBar
                visible={scholarshipSelection.selectedCount > 1}
                label={format(tx('explorer.selectedCount'), {
                  count: scholarshipSelection.selectedCount,
                })}
                clearLabel={tx('explorer.clearSelection')}
                onClear={scholarshipSelection.clearSelection}
                actions={[
                  {
                    id: 'delete',
                    label: tx('explorer.deleteSelected'),
                    icon: <Trash2 size={13} aria-hidden="true" />,
                    tone: 'danger',
                    onClick: () => removeScholarships(scholarshipSelection.selectedIdList),
                  },
                ]}
              />

              {!tabContentReady ? (
                <DossierDeferredRows className="funding-list-deferred" />
              ) : application.scholarships.length === 0 ? (
                <div className="funding-empty">
                  <div className="funding-empty-icon">
                    <GraduationCap size={24} />
                  </div>
                  <strong>{tx('dossier.noScholarships')}</strong>
                  <p>{tx('dossier.noScholarshipsHint')}</p>
                  <button type="button" className="primary-action" onClick={openScholarshipAdd}>
                    <Plus size={14} /> {tx('dossier.addScholarship')}
                  </button>
                </div>
              ) : (
                <div className="funding-cards">
                  {application.scholarships.map((storedItem) => {
                    const item = optimisticScholarships[storedItem.id] ?? storedItem
                    const materials = item.materials ?? []
                    const tasks = item.tasks ?? []
                    const events = item.timeline ?? []
                    const completedMaterials = materials.filter((material) => material.status === 'Submitted').length
                    const completedTasks = tasks.filter((task) => task.done).length
                    const totalTrackables = materials.length + tasks.length
                    const completedTrackables = completedMaterials + completedTasks
                    const progress = totalTrackables > 0 ? Math.round((completedTrackables / totalTrackables) * 100) : 0
                    const isExpanded = expandedScholarships.has(item.id)
                    const isEditing = Boolean(editingScholarshipId === item.id && scholarshipEditDraft)
                    const isSavingEdit = savingScholarshipId === item.id
                    const isRemoving = removingScholarshipIds.has(item.id)
                    const dueDays = daysUntil(item.endDate)
                    const tone = deadlineUrgency(dueDays)
                    const displaySchool = item.school || application.school.name
                    const displayIssuer = item.issuer || tx('dossier.scholarshipIssuerUnknown')
                    return (
                      <article
                        key={item.id}
                        id={`scholarship-${item.id}`}
                        className={`funding-card ${isExpanded ? 'expanded' : ''} ${isEditing ? 'editing' : ''} ${isSavingEdit ? 'saving' : ''} ${isRemoving ? 'is-removing' : ''} ${scholarshipSelection.selectedCount > 1 && scholarshipSelection.selectedIds.has(item.id) ? 'explorer-selected' : ''}`}
                        data-tour={item.id === 'tour-fellowship' ? 'funding-card' : undefined}
                        aria-selected={scholarshipSelection.selectedIds.has(item.id)}
                        onContextMenu={(event) => openScholarshipContextMenu(event, item)}
                      >
                        <div
                          className="funding-card-summary"
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            if (hasExplorerSelectionModifier(event)) {
                              scholarshipSelection.applyGesture(item.id, event)
                              return
                            }
                            scholarshipSelection.selectOnly(item.id)
                            toggleScholarshipExpanded(item.id)
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            event.preventDefault()
                            toggleScholarshipExpanded(item.id)
                          }}
                        >
                          <div className="funding-card-icon">
                            <GraduationCap size={18} />
                          </div>
                          <div className="funding-card-info">
                            <div className="funding-card-title-row">
                              <strong>{localize(item.name)}</strong>
                              <span className={`funding-status-chip ${item.status ?? 'Preparing'}`}>
                                {tx(
                                  `dossier.scholarshipStatus.${item.status ?? 'Preparing'}`,
                                  item.status ?? 'Preparing',
                                )}
                              </span>
                            </div>
                            <span>
                              {displaySchool} · {displayIssuer}
                            </span>
                          </div>
                          <div className="funding-card-actions" onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              className={`funding-mini-btn${isEditing ? ' active' : ''}`}
                              onClick={() => startEditingScholarship(item)}
                              title={isEditing ? tx('dossier.cancelEdit') : tx('explorer.edit')}
                              aria-label={isEditing ? tx('dossier.cancelEdit') : tx('explorer.edit')}
                              aria-expanded={isEditing}
                            >
                              {isEditing ? <X size={13} /> : <Pencil size={13} />}
                            </button>
                            <button
                              type="button"
                              className="funding-mini-btn funding-delete-btn"
                              onClick={() => setConfirmRemoveScholarshipId(item.id)}
                              title={tx('dossier.remove')}
                              aria-label={tx('dossier.remove')}
                            >
                              <Trash2 size={13} />
                            </button>
                            <button
                              type="button"
                              className={`funding-expand-btn ${isExpanded ? 'open' : ''}`}
                              onClick={() => toggleScholarshipExpanded(item.id)}
                              aria-label={isExpanded ? tx('dossier.collapse') : tx('dossier.expand')}
                              aria-expanded={isExpanded}
                            >
                              <ChevronDown size={15} />
                            </button>
                          </div>
                        </div>

                        <CollapsiblePanel
                          open={!isEditing}
                          keepMounted
                          className="funding-card-summary-details"
                          innerClassName="funding-card-summary-details-inner"
                          openMs={380}
                          closeMs={320}
                        >
                          <div className="funding-card-meta-grid">
                            <div>
                              <span>{tx('dossier.scholarshipAmount')}</span>
                              <strong>{item.amount || tx('dossier.scholarshipAmountTbd')}</strong>
                            </div>
                            <div>
                              <span>{tx('dossier.scholarshipEnd')}</span>
                              <strong className={tone}>{formatDate(item.endDate, lang)}</strong>
                            </div>
                            <div>
                              <span>{tx('dossier.scholarshipMaterials')}</span>
                              <strong>
                                {completedMaterials}/{materials.length}
                              </strong>
                            </div>
                            <div>
                              <span>{tx('dossier.scholarshipTasks')}</span>
                              <strong>
                                {completedTasks}/{tasks.length}
                              </strong>
                            </div>
                          </div>

                          <div className="funding-progress-line" aria-hidden="true">
                            <span style={{ width: `${progress}%` }} />
                          </div>
                        </CollapsiblePanel>

                        <CollapsiblePanel
                          open={isExpanded || isEditing}
                          className="funding-card-detail"
                          innerClassName="funding-card-detail-inner"
                          keepMounted={isEditing}
                        >
                          {isEditing && scholarshipEditDraft ? (
                            <form
                              className={`scholarship-edit-panel${isSavingEdit ? ' is-saving' : ''}`}
                              aria-busy={isSavingEdit}
                              onSubmit={(event) => {
                                event.preventDefault()
                                void saveScholarshipEdit(item.id)
                              }}
                            >
                              {renderScholarshipForm(scholarshipEditDraft, setScholarshipEditDraft, `edit-${item.id}`)}
                              <div className="scholarship-form-actions">
                                <button
                                  type="submit"
                                  className={`primary-action save-action${isSavingEdit ? ' loading' : ''}`}
                                  disabled={!scholarshipEditDraft.name.trim() || isSavingEdit}
                                >
                                  {isSavingEdit ? (
                                    <LoaderCircle className="spin-icon" size={14} aria-hidden="true" />
                                  ) : (
                                    <Save size={14} aria-hidden="true" />
                                  )}
                                  {tx('dossier.saveEvent')}
                                </button>
                                <button
                                  type="button"
                                  className="ghost-action"
                                  onClick={() => requestCloseItemEditor('scholarship')}
                                  disabled={isSavingEdit}
                                >
                                  <X size={13} /> {tx('dossier.cancelEdit')}
                                </button>
                              </div>
                            </form>
                          ) : (
                            <div className="funding-detail-readonly">
                              {item.notes ? (
                                <section className="funding-detail-notes">
                                  <span className="funding-detail-heading">
                                    <StickyNote size={13} /> {tx('dossier.notes')}
                                  </span>
                                  <MarkdownContent value={localize(item.notes)} />
                                </section>
                              ) : null}
                              <div className="funding-detail-columns">
                                <section className="funding-detail-materials">
                                  <span className="funding-detail-heading">
                                    <FileText size={13} /> {tx('dossier.scholarshipMaterials')}
                                  </span>
                                  {materials.length === 0 ? (
                                    <p className="scholarship-mini-empty">{tx('dossier.scholarshipNoMaterials')}</p>
                                  ) : (
                                    <div className="funding-detail-list">
                                      {materials.map((material) => {
                                        const completed = material.status === 'Submitted'
                                        return (
                                          <div
                                            key={`${item.id}:material:${material.id}`}
                                            className={`funding-detail-line funding-detail-toggle ${completed ? 'done' : ''}`}
                                            onContextMenu={(event) =>
                                              openScholarshipMaterialContextMenu(event, item, material)
                                            }
                                          >
                                            <button
                                              type="button"
                                              className="funding-detail-line-main"
                                              onClick={() => toggleScholarshipMaterialCompletion(item, material)}
                                              aria-pressed={completed}
                                              aria-label={
                                                completed ? tx('dossier.markIncomplete') : tx('dossier.markComplete')
                                              }
                                              title={`${completed ? tx('dossier.markIncomplete') : tx('dossier.markComplete')} · ${tx('explorer.changeStatus')}`}
                                            >
                                              <strong>{localize(material.name)}</strong>
                                              <span className="funding-detail-line-meta">
                                                <MaterialPill status={material.status} />
                                                {material.due ? <span>{formatDate(material.due, lang)}</span> : null}
                                              </span>
                                            </button>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
                                </section>
                                <section className="funding-detail-tasks">
                                  <span className="funding-detail-heading">
                                    <CheckCircle2 size={13} /> {tx('dossier.scholarshipTasks')}
                                  </span>
                                  {tasks.length === 0 ? (
                                    <p className="scholarship-mini-empty">{tx('dossier.scholarshipNoTasks')}</p>
                                  ) : (
                                    <div className="funding-detail-list">
                                      {tasks.map((task) => (
                                        <div
                                          key={`${item.id}:task:${task.id}`}
                                          className={`funding-detail-line funding-detail-toggle ${task.done ? 'done' : ''}`}
                                          onContextMenu={(event) => openScholarshipTaskContextMenu(event, item, task)}
                                        >
                                          <button
                                            type="button"
                                            className="funding-detail-line-main"
                                            onClick={() => toggleScholarshipTaskCompletion(item, task)}
                                            aria-pressed={task.done}
                                            aria-label={
                                              task.done ? tx('dossier.markIncomplete') : tx('dossier.markComplete')
                                            }
                                            title={`${task.done ? tx('dossier.markIncomplete') : tx('dossier.markComplete')} · ${tx('explorer.changeStatus')}`}
                                          >
                                            <strong>{localize(task.title)}</strong>
                                            <span className="funding-detail-line-meta">
                                              <span
                                                className={`funding-task-status ${task.done ? 'complete' : 'open'}`}
                                              >
                                                {task.done ? tx('explorer.statusComplete') : tx('explorer.statusOpen')}
                                              </span>
                                              {task.due ? <span>{formatDate(task.due, lang)}</span> : null}
                                            </span>
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </section>
                              </div>
                              <section className="funding-detail-timeline">
                                <span className="funding-detail-heading">
                                  <Clock size={13} /> {tx('dossier.scholarshipTimeline')}
                                </span>
                                {events.length === 0 ? (
                                  <p className="scholarship-mini-empty">{tx('dossier.scholarshipNoTimeline')}</p>
                                ) : (
                                  <div className="funding-scholarship-timeline" role="list">
                                    {sortScholarshipTimelineNewestFirst(events).map((event, eventIndex, sorted) => {
                                      const status = timelineDateStatus(event.date)
                                      const isLast = eventIndex === sorted.length - 1
                                      return (
                                        <article
                                          key={`${item.id}:timeline:${event.id}`}
                                          className={`funding-scholarship-timeline-event status-${status}`}
                                          role="listitem"
                                        >
                                          <div className="funding-scholarship-timeline-rail" aria-hidden="true">
                                            <span className={`funding-scholarship-timeline-dot ${status}`} />
                                            {!isLast ? (
                                              <span className={`funding-scholarship-timeline-line ${status}`} />
                                            ) : null}
                                          </div>
                                          <div className="funding-scholarship-timeline-card">
                                            <div className="funding-scholarship-timeline-card-head">
                                              <strong>{localize(event.title)}</strong>
                                              <time dateTime={event.date}>{formatDate(event.date, lang)}</time>
                                            </div>
                                            {event.note ? (
                                              <p className="funding-scholarship-timeline-note">
                                                {localize(event.note)}
                                              </p>
                                            ) : null}
                                          </div>
                                        </article>
                                      )
                                    })}
                                  </div>
                                )}
                              </section>
                            </div>
                          )}
                        </CollapsiblePanel>
                      </article>
                    )
                  })}
                </div>
              )}

              {tabContentReady ? (
                <div className="funding-section">
                  <div className="funding-section-header">
                    <h4>{tx('fees.sectionTitle')}</h4>
                    <span className="eyebrow">{tx('fees.sectionEyebrow')}</span>
                  </div>
                  <FeeTracker
                    key={`${session.user.id}:${application.id}`}
                    userId={session.user.id}
                    applicationId={application.id}
                    fees={application.fees ?? []}
                    onAdd={onAddFee}
                    onUpdate={onUpdateFee}
                    onDelete={onDeleteFee}
                    onRegisterExitGuard={registerFeeExitGuard}
                    onNotify={onNotify}
                  />
                </div>
              ) : null}
            </div>
          )}

          {/* ================================================================
             TIMELINE — Collapsible tasks + grouped event timeline
             ================================================================ */}
        {renderedTab === 'timeline' &&
            (() => {
              const renderNowMarker = (key: string) => (
                <div key={key} className="timeline-now-marker" ref={nowMarkerRef} data-timeline-date={today}>
                  <div className="timeline-now-rail">
                    <div className="timeline-now-dot" />
                  </div>
                  <div className="timeline-now-label">
                    <span>{tx('dossier.timeGroupToday')}</span>
                  </div>
                </div>
              )
              const timelineJumpDock = (
                <TimelineJumpDock
                  key={application.id}
                  initialValue={today}
                  lang={lang}
                  timelinePageRef={timelinePageRef}
                  nearToday={timelineNearToday}
                  todayDirection={timelineTodayDirection}
                  usesViewportPortal={timelineJumpUsesViewportPortal}
                  hasMobileRail={typeof document !== 'undefined' && Boolean(document.querySelector('.atlas-rail'))}
                  dockLabel={tx('dossier.timelineJumpDock', 'Jump on timeline')}
                  dateLabel={tx('dossier.timelineJumpDate', 'Jump to date')}
                  todayLabel={tx('dossier.jumpToToday', 'Go to today')}
                  onDateChange={scrollTimelineToDate}
                  onToday={scrollTimelineToToday}
                />
              )
              return (
                <div className="timeline-page" ref={timelinePageRef} aria-busy={!tabContentReady || undefined}>
                  {/* Hero */}
                  <div className="timeline-hero">
                    <div className="timeline-hero-info">
                      <span className="eyebrow">{tx('dossier.eyebrow')}</span>
                      <h3>{tx('dossier.tabs.timeline')}</h3>
                      <p>
                        {unifiedTimelineEvents.length === 0
                          ? tx('dossier.noTimeline')
                          : latestTimelineEvent
                            ? format(tx('dossier.heroLatest'), {
                                count: unifiedTimelineEvents.length,
                                date: formatDate(latestTimelineEvent.date, lang),
                              })
                            : format(tx('dossier.eventCount'), {
                                count: unifiedTimelineEvents.length,
                              })}
                      </p>
                    </div>
                    {onAddTimelineEvent && (
                      <button
                        type="button"
                        className={`primary-action timeline-hero-add-btn ${timelineAddOpen ? 'active' : ''}`}
                        onClick={() => {
                          setTimelineAddOpen(!timelineAddOpen)
                          setEditingEventId(null)
                        }}
                      >
                        <Plus size={15} /> {tx('dossier.addEvent')}
                      </button>
                    )}
                  </div>

                  {/* Collapsible add-event form */}
                  {onAddTimelineEvent && (
                    <CollapsiblePanel open={timelineAddOpen} className="timeline-add-panel-wrap">
                      <form
                        className="timeline-add-panel"
                        onSubmit={(e) => {
                          e.preventDefault()
                          if (timelineTitle.trim())
                            void (async () => {
                              const saved = await onAddTimelineEvent(timelineTitle, timelineDate, timelineNote)
                              if (saved === false) return
                              setTimelineTitle('')
                              setTimelineNote('')
                              setTimelineAddOpen(false)
                            })()
                        }}
                      >
                        <div className="timeline-add-panel-fields">
                          <input
                            required
                            value={timelineTitle}
                            onChange={(e) => setTimelineTitle(e.target.value)}
                            placeholder={tx('dossier.eventTitle')}
                            aria-label={tx('dossier.eventTitle')}
                            className="timeline-add-panel-input"
                            tabIndex={timelineAddOpen ? 0 : -1}
                          />
                          <DatePicker
                            value={timelineDate}
                            onChange={setTimelineDate}
                            placeholder={tx('dossier.eventDate')}
                          />
                          <MarkdownTextarea
                            value={timelineNote}
                            onChange={(e) => setTimelineNote(e.target.value)}
                            placeholder={tx('dossier.eventNote')}
                            aria-label={tx('dossier.eventNote')}
                            className="timeline-add-panel-textarea"
                            rows={2}
                          />
                        </div>
                        <div className="timeline-add-panel-actions">
                          <button type="submit" className="primary-action timeline-add-btn">
                            <Plus size={14} /> {tx('dossier.addEvent')}
                          </button>
                          <button type="button" className="ghost-action" onClick={() => setTimelineAddOpen(false)}>
                            {tx('dossier.cancelEdit')}
                          </button>
                        </div>
                      </form>
                    </CollapsiblePanel>
                  )}

                  {/* Timeline events */}
                  <div className="timeline-section">
                    <div className="timeline-section-header">
                      <div className="timeline-section-heading">
                        <Clock size={16} />
                        <h4>{tx('dossier.timeline')}</h4>
                        <span className="timeline-count-badge">{unifiedTimelineEvents.length}</span>
                      </div>
                    </div>

                    {!tabContentReady ? (
                      <DossierDeferredRows className="timeline-list-deferred" />
                    ) : unifiedTimelineEvents.length === 0 ? (
                      <div className="timeline-empty">
                        <Clock size={24} />
                        <span>{tx('dossier.noTimeline')}</span>
                      </div>
                    ) : (
                      <>
                        <ExplorerSelectionBar
                          visible={timelineSelection.selectedCount > 1}
                          label={format(tx('explorer.selectedCount'), {
                            count: timelineSelection.selectedCount,
                          })}
                          clearLabel={tx('explorer.clearSelection')}
                          onClear={timelineSelection.clearSelection}
                          actions={[
                            {
                              id: 'delete',
                              label: tx('explorer.deleteSelected'),
                              icon: <Trash2 size={13} aria-hidden="true" />,
                              disabled: timelineSelection.selectedIdList.every(
                                (id) => !unifiedTimelineEvents.some((event) => event.id === id && event.manual),
                              ),
                              tone: 'danger',
                              onClick: () => removeManualTimelineEvents(timelineSelection.selectedIdList),
                            },
                          ]}
                        />
                        <div className="timeline-track" data-tour="timeline-track">
                          {groupedTimeline.map((group, gi) => (
                            <div key={group.key} className="timeline-group">
                              <span className="timeline-group-label">{group.label}</span>
                              <div className="timeline-group-events">
                                {group.events.map((event, ei) => {
                                  const eventStatus = timelineDateStatus(event.date)
                                  const showNowMarker =
                                    timelineNowMarker?.groupIndex === gi && timelineNowMarker?.eventIndex === ei
                                  const isEditing = editingEventId === event.id
                                  const isFirstInGroup = ei === 0
                                  const isLastInGroup = ei === group.events.length - 1
                                  const isLastOverall = gi === groupedTimeline.length - 1 && isLastInGroup
                                  const noteLong = event.note && event.note.length > 120
                                  const noteExpanded = expandedNotes.has(event.id)
                                  const canEditEvent = Boolean(
                                    event.manual && (onUpdateTimelineEvent || onRemoveTimelineEvent),
                                  )
                                  const relativeLabel = relativeTime(event.date, lang)
                                  const showRelativeLabel =
                                    Boolean(relativeLabel) && relativeLabel !== formatDate(event.date, lang)
                                  const isRemoving = removingTimelineIds.has(event.id)
                                  const timelineRenderKey = `${group.key}:${event.date}:${event.source ?? 'manual'}:${event.id}:${ei}`

                                  if (isEditing && event.manual && onUpdateTimelineEvent) {
                                    return (
                                      <Fragment key={timelineRenderKey}>
                                        {showNowMarker && renderNowMarker('now-marker')}
                                        <form
                                          className={`timeline-event timeline-event-kind-${event.sourceKind} timeline-event-type-manual timeline-event-editing animate-enter ${isRemoving ? 'is-removing' : ''}`}
                                          data-timeline-date={event.date}
                                          onSubmit={(e) => {
                                            e.preventDefault()
                                            void saveTimelineEdit()
                                          }}
                                        >
                                          <div className="timeline-event-rail">
                                            <div className={`timeline-event-dot ${eventStatus}`}>
                                              <TimelineEventGlyph kind="manual" />
                                            </div>
                                            {!isLastOverall && <div className={`timeline-event-line ${eventStatus}`} />}
                                          </div>
                                          <div className="timeline-event-card timeline-event-card-edit">
                                            <input
                                              required
                                              value={editTitle}
                                              onChange={(e) => setEditTitle(e.target.value)}
                                              className="timeline-edit-input"
                                              placeholder={tx('dossier.eventTitle')}
                                              autoFocus
                                            />
                                            <MarkdownTextarea
                                              value={editNote}
                                              onChange={(e) => setEditNote(e.target.value)}
                                              className="timeline-edit-textarea"
                                              placeholder={tx('dossier.eventNote')}
                                              rows={2}
                                            />
                                            <div className="timeline-edit-footer">
                                              <div className="timeline-edit-date">
                                                <DatePicker
                                                  value={editDate}
                                                  onChange={setEditDate}
                                                  placeholder={tx('dossier.eventDate')}
                                                />
                                              </div>
                                              <div className="timeline-edit-actions">
                                                <button
                                                  type="submit"
                                                  className="primary-action save-action timeline-add-btn"
                                                >
                                                  <Save size={13} /> {tx('dossier.saveEvent')}
                                                </button>
                                                <button
                                                  type="button"
                                                  className="ghost-action"
                                                  onClick={() => requestCloseItemEditor('timeline')}
                                                >
                                                  {tx('dossier.cancelEdit')}
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        </form>
                                      </Fragment>
                                    )
                                  }

                                  return (
                                    <Fragment key={timelineRenderKey}>
                                      {showNowMarker && renderNowMarker('now-marker')}
                                      <div
                                        className={`timeline-event timeline-event-kind-${event.sourceKind} timeline-event-type-${event.eventKind} ${isFirstInGroup ? 'timeline-event-first' : ''} ${isRemoving ? 'is-removing' : ''}`}
                                        data-timeline-date={event.date}
                                        data-timeline-event-kind={event.eventKind}
                                        data-timeline-scroll-reveal=""
                                      >
                                        <div className="timeline-event-rail">
                                          <div className={`timeline-event-dot ${eventStatus}`}>
                                            <TimelineEventGlyph kind={event.eventKind} />
                                          </div>
                                          {!isLastOverall && <div className={`timeline-event-line ${eventStatus}`} />}
                                        </div>
                                        <div
                                          id={`timeline-event-${event.id}`}
                                          className={`timeline-event-card ${timelineSelection.selectedCount > 1 && timelineSelection.selectedIds.has(event.id) ? 'explorer-selected' : ''} ${event.nav ? 'timeline-event-card-navigable' : ''}`}
                                          data-tour={
                                            event.id === 'tour-timeline-shortlist' ? 'timeline-card' : undefined
                                          }
                                          aria-selected={timelineSelection.selectedIds.has(event.id)}
                                          role={event.nav ? 'button' : undefined}
                                          tabIndex={event.nav ? 0 : undefined}
                                          onClick={(clickEvent) => {
                                            if (!hasExplorerSelectionModifier(clickEvent) && event.nav) {
                                              navigateToTimelineSource(event.nav)
                                              return
                                            }
                                            timelineSelection.applyGesture(event.id, clickEvent)
                                          }}
                                          onKeyDown={(keyEvent) => {
                                            if (!event.nav || (keyEvent.key !== 'Enter' && keyEvent.key !== ' ')) return
                                            keyEvent.preventDefault()
                                            navigateToTimelineSource(event.nav)
                                          }}
                                          onContextMenu={(contextEvent) => openTimelineContextMenu(contextEvent, event)}
                                        >
                                          <div className="timeline-event-card-header">
                                            <div className="timeline-event-meta">
                                              <span className="timeline-event-date">
                                                {formatDate(event.date, lang)}
                                              </span>
                                              {showRelativeLabel && (
                                                <span className="timeline-event-relative">{relativeLabel}</span>
                                              )}
                                            </div>
                                            <div className="timeline-event-card-trailing">
                                              {event.nav && (
                                                <span className="timeline-event-nav-hint" aria-hidden="true">
                                                  <ArrowUpRight size={13} />
                                                </span>
                                              )}
                                              {canEditEvent && (
                                                <div
                                                  className="timeline-event-actions"
                                                  onClick={(actionEvent) => actionEvent.stopPropagation()}
                                                >
                                                  {onUpdateTimelineEvent && (
                                                    <button
                                                      type="button"
                                                      className="timeline-event-action-btn"
                                                      title={tx('dossier.editEvent')}
                                                      onClick={() => {
                                                        startEditingTimelineEvent(event)
                                                      }}
                                                    >
                                                      <Pencil size={13} />
                                                    </button>
                                                  )}
                                                  {onRemoveTimelineEvent && (
                                                    <button
                                                      type="button"
                                                      className="timeline-event-action-btn timeline-event-delete-btn"
                                                      title={tx('dossier.deleteEvent')}
                                                      onClick={() => removeManualTimelineEvents([event.id])}
                                                    >
                                                      <Trash2 size={13} />
                                                    </button>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                          <div className={`timeline-event-title-row timeline-event-kind-${event.sourceKind}`}>
                                            <strong>{localize(event.title)}</strong>
                                            {event.source ? (
                                              <span className="timeline-source-chip">{event.source}</span>
                                            ) : null}
                                          </div>
                                          {(event.value || event.statusText || event.note) && (
                                            <div className={`timeline-event-support timeline-event-support-${event.eventKind}`}>
                                              {(event.value || event.statusText) ? (
                                                <div className="timeline-event-facts">
                                                  {event.value ? (
                                                    <span className="timeline-event-value">{localize(event.value)}</span>
                                                  ) : null}
                                                  {event.statusText ? (
                                                    <span className={`timeline-event-status is-${event.statusTone ?? 'neutral'}`}>
                                                      {localize(event.statusText)}
                                                    </span>
                                                  ) : null}
                                                </div>
                                              ) : null}
                                              {event.note && (
                                                <div
                                                  className={`timeline-event-note ${noteLong && !noteExpanded ? 'collapsed' : ''}`}
                                                >
                                                  <MarkdownContent
                                                    value={localize(event.note)}
                                                    format={event.plainText ? 'plain' : undefined}
                                                  />
                                                  {noteLong && (
                                                    <button
                                                      type="button"
                                                      className="timeline-note-toggle"
                                                      onClick={() => {
                                                        const next = new Set(expandedNotes)
                                                        if (noteExpanded) {
                                                          next.delete(event.id)
                                                        } else {
                                                          next.add(event.id)
                                                        }
                                                        setExpandedNotes(next)
                                                      }}
                                                    >
                                                      <InlinePresence present={noteExpanded} parentGap="4px">
                                                        <span>{tx('dossier.showLess')}</span>
                                                      </InlinePresence>
                                                      <InlinePresence present={!noteExpanded} parentGap="4px">
                                                        <span>{tx('dossier.showMore')}</span>
                                                      </InlinePresence>
                                                    </button>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </Fragment>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                          {timelineNowMarker?.groupIndex === groupedTimeline.length && renderNowMarker('now-marker')}
                        </div>

                        {timelineJumpUsesViewportPortal
                          ? timelineJumpPageVisible && typeof document !== 'undefined'
                            ? createPortal(timelineJumpDock, document.body)
                            : null
                          : timelineJumpDock}
                      </>
                    )}
                  </div>
                </div>
              )
            })()}
        </fieldset>

        {detailTabs.includes('admissions') && (
          <div
            className="admissions-page"
            hidden={renderedTab !== 'admissions'}
            aria-hidden={renderedTab !== 'admissions' || undefined}
          >
            {/* The school, programme and professor are read from the stored
                application on the server, so a saved report is provably about
                this record rather than about whatever a request body claimed. */}
            <AdmissionSignalsPanel
              key={application.id}
              token={session.token}
              applicationId={application.id}
              aiKeys={aiKeys}
            />
          </div>
        )}

        {/* Team feedback is available only from the team-scoped workspace. */}
        {renderedTab === 'review' &&
          teamFeedbackAvailable &&
          (() => {
            const allComments = draft.reviewComments ?? []
            const comments = allComments.filter((comment) => !comment.parentId).reverse()
            const reviewCount = countReviewComments(allComments)
            const reviewCountStr = reviewCount === 0 ? tx('dossier.reviewEmpty') : String(reviewCount)
            const formatCommentTime = (createdAt: string) => {
              try {
                return new Date(createdAt).toLocaleString(localeForLanguage(lang), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              } catch {
                return createdAt
              }
            }
            const commentRoleKey = (authorId: string) =>
              authorId === draft.ownerId ? 'dossier.reviewStudentRole' : 'dossier.reviewAdvisorRole'
            const replyActionKey = (authorId: string) =>
              authorId === draft.ownerId ? 'dossier.reviewReplyToStudent' : 'dossier.reviewReplyToAdvisor'
            async function handleSubmitComment() {
              if (!reviewCommentText.trim() || !onAddReviewComment) return
              const sourceApplicationId = application.id
              setReviewCommentBusy(true)
              try {
                await onAddReviewComment(reviewCommentText.trim(), 'review')
                if (activeApplicationIdRef.current === sourceApplicationId) setReviewCommentText('')
              } catch {
                // The App orchestrator reports the API error and the draft stays available for retry.
              } finally {
                if (activeApplicationIdRef.current === sourceApplicationId) setReviewCommentBusy(false)
              }
            }
            async function handleSubmitReply(parentId: string, targetAuthorId: string) {
              if (!reviewReplyText.trim() || !onAddReviewComment) return
              const sourceApplicationId = application.id
              setReviewCommentBusy(true)
              try {
                await onAddReviewComment(reviewReplyText.trim(), 'review', parentId, [targetAuthorId])
                if (activeApplicationIdRef.current === sourceApplicationId) {
                  setReviewReplyText('')
                  setReviewReplyToId(null)
                }
              } catch {
                // Keep the reply in place so a failed online request can be retried.
              } finally {
                if (activeApplicationIdRef.current === sourceApplicationId) setReviewCommentBusy(false)
              }
            }
            const canRequestFeedback = Boolean(
              teamFeedbackAvailable && session.user.id && draft.ownerId === session.user.id,
            )
            async function handleRequestFeedback() {
              if (!canRequestFeedback || feedbackBusy) return
              setFeedbackBusy(true)
              setFeedbackStatus(null)
              try {
                const result = await phdApi.requestApplicationFeedback(
                  session.token,
                  application.id,
                  feedbackNote.trim(),
                )
                setFeedbackStatus(
                  format(tx('team.requestFeedbackSent'), {
                    count: result.notified,
                  }),
                )
                setFeedbackNote('')
              } catch (error) {
                setFeedbackStatus(normalizeErrorMessage(error, lang, tx('team.requestFeedback')))
              } finally {
                setFeedbackBusy(false)
              }
            }
            return (
              <div className="dossier-section">
                <div className="dossier-section-header">
                  <div>
                    <h3>{tx('dossier.tabs.review')}</h3>
                  </div>
                  <span className="muted">{reviewCountStr}</span>
                </div>

                {canRequestFeedback ? (
                  <section className="review-request-feedback" aria-label={tx('team.requestFeedback')}>
                    <div>
                      <strong>{tx('team.requestFeedback')}</strong>
                      <p>{tx('team.requestFeedbackHint')}</p>
                    </div>
                    <textarea
                      className="review-request-feedback-note"
                      value={feedbackNote}
                      onChange={(event) => setFeedbackNote(event.target.value)}
                      placeholder={tx('team.requestFeedbackNotePlaceholder')}
                      rows={2}
                      maxLength={500}
                      disabled={feedbackBusy}
                    />
                    <button
                      type="button"
                      className="secondary-action compact-action"
                      disabled={feedbackBusy}
                      aria-busy={feedbackBusy || undefined}
                      onClick={() => void handleRequestFeedback()}
                    >
                      {feedbackBusy ? (
                        <PendingLabel label={tx('team.requestFeedbackWorking')} />
                      ) : (
                        tx('team.requestFeedback')
                      )}
                    </button>
                    {feedbackStatus ? (
                      <p className="review-request-feedback-ok" role="status">
                        {feedbackStatus}
                      </p>
                    ) : null}
                  </section>
                ) : null}

                {onAddReviewComment ? (
                  <div className="review-composer">
                    <MarkdownTextarea
                      value={reviewCommentText}
                      onChange={(event) => setReviewCommentText(event.target.value)}
                      placeholder={tx('dossier.reviewComposerPlaceholder')}
                      rows={3}
                      maxLength={4000}
                      disabled={reviewCommentBusy}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          handleSubmitComment()
                        }
                      }}
                    />
                    <div className="review-composer-footer">
                      <span className="review-composer-hint">{reviewCommentText.length}/4000</span>
                      <button
                        type="button"
                        className="primary-action compact-action"
                        disabled={reviewCommentBusy || !reviewCommentText.trim()}
                        aria-busy={reviewCommentBusy || undefined}
                        onClick={handleSubmitComment}
                      >
                        {reviewCommentBusy ? (
                          <PendingLabel label={tx('working')} />
                        ) : (
                          <>
                            <MessageSquare size={13} aria-hidden="true" /> {tx('dossier.reviewSubmit')}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : null}

                {comments.length === 0 ? (
                  <p className="muted">{tx('dossier.reviewEmpty')}</p>
                ) : (
                  <ul className="review-comment-list">
                    {comments.map((comment) => {
                      const replies = reviewRepliesFor(allComments, comment)
                      const replyTarget = replies.at(-1) ?? comment
                      const replyOpen = reviewReplyToId === comment.id
                      const canReply = Boolean(onAddReviewComment && replyTarget.authorId !== session.user.id)
                      const replyPanelId = `review-reply-composer-${comment.id}`
                      return (
                        <li
                          key={comment.id}
                          id={`review-comment-${comment.id}`}
                          className={`review-comment-item${replyOpen ? ' is-replying' : ''}`}
                        >
                          <div className="review-comment-head">
                            <span className="review-comment-author-group">
                              <span className="review-comment-author">{comment.authorName}</span>
                              <span className="review-comment-role">{tx(commentRoleKey(comment.authorId))}</span>
                            </span>
                            <span className="review-comment-time" title={comment.createdAt}>
                              {formatCommentTime(comment.createdAt)}
                            </span>
                          </div>
                          <MarkdownContent value={comment.body} className="review-comment-body" />
                          {replies.length > 0 ? (
                            <ul className="review-comment-replies" aria-label={tx('dossier.reviewReplies')}>
                              {replies.map((reply) => (
                                <li key={reply.id} id={`review-comment-${reply.id}`} className="review-comment-reply">
                                  <div className="review-comment-head">
                                    <span className="review-comment-author-group">
                                      <span className="review-comment-author">{reply.authorName}</span>
                                      <span className="review-comment-role">{tx(commentRoleKey(reply.authorId))}</span>
                                    </span>
                                    <span className="review-comment-time" title={reply.createdAt}>
                                      {formatCommentTime(reply.createdAt)}
                                    </span>
                                  </div>
                                  <MarkdownContent value={reply.body} className="review-comment-body" />
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {canReply ? (
                            <div className="review-comment-reply-action">
                              <button
                                type="button"
                                className="review-comment-reply-trigger"
                                aria-expanded={replyOpen}
                                aria-controls={replyPanelId}
                                onClick={() => {
                                  setReviewReplyToId(replyOpen ? null : comment.id)
                                  setReviewReplyText('')
                                }}
                              >
                                <Reply size={12} aria-hidden="true" />
                                {tx(replyActionKey(replyTarget.authorId))}
                              </button>
                            </div>
                          ) : null}
                          <CollapsiblePanel
                            id={replyPanelId}
                            open={replyOpen}
                            className="review-inline-reply-panel"
                            innerClassName="review-inline-reply-composer"
                            collapseMs={220}
                          >
                            <span className="review-inline-reply-context">
                              {format(tx('dossier.reviewReplyingTo'), {
                                name: replyTarget.authorName,
                              })}
                            </span>
                            <MarkdownTextarea
                              value={reviewReplyText}
                              onChange={(event) => setReviewReplyText(event.target.value)}
                              placeholder={tx('dossier.reviewReplyPlaceholder')}
                              rows={2}
                              maxLength={4000}
                              disabled={reviewCommentBusy}
                              autoFocus
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                  event.preventDefault()
                                  void handleSubmitReply(comment.id, replyTarget.authorId)
                                }
                              }}
                            />
                            <div className="review-inline-reply-footer">
                              <span className="review-composer-hint">{reviewReplyText.length}/4000</span>
                              <div>
                                <button
                                  type="button"
                                  className="quiet-action compact-action"
                                  disabled={reviewCommentBusy}
                                  onClick={() => {
                                    setReviewReplyToId(null)
                                    setReviewReplyText('')
                                  }}
                                >
                                  {tx('cancel')}
                                </button>
                                <button
                                  type="button"
                                  className="primary-action compact-action"
                                  disabled={reviewCommentBusy || !reviewReplyText.trim()}
                                  aria-busy={reviewCommentBusy || undefined}
                                  onClick={() => void handleSubmitReply(comment.id, replyTarget.authorId)}
                                >
                                  {reviewCommentBusy ? (
                                    <PendingLabel label={tx('working')} iconSize={12} />
                                  ) : (
                                    <>
                                      <Reply size={12} aria-hidden="true" /> {tx('dossier.reviewReplySubmit')}
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          </CollapsiblePanel>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })()}
      </div>
      <ProjectFooter />
      {pendingDraftExit && (
        <ModalPortal>
          <div
            className={`dialog-layer composer-exit-layer${draftExitExiting ? ' exiting' : ''}`}
            onClick={(event) => {
              if (event.target === event.currentTarget) requestDraftExitClose()
            }}
          >
            <section
              ref={draftExitDialogRef}
              className="composer-exit-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="draft-exit-title"
              aria-describedby="draft-exit-message"
            >
              <div className="composer-exit-icon">
                <AlertCircle size={22} aria-hidden="true" />
              </div>
              <div className="composer-exit-copy">
                <h3 id="draft-exit-title">
                  {tx(pendingDraftExit.blocked ? 'dossier.saveBlockedTitle' : 'dossier.unsavedChangesTitle')}
                </h3>
                <p id="draft-exit-message">
                  {tx(pendingDraftExit.blocked ? 'dossier.saveBlockedMessage' : 'dossier.unsavedChangesMessage')}
                </p>
                {pendingDraftExit.blocked && saveErrorMessage ? (
                  <p className="composer-exit-reason">{saveErrorMessage}</p>
                ) : null}
              </div>
              <div className="composer-exit-actions">
                <button
                  type="button"
                  className="primary-action save-action"
                  onClick={() =>
                    requestDraftExitClose(() => {
                      void handlePendingDraftSave()
                    })
                  }
                  disabled={saving}
                  aria-busy={saving || undefined}
                >
                  {saving ? (
                    <PendingLabel label={tx('dossier.saving')} iconSize={14} />
                  ) : (
                    <>
                      <Save size={14} aria-hidden="true" />{' '}
                      {tx(pendingDraftExit.blocked ? 'dossier.retrySave' : 'dossier.save')}
                    </>
                  )}
                </button>
                {pendingDraftExit.blocked && onReviewSaveFailure ? (
                  <button
                    type="button"
                    className="quiet-action"
                    onClick={() => requestDraftExitClose(() => onReviewSaveFailure())}
                  >
                    <Search size={14} aria-hidden="true" /> {tx('dossier.reviewSaveProblem')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="warning-action"
                  onClick={() => requestDraftExitClose(handlePendingDraftDiscard)}
                >
                  <Undo2 size={14} aria-hidden="true" /> {tx('dossier.discardChanges')}
                </button>
                <button type="button" className="quiet-action" onClick={() => requestDraftExitClose()}>
                  <X size={14} aria-hidden="true" /> {tx('cancel')}
                </button>
              </div>
            </section>
          </div>
        </ModalPortal>
      )}
      {pendingResourceSettingsExit && (
        <ModalPortal>
          <div
            className={`dialog-layer composer-exit-layer${resourceSettingsExitExiting ? ' exiting' : ''}`}
            onClick={(event) => {
              if (event.target === event.currentTarget) requestResourceSettingsExitClose()
            }}
          >
            <section
              ref={resourceSettingsExitDialogRef}
              className="composer-exit-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="resource-settings-exit-title"
              aria-describedby="resource-settings-exit-message"
            >
              <div className="composer-exit-icon">
                <AlertCircle size={22} aria-hidden="true" />
              </div>
              <div className="composer-exit-copy">
                <h3 id="resource-settings-exit-title">{tx('dossier.unsavedChangesTitle')}</h3>
                <p id="resource-settings-exit-message">{tx('dossier.unsavedChangesMessage')}</p>
              </div>
              <div className="composer-exit-actions">
                <button
                  type="button"
                  className="primary-action save-action"
                  onClick={() =>
                    requestResourceSettingsExitClose(() => {
                      void handlePendingResourceSettingsSave()
                    })
                  }
                  disabled={saving}
                  aria-busy={saving || undefined}
                >
                  {saving ? (
                    <PendingLabel label={tx('dossier.saving')} iconSize={14} />
                  ) : (
                    <>
                      <Save size={14} aria-hidden="true" /> {tx('dossier.save')}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="warning-action"
                  onClick={() => requestResourceSettingsExitClose(handlePendingResourceSettingsDiscard)}
                >
                  <Undo2 size={14} aria-hidden="true" /> {tx('dossier.discardChanges')}
                </button>
                <button type="button" className="quiet-action" onClick={() => requestResourceSettingsExitClose()}>
                  <X size={14} aria-hidden="true" /> {tx('cancel')}
                </button>
              </div>
            </section>
          </div>
        </ModalPortal>
      )}
      {pendingItemEditExit && (
        <ModalPortal>
          <div
            className={`dialog-layer composer-exit-layer${itemEditExitExiting ? ' exiting' : ''}`}
            onClick={(event) => {
              if (event.target === event.currentTarget) requestItemEditExitClose()
            }}
          >
            <section
              ref={itemEditExitDialogRef}
              className="composer-exit-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="item-edit-exit-title"
              aria-describedby="item-edit-exit-message"
            >
              <div className="composer-exit-icon">
                <AlertCircle size={22} aria-hidden="true" />
              </div>
              <div className="composer-exit-copy">
                <h3 id="item-edit-exit-title">{tx('dossier.unsavedEditorTitle')}</h3>
                <p id="item-edit-exit-message">{tx('dossier.unsavedEditorMessage')}</p>
              </div>
              <div className="composer-exit-actions">
                <button
                  type="button"
                  className="primary-action save-action"
                  onClick={() =>
                    requestItemEditExitClose(() => {
                      void handlePendingItemEditSave()
                    })
                  }
                  disabled={
                    savingScholarshipId !== null
                    || savingPendingChecklistCreate
                    || (pendingItemEditExit.kind === 'scholarship-add' && !scholarshipDraft.name.trim())
                    || (pendingItemEditExit.kind === 'checklist-create' && !pendingChecklistCreateIsValid())
                    || (
                      pendingItemEditExit.kind === 'recommender-create'
                      && (pendingItemEditExit.ids ?? []).some((id) => {
                        const recommender = pendingOverviewRecommendersRef.current.find((item) => item.id === id)
                        return !recommender || !hasApplicationRecommenderIdentity(recommender)
                      })
                    )
                  }
                >
                  <Save size={14} aria-hidden="true" /> {tx('dossier.save')}
                </button>
                <button
                  type="button"
                  className="warning-action"
                  onClick={() => requestItemEditExitClose(handlePendingItemEditDiscard)}
                >
                  <Undo2 size={14} aria-hidden="true" /> {tx('dossier.discardChanges')}
                </button>
                <button type="button" className="quiet-action" onClick={() => requestItemEditExitClose()}>
                  <X size={14} aria-hidden="true" /> {tx('cancel')}
                </button>
              </div>
            </section>
          </div>
        </ModalPortal>
      )}
      {onPreview ? (
        <AttachmentPreviewDialog
          file={attachmentPreview}
          loadFile={onPreview}
          onClose={() => setAttachmentPreview(null)}
        />
      ) : null}
      <ExplorerContextMenu menu={explorerMenu} onClose={closeExplorerMenu} />
      <ConfirmDialog
        open={pendingRecommenderDecision !== null}
        title={tx('dossier.recommenderSyncTitle', 'Update this recommender everywhere?')}
        message={pendingRecommenderDecision
          ? format(
              tx(
                'dossier.recommenderSyncMessage',
                'You changed {name}. Sync the new name, email and phone to the profile and every linked application, or keep this application as an independent recommender?',
              ),
              { name: pendingRecommenderDecision.name },
            )
          : ''}
        confirmLabel={tx('dossier.recommenderSyncAll', 'Sync everywhere')}
        secondaryLabel={tx('dossier.recommenderKeepIndependent', 'Keep only here')}
        cancelLabel={tx('cancel')}
        onConfirm={() => settleRecommenderDecision('sync')}
        onSecondary={() => settleRecommenderDecision('independent')}
        onCancel={() => settleRecommenderDecision(null)}
      />
      <ConfirmDialog
        open={pendingMissingAttachmentSend !== null}
        title={tx('dossier.missingAttachmentTitle')}
        message={tx('dossier.missingAttachmentMessage')}
        confirmLabel={tx('dossier.sendWithoutAttachment')}
        cancelLabel={tx('cancel')}
        onConfirm={() => handleMissingAttachmentDecision(true)}
        onCancel={() => handleMissingAttachmentDecision(false)}
      />
      <ConfirmDialog
        open={confirmRemoveAttachment !== null}
        title={tx('dossier.removeAttachment')}
        message={tx('dossier.removeAttachmentConfirm')}
        confirmLabel={tx('dossier.remove')}
        cancelLabel={tx('cancel')}
        variant="danger"
        onConfirm={async () => {
          if (confirmRemoveAttachment) {
            const { kind, itemId, fileId } = confirmRemoveAttachment
            if (kind === 'material') {
              const material = draft.materials.find((m) => m.id === itemId)
              if (material) await removeChecklistAttachment('material', material, fileId)
            } else {
              const task = draft.tasks.find((t) => t.id === itemId)
              if (task) await removeChecklistAttachment('task', task, fileId)
            }
            setConfirmRemoveAttachment(null)
          }
        }}
        onCancel={() => setConfirmRemoveAttachment(null)}
      />
      <ConfirmDialog
        open={confirmRemoveCommunicationId !== null}
        title={tx('dossier.deleteCommunication')}
        message={tx('dossier.deleteCommunicationConfirm')}
        confirmLabel={tx('dossier.delete')}
        cancelLabel={tx('cancel')}
        variant="danger"
        onConfirm={() => {
          if (confirmRemoveCommunicationId !== null) {
            removeCommunications([confirmRemoveCommunicationId])
            setConfirmRemoveCommunicationId(null)
          }
        }}
        onCancel={() => setConfirmRemoveCommunicationId(null)}
      />
      <ConfirmDialog
        open={confirmRemoveScholarshipId !== null}
        title={tx('dossier.deleteScholarship')}
        message={tx('dossier.deleteScholarshipConfirm')}
        confirmLabel={tx('dossier.remove')}
        cancelLabel={tx('cancel')}
        variant="danger"
        onConfirm={() => {
          if (confirmRemoveScholarshipId !== null) {
            removeScholarships([confirmRemoveScholarshipId])
            setConfirmRemoveScholarshipId(null)
          }
        }}
        onCancel={() => setConfirmRemoveScholarshipId(null)}
      />
    </section>
  )
}
