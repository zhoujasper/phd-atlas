import '../../styles/dossier-collapsed.css'
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
  Trash2,
  Trophy,
  Undo2,
  University,
  UploadCloud,
  User,
  UserCheck,
  UserRoundSearch,
  Users,
  UsersRound,
  WalletCards,
  Waypoints,
  Wifi,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Fragment, memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type SetStateAction } from 'react'
import { createPortal, flushSync } from 'react-dom'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { phdApi, type AiDraftEvent, type AiDraftInput, type AiKey, type AuthSession, type CommunicationAttachmentInput, type CommunicationInput, type CommunicationPatchInput, type CommunicationSendInput, type ProfileAsset, type TeamRole } from '../../api/phdApi'
import type {
  ApplicationRecord,
  ApplicationStatus,
  MaterialRecommender,
  MaterialStatus,
} from '../../data/applications'
import type { DetailTab } from '../../appModel'
import { formatDate, today, daysUntil, deadlineUrgency, relativeTime, groupTimelineEvents, priorityToLevel, priorityTone, timelineDateStatus } from '../../appModel'
import { countryDisplayName } from '../../data/countries'
import { PrioritySlider } from '../shared/PrioritySlider'
import { contentLanguagesFromSettings } from '../../contentLanguages'
import { normalizeErrorMessage } from '../../errorMessages'
import { formatList, localeForLanguage, localizeStaticText, t as translate, tpl, type Language } from '../../i18n'
import { materialStatusMenuTone, statusCssSlug, statusLabel } from '../../statusLabels'
import { profileKindLabel } from '../../profileAssets'
import { safeExternalHttpUrl, safeMailtoHref, safeTelHref } from '../../safeLinks'
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
import { TimePicker } from '../shared/TimePicker'
import { Select } from '../shared/Select'
import { CountrySelect } from '../shared/CountrySelect'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { hasExplorerSelectionModifier, useExplorerSelection } from '../hooks/useExplorerSelection'
import { useModalA11y } from '../hooks/useModalA11y'
import { CollapsiblePanel } from '../shared/CollapsiblePanel'
import { InlinePresence } from '../shared/InlinePresence'
import { InfoTooltip } from '../shared/InfoTooltip'
import { AssetInsertMenu, type InsertLanguage } from '../shared/AssetInsertMenu'
import { ExplorerContextMenu, type ExplorerContextMenuState } from '../shared/ExplorerContextMenu'
import { ExplorerSelectionBar } from '../shared/ExplorerSelectionBar'
import { FileDropzone } from '../shared/FileDropzone'
import FeeTracker from '../shared/FeeTracker'
import { MarkdownContent } from '../shared/MarkdownContent'
import { LazyMarkdownTextarea as MarkdownTextarea } from '../shared/LazyMarkdownTextarea'
import { AiDraftPanel } from '../shared/AiDraftPanel'
import { AnchoredPopover } from '../shared/AnchoredPopover'
import {
  TableCell,
  TableColGroup,
  TableHeaderCell,
  useTableColumnMenu,
} from '../shared/TableColumnChrome'
import type { TableColumnDef } from '../shared/useTableColumns'

const statusOrder: ApplicationStatus[] = [
  'Draft', 'Preparing', 'Submitted', 'Interview', 'Accepted', 'Rejected', 'Waitlist',
]

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
const BASE_DETAIL_TABS: DetailTab[] = ['dossier', 'materials', 'mail', 'funding', 'timeline']
const scholarshipStatusOrder = ['Draft', 'Preparing', 'Submitted', 'Awarded', 'Rejected'] as const

const checklistGroups = [
  'Core materials',
  'Recommendations',
  'Testing',
  'Portal',
  'Writing',
  'Funding',
  'Administrative',
  'Interview',
  'Post-submit',
  'Visa',
  'Submission',
  'Custom',
] as const

type ChecklistGroup = typeof checklistGroups[number]
type MaterialItem = ApplicationRecord['materials'][number]
type TaskItem = ApplicationRecord['tasks'][number]
type CommunicationItem = ApplicationRecord['communications'][number]
type ScholarshipItem = ApplicationRecord['scholarships'][number]
type DossierResourceCard = NonNullable<ApplicationRecord['dossierCards']>[number]
type DossierResourceField = DossierResourceCard['fields'][number]
type DossierResourceFieldType = DossierResourceField['type']
type DossierResourceCardSettingsDraft = Pick<DossierResourceCard, 'title' | 'icon' | 'color' | 'width' | 'fields'>
type DossierResourceCardWidth = NonNullable<DossierResourceCard['width']>
type DossierResourceFieldWidth = NonNullable<DossierResourceField['width']>
type ScholarshipStatus = typeof scholarshipStatusOrder[number]
type ScholarshipMaterialItem = NonNullable<ScholarshipItem['materials']>[number]
type ScholarshipTaskItem = NonNullable<ScholarshipItem['tasks']>[number]
type ScholarshipTimelineItem = NonNullable<ScholarshipItem['timeline']>[number]
type ScholarshipFormDraft = {
  name: string
  amount: string
  startDate: string
  endDate: string
  school: string
  issuer: string
  status: ScholarshipStatus
  notes: string
  materials: ScholarshipMaterialItem[]
  tasks: ScholarshipTaskItem[]
  timeline: ScholarshipTimelineItem[]
}
type ChecklistUploadTarget =
  | { kind: 'material'; id: string }
  | { kind: 'task'; id: string }
  | null
type ReminderMenuTarget =
  | { kind: 'material'; id: string }
  | { kind: 'task'; id: string }
  | null
type UploadDraftFile = {
  id: string
  file: File
  name: string
}
type MaterialFilter = 'all' | `status:${string}` | 'with-reminder' | 'with-attachment'
type MaterialSort = 'manual' | 'name' | 'status' | 'group' | 'updated'
type TaskFilter = 'all' | 'open' | 'done' | 'overdue' | 'with-attachment' | 'with-reminder'
type TaskSort = 'manual' | 'due' | 'title' | 'status'
type ChecklistDropPosition = 'before' | 'after'

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
type ChecklistDragTarget =
  | { kind: 'material'; id: string }
  | { kind: 'task'; id: string }
  | null
type ChecklistDropTarget =
  | { kind: 'material'; id: string; position: ChecklistDropPosition }
  | { kind: 'task'; id: string; position: ChecklistDropPosition }
  | null
type ChecklistDragOffset =
  | { kind: 'material'; id: string; x: number; y: number; left: number; top: number; width: number; height: number }
  | { kind: 'task'; id: string; x: number; y: number; left: number; top: number; width: number; height: number }
  | null
type ChecklistDragSession = {
  kind: 'material' | 'task'
  id: string
  pointerId: number
  startX: number
  startY: number
  left: number
  top: number
  width: number
  height: number
  hasMoved: boolean
  handle: HTMLElement
  item: HTMLElement
  scrollParent: HTMLElement | null
  frame: number
  latestClientX: number
  latestClientY: number
}
type DossierResourceDropTarget = { id: string; position: ChecklistDropPosition } | null
type DossierResourceDragOffset =
  | { id: string; x: number; y: number; left: number; top: number; width: number; height: number }
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
/** Where a generated (non-manual) timeline card should jump to when clicked. */
type TimelineNav =
  | { tab: 'dossier' }
  | { tab: 'materials'; kind: 'material' | 'task'; id: string }
  | { tab: 'mail'; id: string }
  | { tab: 'funding'; scholarshipId: string }
type DossierJumpExpand =
  | { kind: 'material' | 'task'; id: string }
  | { kind: 'scholarship'; id: string }
export type DossierJumpIntent = {
  token: number
  tab: DetailTab
  targetId: string
  fallbackText?: string[]
  expand?: DossierJumpExpand
}

function ChecklistDisclosureItem({
  id,
  kind,
  itemId,
  tour,
  externalOpen,
  syncVersion,
  className,
  style,
  ariaSelected,
  onContextMenu,
  children,
}: {
  id: string
  kind: 'material' | 'task'
  itemId: string
  tour?: string
  externalOpen: boolean
  syncVersion: number
  className: (open: boolean) => string
  style?: CSSProperties
  ariaSelected: boolean
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void
  children: (open: boolean, toggle: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(externalOpen)

  useEffect(() => {
    setOpen(externalOpen)
  }, [externalOpen, syncVersion])

  const toggle = useCallback(() => {
    setOpen((current) => !current)
  }, [])

  return (
    <div
      id={id}
      data-checklist-kind={kind}
      data-checklist-id={itemId}
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

function DossierTabStrip({
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
  const activeTab = optimisticTab ?? tab

  useEffect(() => {
    if (optimisticTab === null) return
    if (optimisticTab === tab || !detailTabs.includes(optimisticTab)) {
      setOptimisticTab(null)
    }
  }, [detailTabs, optimisticTab, tab])

  const labelForTab = (key: DetailTab) =>
    key === 'dossier'
      ? tx('dossier.tabs.dossier')
      : key === 'materials'
        ? tx('dossier.tabs.materials')
        : key === 'mail'
          ? tx('dossier.tabs.mail')
          : key === 'funding'
            ? tx('dossier.tabs.funding')
            : key === 'review'
              ? tx('dossier.tabs.review')
              : tx('dossier.tabs.timeline')

  return (
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
  )
}

function DossierDeferredRows({ className = '' }: { className?: string }) {
  return (
    <div className={`dossier-list-deferred${className ? ` ${className}` : ''}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}

type EmailAttachmentDraft = CommunicationAttachmentInput & {
  id: string
  name: string
  assetId?: string
  fileId?: string
  file?: File
  fileSize?: number
  mimeType?: string
}
type CorrespondenceKind =
  | 'outgoing-email'
  | 'incoming-email'
  | 'outgoing-message'
  | 'incoming-message'
  | 'note'

type CorrespondenceMode = 'draft-email' | 'record-email' | 'record-message' | 'note'
type CorrespondenceView = 'all' | 'drafts'
type ComposerExitRequest = { proceed: () => void; keepOpenAfterSave?: boolean }

const checklistGroupI18n: Record<ChecklistGroup, string> = {
  'Core materials': 'core',
  Recommendations: 'recommendations',
  Testing: 'testing',
  Portal: 'portal',
  Writing: 'writing',
  Funding: 'funding',
  Administrative: 'administrative',
  Interview: 'interview',
  'Post-submit': 'postSubmit',
  Visa: 'visa',
  Submission: 'submission',
  Custom: 'custom',
}

const correspondenceKinds: Array<{
  value: CorrespondenceKind
  labelKey: string
  channel: 'Email' | 'Message' | 'Note'
  direction: 'incoming' | 'outgoing' | 'note'
}> = [
  { value: 'outgoing-email', labelKey: 'dossier.correspondenceTypes.outgoingEmail', channel: 'Email', direction: 'outgoing' },
  { value: 'incoming-email', labelKey: 'dossier.correspondenceTypes.incomingEmail', channel: 'Email', direction: 'incoming' },
  { value: 'outgoing-message', labelKey: 'dossier.correspondenceTypes.outgoingMessage', channel: 'Message', direction: 'outgoing' },
  { value: 'incoming-message', labelKey: 'dossier.correspondenceTypes.incomingMessage', channel: 'Message', direction: 'incoming' },
  { value: 'note', labelKey: 'dossier.correspondenceTypes.note', channel: 'Note', direction: 'note' },
]

const dossierResourceFieldTypes: DossierResourceFieldType[] = [
  'url',
  'text',
  'textarea',
  'email',
  'phone',
  'contact',
  'tags',
  'date',
]

const dossierResourceColors = [
  { value: 'accent', labelKey: 'dossier.resourceColors.accent' },
  { value: 'blue', labelKey: 'dossier.resourceColors.blue' },
  { value: 'green', labelKey: 'dossier.resourceColors.green' },
  { value: 'orange', labelKey: 'dossier.resourceColors.orange' },
  { value: 'red', labelKey: 'dossier.resourceColors.red' },
  { value: 'violet', labelKey: 'dossier.resourceColors.violet' },
  { value: 'slate', labelKey: 'dossier.resourceColors.slate' },
] as const

type DossierResourceColor = typeof dossierResourceColors[number]['value']
const dossierResourceCardWidths: DossierResourceCardWidth[] = ['half', 'full']
const dossierResourceFieldWidths: DossierResourceFieldWidth[] = ['half', 'full']

type DossierResourceIconPreset = {
  id: string
  icon: string
  label: string
  labelKey: string
  keywords: string
}

function createDossierResourceIconPreset(
  id: string,
  icon: string,
  label: string,
  keywords: string,
): DossierResourceIconPreset {
  return {
    id,
    icon,
    label,
    labelKey: `dossier.resourceIconLabels.${id}`,
    keywords,
  }
}

const dossierResourceIconPresets = [
  createDossierResourceIconPreset('link', 'Link', 'Link', 'url link website href 链接 网站 网址'),
  createDossierResourceIconPreset('globe', 'Globe', 'Website', 'global web admissions international 网页 网站 国际'),
  createDossierResourceIconPreset('door-open', 'DoorOpen', 'Portal', 'portal application login door 网申 门户 登录 入口'),
  createDossierResourceIconPreset('key', 'KeyRound', 'Account', 'password account login key credential 账号 密码 登录'),
  createDossierResourceIconPreset('checklist', 'ClipboardList', 'Checklist', 'checklist task requirements todo 清单 要求 任务'),
  createDossierResourceIconPreset('file', 'FileText', 'File', 'document file pdf material 文件 材料 文档'),
  createDossierResourceIconPreset('file-pen', 'FilePenLine', 'Writing', 'writing essay sop statement 文书 写作 文档'),
  createDossierResourceIconPreset('professor', 'GraduationCap', 'Professor', 'professor advisor faculty mentor 导师 教授'),
  createDossierResourceIconPreset('user', 'User', 'Person', 'person contact user applicant 联系人 用户'),
  createDossierResourceIconPreset('building', 'Building2', 'Department', 'department building office 院系 学院 办公室'),
  createDossierResourceIconPreset('school', 'Library', 'University', 'university library school 大学 学校 图书馆'),
  createDossierResourceIconPreset('book', 'BookOpen', 'Research', 'research reading program book 研究 项目 书'),
  createDossierResourceIconPreset('book-marked', 'BookMarked', 'Guide', 'saved bookmark guideline guide 收藏 指南 书签'),
  createDossierResourceIconPreset('lab', 'Compass', 'Lab', 'lab research direction compass 实验室 方向'),
  createDossierResourceIconPreset('email', 'Mail', 'Email', 'mail email inbox 邮件 邮箱'),
  createDossierResourceIconPreset('mail-check', 'MailCheck', 'Confirmed mail', 'verified received mail confirmed 已确认 邮件'),
  createDossierResourceIconPreset('at', 'AtSign', 'Social handle', 'social handle at username 社交 账号'),
  createDossierResourceIconPreset('phone', 'PhoneCall', 'Phone', 'phone call contact 电话 联系'),
  createDossierResourceIconPreset('message', 'MessageCircle', 'Message', 'message chat note 消息 聊天 备注'),
  createDossierResourceIconPreset('chat', 'MessageSquare', 'Conversation', 'conversation thread chat dialog 往来 对话 聊天'),
  createDossierResourceIconPreset('calendar', 'Calendar', 'Date', 'date deadline event calendar 日期 截止 日历'),
  createDossierResourceIconPreset('clock', 'Clock', 'Time', 'time reminder schedule clock 时间 提醒 日程'),
  createDossierResourceIconPreset('location', 'MapPin', 'Location', 'address campus location pin 地址 校区 地点'),
  createDossierResourceIconPreset('wallet', 'WalletCards', 'Payment', 'fee payment tuition wallet 费用 支付 学费'),
  createDossierResourceIconPreset('funding', 'CircleDollarSign', 'Funding', 'funding scholarship money dollar 奖学金 资金 钱'),
  createDossierResourceIconPreset('award', 'Award', 'Award', 'award fellowship honor certificate 奖项 荣誉'),
  createDossierResourceIconPreset('shield', 'ShieldCheck', 'Security', 'visa security privacy shield 签证 安全 隐私'),
  createDossierResourceIconPreset('id', 'IdCard', 'ID', 'id identity account number 身份 编号 账号'),
  createDossierResourceIconPreset('notes', 'NotebookTabs', 'Notes', 'notes memo notebook remarks 备注 笔记'),
  createDossierResourceIconPreset('tags', 'Tags', 'Tags', 'tags labels category 标签 分类'),
  createDossierResourceIconPreset('bank', 'Landmark', 'Office', 'office finance institution bank 办公室 财务 机构'),
  createDossierResourceIconPreset('upload', 'UploadCloud', 'Upload', 'upload submit submission cloud 上传 提交'),
  createDossierResourceIconPreset('briefcase', 'Briefcase', 'Work', 'career work professional job 工作 职业'),
  createDossierResourceIconPreset('folder-open', 'FolderOpen', 'Folder', 'folder archive collection 文件夹 归档'),
  createDossierResourceIconPreset('file-check', 'FileCheck', 'Approved file', 'approved submitted complete file 已提交 完成 文件'),
  createDossierResourceIconPreset('file-clock', 'FileClock', 'Pending file', 'pending waiting draft file 等待 草稿 文件'),
  createDossierResourceIconPreset('file-lock', 'FileLock', 'Private file', 'locked private secure file 私密 加密 文件'),
  createDossierResourceIconPreset('file-search', 'FileSearch', 'Review file', 'review search scan file 审核 搜索 文件'),
  createDossierResourceIconPreset('file-up', 'FileUp', 'Upload file', 'file upload attachment 上传 附件 文件'),
  createDossierResourceIconPreset('files', 'Files', 'Files', 'multiple files copies documents 多文件 文档'),
  createDossierResourceIconPreset('paperclip', 'Paperclip', 'Attachment', 'attachment paperclip clip 附件'),
  createDossierResourceIconPreset('pencil-line', 'PencilLine', 'Edit note', 'edit write pencil note 编辑 书写'),
  createDossierResourceIconPreset('signature', 'Signature', 'Signature', 'signature sign form 签名 签字 表格'),
  createDossierResourceIconPreset('stamp', 'Stamp', 'Stamp', 'stamp official seal approval 印章 盖章 官方'),
  createDossierResourceIconPreset('badge-check', 'BadgeCheck', 'Verified', 'verified check approved badge 认证 通过'),
  createDossierResourceIconPreset('badge-dollar', 'BadgeDollarSign', 'Fee badge', 'fee dollar payment badge 费用 支付'),
  createDossierResourceIconPreset('badge-info', 'BadgeInfo', 'Info badge', 'info detail badge 信息 说明'),
  createDossierResourceIconPreset('bell-ring', 'BellRing', 'Reminder', 'alert reminder notification bell 提醒 通知'),
  createDossierResourceIconPreset('bookmark', 'Bookmark', 'Bookmark', 'bookmark saved favorite 收藏 标记'),
  createDossierResourceIconPreset('book-open-check', 'BookOpenCheck', 'Requirement', 'requirement guideline check 要求 指南'),
  createDossierResourceIconPreset('book-text', 'BookText', 'Handbook', 'handbook catalog text manual 手册 文本'),
  createDossierResourceIconPreset('brain', 'Brain', 'Research idea', 'brain research idea cognition 研究 想法'),
  createDossierResourceIconPreset('chart-bar', 'ChartNoAxesColumn', 'Stats', 'chart stats ranking bar 统计 排名'),
  createDossierResourceIconPreset('chart-pie', 'ChartPie', 'Analysis', 'chart pie analytics 分析 图表'),
  createDossierResourceIconPreset('check-check', 'CheckCheck', 'Completed', 'complete done double check 完成 勾选'),
  createDossierResourceIconPreset('alert', 'CircleAlert', 'Alert', 'alert warning issue 注意 警告'),
  createDossierResourceIconPreset('check-circle', 'CircleCheck', 'Accepted', 'accepted success complete 通过 成功'),
  createDossierResourceIconPreset('help-circle', 'CircleHelp', 'Help', 'help question faq support 帮助 问题'),
  createDossierResourceIconPreset('profile', 'CircleUserRound', 'Profile', 'profile person applicant 画像 个人'),
  createDossierResourceIconPreset('cloud', 'Cloud', 'Cloud', 'cloud online storage 云端 在线'),
  createDossierResourceIconPreset('cloud-upload', 'CloudUpload', 'Cloud upload', 'cloud upload sync 云 上传 同步'),
  createDossierResourceIconPreset('code', 'Code', 'Code', 'code technical cs github 代码 计算机'),
  createDossierResourceIconPreset('compass', 'Compass', 'Direction', 'direction fit strategy compass 方向 策略'),
  createDossierResourceIconPreset('contact', 'Contact', 'Contact card', 'contact card address book 联系人 名片'),
  createDossierResourceIconPreset('database', 'Database', 'Database', 'database record data 数据库 记录'),
  createDossierResourceIconPreset('earth', 'Earth', 'International', 'earth global international world 国际 世界'),
  createDossierResourceIconPreset('external', 'ExternalLink', 'External link', 'external open outbound link 外链 打开'),
  createDossierResourceIconPreset('eye', 'Eye', 'View', 'view visible preview eye 查看 预览'),
  createDossierResourceIconPreset('flag', 'Flag', 'Flag', 'flag milestone priority 标记 里程碑'),
  createDossierResourceIconPreset('handshake', 'Handshake', 'Agreement', 'agreement offer partnership 握手 协议 offer'),
  createDossierResourceIconPreset('heart-handshake', 'HeartHandshake', 'Fit', 'fit relationship support match 匹配 支持'),
  createDossierResourceIconPreset('home', 'Home', 'Home', 'home housing address 住宿 地址 家'),
  createDossierResourceIconPreset('inbox', 'Inbox', 'Inbox', 'inbox received mail 收件箱 接收'),
  createDossierResourceIconPreset('languages', 'Languages', 'Language', 'language translation english chinese 语言 翻译'),
  createDossierResourceIconPreset('laptop', 'Laptop', 'Online system', 'laptop online system computer 在线 系统'),
  createDossierResourceIconPreset('layers', 'Layers', 'Layers', 'layers stack versions 层级 版本'),
  createDossierResourceIconPreset('lightbulb', 'Lightbulb', 'Idea', 'idea insight tip lightbulb 想法 灵感'),
  createDossierResourceIconPreset('list-checks', 'ListChecks', 'Task list', 'task list checklist todo 任务 清单'),
  createDossierResourceIconPreset('lock', 'LockKeyhole', 'Password', 'lock password secure 密码 锁 安全'),
  createDossierResourceIconPreset('map', 'Map', 'Map', 'map campus location 地图 校区'),
  createDossierResourceIconPreset('map-pinned', 'MapPinned', 'Pinned place', 'pin place campus pinned 地点 地址'),
  createDossierResourceIconPreset('megaphone', 'Megaphone', 'Announcement', 'announcement news update 通知 公告'),
  createDossierResourceIconPreset('messages', 'MessagesSquare', 'Messages', 'messages comments thread 消息 评论'),
  createDossierResourceIconPreset('microscope', 'Microscope', 'Lab research', 'microscope lab science research 实验 科研'),
  createDossierResourceIconPreset('network', 'Network', 'Network', 'network connections graph 网络 关系'),
  createDossierResourceIconPreset('newspaper', 'Newspaper', 'News', 'news article page 新闻 文章'),
  createDossierResourceIconPreset('package-check', 'PackageCheck', 'Package', 'package delivery complete 包裹 材料'),
  createDossierResourceIconPreset('panel-top', 'PanelTop', 'Portal page', 'portal page web panel 页面 门户'),
  createDossierResourceIconPreset('plane', 'Plane', 'Travel', 'travel flight visa plane 旅行 航班 签证'),
  createDossierResourceIconPreset('presentation', 'Presentation', 'Presentation', 'presentation slides interview 演示 面试'),
  createDossierResourceIconPreset('qr-code', 'QrCode', 'QR code', 'qr code barcode 二维码 编码'),
  createDossierResourceIconPreset('receipt', 'Receipt', 'Receipt', 'receipt invoice fee 发票 收据 费用'),
  createDossierResourceIconPreset('route', 'Route', 'Route', 'route plan path 路线 计划'),
  createDossierResourceIconPreset('school-campus', 'School', 'Campus', 'school campus college 校园 学校'),
  createDossierResourceIconPreset('search-check', 'SearchCheck', 'Search done', 'search verify lookup 搜索 核查'),
  createDossierResourceIconPreset('send', 'Send', 'Send', 'send submit email 发送 提交'),
  createDossierResourceIconPreset('settings', 'Settings', 'Settings', 'settings config preference 设置 配置'),
  createDossierResourceIconPreset('share', 'Share2', 'Share', 'share link collaboration 分享 链接'),
  createDossierResourceIconPreset('sparkles', 'Sparkles', 'Highlight', 'highlight premium sparkle 重点 高亮'),
  createDossierResourceIconPreset('square-pen', 'SquarePen', 'Edit form', 'edit form write 编辑 表单'),
  createDossierResourceIconPreset('star', 'Star', 'Priority', 'star favorite priority 星标 优先级'),
  createDossierResourceIconPreset('sticky-note', 'StickyNote', 'Memo', 'memo sticky note 便签 备注'),
  createDossierResourceIconPreset('target', 'Target', 'Target', 'target goal fit 目标 匹配'),
  createDossierResourceIconPreset('timer', 'Timer', 'Timer', 'timer countdown deadline 倒计时 截止'),
  createDossierResourceIconPreset('trophy', 'Trophy', 'Outcome', 'trophy result win 结果 奖杯'),
  createDossierResourceIconPreset('university', 'University', 'Institution', 'university institution school 大学 机构'),
  createDossierResourceIconPreset('user-check', 'UserCheck', 'Confirmed person', 'user check verified person 已确认 联系人'),
  createDossierResourceIconPreset('user-search', 'UserRoundSearch', 'Find person', 'find professor user search 查找 导师'),
  createDossierResourceIconPreset('users-round', 'UsersRound', 'Group', 'group team people 群组 团队'),
  createDossierResourceIconPreset('waypoints', 'Waypoints', 'Workflow points', 'workflow process points 流程 节点'),
  createDossierResourceIconPreset('wifi', 'Wifi', 'Online', 'online wifi connection 网络 在线'),
  createDossierResourceIconPreset('workflow', 'Workflow', 'Workflow', 'workflow automation process 流程 自动化'),
  createDossierResourceIconPreset('zap', 'Zap', 'Urgent', 'urgent fast lightning 紧急 快速'),
  createDossierResourceIconPreset('archive-box', 'Archive', 'Archive', 'archive storage saved 归档 保存'),
  createDossierResourceIconPreset('archive-restore', 'ArchiveRestore', 'Restore', 'restore backup archive 恢复 备份'),
]

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
const dossierResourceBuiltinLanguages: Language[] = ['en', 'zh']
const defaultDossierResourceCardTitleKeys: Record<string, string> = {
  'default-application-portal': 'dossier.resourceDefaults.portalTitle',
  'default-program-page': 'dossier.resourceDefaults.programTitle',
  'default-professor-contact': 'dossier.resourceDefaults.professorTitle',
  'default-requirements': 'dossier.resourceDefaults.requirementsTitle',
}
const defaultDossierResourceFieldLabelKeys: Record<string, string> = {
  'default-portal-link': 'dossier.resourceDefaults.portalLink',
  'default-portal-account': 'dossier.resourceDefaults.portalAccount',
  'default-portal-notes': 'dossier.resourceDefaults.portalNotes',
  'default-program-website': 'dossier.resourceDefaults.admissionsWebsite',
  'default-program-name': 'dossier.program',
  'default-program-deadline': 'dossier.deadline',
  'default-professor-email': 'dossier.email',
  'default-professor-homepage': 'dossier.homepage',
  'default-professor-contact': 'dossier.resourceDefaults.contactMethod',
  'default-requirements-tags': 'dossier.tags',
  'default-requirements-notes': 'dossier.resourceDefaults.requirementsNotes',
}
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

function isDossierResourceFieldType(value: unknown): value is DossierResourceFieldType {
  return typeof value === 'string' && dossierResourceFieldTypes.includes(value as DossierResourceFieldType)
}

function normalizeDossierResourceColor(value: unknown): DossierResourceColor {
  return dossierResourceColors.some((color) => color.value === value) ? value as DossierResourceColor : 'accent'
}

function normalizeDossierResourceCardWidth(value: unknown): DossierResourceCardWidth {
  return value === 'full' ? 'full' : 'half'
}

function preferredDossierResourceFieldWidth(type: DossierResourceFieldType): DossierResourceFieldWidth {
  return type === 'textarea' || type === 'tags' ? 'full' : 'half'
}

function normalizeDossierResourceFieldWidth(
  value: unknown,
  type: DossierResourceFieldType,
): DossierResourceFieldWidth {
  if (type === 'textarea') return 'full'
  return value === 'half' || value === 'full' ? value : preferredDossierResourceFieldWidth(type)
}

function normalizeDossierResourceIcon(value: unknown) {
  return typeof value === 'string' && dossierResourceIconMap[value] ? value : 'link'
}

function isDossierResourceBuiltinValue(value: string, key: string) {
  const trimmed = value.trim()
  if (!trimmed) return true
  return dossierResourceBuiltinLanguages.some((language) => translate(language, key) === trimmed)
}

function localizeDossierResourceCardTitle(
  card: DossierResourceCard,
  tx: (key: string, fallback?: string) => string,
) {
  const titleKey = defaultDossierResourceCardTitleKeys[card.id]
  if (titleKey && isDossierResourceBuiltinValue(card.title, titleKey)) return tx(titleKey)
  if (isDossierResourceBuiltinValue(card.title, 'dossier.resourceUntitledCard')) {
    return tx('dossier.resourceUntitledCard')
  }
  return card.title
}

function localizeDossierResourceFieldLabel(
  field: DossierResourceField,
  tx: (key: string, fallback?: string) => string,
) {
  const labelKey = defaultDossierResourceFieldLabelKeys[field.id] ?? `dossier.resourceFieldTypes.${field.type}`
  if (isDossierResourceBuiltinValue(field.label, labelKey)) return tx(labelKey)
  return field.label
}

function createDefaultDossierResourceCards(
  draft: ApplicationRecord,
  tx: (key: string, fallback?: string) => string,
): DossierResourceCard[] {
  return [
    {
      id: 'default-application-portal',
      title: tx('dossier.resourceDefaults.portalTitle'),
      icon: 'door-open',
      color: 'accent',
      width: 'half',
      fields: [
        { id: 'default-portal-link', type: 'url', label: tx('dossier.resourceDefaults.portalLink'), value: '', width: 'half' },
        { id: 'default-portal-account', type: 'text', label: tx('dossier.resourceDefaults.portalAccount'), value: '', width: 'half' },
        { id: 'default-portal-notes', type: 'textarea', label: tx('dossier.resourceDefaults.portalNotes'), value: '', width: 'full' },
      ],
    },
    {
      id: 'default-program-page',
      title: tx('dossier.resourceDefaults.programTitle'),
      icon: 'globe',
      color: 'slate',
      width: 'half',
      fields: [
        { id: 'default-program-website', type: 'url', label: tx('dossier.resourceDefaults.admissionsWebsite'), value: draft.school.website, width: 'half' },
        { id: 'default-program-name', type: 'text', label: tx('dossier.program'), value: draft.program, width: 'half' },
        { id: 'default-program-deadline', type: 'date', label: tx('dossier.deadline'), value: draft.deadline, width: 'half' },
      ],
    },
    {
      id: 'default-professor-contact',
      title: tx('dossier.resourceDefaults.professorTitle'),
      icon: 'email',
      color: 'green',
      width: 'half',
      fields: [
        { id: 'default-professor-email', type: 'email', label: tx('dossier.email'), value: draft.professor.email, width: 'half' },
        { id: 'default-professor-homepage', type: 'url', label: tx('dossier.homepage'), value: draft.professor.homepage, width: 'half' },
        { id: 'default-professor-contact', type: 'contact', label: tx('dossier.resourceDefaults.contactMethod'), value: draft.professor.social || draft.professor.phone, width: 'half' },
      ],
    },
    {
      id: 'default-requirements-notes',
      title: tx('dossier.resourceDefaults.requirementsTitle'),
      icon: 'checklist',
      color: 'orange',
      width: 'half',
      fields: [
        { id: 'default-requirements-tags', type: 'tags', label: tx('dossier.tags'), value: draft.tags.join(', '), width: 'full' },
        { id: 'default-requirements-notes', type: 'textarea', label: tx('dossier.resourceDefaults.requirementsNotes'), value: '', width: 'full' },
      ],
    },
  ]
}

function normalizeDossierResourceCards(
  cards: ApplicationRecord['dossierCards'],
  draft: ApplicationRecord,
  tx: (key: string, fallback?: string) => string,
) {
  const source = Array.isArray(cards) && cards.length > 0 ? cards : createDefaultDossierResourceCards(draft, tx)
  return source.map((card, cardIndex) => ({
    id: String(card.id || `resource-card-${cardIndex + 1}`),
    title: String(card.title ?? ''),
    icon: normalizeDossierResourceIcon(card.icon),
    color: normalizeDossierResourceColor(card.color),
    width: normalizeDossierResourceCardWidth(card.width),
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    fields: (Array.isArray(card.fields) ? card.fields : []).map((field, fieldIndex) => ({
      id: String(field.id || `${card.id || `resource-card-${cardIndex + 1}`}-field-${fieldIndex + 1}`),
      type: isDossierResourceFieldType(field.type) ? field.type : 'text',
      label: String(field.label ?? ''),
      value: String(field.value ?? ''),
      width: normalizeDossierResourceFieldWidth(
        'width' in field ? field.width : undefined,
        isDossierResourceFieldType(field.type) ? field.type : 'text',
      ),
    })),
  }))
}

function createDossierResourceField(
  type: DossierResourceFieldType,
  tx: (key: string, fallback?: string) => string,
  width: DossierResourceFieldWidth = preferredDossierResourceFieldWidth(type),
): DossierResourceField {
  return {
    id: createLocalId('resource-field'),
    type,
    label: tx(`dossier.resourceFieldTypes.${type}`),
    value: type === 'date' ? today : '',
    width,
  }
}

function createDossierResourceCard(
  tx: (key: string, fallback?: string) => string,
  width: DossierResourceCardWidth = 'half',
): DossierResourceCard {
  const stamp = new Date().toISOString()
  return {
    id: createLocalId('resource-card'),
    title: tx('dossier.resourceUntitledCard'),
    icon: 'link',
    color: 'accent',
    width,
    fields: [
      createDossierResourceField('url', tx),
      createDossierResourceField('textarea', tx),
    ],
    createdAt: stamp,
    updatedAt: stamp,
  }
}

function normalizedExternalHref(value: string) {
  return safeExternalHttpUrl(value)
}

function mailtoHref(value: string) {
  return safeMailtoHref(value)
}

function phoneHref(value: string) {
  return safeTelHref(value)
}

function resourceTags(value: string) {
  return value
    .split(/[,，\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function resourceFieldSummary(field: DossierResourceField) {
  if (field.type === 'tags') return resourceTags(field.value).slice(0, 3).join(' · ')
  if (field.type === 'textarea') return field.value.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
  return field.value.trim()
}

function firstSummaryLine(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
}

function joinSummaryValues(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  return values
    .map((value) => value?.trim() ?? '')
    .filter((value) => {
      if (!value || seen.has(value)) return false
      seen.add(value)
      return true
    })
    .join(' · ')
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
  return next
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

function materialStatusFilterValue(status: MaterialStatus): MaterialFilter {
  return `status:${status}`
}

function fileSizeLabel(size?: number) {
  if (!size && size !== 0) return '—'
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB']
  let value = size / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function createScholarshipDraft(school = ''): ScholarshipFormDraft {
  return {
    name: '',
    amount: '',
    startDate: today,
    endDate: today,
    school,
    issuer: '',
    status: 'Preparing',
    notes: '',
    materials: [],
    tasks: [],
    timeline: [],
  }
}

function scholarshipToDraft(scholarship: ScholarshipItem, fallbackSchool = ''): ScholarshipFormDraft {
  return {
    name: scholarship.name ?? '',
    amount: scholarship.amount ?? '',
    startDate: scholarship.startDate || today,
    endDate: scholarship.endDate || scholarship.startDate || today,
    school: scholarship.school || fallbackSchool,
    issuer: scholarship.issuer ?? '',
    status: scholarship.status ?? 'Preparing',
    notes: scholarship.notes ?? '',
    materials: (scholarship.materials ?? []).map((material) => ({
      id: material.id,
      name: material.name,
      status: material.status ?? 'Draft',
      due: material.due ?? '',
      details: material.details ?? '',
    })),
    tasks: (scholarship.tasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      due: task.due || scholarship.endDate || today,
      done: Boolean(task.done),
      details: task.details ?? '',
    })),
    timeline: (scholarship.timeline ?? []).map((event) => ({
      id: event.id,
      title: event.title,
      date: event.date || scholarship.endDate || today,
      note: event.note ?? '',
    })),
  }
}

function cleanScholarshipDraft(draft: ScholarshipFormDraft): Omit<ScholarshipItem, 'id'> {
  const startDate = draft.startDate || today
  const endDate = draft.endDate || startDate
  return {
    name: draft.name.trim(),
    amount: draft.amount.trim(),
    startDate,
    endDate,
    school: draft.school.trim(),
    issuer: draft.issuer.trim(),
    status: draft.status,
    notes: draft.notes.trim(),
    materials: draft.materials
      .filter((material) => material.name.trim())
      .map((material) => ({
        id: material.id,
        name: material.name.trim(),
        status: material.status,
        due: material.due || '',
        details: material.details?.trim() ?? '',
      })),
    tasks: draft.tasks
      .filter((task) => task.title.trim())
      .map((task) => ({
        id: task.id,
        title: task.title.trim(),
        due: task.due || endDate,
        done: Boolean(task.done),
        details: task.details?.trim() ?? '',
      })),
    timeline: draft.timeline
      .filter((event) => event.title.trim())
      .map((event) => ({
        id: event.id,
        title: event.title.trim(),
        date: event.date || endDate,
        note: event.note?.trim() ?? '',
      })),
  }
}

function isChecklistGroup(value: string): value is ChecklistGroup {
  return checklistGroups.includes(value as ChecklistGroup)
}

function isRecommendationMaterial(material: MaterialItem) {
  return material.type === 'Request' || /recommendation|recommender|推荐/i.test(material.name)
}

function normalizeRecommenders(material: MaterialItem, count = material.requiredCount ?? 1): MaterialRecommender[] {
  return Array.from({ length: count }, (_, index) => {
    const recommender = material.recommenders?.[index]
    return {
      id: recommender?.id ?? `${material.id}-recommender-${index + 1}`,
      name: recommender?.name ?? '',
      contact: recommender?.contact ?? '',
    }
  })
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

  const setPreviewDate = useCallback((value: string, direction: 'up' | 'down') => {
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
  }, [lang])

  useEffect(() => {
    let frame = 0
    const updatePreviewDate = () => {
      frame = 0
      const timelinePage = timelinePageRef.current
      if (!timelinePage) return
      const scrollParent = findScrollableAncestor(timelinePage)
      const viewport = !scrollParent || scrollParent === document.scrollingElement
        ? (() => {
            const visualViewport = window.visualViewport
            const top = visualViewport?.offsetTop ?? 0
            const height = visualViewport?.height ?? window.innerHeight
            return { top, bottom: top + height, height }
          })()
        : (() => {
            const rect = scrollParent.getBoundingClientRect()
            return { top: rect.top, bottom: rect.bottom, height: rect.height }
          })()
      const scrollPosition = !scrollParent || scrollParent === document.scrollingElement
        ? window.scrollY
        : scrollParent.scrollTop
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
        const blockDistance = readingLine < rect.top
          ? rect.top - readingLine
          : readingLine > rect.bottom
            ? readingLine - rect.bottom
            : 0
        const centerDistance = Math.abs((rect.top + rect.bottom) / 2 - readingLine)
        if (
          blockDistance < closestBlockDistance
          || (blockDistance === closestBlockDistance && centerDistance < closestCenterDistance)
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
    document.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true })
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
          <DatePicker
            value={indicator.value}
            onChange={selectDate}
            placeholder={dateLabel}
          />
          <span
            ref={readoutRef}
            className={`timeline-jump-date-readout${indicator.previousValue ? ' has-transition' : ''} direction-${indicator.direction}`}
            aria-hidden="true"
          >
            <span
              ref={previousValueRef}
              className="timeline-jump-date-value is-previous"
            >
              {indicator.previousValue ? formatDate(indicator.previousValue, lang) : ''}
            </span>
            <span
              ref={currentValueRef}
              className="timeline-jump-date-value is-current"
            >
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
              {todayDirection === 'up'
                ? <ArrowUp size={12} aria-hidden="true" />
                : todayDirection === 'down'
                  ? <ArrowDown size={12} aria-hidden="true" />
                  : <Target size={12} aria-hidden="true" />}
              <span>{todayLabel}</span>
            </button>
          </span>
        </span>
      </div>
    </div>
  )
})

export function DossierView({
  application, draft, tab, saving, isDirty,
  profileAssets, session,
  deferHeavyContent = false,
  aiKeys = [], onAiDraft, onResolveAiAttachment, onAiInspectorOpenChange, onNotify,
  onTab, onDraft, onSave, onDiscardDraft, onDelete, onShare, onEnrich,
  canToggleTeamVisibility = false,
  onToggleTeamVisibility,
  onCloseApplication,
  onOpenUpgrade,
  onRegisterNavigationGuard,
  onCopy,
  onAddReviewComment,
  applicationOwnerName,
  onUpload, onDownload,
  onUploadMaterialFiles, onUploadTaskFiles,
  onRemoveMaterialFile, onRemoveTaskFile,
  onRenameMaterialFile, onRenameTaskFile,
  onAddTask, onUpdateTask, onToggleTask, onRemoveTask, onRemoveTasks,
  onAddCommunication, onUpdateCommunication, onSendCommunication, onRemoveCommunication, onRemoveCommunications,
  onAddScholarship, onUpdateScholarship, onRemoveScholarship, onRemoveScholarships,
  onAddFee, onUpdateFee, onDeleteFee,
  onAddTimelineEvent,
  onUpdateTimelineEvent,
  onRemoveTimelineEvent,
  onRemoveTimelineEvents,
  jumpIntent,
  allowedTabs,
  readOnly = false,
  readOnlyBanner,
}: {
  application: ApplicationRecord
  draft: ApplicationRecord
  tab: DetailTab
  saving: boolean
  isDirty: boolean
  profileAssets: ProfileAsset[]
  session: AuthSession
  /** True while the parent is capturing a lightweight View Transition target. */
  deferHeavyContent?: boolean
  aiKeys?: AiKey[]
  onAiDraft?: (input: AiDraftInput, onEvent: (event: AiDraftEvent) => void, signal?: AbortSignal) => Promise<void>
  onResolveAiAttachment?: (fileId: string) => Promise<Blob>
  onAiInspectorOpenChange?: (open: boolean) => void
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
  onTab: (tab: DetailTab, direction?: 'forward' | 'backward') => void
  onRegisterNavigationGuard?: (guard: ((proceed: () => void) => boolean) | null) => void
  onDraft: (draft: ApplicationRecord) => void
  onSave: () => void | Promise<void>
  onDiscardDraft: () => void
  onDelete: () => void
  onShare: () => void
  onEnrich?: () => void
  canToggleTeamVisibility?: boolean
  onToggleTeamVisibility?: (visible: boolean) => void | Promise<void>
  onCloseApplication?: () => void
  onOpenUpgrade?: (feature: string, requested: string, limit?: string) => void
  onCopy?: (value: string, label: string) => void
  onUpload: (file: File | null) => void | Promise<void>
  onUploadMaterialFiles?: (materialId: string, files: File[]) => void | Promise<void>
  onUploadTaskFiles?: (taskId: string, files: File[]) => void | Promise<void>
  onRemoveMaterialFile?: (materialId: string, fileId: string) => void | Promise<void>
  onRemoveTaskFile?: (taskId: string, fileId: string) => void | Promise<void>
  onRenameMaterialFile?: (materialId: string, fileId: string, fileName: string) => void | Promise<void>
  onRenameTaskFile?: (taskId: string, fileId: string, fileName: string) => void | Promise<void>
  onDownload: (fileId?: string, name?: string) => void
  onAddTask: (title: string, due: string, options?: Partial<Pick<TaskItem, 'details' | 'reminderEnabled' | 'reminderOffsets' | 'reminderTime' | 'reminderRepeat' | 'attachmentRequired' | 'uploadReserved' | 'allowedFileTypes'>>) => void
  onUpdateTask?: (taskId: string, patch: Partial<Pick<TaskItem, 'title' | 'due' | 'done' | 'details' | 'reminderEnabled' | 'reminderOffsets' | 'reminderTime' | 'reminderRepeat' | 'attachmentRequired' | 'uploadReserved' | 'allowedFileTypes'>>) => void
  onToggleTask: (taskId: string, done: boolean) => void
  onRemoveTask: (taskId: string) => void
  onRemoveTasks?: (taskIds: string[]) => void
  onAddCommunication: (input: CommunicationInput) => void | Promise<void>
  onUpdateCommunication?: (id: string, input: CommunicationPatchInput) => void | Promise<void>
  onSendCommunication?: (input: CommunicationSendInput) => Promise<boolean>
  onRemoveCommunication: (id: string) => void
  onRemoveCommunications?: (ids: string[]) => void
  onAddScholarship: (input: Omit<ScholarshipItem, 'id'>) => void
  onUpdateScholarship?: (id: string, input: Omit<ScholarshipItem, 'id'>) => void | Promise<void>
  onRemoveScholarship: (id: string) => void
  onRemoveScholarships?: (ids: string[]) => void
  onAddFee: (input: { amount: number; currency: string; paidDate?: string; waived: boolean; notes: string }) => void
  onUpdateFee: (feeId: string, patch: { amount?: number; currency?: string; paidDate?: string | null; waived?: boolean; notes?: string }) => void
  onDeleteFee: (feeId: string) => void | Promise<void>
  onAddTimelineEvent?: (title: string, date: string, note: string) => void
  onUpdateTimelineEvent?: (id: string, title: string, date: string, note: string) => void
  onRemoveTimelineEvent?: (id: string) => void
  onRemoveTimelineEvents?: (ids: string[]) => void
  onAddReviewComment?: (body: string, targetTab?: DetailTab) => void | Promise<void>
  // Only set when viewing this application through the team-scoped workspace — the caller's
  // effective role on THIS application ('owner' also covers "it's my own app").
  // undefined/null means the personal workspace.
  currentUserApplicationRole?: TeamRole | null
  // Only set (and only when it isn't the viewer's own application) in the team-scoped workspace.
  applicationOwnerName?: string
  jumpIntent?: DossierJumpIntent | null
  /** Restrict visible dossier tabs (e.g. shared application sections). */
  allowedTabs?: DetailTab[]
  /** Disable all nested form controls and hide owner mutation affordances. */
  readOnly?: boolean
  /** Optional override for the default read-only banner copy. */
  readOnlyBanner?: string
}) {
  const { tx, format, lang } = useI18n()
  const attachmentTableColumns = useMemo<TableColumnDef[]>(() => [
    { id: 'name', label: tx('dossier.uploadFileName'), defaultWidth: 220, minWidth: 120 },
    { id: 'size', label: tx('dossier.fileSize'), defaultWidth: 96, minWidth: 72 },
    { id: 'author', label: tx('dossier.uploadedBy'), defaultWidth: 120, minWidth: 80 },
    { id: 'uploadedAt', label: tx('dossier.uploadedAt'), defaultWidth: 140, minWidth: 100 },
    { id: 'actions', label: tx('dossier.actions'), defaultWidth: 88, minWidth: 72, hideable: false },
  ], [tx])
  const {
    api: attachmentTableApi,
    openMenu: openAttachmentTableMenu,
    menuNode: attachmentTableMenuNode,
  } = useTableColumnMenu('dossier-attachments', attachmentTableColumns)
  const attachmentCol = useMemo(
    () => Object.fromEntries(attachmentTableColumns.map((column) => [column.id, column])) as Record<string, TableColumnDef>,
    [attachmentTableColumns],
  )
  const tabContentReady = !deferHeavyContent
  // Checklist rows are the most expensive tab payload: filtering can localize and
  // sort every material/task. Keep that work out of the transition snapshot.
  const checklistContentReady = tab === 'materials' && tabContentReady
  const canUseDrafts = session.user.role === 'admin'
    || session.user.settings.membershipPlan === 'pro'
    || session.user.settings.membershipPlan === 'team'
  const isReadOnly = readOnly
  // Deleting/sharing a teammate's application is never allowed, even for the institution admin
  // editing it — only the application's actual owner controls those two actions.
  const isOwnApplication = application.ownerId === session.user.id
  const pendingTeamTransfer = application.teamTransferRequest?.status === 'pending' ? application.teamTransferRequest : null
  const isTeamVisible = Boolean(application.teamId)
  const canManageOwnTeamVisibility = isOwnApplication && canToggleTeamVisibility && !isReadOnly
  const shouldShowTeamVisibility = !isReadOnly && Boolean(
    pendingTeamTransfer ||
    (!isOwnApplication && isTeamVisible) ||
    canManageOwnTeamVisibility,
  )
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
  const detailTabs: DetailTab[] = useMemo(() => {
    if (allowedTabs && allowedTabs.length > 0) {
      const unique = allowedTabs.filter((item, index) => allowedTabs.indexOf(item) === index)
      return unique
    }
    return application.teamId ? [...BASE_DETAIL_TABS, 'review'] : BASE_DETAIL_TABS
  }, [allowedTabs, application.teamId])
  const directionForTab = useCallback((nextTab: DetailTab) => (
    detailTabs.indexOf(nextTab) >= detailTabs.indexOf(tab) ? 'forward' : 'backward'
  ), [detailTabs, tab])
  const defaultCorrespondenceMode: CorrespondenceMode = 'draft-email'

  // Form state
  const [pendingTaskCreate, setPendingTaskCreate] = useState(false)
  const [scholarshipAddOpen, setScholarshipAddOpen] = useState(false)
  const [scholarshipDraft, setScholarshipDraft] = useState<ScholarshipFormDraft>(() => createScholarshipDraft(application.school.name))
  const [expandedScholarships, setExpandedScholarships] = useState<Set<string>>(
    () => new Set(application.scholarships.map((item) => item.id)),
  )
  const previousScholarshipIdsRef = useRef<Set<string>>(new Set(application.scholarships.map((item) => item.id)))
  const [editingScholarshipId, setEditingScholarshipId] = useState<string | null>(null)
  const [scholarshipEditDraft, setScholarshipEditDraft] = useState<ScholarshipFormDraft | null>(null)
  const [savingScholarshipId, setSavingScholarshipId] = useState<string | null>(null)
  const [optimisticScholarships, setOptimisticScholarships] = useState<Record<string, ScholarshipItem>>({})
  const [scholarshipMaterialPreviousStatuses, setScholarshipMaterialPreviousStatuses] = useState<Record<string, MaterialStatus>>({})
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
  const [collapsedDossierCoreCards, setCollapsedDossierCoreCards] = useState<Set<string>>(new Set())
  const [expandedDossierResourceCards, setExpandedDossierResourceCards] = useState<Set<string>>(new Set())
  const [editingDossierResourceCardId, setEditingDossierResourceCardId] = useState<string | null>(null)
  const [dossierResourceSettingsDraft, setDossierResourceSettingsDraft] = useState<DossierResourceCardSettingsDraft | null>(null)
  const [recentDossierResourceCardId, setRecentDossierResourceCardId] = useState<string | null>(null)
  const [recentDossierResourceFieldId, setRecentDossierResourceFieldId] = useState<string | null>(null)
  const [dossierResourceIconSearch, setDossierResourceIconSearch] = useState('')
  const [dossierResourceDrag, setDossierResourceDrag] = useState<{ id: string } | null>(null)
  const [dossierResourceDropTarget, setDossierResourceDropTarget] = useState<DossierResourceDropTarget>(null)
  const [dossierResourceDragOffset, setDossierResourceDragOffset] = useState<DossierResourceDragOffset>(null)
  const [expandedMaterials, setExpandedMaterials] = useState<Set<string>>(new Set())
  const [expandedChecklistTasks, setExpandedChecklistTasks] = useState<Set<string>>(new Set())
  const [materialExpansionSyncVersion, setMaterialExpansionSyncVersion] = useState(0)
  const [taskExpansionSyncVersion, setTaskExpansionSyncVersion] = useState(0)
  const [pendingTimelineNav, setPendingTimelineNav] = useState<TimelineNav | null>(null)
  const [checklistSearch, setChecklistSearch] = useState('')
  const [materialFilter, setMaterialFilter] = useState<MaterialFilter>('all')
  const [checklistFilterAnimKey, setChecklistFilterAnimKey] = useState(0)
  const [materialGroupFilter, setMaterialGroupFilter] = useState('all')
  const [materialSort, setMaterialSort] = useState<MaterialSort>('manual')
  const [materialPreviousStatuses, setMaterialPreviousStatuses] = useState<Record<string, MaterialStatus>>({})
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [taskSort, setTaskSort] = useState<TaskSort>('manual')
  const [checklistDrag, setChecklistDrag] = useState<ChecklistDragTarget>(null)
  const [checklistDropTarget, setChecklistDropTarget] = useState<ChecklistDropTarget>(null)
  const [checklistDragOffset, setChecklistDragOffset] = useState<ChecklistDragOffset>(null)
  const [recentChecklistItem, setRecentChecklistItem] = useState<ChecklistDragTarget>(null)
  const [removingMaterialIds, setRemovingMaterialIds] = useState<Set<string>>(new Set())
  const [removingTaskIds, setRemovingTaskIds] = useState<Set<string>>(new Set())
  const [removingCommunicationIds, setRemovingCommunicationIds] = useState<Set<string>>(new Set())
  const [removingScholarshipIds, setRemovingScholarshipIds] = useState<Set<string>>(new Set())
  const [removingTimelineIds, setRemovingTimelineIds] = useState<Set<string>>(new Set())
  const [reviewCommentText, setReviewCommentText] = useState('')
  const [reviewCommentBusy, setReviewCommentBusy] = useState(false)
  const [feedbackNote, setFeedbackNote] = useState('')
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null)
  const [confirmRemoveAttachment, setConfirmRemoveAttachment] = useState<{ kind: 'material' | 'task'; itemId: string; fileId: string } | null>(null)
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
  const {
    exiting: checklistUploadExiting,
    requestClose: requestChecklistUploadClose,
  } = useAnimatedClose(checklistUploadOpen, finalizeChecklistUploadClose, 180, application.id)
  const checklistUploadDialogRef = useModalA11y<HTMLDivElement>({
    open: checklistUploadOpen && !checklistUploadExiting,
    onClose: () => requestChecklistUploadClose(),
  })
  const [reminderMenu, setReminderMenu] = useState<ReminderMenuTarget>(null)
  const [closingReminderMenu, setClosingReminderMenu] = useState<ReminderMenuTarget>(null)
  const [reminderPopoverStyle, setReminderPopoverStyle] = useState<CSSProperties>({})
  const [explorerMenu, setExplorerMenu] = useState<ExplorerContextMenuState | null>(null)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailScheduleDate, setEmailScheduleDate] = useState(today)
  const [emailScheduleTime, setEmailScheduleTime] = useState('')
  const [emailAttachments, setEmailAttachments] = useState<EmailAttachmentDraft[]>([])
  const [emailInsertAnimating, setEmailInsertAnimating] = useState(false)
  const [emailAiRestoreAnimating, setEmailAiRestoreAnimating] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [aiDraftSessionKey, setAiDraftSessionKey] = useState(0)
  const [aiDraftMode, setAiDraftMode] = useState<'compose' | 'reply'>('compose')
  const [aiReplyToId, setAiReplyToId] = useState<string | null>(null)
  const [lastInsertSelection, setLastInsertSelection] = useState<{ ids: string[]; language: InsertLanguage } | null>(null)
  const [renamingAttachmentId, setRenamingAttachmentId] = useState<string | null>(null)
  const [renameAttachmentValue, setRenameAttachmentValue] = useState('')
  /** Checklist material/task file rename: `${kind}:${itemId}:${fileId}` */
  const [renamingChecklistFileKey, setRenamingChecklistFileKey] = useState<string | null>(null)
  const [renameChecklistFileValue, setRenameChecklistFileValue] = useState('')
  const renameChecklistFileInputRef = useRef<HTMLInputElement | null>(null)
  const [correspondenceKind, setCorrespondenceKind] = useState<CorrespondenceKind>('outgoing-email')
  const [composerOpen, setComposerOpen] = useState(false)
  const [correspondenceMode, setCorrespondenceMode] = useState<CorrespondenceMode>(defaultCorrespondenceMode)
  const [correspondenceView, setCorrespondenceView] = useState<CorrespondenceView>('all')
  const [recordDirection, setRecordDirection] = useState<'sent' | 'received'>('sent')
  const [recordFromOverride, setRecordFromOverride] = useState<string | null>(null)
  const [recordToOverride, setRecordToOverride] = useState<string | null>(null)
  const [editingCommunicationId, setEditingCommunicationId] = useState<string | null>(null)
  const [communicationEditDraft, setCommunicationEditDraft] = useState<CommunicationPatchInput | null>(null)
  const [activeRouteSwap, setActiveRouteSwap] = useState<string | null>(null)
  const [pendingComposerExit, setPendingComposerExit] = useState<ComposerExitRequest | null>(null)
  const [pendingDraftExit, setPendingDraftExit] = useState<{ proceed: () => void } | null>(null)
  const [pendingResourceSettingsExit, setPendingResourceSettingsExit] = useState<{ proceed?: () => void; navigation?: boolean } | null>(null)
  const [pendingItemEditExit, setPendingItemEditExit] = useState<{
    kind: 'communication' | 'scholarship' | 'timeline'
    proceed?: () => void
    navigation?: boolean
  } | null>(null)
  useEffect(() => {
    onAiInspectorOpenChange?.(aiPanelOpen)
  }, [aiPanelOpen, onAiInspectorOpenChange])

  useEffect(() => () => onAiInspectorOpenChange?.(false), [onAiInspectorOpenChange])
  const {
    exiting: composerExitExiting,
    requestClose: requestComposerExitClose,
  } = useAnimatedClose(pendingComposerExit !== null, () => setPendingComposerExit(null), undefined, application.id)
  const {
    exiting: draftExitExiting,
    requestClose: requestDraftExitClose,
  } = useAnimatedClose(pendingDraftExit !== null, () => setPendingDraftExit(null), undefined, application.id)
  const {
    exiting: resourceSettingsExitExiting,
    requestClose: requestResourceSettingsExitClose,
  } = useAnimatedClose(pendingResourceSettingsExit !== null, () => setPendingResourceSettingsExit(null), undefined, application.id)
  const {
    exiting: itemEditExitExiting,
    requestClose: requestItemEditExitClose,
  } = useAnimatedClose(pendingItemEditExit !== null, () => setPendingItemEditExit(null), undefined, application.id)
  const composerExitDialogRef = useModalA11y<HTMLElement>({
    open: pendingComposerExit !== null && !composerExitExiting,
    onClose: () => requestComposerExitClose(),
  })
  const draftExitDialogRef = useModalA11y<HTMLElement>({
    open: pendingDraftExit !== null && !draftExitExiting,
    onClose: () => requestDraftExitClose(),
  })
  const resourceSettingsExitDialogRef = useModalA11y<HTMLElement>({
    open: pendingResourceSettingsExit !== null && !resourceSettingsExitExiting,
    onClose: () => requestResourceSettingsExitClose(),
  })
  const itemEditExitDialogRef = useModalA11y<HTMLElement>({
    open: pendingItemEditExit !== null && !itemEditExitExiting,
    onClose: () => requestItemEditExitClose(),
  })
  const draftRef = useRef(draft)
  const activeApplicationIdRef = useRef(application.id)
  const composerBodyRef = useRef<HTMLTextAreaElement | null>(null)
  const dossierResourceDragSessionRef = useRef<DossierResourceDragSession | null>(null)
  const dossierResourceDropTargetRef = useRef<DossierResourceDropTarget>(null)
  const dossierResourceSettingsInitialRef = useRef<string | null>(null)
  const dossierResourceListRef = useRef<HTMLDivElement | null>(null)
  const checklistDragSessionRef = useRef<ChecklistDragSession | null>(null)
  const checklistDropTargetRef = useRef<ChecklistDropTarget>(null)
  const reminderAnchorRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const reminderPopoverRef = useRef<HTMLDivElement | null>(null)
  const reminderCloseTimerRef = useRef<number | null>(null)
  const previousTabRef = useRef<DetailTab>(tab)
  const tabStripRef = useRef<HTMLDivElement | null>(null)
  const tabButtonRefs = useRef<Partial<Record<DetailTab, HTMLButtonElement | null>>>({})
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
  /** The exact range/text of the most recent auto-inserted snippet phrase, so a later selection change can replace it in place instead of appending. */
  const lastInsertRangeRef = useRef<{ start: number; end: number; text: string } | null>(null)
  /** The full email body an in-flight animated write is converging toward — lets a new insert/replace settle a prior one to its intended end state instead of racing it. */
  const pendingWriteTargetRef = useRef<string | null>(null)
  const consumedJumpTokenRef = useRef<number | null>(null)
  const [tabDirection, setTabDirection] = useState<'forward' | 'backward'>('forward')
  const dossierResourceFieldSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const resourceSettingsDirty = Boolean(
    dossierResourceSettingsDraft
    && dossierResourceSettingsInitialRef.current
    && JSON.stringify(dossierResourceSettingsDraft) !== dossierResourceSettingsInitialRef.current,
  )
  const editingCommunication = editingCommunicationId
    ? application.communications.find((item) => item.id === editingCommunicationId) ?? null
    : null
  const communicationEditDirty = Boolean(editingCommunication && communicationEditDraft && JSON.stringify(communicationEditDraft) !== JSON.stringify({
    subject: editingCommunication.subject,
    channel: editingCommunication.channel,
    date: editingCommunication.date || today,
    summary: editingCommunication.summary,
    direction: editingCommunication.direction ?? (editingCommunication.channel === 'Email' ? 'incoming' : 'note'),
    messageType: editingCommunication.messageType ?? 'note',
    from: editingCommunication.from ?? '',
    to: editingCommunication.to ?? '',
    time: editingCommunication.time ?? '',
  }))
  const editingScholarship = editingScholarshipId
    ? application.scholarships.find((item) => item.id === editingScholarshipId) ?? null
    : null
  const scholarshipEditDirty = Boolean(
    editingScholarship
    && scholarshipEditDraft
    && JSON.stringify(scholarshipEditDraft) !== JSON.stringify(scholarshipToDraft(editingScholarship, application.school.name)),
  )
  const editingTimelineEvent = editingEventId
    ? application.timeline.find((item) => item.id === editingEventId) ?? null
    : null
  const timelineEditDirty = Boolean(
    editingTimelineEvent
    && (
      editTitle !== editingTimelineEvent.title
      || editDate !== editingTimelineEvent.date
      || editNote !== editingTimelineEvent.note
    ),
  )
  const itemEditDirty = communicationEditDirty || scholarshipEditDirty || timelineEditDirty

  const due = daysUntil(application.deadline)
  const urgency = deadlineUrgency(due)
  const priorityLevel = priorityToLevel(draft.priority)
  const priorityLevelTone = priorityTone(draft.priority)
  const localize = useCallback((value: string) => localizeStaticText(value, lang), [lang])
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  const commitDraft = useCallback((nextDraft: ApplicationRecord) => {
    if (isReadOnly) return
    draftRef.current = nextDraft
    onDraft(nextDraft)
  }, [isReadOnly, onDraft])
  const professorDisplayName =
    (lang === 'zh' ? draft.professor.chinese : draft.professor.english) ||
    draft.professor.english ||
    draft.professor.chinese ||
    tx('dossier.professor')
  const emailBodyForCommunication = emailBody.trim() || tx('dossier.emptyEmailBody')
  const userSendFrom = session.user.settings.sendFrom || session.user.email
  const receiveEmails = session.user.settings.receiveEmails ?? []
  const primaryReceiveEmail =
    receiveEmails.find((email) => email.isPrimary && (email.verified ?? true))?.address ||
    session.user.settings.receiveAt ||
    session.user.email
  const incomingMailbox = session.user.settings.incomingUser || primaryReceiveEmail
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
    const timer = window.setTimeout(() => {
      commit()
      setRemovingIds((current) => {
        const next = new Set(current)
        uniqueIds.forEach((id) => next.delete(id))
        return next
      })
    }, reduceMotion ? 40 : destroyAnimationMs)
    removalTimersRef.current.push(timer)
  }
  const correspondenceMeta = correspondenceKinds.find((item) => item.value === correspondenceKind) ?? correspondenceKinds[0]
  const correspondenceFrom =
    correspondenceMeta.direction === 'outgoing'
      ? userSendFrom
      : correspondenceMeta.direction === 'incoming'
        ? draft.professor.email
        : session.user.email
  const correspondenceTo =
    correspondenceMeta.direction === 'outgoing'
      ? draft.professor.email
      : correspondenceMeta.direction === 'incoming'
        ? incomingMailbox
        : draft.school.name
  const hasComposerContent =
    emailSubject.trim().length > 0 ||
    emailBody.trim().length > 0 ||
    emailScheduleTime.trim().length > 0 ||
    emailScheduleDate !== today ||
    emailAttachments.length > 0
  const emailSubjectReady = emailSubject.trim().length > 0
  const emailBodyReady = emailBody.trim().length > 0
  const emailHasSchedule = emailScheduleTime.trim().length > 0 || emailScheduleDate !== today
  const emailScheduleSummary = emailHasSchedule
    ? format(tx('dossier.emailScheduledFor'), {
        date: `${formatDate(emailScheduleDate, lang)}${emailScheduleTime.trim() ? ` ${emailScheduleTime.trim()}` : ''}`,
      })
    : tx('dossier.emailManualSend')
  const dossierResourceCards = useMemo(
    () => tab === 'dossier' && tabContentReady
      ? normalizeDossierResourceCards(draft.dossierCards, draft, tx)
      : [],
    [draft, tab, tabContentReady, tx],
  )
  const dossierResourceFieldTypeOptions = useMemo(
    () => dossierResourceFieldTypes.map((type) => ({
      value: type,
      label: tx(`dossier.resourceFieldTypes.${type}`),
    })),
    [tx],
  )
  const filteredDossierResourceIconPresets = useMemo(() => {
    const query = dossierResourceIconSearch.trim().toLocaleLowerCase()
    if (!query) return dossierResourceIconPresets
    return dossierResourceIconPresets.filter((preset) =>
      [
        tx(preset.labelKey, preset.label),
        preset.label,
        preset.id,
        preset.icon,
      ].join(' ').toLocaleLowerCase().includes(query),
    )
  }, [dossierResourceIconSearch, tx])

  const commitDossierResourceCards = (cards: DossierResourceCard[]) => {
    const currentDraft = draftRef.current
    commitDraft({
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
    })
  }

  const animateDossierResourceLayout = (update: () => void) => {
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
      element.animate([
        { transform: `translate3d(${dx}px, ${dy}px, 0) scaleX(${scaleX})`, transformOrigin: 'top left' },
        { transform: 'translate3d(0, 0, 0) scaleX(1)', transformOrigin: 'top left' },
      ], {
        duration: 420,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      })
    })
  }

  const toggleDossierResourceCard = (cardId: string) => {
    setExpandedDossierResourceCards((current) => {
      const next = new Set(current)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  const isDossierCoreCardExpanded = (cardId: string) => !collapsedDossierCoreCards.has(cardId)

  const toggleDossierCoreCard = (cardId: string) => {
    setCollapsedDossierCoreCards((current) => {
      const next = new Set(current)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  const renderDossierCoreSummary = (
    cardId: 'school' | 'professor' | 'research' | 'config',
    Icon: LucideIcon,
    title: string,
    primary: string,
    secondary: string,
  ) => {
    const expanded = isDossierCoreCardExpanded(cardId)
    return (
      <button
        type="button"
        className={`dossier-core-summary ${expanded ? 'open' : ''}`}
        onClick={() => toggleDossierCoreCard(cardId)}
        aria-label={`${expanded ? tx('dossier.collapse') : tx('dossier.expand')} ${title}`}
        aria-expanded={expanded}
      >
        <span className="dossier-core-summary-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        <span className="dossier-core-summary-copy">
          <strong>{title}</strong>
          {!expanded && (primary || secondary) ? (
            <span className="dossier-core-summary-preview">
              {primary ? <span className="dossier-core-summary-primary">{primary}</span> : null}
              {secondary ? <span className="dossier-core-summary-secondary">{secondary}</span> : null}
            </span>
          ) : null}
        </span>
        <span className="dossier-core-summary-chevron" aria-hidden="true">
          <ChevronDown size={15} />
        </span>
      </button>
    )
  }

  const schoolCountryLabel = draft.school.country.trim()
    ? countryDisplayName(draft.school.country, lang)
    : ''
  const schoolSummaryPrimary = localize(
    draft.school.name.trim() || draft.program.trim() || schoolCountryLabel,
  )
  const schoolSummarySecondary = joinSummaryValues([
    localize(draft.program),
    schoolCountryLabel,
  ].filter((value) => value !== schoolSummaryPrimary))
  const professorSummaryPrimary = localize(
    draft.professor.english.trim() || draft.professor.chinese.trim() || draft.professor.email.trim(),
  )
  const professorSummarySecondary = joinSummaryValues([
    localize(draft.professor.chinese),
    draft.professor.email,
  ].filter((value) => value !== professorSummaryPrimary))
  const researchDirectionSummary = localize(firstSummaryLine(draft.professor.research))
  const researchLabSummary = localize(firstSummaryLine(draft.professor.lab))
  const researchSummaryPrimary = researchDirectionSummary || researchLabSummary
  const researchSummarySecondary = researchLabSummary === researchSummaryPrimary ? '' : researchLabSummary
  const configSummaryPrimary = joinSummaryValues([
    statusLabel(draft.status, tx),
    formatDate(draft.deadline, lang),
  ])
  const configSummarySecondary = joinSummaryValues([
    `${tx('dossier.priority')} ${draft.priority}`,
    ...draft.tags.slice(0, 2).map(localize),
  ])

  const addDossierResourceCard = () => {
    const card = createDossierResourceCard(tx, 'half')
    const settingsDraft = {
      title: localizeDossierResourceCardTitle(card, tx),
      icon: normalizeDossierResourceIcon(card.icon),
      color: normalizeDossierResourceColor(card.color),
      width: normalizeDossierResourceCardWidth(card.width),
      fields: card.fields.map((field) => ({ ...field, label: localizeDossierResourceFieldLabel(field, tx) })),
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

  const updateDossierResourceCard = (
    cardId: string,
    updater: (card: DossierResourceCard) => DossierResourceCard,
  ) => {
    const updatedAt = new Date().toISOString()
    commitDossierResourceCards(dossierResourceCards.map((card) =>
      card.id === cardId ? { ...updater(card), updatedAt } : card,
    ))
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
    setDossierResourceSettingsDraft((current) => current ? updater(current) : current)
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

  const updateDossierResourceSettingsField = (
    fieldId: string,
    patch: Partial<DossierResourceField>,
  ) => {
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

  const updateDossierResourceField = (
    cardId: string,
    fieldId: string,
    patch: Partial<DossierResourceField>,
  ) => {
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

  const findDossierResourceDropTarget = useCallback((
    activeId: string,
    clientX: number,
    clientY: number,
  ): DossierResourceDropTarget => {
    // Once the preview slot opens it participates in grid layout and can move
    // neighbouring cards. Keep the current target while the pointer remains
    // inside that visible slot, otherwise a second pointermove can reinterpret
    // the same on-screen location and save a different order than the preview.
    const currentTarget = dossierResourceDropTargetRef.current
    const previewSlot = dossierResourceListRef.current?.querySelector<HTMLElement>('.resource-drop-slot')
    if (currentTarget && previewSlot) {
      const slotRect = previewSlot.getBoundingClientRect()
      if (
        clientX >= slotRect.left
        && clientX <= slotRect.right
        && clientY >= slotRect.top
        && clientY <= slotRect.bottom
      ) return currentTarget
    }
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-resource-card-id]'))
      .filter((card) => card.dataset.resourceCardId && card.dataset.resourceCardId !== activeId)
    if (cards.length === 0) return null

    const nearest = cards
      .map((card) => {
        const rect = card.getBoundingClientRect()
        const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0
        const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0
        return { card, rect, distance: (dx * dx) + (dy * dy) }
      })
      .sort((a, b) => a.distance - b.distance || a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0]

    if (nearest) {
      const { card, rect } = nearest
      const id = card.dataset.resourceCardId ?? ''
      const listWidth = dossierResourceListRef.current?.getBoundingClientRect().width ?? rect.width
      const pointerWithinRow = clientY >= rect.top && clientY <= rect.bottom
      const isHalfWidth = rect.width < listWidth * 0.75
      const position = isHalfWidth && pointerWithinRow
        ? (clientX <= rect.left + rect.width / 2 ? 'before' : 'after')
        : (clientY <= rect.top + rect.height / 2 ? 'before' : 'after')
      return { id, position }
    }

    const last = cards[cards.length - 1]
    return { id: last.dataset.resourceCardId ?? '', position: 'after' }
  }, [])

  const scrollDossierResourceDuringDrag = useCallback((clientY: number) => {
    const scrollParent = dossierResourceDragSessionRef.current?.scrollParent
    if (!scrollParent) return
    const viewport = scrollParent === document.scrollingElement
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
  }, [dossierResourceCards])

  const startDossierResourceDrag = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    id: string,
  ) => {
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
    setDossierResourceDragOffset({ id, x: 0, y: 0, left: dragLeft, top: dragTop, width: rect.width, height: rect.height })
    updateDossierResourceDropTarget(null)
  }, [updateDossierResourceDropTarget])

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
      updateDossierResourceDropTarget(session.hasMoved ? findDossierResourceDropTarget(session.id, event.clientX, event.clientY) : null)
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

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
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

  const renderDossierResourceDropSlot = (
    id: string,
    position: ChecklistDropPosition,
  ) => {
    if (
      !dossierResourceDragOffset ||
      dossierResourceDropTarget?.id !== id ||
      dossierResourceDropTarget.position !== position
    ) {
      return null
    }
    const slotHeight = Math.max(dossierResourceDragOffset.height, 96)
    const targetCard = dossierResourceCards.find((card) => card.id === id)
    const fullWidth = normalizeDossierResourceCardWidth(targetCard?.width) === 'full'
    return (
      <div
        key={`${id}-resource-drop-${position}`}
        className={`resource-drop-slot drop-${position}${fullWidth ? ' width-full' : ''}`}
        style={{
          '--resource-slot-height': `${slotHeight}px`,
          '--checklist-slot-height': `${slotHeight}px`,
          height: `${slotHeight}px`,
          minHeight: `${slotHeight}px`,
        } as CSSProperties}
        aria-hidden="true"
      />
    )
  }

  const clearEmailInsertAnimation = (resetState = true) => {
    emailInsertTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    emailInsertTimersRef.current = []
    if (resetState) setEmailInsertAnimating(false)
  }

  const insertChunkSize = (length: number) => (length > 180 ? 5 : length > 90 ? 4 : 3)

  const insertTextAtCursor = (text: string, animated = false): { start: number; end: number } | null => {
    clearEmailInsertAnimation(false)
    const node = composerBodyRef.current
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (!node) {
      setEmailBody((current) => current + (current ? '\n' : '') + text)
      return null
    }
    const start = node.selectionStart ?? node.value.length
    const end = node.selectionEnd ?? node.value.length
    const prefix = node.value.slice(0, start)
    const suffix = node.value.slice(end)
    const cursor = start + text.length
    const finish = () => {
      window.requestAnimationFrame(() => {
        node.focus()
        node.setSelectionRange(cursor, cursor)
      })
    }

    if (!animated || reduceMotion || text.length < 8) {
      pendingWriteTargetRef.current = null
      setEmailBody(prefix + text + suffix)
      finish()
      return { start, end: cursor }
    }

    pendingWriteTargetRef.current = prefix + text + suffix
    setEmailInsertAnimating(true)
    let written = 0
    const chunkSize = insertChunkSize(text.length)
    const writeNext = () => {
      written = Math.min(text.length, written + chunkSize)
      setEmailBody(prefix + text.slice(0, written) + suffix)
      if (written < text.length) {
        const timer = window.setTimeout(writeNext, 18)
        emailInsertTimersRef.current.push(timer)
        return
      }
      emailInsertTimersRef.current = []
      pendingWriteTargetRef.current = null
      setEmailInsertAnimating(false)
      finish()
    }
    writeNext()
    return { start, end: cursor }
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
    const kindLabel = profileKindLabel(
      asset.kind,
      language,
      { zh: asset.customLabelZh, en: asset.customLabelEn },
      pair,
    )
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
    const nameList = formatAssetNameList(selected.map((asset) => assetInsertLabel(asset, language)), language)
    if (!lead.trim() && !tail.trim()) {
      return selected.length === 1
        ? tpl(translate(language, 'dossier.assetAttachedLine'), { name: nameList })
        : tpl(translate(language, 'dossier.assetsAttachedLine'), { items: nameList })
    }
    return `${lead}${nameList}${tail}`
  }

  const insertAssets = (selected: ProfileAsset[], language: InsertLanguage) => {
    const phrase = selected.length > 0 ? buildAssetInsertPhrase(selected, language) : ''

    // If a previous animated write is still mid-flight, settle it to its intended end state first —
    // otherwise the staleness check below would compare against a half-typed body and never match,
    // silently defeating "replace in place" on exactly the rapid-reselect flow it exists for.
    let effectiveBody = emailBody
    if (emailInsertAnimating && pendingWriteTargetRef.current != null) {
      const settled = pendingWriteTargetRef.current
      clearEmailInsertAnimation(false)
      setEmailBody(settled)
      effectiveBody = settled
    }

    const priorRange = lastInsertRangeRef.current
    const canReplace = priorRange != null && effectiveBody.slice(priorRange.start, priorRange.end) === priorRange.text

    if (canReplace && priorRange) {
      clearEmailInsertAnimation()
      const start = priorRange.start
      const end = start + phrase.length
      setEmailBody(effectiveBody.slice(0, priorRange.start) + phrase + effectiveBody.slice(priorRange.end))
      window.requestAnimationFrame(() => {
        composerBodyRef.current?.focus()
        composerBodyRef.current?.setSelectionRange(end, end)
      })
      lastInsertRangeRef.current = phrase.trim() ? { start, end, text: phrase } : null
    } else if (phrase.trim()) {
      const range = insertTextAtCursor(phrase, true)
      lastInsertRangeRef.current = range ? { ...range, text: phrase } : null
    }
    setLastInsertSelection(selected.length > 0 ? { ids: selected.map((asset) => asset.id), language } : null)

    const existingFileIds = new Set(emailAttachments.map((att) => att.fileId).filter(Boolean))
    const newAttachments = selected.flatMap((asset) =>
      (asset.attachments ?? [])
        .filter((attachment) => !existingFileIds.has(attachment.fileId))
        .map((attachment) => ({
          id: createLocalId('att'),
          name: attachment.fileName,
          fileName: attachment.fileName,
          assetId: asset.id,
          fileId: attachment.fileId,
          fileSize: attachment.fileSize,
          mimeType: attachment.mimeType,
        })),
    )
    if (newAttachments.length > 0) {
      setEmailAttachments((current) => [...current, ...newAttachments])
    }
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
      setEmailAttachments((current) => current.map((item) => (item.id === id ? { ...item, name: nextName, fileName: nextName } : item)))
    }
    setRenamingAttachmentId(null)
  }

  const clearEmailComposer = () => {
    clearEmailInsertAnimation()
    setEmailAiRestoreAnimating(false)
    setAiDraftSessionKey((current) => current + 1)
    pendingWriteTargetRef.current = null
    lastInsertRangeRef.current = null
    setLastInsertSelection(null)
    setEmailSubject('')
    setEmailBody('')
    setEmailScheduleDate(today)
    setEmailScheduleTime('')
    setEmailAttachments([])
    setAiPanelOpen(false)
    setAiReplyToId(null)
    setAiDraftMode('compose')
    setRecordFromOverride(null)
    setRecordToOverride(null)
  }

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
      (direction === 'outgoing' ? userSendFrom : direction === 'incoming' ? draft.professor.email : session.user.email)
    const to =
      patch.to ??
      (direction === 'outgoing' ? draft.professor.email : direction === 'incoming' ? incomingMailbox : draft.school.name)
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

  const applyCorrespondenceMode = (mode: CorrespondenceMode) => {
    const nextMode = mode
    setCorrespondenceMode(nextMode)
    if (nextMode === 'draft-email') setCorrespondenceKind('outgoing-email')
    else if (nextMode === 'record-email') setCorrespondenceKind(recordDirection === 'sent' ? 'outgoing-email' : 'incoming-email')
    else if (nextMode === 'record-message') setCorrespondenceKind(recordDirection === 'sent' ? 'outgoing-message' : 'incoming-message')
    else setCorrespondenceKind('note')
  }

  const requestComposerExit = (proceed: () => void, options: Omit<ComposerExitRequest, 'proceed'> = {}) => {
    if (composerOpen && hasComposerContent) {
      setPendingComposerExit({ proceed, ...options })
      return
    }
    proceed()
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
      clearEmailComposer()
      setComposerOpen(false)
    })
  }

  const openAiDraft = (replyTo?: CommunicationItem) => {
    if (!onAiDraft) return
    const open = () => {
      applyCorrespondenceMode('draft-email')
      setComposerOpen(true)
      setAiDraftMode(replyTo ? 'reply' : 'compose')
      setAiReplyToId(replyTo?.id ?? null)
      if (replyTo && !emailSubject.trim()) {
        setEmailSubject(replyTo.subject ? `Re: ${replyTo.subject.replace(/^re:\s*/i, '')}` : '')
      }
      setAiPanelOpen(true)
    }
    if (composerOpen && correspondenceMode !== 'draft-email') {
      requestComposerExit(open, { keepOpenAfterSave: true })
      return
    }
    open()
  }

  const persistCurrentComposer = async ({ keepComposerOpen = false } = {}) => {
    if (!hasComposerContent) return false
    const sourceApplicationId = application.id
    if (correspondenceMode === 'note') {
      if (!emailBody.trim()) return false
      await onAddCommunication(buildCommunicationInput('note', formatDate(emailScheduleDate, lang), emailBodyForCommunication))
    } else {
      await onAddCommunication(buildCommunicationInput(correspondenceKind, emailSubject, emailBodyForCommunication))
    }
    if (activeApplicationIdRef.current !== sourceApplicationId) return false
    clearEmailComposer()
    if (!keepComposerOpen) setComposerOpen(false)
    return true
  }

  const persistComposerDraft = async ({ keepComposerOpen = false } = {}) => {
    if (!canUseDrafts) return false
    if (!hasComposerContent) return false
    const sourceApplicationId = application.id
    await onAddCommunication(buildCommunicationInput(
      'outgoing-email',
      format(tx('dossier.draftEmailSubject'), { subject: emailSubject || tx('dossier.untitledEmail') }),
      emailBodyForCommunication,
      { date: today, time: '', messageType: 'draft-email', channel: 'Email', direction: 'outgoing' },
    ))
    if (activeApplicationIdRef.current !== sourceApplicationId) return false
    clearEmailComposer()
    if (!keepComposerOpen) setComposerOpen(false)
    return true
  }

  const handlePendingComposerSave = async () => {
    const exit = pendingComposerExit
    setPendingComposerExit(null)
    const saved = await persistCurrentComposer({ keepComposerOpen: exit?.keepOpenAfterSave })
    if (saved && !exit?.keepOpenAfterSave) exit?.proceed()
  }

  const handlePendingComposerDraft = async () => {
    const exit = pendingComposerExit
    setPendingComposerExit(null)
    const saved = await persistComposerDraft({ keepComposerOpen: exit?.keepOpenAfterSave })
    if (saved && !exit?.keepOpenAfterSave) exit?.proceed()
  }

  const sendComposerEmail = async () => {
    if (!hasComposerContent) return false
    if (!onSendCommunication) return persistCurrentComposer()
    const sourceApplicationId = application.id
    const payload = buildCommunicationInput(correspondenceKind, emailSubject, emailBodyForCommunication)
    const sent = await onSendCommunication({
      ...payload,
      subject: payload.subject || tx('dossier.untitledEmail'),
    })
    // Keep the composer available after a failed send so its content is never lost.
    if (!sent) return false
    if (activeApplicationIdRef.current !== sourceApplicationId) return false
    clearEmailComposer()
    setComposerOpen(false)
    return true
  }

  const handlePendingComposerSend = async () => {
    const exit = pendingComposerExit
    setPendingComposerExit(null)
    const sent = await sendComposerEmail()
    if (sent && !exit?.keepOpenAfterSave) exit?.proceed()
  }

  const handlePendingComposerDiscard = () => {
    const exit = pendingComposerExit
    setPendingComposerExit(null)
    clearEmailComposer()
    setComposerOpen(false)
    exit?.proceed()
  }

  const handlePendingDraftSave = async () => {
    const exit = pendingDraftExit
    setPendingDraftExit(null)
    await onSave()
    exit?.proceed()
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
    if (exit?.navigation) await onSave()
    exit?.proceed?.()
  }

  const handlePendingResourceSettingsDiscard = () => {
    const exit = pendingResourceSettingsExit
    setPendingResourceSettingsExit(null)
    cancelEditingDossierResourceCard()
    if (exit?.navigation && isDirty && exit.proceed) {
      setPendingDraftExit({ proceed: exit.proceed })
      return
    }
    exit?.proceed?.()
  }

  const handleSendEmail = () => {
    void sendComposerEmail()
  }

  const handleScheduleEmail = () => {
    if (!emailSubject.trim() || !emailScheduleDate) return
    void onAddCommunication(buildCommunicationInput(
      'outgoing-email',
      format(tx('dossier.scheduledEmailSubject'), {
        date: emailScheduleDate,
        time: emailScheduleTime || tx('dossier.unspecifiedTime'),
        subject: emailSubject,
      }),
      emailBodyForCommunication,
      { messageType: 'scheduled-email', channel: 'Email', direction: 'outgoing' },
    ))
    clearEmailComposer()
    setComposerOpen(false)
  }

  const handleSaveDraft = () => {
    if (!canUseDrafts) return
    void persistComposerDraft()
  }

  useEffect(() => {
    if (!onRegisterNavigationGuard) return undefined
    onRegisterNavigationGuard((proceed) => {
      if (composerOpen && hasComposerContent) {
        setPendingComposerExit({ proceed })
        return true
      }
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
        setPendingDraftExit({ proceed })
        return true
      }
      return false
    })
    return () => onRegisterNavigationGuard(null)
  }, [communicationEditDirty, composerOpen, hasComposerContent, editingDossierResourceCardId, isDirty, itemEditDirty, onRegisterNavigationGuard, resourceSettingsDirty, scholarshipEditDirty])

  useEffect(() => {
    if (!(composerOpen && hasComposerContent) && !isDirty && !resourceSettingsDirty && !itemEditDirty) return undefined
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [composerOpen, hasComposerContent, isDirty, itemEditDirty, resourceSettingsDirty])

  // App keeps this component mounted while records slide between each other. Reset
  // record-scoped controls before paint so the new dossier never inherits a stale
  // expansion, dialog, drag target, or composer state from the previous record.
  useLayoutEffect(() => {
    activeApplicationIdRef.current = application.id
    setPendingTaskCreate(false)
    setScholarshipAddOpen(false)
    setScholarshipDraft(createScholarshipDraft(application.school.name))
    const scholarshipIds = application.scholarships.map((item) => item.id)
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
    setCollapsedDossierCoreCards(new Set())
    setExpandedDossierResourceCards(new Set(dossierResourceCards.map((card) => card.id)))
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
    setChecklistDrag(null)
    setChecklistDropTarget(null)
    setChecklistDragOffset(null)
    checklistDragSessionRef.current = null
    checklistDropTargetRef.current = null
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
    setCorrespondenceView('all')
    setRecordDirection('sent')
    setEditingCommunicationId(null)
    setCommunicationEditDraft(null)
    if (routeSwapTimerRef.current !== null) {
      window.clearTimeout(routeSwapTimerRef.current)
      routeSwapTimerRef.current = null
    }
    setActiveRouteSwap(null)
    clearEmailComposer()
    setRenamingAttachmentId(null)
    setRenameAttachmentValue('')
    setComposerOpen(false)
    setPendingComposerExit(null)
    setPendingDraftExit(null)
    previousTabRef.current = tab
    setTabDirection('forward')
    consumedJumpTokenRef.current = null
  }, [application.id, application.school.name, defaultCorrespondenceMode])

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
    if (!pendingTaskCreate || draft.tasks.length === 0) return
    const newestTask = draft.tasks[0]
    setExpandedChecklistTasks((current) => new Set([...current, newestTask.id]))
    setTaskExpansionSyncVersion((version) => version + 1)
    setRecentChecklistItem({ kind: 'task', id: newestTask.id })
    setPendingTaskCreate(false)
  }, [draft.tasks, pendingTaskCreate])

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
      if (routeSwapTimerRef.current !== null) {
        window.clearTimeout(routeSwapTimerRef.current)
      }
      if (scholarshipSaveTimerRef.current !== null) {
        window.clearTimeout(scholarshipSaveTimerRef.current)
      }
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
    window.addEventListener('scroll', schedulePosition, { capture: true, passive: true })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedulePosition)
      window.removeEventListener('scroll', schedulePosition, true)
    }
  }, [getReminderPopoverStyle, reminderMenu])

  const createChecklistItem = () => {
    const newId = createLocalId('material')
    const material: MaterialItem = {
      id: newId,
      name: tx('dossier.newMaterial'),
      type: 'Checklist' as const,
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
    setChecklistSearch('')
    setMaterialFilter('all')
    setMaterialGroupFilter('all')
    setMaterialSort('manual')
    onDraft({
      ...draft,
      materials: [
        material,
        ...draft.materials,
      ],
    })
    setExpandedMaterials(prev => new Set([...prev, newId]))
    setMaterialExpansionSyncVersion((version) => version + 1)
    setRecentChecklistItem({ kind: 'material', id: newId })
  }

  const requestChecklistUpload = (target: ChecklistUploadTarget) => {
    const existingTarget = target?.kind === 'material'
      ? draft.materials.find((material) => material.id === target.id)
      : target?.kind === 'task'
        ? draft.tasks.find((task) => task.id === target.id)
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

  const closeChecklistUpload = () => {
    requestChecklistUploadClose()
  }

  const uploadAllowedTypes = useMemo(
    () => resolveUploadAllowedTypes(uploadAllowedPresetIds, uploadCustomTypes),
    [uploadAllowedPresetIds, uploadCustomTypes],
  )
  const effectiveUploadAllowedTypes = useMemo(
    () => uploadAllowedTypes.length > 0 ? uploadAllowedTypes : [...DEFAULT_UPLOAD_ALLOWED_TYPES],
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
      messages.push(format(tx('dossier.uploadTypeRejected'), {
        count: typeRejected.length,
        types: allowedFileTypesLabel(uploadAllowedTypes, tx('dossier.fileTypeAny')),
      }))
    }
    if (sizeRejected.length > 0) {
      messages.push(format(tx('fileUpload.filesTooLarge'), {
        names: sizeRejected.slice(0, 3).map((file) => file.name).join(', '),
        size: formatFileSize(MAX_UPLOAD_FILE_SIZE),
      }))
    }
    if (countRejected.length > 0) {
      messages.push(format(tx('fileUpload.tooManyFiles'), { count: MAX_UPLOAD_FILES_PER_BATCH }))
    }
    setUploadTypeError(messages.join(' '))
    if (result.accepted.length === 0) return
    setUploadDraftFiles((current) => [
      ...current,
      ...result.accepted.map((file) => ({
        id: createLocalId('upload'),
        file,
        name: file.name,
      })),
    ])
  }

  const uploadCustomTypesOpen = uploadAllowedPresetIds.includes(uploadOtherTypeId)
  const hasUploadTypeMismatch = useMemo(
    () => uploadDraftFiles.some((draftFile) => !fileMatchesAllowedTypes(draftFile.file, effectiveUploadAllowedTypes)),
    [effectiveUploadAllowedTypes, uploadDraftFiles],
  )
  const uploadTypeMessage = uploadTypeError || (hasUploadTypeMismatch
    ? format(tx('dossier.uploadTypeMismatch'), {
        types: allowedFileTypesLabel(uploadAllowedTypes, tx('dossier.fileTypeAny')),
      })
    : '')

  const currentUploadTargetItem = useMemo<MaterialItem | TaskItem | null>(() => {
    if (!checklistUploadTarget) return null
    return checklistUploadTarget.kind === 'material'
      ? draft.materials.find((material) => material.id === checklistUploadTarget.id) ?? null
      : draft.tasks.find((task) => task.id === checklistUploadTarget.id) ?? null
  }, [checklistUploadTarget, draft.materials, draft.tasks])

  const existingUploadNames = useMemo(() => {
    if (!currentUploadTargetItem) return new Set<string>()
    return new Set(
      attachmentRows(currentUploadTargetItem)
        .map((row) => normalizeUploadFileName(row.file))
        .filter(Boolean),
    )
  }, [currentUploadTargetItem])

  const uploadDraftFinalNames = useMemo(
    () => uploadDraftFiles.map((draftFile, index) =>
      buildUploadFileName(draftFile.file, uploadBaseName, index, uploadDraftFiles.length, draftFile.name),
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
      updateTaskDraft(checklistUploadTarget.id, patch)
      onUpdateTask?.(checklistUploadTarget.id, patch)
    }
  }

  const submitChecklistUpload = async () => {
    if (uploadSubmitting || hasUploadNameConflict || hasUploadTypeMismatch) return
    const sourceApplicationId = application.id
    setUploadSubmitting(true)
    try {
      const target = checklistUploadTarget
      const files = uploadDraftFiles.map((draftFile, index) => {
        const name = buildUploadFileName(draftFile.file, uploadBaseName, index, uploadDraftFiles.length, draftFile.name)
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
      closeChecklistUpload()
    } finally {
      if (activeApplicationIdRef.current === sourceApplicationId) setUploadSubmitting(false)
    }
  }

  const createChecklistTask = () => {
    setChecklistSearch('')
    setTaskFilter('all')
    setTaskSort('manual')
    setPendingTaskCreate(true)
    onAddTask(tx('dossier.newTask'), today, {
      reminderEnabled: false,
      reminderOffsets: [],
      reminderTime: '',
      reminderRepeat: 'once',
      attachmentRequired: false,
      uploadReserved: false,
      allowedFileTypes: [],
    })
  }

  const updateTaskDraft = (id: string, patch: Partial<TaskItem>) => {
    const currentDraft = draftRef.current
    commitDraft({
      ...currentDraft,
      tasks: currentDraft.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    })
  }

  const materialStatuses = useMemo(
    () => [
      ...materialStatusOrder,
      ...Array.from(new Set(
        (checklistContentReady ? draft.materials : [])
          .map((material) => material.status)
          .filter((status) => status && !materialStatusOrder.includes(status)),
      )),
    ],
    [checklistContentReady, draft.materials],
  )
  const checklistGroupOptions = checklistGroups.map((group) => ({
    value: group,
    label: tx(`dossier.checklistGroups.${checklistGroupI18n[group]}`),
  }))
  const materialStatusOptions = materialStatuses.map((status) => ({
    value: status,
    label: statusLabel(status, tx),
  }))
  const scholarshipStatusOptions = scholarshipStatusOrder.map((status) => ({
    value: status,
    label: tx(`dossier.scholarshipStatus.${status}`, status),
  }))
  const notificationTarget = session.user.settings.receiveAt || session.user.email
  const completedChecklistCount = useMemo(
    () => checklistContentReady
      ? draft.materials.filter((material) => material.status === 'Submitted').length
      : 0,
    [checklistContentReady, draft.materials],
  )
  const reminderChecklistCount = useMemo(() => {
    if (!checklistContentReady) return 0
    const materialCount = draft.materials.filter((material) => material.reminderEnabled).length
    const taskCount = draft.tasks.filter((task) => task.reminderEnabled).length
    return materialCount + taskCount
  }, [checklistContentReady, draft.materials, draft.tasks])
  const reminderFilterActive = materialFilter === 'with-reminder' || taskFilter === 'with-reminder'
  const groupLabel = useCallback(
    (group: string) => isChecklistGroup(group) ? tx(`dossier.checklistGroups.${checklistGroupI18n[group]}`) : localize(group),
    [localize, tx],
  )

  const normalizedChecklistSearch = checklistSearch.trim().toLocaleLowerCase()
  const materialFilterOptions: Array<{ value: MaterialFilter; label: string }> = [
    { value: 'all', label: tx('dossier.allMaterials') },
    ...materialStatuses.map((status) => ({ value: materialStatusFilterValue(status), label: statusLabel(status, tx) })),
    { value: 'with-reminder', label: tx('dossier.withReminder') },
    { value: 'with-attachment', label: tx('dossier.withAttachment') },
  ]
  const materialGroupOptions = useMemo<Array<{ value: string; label: string }>>(() => {
    const groups = checklistContentReady
      ? Array.from(new Set(draft.materials.map((material) => material.group || 'Core materials')))
      : []
    return [
      { value: 'all', label: tx('dossier.allGroups') },
      ...groups.map((group) => ({ value: group, label: groupLabel(group) })),
    ]
  }, [checklistContentReady, draft.materials, groupLabel, tx])
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
        localize(material.type),
        statusLabel(material.status, tx),
        groupLabel(material.group || 'Core materials'),
        localize(material.details ?? ''),
        material.fileName ?? '',
      ].join(' ').toLocaleLowerCase().includes(normalizedChecklistSearch)
    }
    const filtered = draft.materials.filter((material) => {
      if (materialGroupFilter !== 'all' && (material.group || 'Core materials') !== materialGroupFilter) return false
      if (materialFilter === 'with-reminder' && !material.reminderEnabled) return false
      if (materialFilter === 'with-attachment' && !material.fileId && !material.fileName) return false
      if (materialFilter.startsWith('status:') && material.status !== materialFilter.slice('status:'.length)) return false
      return matchesSearch(material)
    })
    if (materialSort === 'manual') return filtered
    return [...filtered].sort((a, b) => {
      if (materialSort === 'name') return localize(a.name).localeCompare(localize(b.name), lang)
      if (materialSort === 'status') return materialStatuses.indexOf(a.status) - materialStatuses.indexOf(b.status)
      if (materialSort === 'group') return groupLabel(a.group || 'Core materials').localeCompare(groupLabel(b.group || 'Core materials'), lang)
      return (b.updatedAt || '').localeCompare(a.updatedAt || '')
    })
  }, [checklistContentReady, draft.materials, groupLabel, lang, materialFilter, materialGroupFilter, materialSort, materialStatuses, normalizedChecklistSearch, localize, tx])

  const visibleTasks = useMemo(() => {
    if (!checklistContentReady) return []
    const matchesSearch = (task: TaskItem) => {
      if (!normalizedChecklistSearch) return true
      return [
        localize(task.title),
        localize(task.details ?? ''),
        task.fileName ?? '',
        task.due,
        formatDate(task.due, lang),
      ].join(' ').toLocaleLowerCase().includes(normalizedChecklistSearch)
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
      return Number(a.done) - Number(b.done) || (a.due || '').localeCompare(b.due || '')
    })
  }, [checklistContentReady, draft.tasks, lang, normalizedChecklistSearch, localize, taskFilter, taskSort])

  const groupedChecklist = useMemo(
    () =>
      checklistContentReady
        ? visibleMaterials.reduce<Array<{ group: string; items: MaterialItem[] }>>(
          (groups, material) => {
            const group = material.group || 'Core materials'
            const existing = groups.find((candidate) => candidate.group === group)
            if (existing) {
              existing.items.push(material)
            } else {
              groups.push({ group, items: [material] })
            }
            return groups
          },
          [],
        )
        : [],
    [checklistContentReady, visibleMaterials],
  )

  const hasChecklistFilters =
    checklistSearch.trim() ||
    materialFilter !== 'all' ||
    materialGroupFilter !== 'all' ||
    materialSort !== 'manual' ||
    taskFilter !== 'all' ||
    taskSort !== 'manual'

  const updateMaterial = (id: string, patch: Partial<MaterialItem>) => {
    const currentDraft = draftRef.current
    commitDraft({
      ...currentDraft,
      materials: currentDraft.materials.map((material) =>
        material.id === id
          ? { ...material, ...patch, updatedAt: today }
          : material,
      ),
    })
  }

  const updateRecommenderCount = (material: MaterialItem, count: number) => {
    const nextCount = Math.min(12, Math.max(1, count))
    updateMaterial(material.id, {
      requiredCount: nextCount,
      recommenders: normalizeRecommenders(material, nextCount),
    })
  }

  const updateRecommender = (
    material: MaterialItem,
    recommenderId: string,
    patch: Partial<MaterialRecommender>,
  ) => {
    const recommenders = normalizeRecommenders(material)
    updateMaterial(material.id, {
      recommenders: recommenders.map((recommender) =>
        recommender.id === recommenderId ? { ...recommender, ...patch } : recommender,
      ),
    })
  }

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

  const removeChecklistAttachment = (kind: 'material' | 'task', item: MaterialItem | TaskItem, fileId?: string) => {
    if (!fileId) return
    if (kind === 'material') {
      if (onRemoveMaterialFile) {
        onRemoveMaterialFile(item.id, fileId)
        return
      }
      onDraft({
        ...draft,
        materials: draft.materials.map((material) =>
          material.id === item.id ? removeAttachmentFromItem(material, fileId) : material,
        ),
      })
      return
    }
    if (onRemoveTaskFile) {
      onRemoveTaskFile(item.id, fileId)
      return
    }
    const nextTask = removeAttachmentFromItem(item as TaskItem, fileId)
    updateTaskDraft(item.id, nextTask)
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
    ].filter(Boolean).join(' · ')
  }

  const taskReminderSummary = (task: TaskItem) => {
    if (!task.reminderEnabled) return tx('dossier.reminderNotSet')
    const offsets = task.reminderOffsets?.length ? task.reminderOffsets : ['1d']
    return [
      offsets.map(offsetLabel).join(' / '),
      task.reminderTime,
    ].filter(Boolean).join(' · ')
  }

  const openReminderMenu = (target: Exclude<ReminderMenuTarget, null>) => {
    if (reminderCloseTimerRef.current !== null) {
      window.clearTimeout(reminderCloseTimerRef.current)
      reminderCloseTimerRef.current = null
    }
    reminderPopoverRef.current?.classList.remove('closing')
    if (sameReminderTarget(reminderMenu, target) && !sameReminderTarget(closingReminderMenu, target)) {
      closeReminderMenu()
      return
    }
    setReminderPopoverStyle(getReminderPopoverStyle(target))
    setClosingReminderMenu(null)
    setReminderMenu(target)
  }

  const closeReminderMenu = (afterClose?: () => void) => {
    const target = reminderMenu
    if (!target) return
    if (reminderCloseTimerRef.current !== null) {
      window.clearTimeout(reminderCloseTimerRef.current)
    }
    reminderPopoverRef.current?.classList.add('closing')
    reminderCloseTimerRef.current = window.setTimeout(() => {
      afterClose?.()
      setReminderMenu((current) => sameReminderTarget(current, target) ? null : current)
      setClosingReminderMenu((current) => sameReminderTarget(current, target) ? null : current)
      reminderCloseTimerRef.current = null
    }, 170)
  }

  const updateTaskWithServer = (taskId: string, patch: Partial<TaskItem>) => {
    updateTaskDraft(taskId, patch)
    onUpdateTask?.(taskId, patch)
  }

  const renderMaterialReminderControl = (material: MaterialItem) => {
    const isOpen = reminderMenu?.kind === 'material' && reminderMenu.id === material.id
    const isClosing = sameReminderTarget(closingReminderMenu, { kind: 'material', id: material.id })
    const shouldRenderMenu = isOpen || isClosing
    const targetKey = reminderTargetKey({ kind: 'material', id: material.id })
    return (
      <div
        className="checklist-popover-anchor"
        ref={(node) => { reminderAnchorRefs.current[targetKey] = node }}
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
        {shouldRenderMenu && createPortal(
          <div ref={reminderPopoverRef} className={`checklist-popover ${isClosing ? 'closing' : ''}`} style={reminderPopoverStyle} role="dialog" aria-label={tx('dossier.reminderMenuTitle')}>
            <div className="checklist-popover-title">
              <Bell size={13} />
              <span>{tx('dossier.reminderMenuTitle')}</span>
            </div>
            <label className="checklist-menu-field">
              <span>{tx('dossier.reminderDate')}</span>
              <DatePicker
                value={material.reminderDate || draft.nextReminder || today}
                onChange={(value) => updateMaterial(material.id, {
                  reminderEnabled: true,
                  reminderDate: value,
                  reminderRepeat: 'once',
                })}
                placeholder={tx('dossier.reminderDate')}
              />
            </label>
            <label className="checklist-menu-field">
              <span>{tx('dossier.reminderTime')}</span>
              <TimePicker
                ariaLabel={tx('dossier.reminderTime')}
                value={material.reminderTime ?? ''}
                onChange={(value) => updateMaterial(material.id, {
                  reminderEnabled: true,
                  reminderDate: material.reminderDate || draft.nextReminder || today,
                  reminderTime: value,
                  reminderRepeat: 'once',
                })}
              />
            </label>
            <div className="checklist-popover-actions">
              <button
                type="button"
                className="quiet-action"
                onClick={() => {
                  closeReminderMenu(() => updateMaterial(material.id, {
                    reminderEnabled: false,
                    reminderDate: '',
                    reminderTime: '',
                    reminderRepeat: 'once',
                  }))
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
    const isClosing = sameReminderTarget(closingReminderMenu, { kind: 'task', id: task.id })
    const shouldRenderMenu = isOpen || isClosing
    const offsets = task.reminderOffsets?.length ? task.reminderOffsets : ['1d']
    const targetKey = reminderTargetKey({ kind: 'task', id: task.id })
    return (
      <div
        className="checklist-popover-anchor"
        ref={(node) => { reminderAnchorRefs.current[targetKey] = node }}
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
        {shouldRenderMenu && createPortal(
          <div ref={reminderPopoverRef} className={`checklist-popover ${isClosing ? 'closing' : ''}`} style={reminderPopoverStyle} role="dialog" aria-label={tx('dossier.reminderMenuTitle')}>
            <div className="checklist-popover-title">
              <Bell size={13} />
              <span>{tx('dossier.reminderMenuTitle')}</span>
            </div>
            <label className="checklist-menu-field">
              <span>{tx('dossier.reminderDate')}</span>
              <DatePicker
                value={task.due}
                onChange={(value) => updateTaskWithServer(task.id, {
                  due: value,
                  reminderEnabled: true,
                  reminderRepeat: 'once',
                })}
                placeholder={tx('dossier.reminderDate')}
              />
            </label>
            <label className="checklist-menu-field">
              <span>{tx('dossier.reminderTime')}</span>
              <TimePicker
                ariaLabel={tx('dossier.reminderTime')}
                value={task.reminderTime ?? ''}
                onChange={(value) => updateTaskWithServer(task.id, {
                  reminderEnabled: true,
                  reminderOffsets: offsets,
                  reminderTime: value,
                  reminderRepeat: 'once',
                })}
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
                  closeReminderMenu(() => updateTaskWithServer(task.id, {
                    reminderEnabled: false,
                    reminderOffsets: [],
                    reminderTime: '',
                    reminderRepeat: 'once',
                  }))
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

  const renderAttachmentControl = (
    kind: 'material' | 'task',
    item: MaterialItem | TaskItem,
    title: string,
  ) => {
    const rows = attachmentRows(item)
    if (rows.length > 0) return null

    const currentRow = rows.find((row) => row.current) ?? rows[0]
    const uploadReserved = Boolean(item.uploadReserved)
    const statusText = rows.length > 1
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
    } finally {
      cancelChecklistFileRename()
    }
  }

  useEffect(() => {
    if (!renamingChecklistFileKey) return
    const frame = window.requestAnimationFrame(() => {
      renameChecklistFileInputRef.current?.focus()
      renameChecklistFileInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [renamingChecklistFileKey])

  const renderAttachmentTable = (
    kind: 'material' | 'task',
    item: MaterialItem | TaskItem,
    title: string,
  ) => {
    const rows = attachmentRows(item)
    const reserved = Boolean(item.uploadReserved)
    if (!rows.length && !reserved) return null
    const canRename = !readOnly && (kind === 'material' ? Boolean(onRenameMaterialFile) : Boolean(onRenameTaskFile))

    return (
      <section className={`checklist-attachment-panel ${reserved ? 'reserved' : ''}`}>
        <div className="checklist-attachment-head">
          <div>
            <span><Paperclip size={13} aria-hidden="true" /> {tx('dossier.attachments')}</span>
            <strong>{rows.length ? format(tx('dossier.attachmentCount'), { count: rows.length }) : tx('dossier.noAttachment')}</strong>
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
              <UploadCloud size={13} aria-hidden="true" /> {rows.length ? tx('dossier.addMoreFiles') : tx('dossier.uploadAttachment')}
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
                  <TableHeaderCell column={attachmentCol.name} api={attachmentTableApi}>{tx('dossier.uploadFileName')}</TableHeaderCell>
                  <TableHeaderCell column={attachmentCol.size} api={attachmentTableApi}>{tx('dossier.fileSize')}</TableHeaderCell>
                  <TableHeaderCell column={attachmentCol.author} api={attachmentTableApi}>{tx('dossier.uploadedBy')}</TableHeaderCell>
                  <TableHeaderCell column={attachmentCol.uploadedAt} api={attachmentTableApi}>{tx('dossier.uploadedAt')}</TableHeaderCell>
                  <TableHeaderCell column={attachmentCol.actions} api={attachmentTableApi}>{tx('dossier.actions')}</TableHeaderCell>
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
                            {row.current ? <em>{tx('dossier.currentAttachment')}</em> : null}
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
                    <TableCell columnId="size" api={attachmentTableApi}>{fileSizeLabel(row.size)}</TableCell>
                    <TableCell columnId="author" api={attachmentTableApi}>{row.author || '—'}</TableCell>
                    <TableCell columnId="uploadedAt" api={attachmentTableApi}>{formatAttachmentTimestamp(row.createdAt)}</TableCell>
                    <TableCell columnId="actions" api={attachmentTableApi}>
                      <div className="checklist-attachment-row-actions">
                        {fileId && canRename ? (
                          <button
                            type="button"
                            className={`checklist-icon-control${renaming ? ' active' : ''}`}
                            onClick={() => {
                              if (renaming) void commitChecklistFileRename(kind, item.id, fileId)
                              else startChecklistFileRename(kind, item.id, fileId, displayName)
                            }}
                            title={tx('dossier.renameFile', 'Rename file')}
                            aria-label={tx('dossier.renameFile', 'Rename file')}
                          >
                            <Pencil size={13} aria-hidden="true" />
                          </button>
                        ) : null}
                        {fileId ? (
                          <button
                            type="button"
                            className="checklist-icon-control"
                            onClick={() => onDownload(fileId, row.file || title)}
                            title={tx('dossier.download')}
                            aria-label={tx('dossier.download')}
                          >
                            <Download size={13} aria-hidden="true" />
                          </button>
                        ) : null}
                        {fileId ? (
                          <button
                            type="button"
                            className="checklist-icon-control checklist-delete-btn"
                            onClick={() => setConfirmRemoveAttachment({ kind, itemId: item.id, fileId })}
                            title={tx('dossier.removeAttachment')}
                            aria-label={tx('dossier.removeAttachment')}
                          >
                            <Trash2 size={13} aria-hidden="true" />
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
      tab === 'mail' && tabContentReady
        ? [...draft.communications].sort((a, b) =>
            `${a.date}T${a.time || '00:00'}`.localeCompare(`${b.date}T${b.time || '00:00'}`),
          )
        : [],
    [draft.communications, tab, tabContentReady],
  )
  const nonDraftCommunications = useMemo(
    () => sortedCommunications.filter((item) => item.messageType !== 'draft-email'),
    [sortedCommunications],
  )
  const draftCommunications = useMemo(
    () => sortedCommunications.filter((item) => item.messageType === 'draft-email'),
    [sortedCommunications],
  )
  const visibleCommunications = useMemo(
    () => correspondenceView === 'drafts' ? draftCommunications : nonDraftCommunications,
    [correspondenceView, draftCommunications, nonDraftCommunications],
  )

  useEffect(() => {
    const row = correspondenceViewRowRef.current
    const activeButton = correspondenceViewButtonRefs.current[correspondenceView]
    if (tab !== 'mail' || !canUseDrafts || !row || !activeButton) return undefined
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
  }, [tab, canUseDrafts, correspondenceView, nonDraftCommunications.length, draftCommunications.length, lang])

  useEffect(() => {
    const bar = correspondenceModeBarRef.current
    if (tab !== 'mail' || !bar) return undefined
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
  }, [tab, composerOpen, correspondenceMode, canUseDrafts, lang])

  const unifiedTimelineEvents = useMemo(() => {
    if (tab !== 'timeline' || !tabContentReady) return []
    const communications = (draft.communications ?? []).filter(Boolean)
    const communicationKeys = new Set(
      communications.map((item) => `${item.date || today}|${item.channel || 'Email'}: ${item.subject || tx('dossier.untitledMessage')}|${item.summary || ''}`),
    )
    const manualEvents = application.timeline
      .filter((event) => !communicationKeys.has(`${event.date}|${event.title}|${event.note}`))
      .map((event) => ({ ...event, source: tx('dossier.timelineSourceManual'), manual: true }))
    type GeneratedTimelineEvent = { id: string; title: string; date: string; note: string; source: string; nav: TimelineNav }
    const rawGenerated: Array<GeneratedTimelineEvent | null> = [
      {
        id: `auto-deadline-${application.id}`,
        title: tx('dossier.timelineDeadlineTitle'),
        date: draft.deadline,
        note: format(tx('dossier.timelineDeadlineNote'), { school: draft.school.name }),
        source: tx('dossier.timelineSourceDossier'),
        nav: { tab: 'dossier' } as TimelineNav,
      },
      draft.nextReminder
        ? {
            id: `auto-reminder-${application.id}`,
            title: tx('dossier.timelineReminderTitle'),
            date: draft.nextReminder,
            note: tx('dossier.timelineReminderNote'),
            source: tx('dossier.timelineSourceDossier'),
            nav: { tab: 'dossier' } as TimelineNav,
          }
        : null,
      ...draft.materials.flatMap((material) => [
        material.reminderEnabled && material.reminderDate
          ? {
              id: `auto-material-reminder-${material.id}`,
              title: format(tx('dossier.timelineMaterialReminder'), { name: localize(material.name) }),
              date: material.reminderDate,
              note: material.details || tx('dossier.emailReminder'),
              source: tx('dossier.timelineSourceChecklist'),
              nav: { tab: 'materials', kind: 'material', id: material.id } as TimelineNav,
            }
          : null,
        material.updatedAt
          ? {
              id: `auto-material-updated-${material.id}`,
              title: format(tx('dossier.timelineMaterialUpdated'), { name: localize(material.name) }),
              date: material.updatedAt,
              note: material.fileName || material.status,
              source: tx('dossier.timelineSourceChecklist'),
              nav: { tab: 'materials', kind: 'material', id: material.id } as TimelineNav,
            }
          : null,
      ]),
      ...draft.tasks.map((task) => ({
        id: `auto-task-${task.id}`,
        title: format(tx('dossier.taskDue'), { name: localize(task.title) }),
        date: task.due,
        note: task.done ? tx('dossier.timelineTaskDone') : (task.details || tx('dossier.timelineTaskOpen')),
        source: tx('dossier.timelineSourceChecklist'),
        nav: { tab: 'materials', kind: 'task', id: task.id } as TimelineNav,
      })),
      ...communications.map((item) => ({
        id: `auto-communication-${item.id}`,
        title: `${tx(`channel.${item.channel || 'Email'}`, item.channel || 'Email')}: ${localize(item.subject || tx('dossier.untitledMessage'))}`,
        date: item.date || today,
        note: item.summary || '',
        source: tx('dossier.timelineSourceMail'),
        nav: { tab: 'mail', id: item.id } as TimelineNav,
      })),
      ...application.scholarships.flatMap((item) => [
        {
          id: `auto-scholarship-start-${item.id}`,
          title: format(tx('dossier.timelineScholarshipStart'), { name: localize(item.name) }),
          date: item.startDate,
          note: item.amount || item.issuer || '',
          source: tx('dossier.timelineSourceFunding'),
          nav: { tab: 'funding', scholarshipId: item.id } as TimelineNav,
        },
        {
          id: `auto-scholarship-end-${item.id}`,
          title: format(tx('dossier.timelineScholarshipEnd'), { name: localize(item.name) }),
          date: item.endDate,
          note: item.amount || item.issuer || '',
          source: tx('dossier.timelineSourceFunding'),
          nav: { tab: 'funding', scholarshipId: item.id } as TimelineNav,
        },
        ...(item.materials ?? []).map((material) => ({
          id: `auto-scholarship-material-${item.id}-${material.id}`,
          title: format(tx('dossier.timelineScholarshipMaterial'), { name: localize(material.name), scholarship: localize(item.name) }),
          date: material.due || item.endDate,
          note: material.details || material.status,
          source: tx('dossier.timelineSourceFunding'),
          nav: { tab: 'funding', scholarshipId: item.id } as TimelineNav,
        })),
        ...(item.tasks ?? []).map((task) => ({
          id: `auto-scholarship-task-${item.id}-${task.id}`,
          title: format(tx('dossier.timelineScholarshipTask'), { name: localize(task.title), scholarship: localize(item.name) }),
          date: task.due || item.endDate,
          note: task.done ? tx('dossier.timelineTaskDone') : (task.details || tx('dossier.timelineTaskOpen')),
          source: tx('dossier.timelineSourceFunding'),
          nav: { tab: 'funding', scholarshipId: item.id } as TimelineNav,
        })),
        ...(item.timeline ?? []).map((event) => ({
          id: `auto-scholarship-event-${item.id}-${event.id}`,
          title: `${localize(item.name)}: ${localize(event.title)}`,
          date: event.date || item.endDate,
          note: event.note || '',
          source: tx('dossier.timelineSourceFunding'),
          nav: { tab: 'funding', scholarshipId: item.id } as TimelineNav,
        })),
      ]),
    ]
    const generated = rawGenerated.filter((event): event is GeneratedTimelineEvent => Boolean(event && event.date))
    const deduped = new Map<string, { id: string; title: string; date: string; note: string; source?: string; manual?: boolean; nav?: TimelineNav }>()
    for (const event of [...manualEvents, ...generated]) {
      const key = `${event.date}|${event.title}|${event.note}`
      if (!deduped.has(key)) deduped.set(key, event)
    }
    return Array.from(deduped.values())
  }, [application, draft, format, localize, tab, tabContentReady, tx])
  const groupedTimeline = useMemo(
    () => tab === 'timeline' ? groupTimelineEvents(unifiedTimelineEvents, lang) : [],
    [unifiedTimelineEvents, lang, tab],
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
    if (tab !== 'timeline' || !tabContentReady || groupedTimeline.length === 0) return undefined
    const timelinePage = timelinePageRef.current
    if (!timelinePage) return undefined

    const rows = Array.from(
      timelinePage.querySelectorAll<HTMLElement>('[data-timeline-scroll-reveal]'),
    ).filter((row) => !row.classList.contains('is-scroll-revealed'))
    if (rows.length === 0) return undefined

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const revealRows = (items: HTMLElement[]) => {
      items
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        .forEach((row, index) => {
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
    const observer = new IntersectionObserver((entries) => {
      const entering = entries
        .filter((entry) => entry.isIntersecting)
        .map((entry) => entry.target as HTMLElement)
      if (entering.length === 0) return
      revealRows(entering)
      entering.forEach((row) => observer.unobserve(row))
    }, {
      root,
      rootMargin: '96px 0px -5% 0px',
      threshold: 0.02,
    })

    rows.forEach((row) => observer.observe(row))
    return () => observer.disconnect()
  }, [application.id, groupedTimeline, tab, tabContentReady])

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
    scrollEventTarget?.addEventListener('scrollend', onScrollEnd, { once: true })
    // Fallback when `scrollend` is missing or never fires.
    timelineProgrammaticScrollTimerRef.current = window.setTimeout(finish, 720)
  }, [])

  const scrollTimelineToToday = useCallback(() => {
    scrollTimelineToElement(nowMarkerRef.current)
  }, [scrollTimelineToElement])

  const scrollTimelineToDate = useCallback((date: string) => {
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
  }, [scrollTimelineToElement, scrollTimelineToToday, unifiedTimelineEvents])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mobileQuery = window.matchMedia('(max-width: 820px)')
    const updateDockSurface = () => setTimelineJumpUsesViewportPortal(mobileQuery.matches)
    updateDockSurface()
    mobileQuery.addEventListener?.('change', updateDockSurface)
    return () => mobileQuery.removeEventListener?.('change', updateDockSurface)
  }, [])

  useEffect(() => {
    if (!timelineJumpUsesViewportPortal || tab !== 'timeline') {
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
  }, [tab, tabContentReady, timelineJumpUsesViewportPortal])

  // Track whether the "today" marker sits in the middle band of the scrollport so the
  // jump dock can animate the Today action in/out. Date preview tracking stays isolated
  // inside TimelineJumpDock so scroll updates never rerender the full dossier surface.
  useEffect(() => {
    if (tab !== 'timeline' || !tabContentReady || unifiedTimelineEvents.length === 0) {
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
      const viewport = !scrollParent || scrollParent === document.scrollingElement
        ? (() => {
            const visualViewport = window.visualViewport
            const top = visualViewport?.offsetTop ?? 0
            const height = visualViewport?.height ?? window.innerHeight
            return { top, bottom: top + height, height }
          })()
        : (() => {
            const rect = scrollParent.getBoundingClientRect()
            return { top: rect.top, bottom: rect.bottom, height: rect.height }
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
      const inBand = Math.abs(markerCenter - viewportCenter) <= proximityThreshold
        && markerRect.bottom > viewport.top + 24
        && markerRect.top < viewport.bottom - 24
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
    const targets = Array.from(new Set<EventTarget>([
      window,
      scrollParent,
    ].filter(Boolean) as EventTarget[]))
    targets.forEach((target) => target.addEventListener('scroll', scheduleUpdate, { passive: true }))
    // Scroll does not bubble. Capture at the document boundary as a resilient fallback
    // when deferred timeline rows make the real dossier scroll owner appear after mount.
    document.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true })
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
  }, [tab, tabContentReady, unifiedTimelineEvents.length])

  const latestTimelineEvent = useMemo(
    () =>
      unifiedTimelineEvents.reduce<(typeof unifiedTimelineEvents)[number] | null>(
        (latest, event) => (!latest || event.date > latest.date ? event : latest),
        null,
      ),
    [unifiedTimelineEvents],
  )
  const materialIds = useMemo(() => checklistContentReady ? visibleMaterials.map((material) => material.id) : [], [checklistContentReady, visibleMaterials])
  const taskIds = useMemo(() => checklistContentReady ? visibleTasks.map((task) => task.id) : [], [checklistContentReady, visibleTasks])
  const communicationIds = useMemo(() => tab === 'mail' ? visibleCommunications.map((item) => item.id) : [], [visibleCommunications, tab])
  const scholarshipIds = useMemo(() => tab === 'funding' ? application.scholarships.map((item) => item.id) : [], [application.scholarships, tab])
  const timelineEventIds = useMemo(() => tab === 'timeline' ? unifiedTimelineEvents.map((event) => event.id) : [], [unifiedTimelineEvents, tab])
  const materialSelection = useExplorerSelection(materialIds)
  const taskSelection = useExplorerSelection(taskIds)
  const communicationSelection = useExplorerSelection(communicationIds)
  const scholarshipSelection = useExplorerSelection(scholarshipIds)
  const timelineSelection = useExplorerSelection(timelineEventIds)

  // Item IDs are normally unique, but templates and imported records can reuse
  // them. Scope multi-select state to the active application rather than relying
  // on an ID intersection to prune it after paint.
  useLayoutEffect(() => {
    materialSelection.clearSelection()
    taskSelection.clearSelection()
    communicationSelection.clearSelection()
    scholarshipSelection.clearSelection()
    timelineSelection.clearSelection()
  }, [
    application.id,
    communicationSelection.clearSelection,
    materialSelection.clearSelection,
    scholarshipSelection.clearSelection,
    taskSelection.clearSelection,
    timelineSelection.clearSelection,
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

  const selectedTaskIds = (id: string) =>
    taskSelection.selectedIds.has(id) ? taskSelection.selectedIdList : [id]

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
    onDraft({
      ...draft,
      materials: draft.materials.map((material) =>
        targets.has(material.id) ? { ...material, status, updatedAt: today } : material,
      ),
    })
  }

  const toggleMaterialCompletion = (material: MaterialItem) => {
    if (material.status === 'Submitted') {
      const previousStatus = materialPreviousStatuses[material.id] || 'Draft'
      updateMaterial(material.id, { status: previousStatus, updatedAt: today })
      setMaterialPreviousStatuses((current) => {
        const { [material.id]: _removed, ...next } = current
        return next
      })
      return
    }
    setMaterialPreviousStatuses((current) => ({ ...current, [material.id]: material.status || 'Draft' }))
    updateMaterial(material.id, { status: 'Submitted', updatedAt: today })
  }

  const removeMaterials = (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids)).filter((id) => !removingMaterialIds.has(id))
    const targets = new Set(uniqueIds)
    if (targets.size === 0) return
    queueDestroyAnimation(uniqueIds, setRemovingMaterialIds, () => {
      onDraft({ ...draft, materials: draft.materials.filter((material) => !targets.has(material.id)) })
      setExpandedMaterials((current) => new Set([...current].filter((id) => !targets.has(id))))
    })
    materialSelection.clearSelection()
  }

  const setMaterialsExpanded = (ids: string[], expanded: boolean) => {
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
    // Optimistically update the draft
    onDraft({
      ...draft,
      tasks: draft.tasks.map((task) => (targets.has(task.id) ? { ...task, done } : task)),
    })
    // Track which tasks succeeded for potential rollback
    const succeeded: string[] = []
    try {
      for (const id of ids) {
        await Promise.resolve(onToggleTask(id, done))
        succeeded.push(id)
      }
    } catch {
      // Rollback: revert the succeeded tasks
      const rollbackTargets = new Set(succeeded)
      onDraft({
        ...draft,
        tasks: draft.tasks.map((task) => (rollbackTargets.has(task.id) ? { ...task, done: !done } : task)),
      })
      for (const id of succeeded) {
        onToggleTask(id, !done)
      }
    }
  }

  const removeTasks = (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids)).filter((id) => !removingTaskIds.has(id))
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

  const updateChecklistDropTarget = useCallback((target: ChecklistDropTarget) => {
    checklistDropTargetRef.current = target
    setChecklistDropTarget((current) => (sameChecklistDropTarget(current, target) ? current : target))
  }, [])

  const endChecklistDrag = useCallback(() => {
    const session = checklistDragSessionRef.current
    if (session) {
      if (session.frame) window.cancelAnimationFrame(session.frame)
      session.item.style.removeProperty('--checklist-drag-y')
      try {
        session.handle.releasePointerCapture(session.pointerId)
      } catch {
        // Pointer capture may already be released by the browser on pointerup.
      }
    }
    checklistDragSessionRef.current = null
    checklistDropTargetRef.current = null
    setChecklistDrag(null)
    setChecklistDropTarget(null)
    setChecklistDragOffset(null)
    document.body.classList.remove('checklist-drag-active')
  }, [])

  const findChecklistDropTarget = useCallback((
    kind: 'material' | 'task',
    id: string,
    clientY: number,
  ): ChecklistDropTarget => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-checklist-kind="${kind}"]`))
      .filter((row) => row.dataset.checklistId && row.dataset.checklistId !== id && !row.classList.contains('is-removing'))
    if (rows.length === 0) return null

    const dropSlot = document.querySelector<HTMLElement>('.checklist-drop-slot')
    const dropSlotHeight = dropSlot?.getBoundingClientRect().height ?? 0
    for (const row of rows) {
      const rect = row.getBoundingClientRect()
      const slotPrecedesRow = dropSlot
        ? Boolean(dropSlot.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)
        : false
      const adjustedTop = rect.top - (slotPrecedesRow ? dropSlotHeight : 0)
      if (clientY <= adjustedTop + rect.height / 2) {
        return { kind, id: row.dataset.checklistId ?? '', position: 'before' }
      }
    }
    const last = rows[rows.length - 1]
    return { kind, id: last.dataset.checklistId ?? '', position: 'after' }
  }, [])

  const scrollChecklistDuringDrag = useCallback((clientY: number) => {
    const scrollParent = checklistDragSessionRef.current?.scrollParent
    if (!scrollParent) return
    const viewport = scrollParent === document.scrollingElement
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

  const commitChecklistDrag = useCallback(() => {
    const drag = checklistDragSessionRef.current
    const target = checklistDropTargetRef.current
    if (!drag || !target || drag.kind !== target.kind || drag.id === target.id || !target.id) return
    if (drag.kind === 'material') {
      const materials = reorderById(draft.materials, drag.id, target.id, target.position)
      if (materials !== draft.materials) onDraft({ ...draft, materials })
      return
    }
    const tasks = reorderById(draft.tasks, drag.id, target.id, target.position)
    if (tasks !== draft.tasks) onDraft({ ...draft, tasks })
  }, [draft, onDraft])

  const startChecklistDrag = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    kind: 'material' | 'task',
    id: string,
  ) => {
    const canDrag = kind === 'material' ? materialSort === 'manual' : taskSort === 'manual'
    if (!canDrag || (event.pointerType === 'mouse' && event.button !== 0)) {
      event.preventDefault()
      return
    }
    const item = event.currentTarget.closest<HTMLElement>('.checklist-item')
    if (!item) return
    const rect = item.getBoundingClientRect()
    const fixedContainingBlockRect = findFixedContainingBlock(item)?.getBoundingClientRect()
    const dragLeft = fixedContainingBlockRect ? rect.left - fixedContainingBlockRect.left : rect.left
    const dragTop = fixedContainingBlockRect ? rect.top - fixedContainingBlockRect.top : rect.top
    event.preventDefault()
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is a progressive enhancement; window listeners still handle the drag.
    }
    checklistDragSessionRef.current = {
      kind,
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: dragLeft,
      top: dragTop,
      width: rect.width,
      height: rect.height,
      hasMoved: false,
      handle: event.currentTarget,
      item,
      scrollParent: findScrollableAncestor(item),
      frame: 0,
      latestClientX: event.clientX,
      latestClientY: event.clientY,
    }
    checklistDropTargetRef.current = null
    document.body.classList.add('checklist-drag-active')
    setChecklistDrag({ kind, id })
    setChecklistDragOffset({ kind, id, x: 0, y: 0, left: dragLeft, top: dragTop, width: rect.width, height: rect.height })
    updateChecklistDropTarget(null)
  }, [materialSort, taskSort, updateChecklistDropTarget])

  useEffect(() => {
    if (!checklistDrag) return undefined

    const handlePointerMove = (event: PointerEvent) => {
      const session = checklistDragSessionRef.current
      if (!session || event.pointerId !== session.pointerId) return
      event.preventDefault()
      session.latestClientX = event.clientX
      session.latestClientY = event.clientY
      if (session.frame) return
      session.frame = window.requestAnimationFrame(() => {
        const activeSession = checklistDragSessionRef.current
        if (!activeSession || activeSession.pointerId !== event.pointerId) return
        activeSession.frame = 0
        const x = activeSession.latestClientX - activeSession.startX
        const y = activeSession.latestClientY - activeSession.startY
        if (!activeSession.hasMoved && Math.hypot(x, y) > 4) activeSession.hasMoved = true

        // Keep pointer-frequency movement off React's render path. The fixed drag
        // card is already on a composited layer, so one CSS variable per frame is
        // enough to follow the finger smoothly even in a large dossier.
        activeSession.item.style.setProperty('--checklist-drag-y', `${y}px`)
        updateChecklistDropTarget(activeSession.hasMoved
          ? findChecklistDropTarget(activeSession.kind, activeSession.id, activeSession.latestClientY)
          : null)
        scrollChecklistDuringDrag(activeSession.latestClientY)
      })
    }

    const handlePointerUp = (event: PointerEvent) => {
      const session = checklistDragSessionRef.current
      if (!session || event.pointerId !== session.pointerId) return
      event.preventDefault()
      if (session.frame) {
        window.cancelAnimationFrame(session.frame)
        session.frame = 0
      }
      const finalX = event.clientX - session.startX
      const finalY = event.clientY - session.startY
      if (!session.hasMoved && Math.hypot(finalX, finalY) > 4) session.hasMoved = true
      session.item.style.setProperty('--checklist-drag-y', `${finalY}px`)
      checklistDropTargetRef.current = session.hasMoved
        ? findChecklistDropTarget(session.kind, session.id, event.clientY)
        : null
      commitChecklistDrag()
      endChecklistDrag()
    }

    const handlePointerCancel = (event: PointerEvent) => {
      const session = checklistDragSessionRef.current
      if (!session || event.pointerId !== session.pointerId) return
      endChecklistDrag()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      endChecklistDrag()
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
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
    checklistDrag,
    commitChecklistDrag,
    endChecklistDrag,
    findChecklistDropTarget,
    scrollChecklistDuringDrag,
    updateChecklistDropTarget,
  ])

  const checklistDragStyle = (
    kind: 'material' | 'task',
    id: string,
  ): CSSProperties | undefined => {
    if (!checklistDragOffset || checklistDragOffset.kind !== kind || checklistDragOffset.id !== id) return undefined
    return {
      '--checklist-drag-x': `${checklistDragOffset.x}px`,
      '--checklist-drag-y': `${checklistDragOffset.y}px`,
      '--checklist-drag-left': `${checklistDragOffset.left}px`,
      '--checklist-drag-top': `${checklistDragOffset.top}px`,
      '--checklist-drag-width': `${checklistDragOffset.width}px`,
      '--checklist-drag-height': `${checklistDragOffset.height}px`,
    } as CSSProperties
  }

  const renderChecklistDropSlot = (
    kind: 'material' | 'task',
    id: string,
    position: ChecklistDropPosition,
  ) => {
    if (
      !checklistDragOffset ||
      checklistDragOffset.kind !== kind ||
      checklistDropTarget?.kind !== kind ||
      checklistDropTarget.id !== id ||
      checklistDropTarget.position !== position
    ) {
      return null
    }
    return (
      <div
        key={`${kind}-${id}-drop-${position}`}
        className={`checklist-drop-slot drop-${position}`}
        style={{ '--checklist-slot-height': `${checklistDragOffset.height}px` } as CSSProperties}
        aria-hidden="true"
      />
    )
  }

  const removeCommunications = (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids)).filter((id) => !removingCommunicationIds.has(id))
    if (uniqueIds.length === 0) return
    queueDestroyAnimation(uniqueIds, setRemovingCommunicationIds, () => {
      if (onRemoveCommunications) onRemoveCommunications(uniqueIds)
      else uniqueIds.forEach((id) => onRemoveCommunication(id))
    })
    communicationSelection.clearSelection()
  }

  const startEditingCommunication = (item: CommunicationItem) => {
    if (editingCommunicationId === item.id) {
      requestCloseItemEditor('communication')
      return
    }
    if (editingCommunicationId && communicationEditDirty) {
      requestCloseItemEditor('communication', () => startEditingCommunication(item))
      return
    }
    setEditingCommunicationId(item.id)
    setCommunicationEditDraft({
      subject: item.subject,
      channel: item.channel,
      date: item.date || today,
      summary: item.summary,
      direction: item.direction ?? (item.channel === 'Email' ? 'incoming' : 'note'),
      messageType: item.messageType ?? 'note',
      from: item.from ?? '',
      to: item.to ?? '',
      time: item.time ?? '',
    })
    communicationSelection.selectOnly(item.id)
  }

  const cancelEditingCommunication = () => {
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
    await Promise.resolve(onUpdateCommunication(item.id, {
      subject,
      summary,
      channel: communicationEditDraft.channel ?? item.channel,
      date: communicationEditDraft.date ?? item.date,
      time: communicationEditDraft.time ?? item.time ?? '',
      direction: communicationEditDraft.direction ?? item.direction ?? (item.channel === 'Email' ? 'incoming' : 'note'),
      messageType: communicationEditDraft.messageType ?? item.messageType ?? 'note',
      from: communicationEditDraft.from ?? item.from ?? '',
      to: communicationEditDraft.to ?? item.to ?? '',
    }))
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

  const submitScholarshipDraft = () => {
    const cleaned = cleanScholarshipDraft(scholarshipDraft)
    if (!cleaned.name) return
    onAddScholarship(cleaned)
    setScholarshipDraft(createScholarshipDraft(application.school.name))
    setScholarshipAddOpen(false)
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
    await Promise.resolve(onUpdateScholarship(id, cleaned)).finally(() => {
      if (activeApplicationIdRef.current !== sourceApplicationId) return
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      scholarshipSaveTimerRef.current = window.setTimeout(() => {
        if (activeApplicationIdRef.current !== sourceApplicationId) return
        scholarshipSaveTimerRef.current = null
        setSavingScholarshipId((current) => current === id ? null : current)
        setEditingScholarshipId((current) => current === id ? null : current)
        setScholarshipEditDraft(null)
      }, reduceMotion ? 0 : 280)
    })
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

  const saveTimelineEdit = () => {
    if (!editingEventId || !onUpdateTimelineEvent || !editTitle.trim()) return false
    onUpdateTimelineEvent(editingEventId, editTitle.trim(), editDate, editNote)
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
    const dirty = kind === 'communication'
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
      setPendingDraftExit({ proceed: exit.proceed })
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
    } else if (exit.kind === 'timeline') {
      saved = saveTimelineEdit()
    }
    if (saved) continueAfterItemEditor(exit)
  }

  const handlePendingItemEditDiscard = () => {
    const exit = pendingItemEditExit
    if (!exit) return
    setPendingItemEditExit(null)
    cancelItemEditor(exit.kind)
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
    setOptimisticScholarships((current) => ({ ...current, [id]: nextScholarship }))
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

    void Promise.all(Array.from(updates.values()).map(({ id, ...input }) =>
      Promise.resolve(onUpdateScholarship(id, input)),
    )).finally(() => {
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

  const setScholarshipTaskDone = (
    scholarship: ScholarshipItem,
    task: ScholarshipTaskItem,
    done: boolean,
  ) => {
    updateScholarshipTrackables(scholarship, {
      materials: scholarship.materials ?? [],
      tasks: (scholarship.tasks ?? []).map((item) =>
        item.id === task.id ? { ...item, done } : item,
      ),
    })
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
      items: [{
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
      }],
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
      items: [{
        id: 'status',
        label: tx('explorer.changeStatus'),
        icon: <BadgeCheck size={14} aria-hidden="true" />,
        shortcut: 'S',
        accessKey: 's',
        submenu: {
          title: tx('explorer.changeStatus'),
          subtitle: tx('explorer.taskStatusMenuHint'),
          backLabel: tx('explorer.back'),
          items: [
            {
              id: 'scholarship-task-open',
              label: tx('explorer.statusOpen'),
              radio: true,
              selected: !task.done,
              statusTone: 'neutral',
              statusSlug: 'open',
              onSelect: () => setScholarshipTaskDone(scholarship, task, false),
            },
            {
              id: 'scholarship-task-complete',
              label: tx('explorer.statusComplete'),
              radio: true,
              selected: task.done,
              statusTone: 'success',
              statusSlug: 'done',
              onSelect: () => setScholarshipTaskDone(scholarship, task, true),
            },
          ],
        },
      }],
    })
  }

  const addScholarshipMaterial = (
    form: ScholarshipFormDraft,
    updateForm: (draft: ScholarshipFormDraft) => void,
  ) => {
    updateForm({
      ...form,
      materials: [
        ...form.materials,
        { id: createLocalId('scholarship-material'), name: '', status: 'Draft', due: form.endDate, details: '' },
      ],
    })
  }

  const addScholarshipTask = (
    form: ScholarshipFormDraft,
    updateForm: (draft: ScholarshipFormDraft) => void,
  ) => {
    updateForm({
      ...form,
      tasks: [
        ...form.tasks,
        { id: createLocalId('scholarship-task'), title: '', due: form.endDate, done: false, details: '' },
      ],
    })
  }

  const addScholarshipTimelineEvent = (
    form: ScholarshipFormDraft,
    updateForm: (draft: ScholarshipFormDraft) => void,
  ) => {
    updateForm({
      ...form,
      timeline: [
        ...form.timeline,
        { id: createLocalId('scholarship-event'), title: '', date: form.endDate, note: '' },
      ],
    })
  }

  const removeManualTimelineEvents = (ids: string[]) => {
    const manualIds = ids.filter((id) =>
      !removingTimelineIds.has(id) && unifiedTimelineEvents.some((event) => event.id === id && event.manual),
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
    return Array.from(document.querySelectorAll<HTMLElement>('.timeline-event-card, .checklist-item, .correspondence-event-card, .funding-card, .section-card'))
      .find((node) => {
        const text = node.textContent ?? ''
        const matches = (candidates: string[]) => candidates.length > 0 && candidates.every((part) => text.includes(part))
        return matches(parts) || matches(parts.slice(1))
      }) ?? null
  }, [])

  const focusJumpTarget = useCallback((targetId: string, fallbackText?: string[], onFocused?: () => void) => {
    let firstFrame = 0
    let secondFrame = 0
    let focusFrame = 0
    let focusTimer = 0
    let handoffTimer = 0
    let cleanupTimer = 0
    let hasFocused = false
    let scrollEndTargets: EventTarget[] = []
    let clearScrollEndListeners: (() => void) | null = null
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    const beginFocus = () => {
      secondFrame = window.requestAnimationFrame(() => {
        const node = findJumpTargetNode(targetId, fallbackText)
        if (!node) return
        const startFocus = () => {
          if (hasFocused) return
          hasFocused = true
          if (focusTimer) window.clearTimeout(focusTimer)
          clearScrollEndListeners?.()
          clearScrollEndListeners = null
          focusFrame = window.requestAnimationFrame(() => {
            node.classList.add('jump-focus')
            onFocused?.()
            // Match jump-focus-glow duration (~1.45s); reduced-motion ~0.72s.
            cleanupTimer = window.setTimeout(
              () => node.classList.remove('jump-focus', 'jump-focus-prep'),
              reduceMotion ? 780 : 1500,
            )
          })
        }
        const handleScrollEnd: EventListener = () => startFocus()
        node.classList.remove('search-highlight', 'jump-focus', 'jump-focus-prep')
        node.classList.add('jump-focus-prep')

        const scrollParent = findScrollableAncestor(node)
        const viewportRect = scrollParent && scrollParent !== document.scrollingElement
          ? scrollParent.getBoundingClientRect()
          : { top: 0, bottom: window.innerHeight }
        const targetRect = node.getBoundingClientRect()
        const alreadyCentered = Math.abs(
          (targetRect.top + targetRect.bottom) / 2 - (viewportRect.top + viewportRect.bottom) / 2,
        ) < 32

        // Skip the scroll wait when the target is already where scrollIntoView would
        // place it — native smooth-scroll then moves ~0px and never fires `scrollend`,
        // which otherwise stalled the highlight until the fixed 620ms fallback timer.
        if (reduceMotion || alreadyCentered) {
          node.scrollIntoView?.({ behavior: 'auto', block: 'center', inline: 'nearest' })
          startFocus()
          return
        }

        node.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' })
        scrollEndTargets = Array.from(new Set<EventTarget>([window, document, scrollParent].filter(Boolean) as EventTarget[]))
        scrollEndTargets.forEach((target) => target.addEventListener('scrollend', handleScrollEnd, { once: true }))
        clearScrollEndListeners = () => {
          scrollEndTargets.forEach((target) => target.removeEventListener('scrollend', handleScrollEnd))
          scrollEndTargets = []
        }
        focusTimer = window.setTimeout(startFocus, 620)
      })
    }

    firstFrame = window.requestAnimationFrame(() => {
      const transitionRoot = document.documentElement
      const tabHandoffActive = transitionRoot.dataset.atlasFallbackScope === 'dossier-tab'
        || transitionRoot.dataset.atlasTransitionScope === 'dossier-tab'
      if (!reduceMotion && tabHandoffActive) {
        // A timeline card can open a different tab and ask it to scroll in the
        // same click. Let the parent handoff finish before smooth scrolling so
        // the browser never has to animate scroll and horizontal movement at
        // the same time.
        handoffTimer = window.setTimeout(beginFocus, 260)
        return
      }
      beginFocus()
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      window.cancelAnimationFrame(focusFrame)
      if (handoffTimer) window.clearTimeout(handoffTimer)
      if (focusTimer) window.clearTimeout(focusTimer)
      if (cleanupTimer) window.clearTimeout(cleanupTimer)
      clearScrollEndListeners?.()
    }
  }, [findJumpTargetNode])

  const jumpTargetFromTimelineNav = useCallback((nav: TimelineNav): Pick<DossierJumpIntent, 'tab' | 'targetId' | 'expand'> => {
    if (nav.tab === 'materials') {
      return {
        tab: 'materials',
        targetId: `${nav.kind}-${nav.id}`,
        expand: { kind: nav.kind, id: nav.id },
      }
    }
    if (nav.tab === 'mail') return { tab: 'mail', targetId: `communication-${nav.id}` }
    if (nav.tab === 'funding') {
      return {
        tab: 'funding',
        targetId: `scholarship-${nav.scholarshipId}`,
        expand: { kind: 'scholarship', id: nav.scholarshipId },
      }
    }
    return { tab: 'dossier', targetId: 'dossier-config-card' }
  }, [])

  const navigateToTimelineSource = (nav: TimelineNav) => {
    const direction = directionForTab(nav.tab)
    prepareJumpTarget(jumpTargetFromTimelineNav(nav))
    setPendingTimelineNav(nav)
    setTabDirection(direction)
    onTab(nav.tab, direction)
  }

  // Once a requested tab becomes active, scroll to and briefly ring the target
  // row/card so the user's eye lands on the destination, not the clicked source.
  useEffect(() => {
    if (!tabContentReady || !pendingTimelineNav || tab !== pendingTimelineNav.tab) return undefined
    const nav = pendingTimelineNav
    const target = jumpTargetFromTimelineNav(nav)
    prepareJumpTarget(target)
    return focusJumpTarget(target.targetId, undefined, () => {
      setPendingTimelineNav((current) => (current === nav ? null : current))
    })
  }, [focusJumpTarget, jumpTargetFromTimelineNav, pendingTimelineNav, prepareJumpTarget, tab, tabContentReady])

  useEffect(() => {
    if (!tabContentReady || !jumpIntent || consumedJumpTokenRef.current === jumpIntent.token || tab !== jumpIntent.tab) {
      return undefined
    }
    prepareJumpTarget(jumpIntent)
    return focusJumpTarget(jumpIntent.targetId, jumpIntent.fallbackText, () => {
      consumedJumpTokenRef.current = jumpIntent.token
    })
  }, [focusJumpTarget, jumpIntent, prepareJumpTarget, tab, tabContentReady])

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
    setExplorerMenu({
      x: event.clientX,
      y: event.clientY,
      title: single ? localize(single.subject) : format(tx('explorer.selectedCount'), { count: targets.length }),
      subtitle: tx('explorer.correspondenceMenuHint'),
      items: [
        {
          id: 'edit',
          label: tx('explorer.edit'),
          icon: <Pencil size={14} aria-hidden="true" />,
          shortcut: 'E',
          accessKey: 'e',
          disabled: !single || !onUpdateCommunication,
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

  const communicationDirection = (item: ApplicationRecord['communications'][number]) =>
    item.direction ?? (item.channel === 'Email' ? 'incoming' : 'note')

  const communicationIcon = (item: ApplicationRecord['communications'][number]) => {
    const direction = communicationDirection(item)
    if (direction === 'outgoing') return User
    if (direction === 'incoming') return GraduationCap
    if (item.channel === 'Email') return Mail
    if (item.channel === 'Message') return MessageSquare
    if (item.channel === 'Meeting') return Users
    if (item.channel === 'Interview') return Calendar
    return FileText
  }

  const renderScholarshipForm = (
    form: ScholarshipFormDraft,
    updateForm: (draft: ScholarshipFormDraft) => void,
    formKey: string,
  ) => (
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
          <Select value={form.status} options={scholarshipStatusOptions} onChange={(status) => updateForm({ ...form, status })} size="small" />
        </label>
        <label>
          <span>{tx('dossier.scholarshipStart')}</span>
          <DatePicker
            value={form.startDate}
            onChange={(startDate) => updateForm({ ...form, startDate, endDate: form.endDate || startDate })}
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

      <label className="scholarship-notes-field">
        <span>{tx('dossier.notes')}</span>
        <MarkdownTextarea
          value={form.notes}
          onChange={(event) => updateForm({ ...form, notes: event.target.value })}
          placeholder={tx('dossier.scholarshipNotesPlaceholder')}
          rows={3}
        />
      </label>

      <div className="scholarship-subsections">
        <section className="scholarship-subsection">
          <div className="scholarship-subsection-head">
            <span><FileText size={13} /> {tx('dossier.scholarshipMaterials')}</span>
            <button type="button" className="scholarship-subsection-add" onClick={() => addScholarshipMaterial(form, updateForm)}>
              <Plus size={12} /> {tx('dossier.addChecklistItem')}
            </button>
          </div>
          <div className={`scholarship-mini-list${form.materials.length === 0 ? ' is-empty' : ''}`}>
            {form.materials.length === 0 ? (
              <p className="scholarship-mini-empty">{tx('dossier.scholarshipNoMaterials')}</p>
            ) : form.materials.map((material) => (
              <div key={`${formKey}:material:${material.id}`} className="scholarship-mini-row material-row">
                <input
                  value={material.name}
                  onChange={(event) => updateForm({
                    ...form,
                    materials: form.materials.map((item) =>
                      item.id === material.id ? { ...item, name: event.target.value } : item,
                    ),
                  })}
                  placeholder={tx('dossier.checklistNewTitle')}
                />
                <Select
                  value={material.status}
                  options={materialStatusOptions}
                  onChange={(status) => updateForm({
                    ...form,
                    materials: form.materials.map((item) =>
                      item.id === material.id ? { ...item, status } : item,
                    ),
                  })}
                  size="small"
                />
                <DatePicker
                  value={material.due || form.endDate}
                  onChange={(dueDate) => updateForm({
                    ...form,
                    materials: form.materials.map((item) =>
                      item.id === material.id ? { ...item, due: dueDate } : item,
                    ),
                  })}
                  placeholder={tx('dossier.dueDate')}
                />
                <button
                  type="button"
                  className="scholarship-row-remove"
                  onClick={() => updateForm({ ...form, materials: form.materials.filter((item) => item.id !== material.id) })}
                  aria-label={tx('dossier.remove')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="scholarship-subsection">
          <div className="scholarship-subsection-head">
            <span><CheckCircle2 size={13} /> {tx('dossier.scholarshipTasks')}</span>
            <button type="button" className="scholarship-subsection-add" onClick={() => addScholarshipTask(form, updateForm)}>
              <Plus size={12} /> {tx('dossier.addTask')}
            </button>
          </div>
          <div className={`scholarship-mini-list${form.tasks.length === 0 ? ' is-empty' : ''}`}>
            {form.tasks.length === 0 ? (
              <p className="scholarship-mini-empty">{tx('dossier.scholarshipNoTasks')}</p>
            ) : form.tasks.map((task) => (
              <div key={`${formKey}:task:${task.id}`} className="scholarship-mini-row task-row">
                <button
                  type="button"
                  className={`scholarship-check-btn ${task.done ? 'on' : ''}`}
                  onClick={() => updateForm({
                    ...form,
                    tasks: form.tasks.map((item) =>
                      item.id === task.id ? { ...item, done: !item.done } : item,
                    ),
                  })}
                  aria-label={task.done ? tx('dossier.markIncomplete') : tx('dossier.markComplete')}
                >
                  {task.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                </button>
                <input
                  value={task.title}
                  onChange={(event) => updateForm({
                    ...form,
                    tasks: form.tasks.map((item) =>
                      item.id === task.id ? { ...item, title: event.target.value } : item,
                    ),
                  })}
                  placeholder={tx('dossier.taskPlaceholder')}
                />
                <DatePicker
                  value={task.due || form.endDate}
                  onChange={(dueDate) => updateForm({
                    ...form,
                    tasks: form.tasks.map((item) =>
                      item.id === task.id ? { ...item, due: dueDate } : item,
                    ),
                  })}
                  placeholder={tx('dossier.dueDate')}
                />
                <button
                  type="button"
                  className="scholarship-row-remove"
                  onClick={() => updateForm({ ...form, tasks: form.tasks.filter((item) => item.id !== task.id) })}
                  aria-label={tx('dossier.remove')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="scholarship-subsection">
          <div className="scholarship-subsection-head">
            <span><Clock size={13} /> {tx('dossier.scholarshipTimeline')}</span>
            <button type="button" className="scholarship-subsection-add" onClick={() => addScholarshipTimelineEvent(form, updateForm)}>
              <Plus size={12} /> {tx('dossier.addEvent')}
            </button>
          </div>
          <div className={`scholarship-mini-list${form.timeline.length === 0 ? ' is-empty' : ''}`}>
            {form.timeline.length === 0 ? (
              <p className="scholarship-mini-empty">{tx('dossier.scholarshipNoTimeline')}</p>
            ) : form.timeline.map((event) => (
              <div key={`${formKey}:timeline:${event.id}`} className="scholarship-mini-row timeline-row">
                <input
                  value={event.title}
                  onChange={(inputEvent) => updateForm({
                    ...form,
                    timeline: form.timeline.map((item) =>
                      item.id === event.id ? { ...item, title: inputEvent.target.value } : item,
                    ),
                  })}
                  placeholder={tx('dossier.eventTitle')}
                />
                <DatePicker
                  value={event.date || form.endDate}
                  onChange={(eventDate) => updateForm({
                    ...form,
                    timeline: form.timeline.map((item) =>
                      item.id === event.id ? { ...item, date: eventDate } : item,
                    ),
                  })}
                  placeholder={tx('dossier.eventDate')}
                />
                <input
                  value={event.note ?? ''}
                  onChange={(inputEvent) => updateForm({
                    ...form,
                    timeline: form.timeline.map((item) =>
                      item.id === event.id ? { ...item, note: inputEvent.target.value } : item,
                    ),
                  })}
                  placeholder={tx('dossier.eventNote')}
                />
                <button
                  type="button"
                  className="scholarship-row-remove"
                  onClick={() => updateForm({ ...form, timeline: form.timeline.filter((item) => item.id !== event.id) })}
                  aria-label={tx('dossier.remove')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )

  const renderDossierResourceFieldInput = (
    field: DossierResourceField,
    updateValue: (value: string) => void,
  ) => {
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
        <DatePicker
          value={field.value}
          onChange={updateValue}
          placeholder={tx('dossier.resourceDatePlaceholder')}
        />
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
          <CopyButton value={field.value} label={field.label || tx('dossier.resourceFieldUntitled')} />
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
            {tags.map((tag) => <span key={tag}>{tag}</span>)}
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
                onChange={(event) => updateDossierResourceSettingsField(field.id, { label: event.target.value })}
                placeholder={tx('dossier.resourceFieldLabelPlaceholder')}
                aria-label={tx('dossier.resourceFieldLabelPlaceholder')}
              />
            </label>
            <label className="resource-field-type-control">
              <span>{tx('dossier.resourceFieldType')}</span>
              <Select<DossierResourceFieldType>
                value={type}
                options={dossierResourceFieldTypeOptions}
                onChange={(nextType) => updateDossierResourceSettingsField(field.id, { type: nextType })}
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
              <div className={`resource-field-layout-toggle is-${width}`} role="radiogroup" aria-label={tx('dossier.resourceFieldLayout')}>
                {dossierResourceFieldWidths.map((preset) => {
                  const Icon = preset === 'half' ? Columns2 : Rows2
                  return (
                    <button
                      key={preset}
                      type="button"
                      className={width === preset ? 'active' : ''}
                      onClick={() => updateDossierResourceSettingsField(field.id, { width: preset })}
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
    const firstHref = fields
      .map((field) =>
        field.type === 'url'
          ? normalizedExternalHref(field.value)
          : field.type === 'email'
            ? mailtoHref(field.value)
            : '',
      )
      .find(Boolean)
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
    const SettingsIcon = settingsDraft ? dossierResourceIconMap[settingsDraft.icon] ?? Link : Link
    const selectedIconPreset = settingsDraft
      ? dossierResourceIconPresets.find((preset) => preset.id === settingsDraft.icon)
      : null
    const selectedIconLabel = selectedIconPreset
      ? tx(selectedIconPreset.labelKey, selectedIconPreset.label)
      : tx('dossier.resourceIcon')
    const selectedColorPreset = settingsDraft
      ? dossierResourceColors.find((preset) => preset.value === settingsDraft.color)
      : null
    const selectedColorLabel = selectedColorPreset
      ? tx(selectedColorPreset.labelKey)
      : tx('dossier.resourceColor')
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
        style={dossierResourceDragStyle(card.id)}
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
                {format(tx('dossier.resourceFieldCount'), { count: fields.length })}
              </span>
            </div>
          </div>
          {!isExpanded && !isEditingSettings && previews.length > 0 ? (
            <div className="resource-card-preview-grid">
              {previews.map((preview) => (
                <span key={preview.id} className="resource-card-preview-item">
                  <span className="resource-card-preview-label">{preview.label}</span>
                  <span className="resource-card-preview-value" title={preview.value}>{preview.value}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div className="resource-card-actions" onClick={(event) => event.stopPropagation()}>
            {firstHref ? (
              <a
                href={firstHref}
                target={firstHref.startsWith('http') ? '_blank' : undefined}
                rel={firstHref.startsWith('http') ? 'noopener noreferrer' : undefined}
                className="resource-mini-btn"
                title={tx('dossier.openLink')}
                aria-label={tx('dossier.openLink')}
              >
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            ) : null}
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
              onClick={() => isEditingSettings ? requestCloseDossierResourceSettings() : startEditingDossierResourceCard(card)}
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

        <CollapsiblePanel open={isExpanded || isEditingSettings} className="resource-card-detail" innerClassName="resource-card-detail-inner" keepMounted>
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
                  onOpenChange={(pickerOpen) => { if (!pickerOpen) setDossierResourceIconSearch('') }}
                  trigger={(
                    <span className="resource-appearance-trigger-icon" aria-hidden="true">
                      <SettingsIcon size={17} />
                    </span>
                  )}
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
                              onClick={() => updateDossierResourceSettingsDraft((current) => ({ ...current, icon: preset.id }))}
                              title={label}
                              aria-label={label}
                              aria-pressed={settingsDraft.icon === preset.id}
                            >
                              <PresetIcon size={16} aria-hidden="true" />
                              {settingsDraft.icon === preset.id ? <Check size={10} aria-hidden="true" className="resource-icon-selected-check" /> : null}
                            </button>
                          )
                        })}
                        {filteredDossierResourceIconPresets.length === 0 ? (
                          <p className="resource-inline-empty">{format(tx('dossier.resourceNoIconMatches'), { query: iconQuery })}</p>
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
                              onClick={() => updateDossierResourceSettingsDraft((current) => ({ ...current, color: preset.value }))}
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
                    onChange={(event) => updateDossierResourceSettingsDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder={tx('dossier.resourceCardNamePlaceholder')}
                    aria-label={tx('dossier.resourceCardNamePlaceholder')}
                  />
                </label>
                <div className="resource-appearance-control resource-width-control resource-identity-width-control">
                  <span className="resource-config-label">{tx('dossier.resourceCardWidth')}</span>
                  <div className={`resource-segmented is-${normalizeDossierResourceCardWidth(settingsDraft.width)}`} role="radiogroup" aria-label={tx('dossier.resourceCardWidth')}>
                    {dossierResourceCardWidths.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={normalizeDossierResourceCardWidth(settingsDraft.width) === preset ? 'active' : ''}
                        onClick={() => animateDossierResourceLayout(() => updateDossierResourceSettingsDraft((current) => ({ ...current, width: preset })))}
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
                  <button
                    key={type}
                    type="button"
                    onClick={() => addDossierResourceSettingsField(type)}
                  >
                    <Plus size={12} aria-hidden="true" />
                    {tx(`dossier.resourceFieldTypes.${type}`)}
                  </button>
                ))}
              </div>

              <div className="resource-settings-footer">
                <p>{tx('dossier.resourceSaveHint')}</p>
                <div className="resource-settings-actions">
                  <button type="button" className="quiet-action compact-action" onClick={() => requestCloseDossierResourceSettings()}>
                    <X size={13} aria-hidden="true" /> {tx('dossier.cancel')}
                  </button>
                  <button type="button" className="primary-action compact-action" onClick={saveDossierResourceCardSettings}>
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
                  <button type="button" className="quiet-action compact-action" onClick={() => startEditingDossierResourceCard(card)}>
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
    return [
      ...dossierResourceCards.map(renderCardWithSlots),
      renderAddCard(),
    ]
  }

  const aiInspectorHost = typeof document === 'undefined' ? null : document.getElementById('ai-inspector-host')
  const aiDraftPanel = onAiDraft ? (
    <AiDraftPanel
      open={aiPanelOpen}
      applicationId={application.id}
      aiKeys={aiKeys}
      mode={aiDraftMode}
      replyToId={aiReplyToId}
      attachments={emailAttachments.map((attachment) => ({ id: attachment.id, name: attachment.name, mimeType: attachment.mimeType, file: attachment.file, fileId: attachment.fileId, fileSize: attachment.fileSize }))}
      currentDraft={{ subject: emailSubject, body: emailBody }}
      draftSessionKey={aiDraftSessionKey}
      onClose={() => setAiPanelOpen(false)}
      onDraft={onAiDraft}
      onResolveAttachment={onResolveAiAttachment}
      onDraftChange={({ subject, body }) => {
        if (subject) setEmailSubject(subject)
        if (body !== undefined) setEmailBody(body)
      }}
      onGeneratingChange={setEmailInsertAnimating}
      onDraftRestoreChange={setEmailAiRestoreAnimating}
      onNotify={onNotify}
    />
  ) : null

  return (
    <section className="dossier-pane content-flow-enter" aria-label={tx('dialog.title')} data-tour="dossier-pane">
      {/* Header */}
      <header className="dossier-header">
        <div>
          <span className="eyebrow">
            {application.program}
            {applicationOwnerName ? <span className="dossier-owner-chip">{format(tx('dossier.byOwner'), { name: applicationOwnerName })}</span> : null}
          </span>
          <h2>{application.school.name}</h2>
          <p>{application.professor.english}</p>
        </div>
        {(!isReadOnly && isOwnApplication) || onCloseApplication ? (
          <div className="dossier-actions">
            {!isReadOnly && isOwnApplication ? (
              <>
                {onEnrich ? (
                  <button type="button" className="quiet-action dossier-enrich-action" onClick={onEnrich}>
                    <Sparkles size={14} /> {tx('dossier.enrichApplication', 'Enrich application')}
                  </button>
                ) : null}
                <button type="button" className="quiet-action" onClick={onShare}><Link size={14} /> {tx('dossier.share')}</button>
                <button type="button" className="danger-action" onClick={onDelete}><Trash2 size={14} /> {tx('dossier.delete')}</button>
              </>
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
        <section className={`dossier-team-visibility ${pendingTeamTransfer ? 'is-pending' : isTeamVisible ? 'is-visible' : 'is-private'}`} aria-label={tx('dossier.teamVisibilityTitle')}>
          <span className="dossier-team-visibility-icon" aria-hidden="true">
            <UsersRound size={15} />
          </span>
          <span>
            <strong>{teamVisibilityTitle}</strong>
            <em>{teamVisibilityDesc}</em>
          </span>
          {canManageOwnTeamVisibility && onToggleTeamVisibility ? (
            <button
              type="button"
              className={isTeamVisible ? 'quiet-action compact-action' : 'primary-action compact-action'}
              disabled={saving || isDirty || Boolean(pendingTeamTransfer)}
              onClick={() => onToggleTeamVisibility(!isTeamVisible)}
              title={isDirty ? tx('dossier.teamVisibilitySaveFirst') : undefined}
            >
              {pendingTeamTransfer ? tx('dossier.teamVisibilityPending') : isTeamVisible ? tx('dossier.teamVisibilityMakePrivate') : tx('dossier.teamVisibilityShare')}
            </button>
          ) : (
            <small>{tx('dossier.teamVisibilityReadOnly')}</small>
          )}
          {canManageOwnTeamVisibility && isDirty ? (
            <p>{tx('dossier.teamVisibilitySaveFirst')}</p>
          ) : null}
        </section>
      ) : null}

      {/* Tab strip */}
      <DossierTabStrip
        detailTabs={detailTabs}
        tab={tab}
        tabStripRef={tabStripRef}
        setTabButtonRef={(key, node) => { tabButtonRefs.current[key] = node }}
        tx={tx}
        onSelect={(key, markOptimistic) => {
          const direction = directionForTab(key)
          requestComposerExit(() => {
            if (composerOpen) {
              clearEmailComposer()
              setComposerOpen(false)
            }
            markOptimistic()
            setTabDirection(direction)
            onTab(key, direction)
          })
        }}
      />

      <div key={tab} className={`dossier-content dossier-tab-panel ${tabDirection === 'forward' ? 'from-next' : 'from-prev'}`}>
        {/* Read-only uses a class + commitDraft guard so downloads/copy still work (fieldset[disabled] would block them). */}
        <fieldset className={`dossier-fieldset${isReadOnly ? ' is-readonly' : ''}`}>
        {/* ================================================================
             DOSSIER — Comprehensive Summary
             ================================================================ */}
        {tab === 'dossier' && (
          <div className="dossier-summary">
            <div className="summary-stat-bar" data-tour="dossier-summary">
              <div className="summary-stat">
                <span className="eyebrow">{tx('dossier.deadline')}</span>
                <strong style={{ color: urgency === 'urgent' ? 'var(--danger)' : urgency === 'warning' ? 'var(--warning)' : 'var(--text)' }}>
                  {formatDate(draft.deadline, lang)}
                </strong>
                <small>
                  {due === 0
                    ? tx('dossier.today')
                    : due > 0
                      ? format(tx('dossier.daysLeft'), { count: due })
                      : format(tx('dossier.daysPast'), { count: Math.abs(due) })}
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
              <section className={`section-card dossier-core-card ${isDossierCoreCardExpanded('school') ? 'expanded' : 'collapsed'}`} data-tour="dossier-fields">
                {renderDossierCoreSummary(
                  'school',
                  Building2,
                  tx('dossier.school'),
                  schoolSummaryPrimary,
                  schoolSummarySecondary,
                )}
                <CollapsiblePanel
                  open={isDossierCoreCardExpanded('school')}
                  className="dossier-core-collapse"
                  innerClassName="dossier-core-collapse-inner"
                  keepMounted
                >
                <div className="field-stack">
                  <label><span>{tx('dossier.schoolName')}</span>
                    <div className="input-with-copy">
                      <input value={draft.school.name} onChange={(e) => onDraft({ ...draft, school: { ...draft.school, name: e.target.value } })} />
                      <CopyButton value={draft.school.name} label={tx('inspector.copySchool')} className="copy-inside" />
                    </div>
                  </label>
                  <label><span>{tx('dossier.program')}</span>
                    <div className="input-with-copy">
                      <input value={draft.program} onChange={(e) => onDraft({ ...draft, program: e.target.value })} />
                      <CopyButton value={draft.program} label={tx('inspector.copyProgram')} className="copy-inside" />
                    </div>
                  </label>
                  <label><span>{tx('dossier.country')}</span>
                    <CountrySelect
                      value={draft.school.country}
                      onChange={(country) => onDraft({ ...draft, school: { ...draft.school, country } })}
                      ariaLabel={tx('dossier.country')}
                      placeholder={tx('dossier.countryPlaceholder')}
                    />
                  </label>
                  <label><span>{tx('dossier.schoolWebsite')}</span>
                    <div className="dossier-link-field">
                      <input value={draft.school.website} onChange={(e) => onDraft({ ...draft, school: { ...draft.school, website: e.target.value } })} />
                      {normalizedExternalHref(draft.school.website) && <a href={normalizedExternalHref(draft.school.website)} target="_blank" rel="noopener noreferrer" className="icon-action" title={tx('dossier.openLink')}><ExternalLink size={14} /></a>}
                      <CopyButton value={draft.school.website} label={tx('dossier.schoolWebsite')} />
                    </div>
                  </label>
                </div>
                </CollapsiblePanel>
              </section>

              <section className={`section-card dossier-core-card ${isDossierCoreCardExpanded('professor') ? 'expanded' : 'collapsed'}`}>
                {renderDossierCoreSummary(
                  'professor',
                  User,
                  tx('dossier.professor'),
                  professorSummaryPrimary,
                  professorSummarySecondary,
                )}
                <CollapsiblePanel
                  open={isDossierCoreCardExpanded('professor')}
                  className="dossier-core-collapse"
                  innerClassName="dossier-core-collapse-inner"
                  keepMounted
                >
                <div className="field-stack">
                  <label><span>{tx('dossier.professor')}</span>
                    <div className="input-with-copy">
                      <input value={draft.professor.english} onChange={(e) => onDraft({ ...draft, professor: { ...draft.professor, english: e.target.value } })}
                        placeholder={tx('dossier.professorNamePlaceholder')} />
                      <CopyButton value={draft.professor.english} label={tx('inspector.copyProfessor')} className="copy-inside" />
                    </div>
                  </label>
                  <label><span>{tx('dossier.email')}</span>
                    <div className="input-with-copy">
                      <input value={draft.professor.email} onChange={(e) => onDraft({ ...draft, professor: { ...draft.professor, email: e.target.value } })} />
                      <CopyButton value={draft.professor.email} label={tx('inspector.copyEmail')} className="copy-inside" />
                    </div>
                  </label>
                  <div className="field-grid field-grid-pair">
                    <label><span>{tx('dossier.phone')}</span>
                      <div className="input-with-copy">
                        <input value={draft.professor.phone} onChange={(e) => onDraft({ ...draft, professor: { ...draft.professor, phone: e.target.value } })} />
                        <CopyButton value={draft.professor.phone} label={tx('dossier.phone')} className="copy-inside" />
                      </div>
                    </label>
                    <label><span>{tx('dossier.social')}</span>
                      <div className="input-with-copy">
                        <input value={draft.professor.social} onChange={(e) => onDraft({ ...draft, professor: { ...draft.professor, social: e.target.value } })} />
                        <CopyButton value={draft.professor.social} label={tx('dossier.social')} className="copy-inside" />
                      </div>
                    </label>
                  </div>
                  <label><span>{tx('dossier.homepage')}</span>
                    <div className="dossier-link-field">
                      <input value={draft.professor.homepage} onChange={(e) => onDraft({ ...draft, professor: { ...draft.professor, homepage: e.target.value } })} />
                      {normalizedExternalHref(draft.professor.homepage) && <a href={normalizedExternalHref(draft.professor.homepage)} target="_blank" rel="noopener noreferrer" className="icon-action" title={tx('dossier.openLink')}><ExternalLink size={14} /></a>}
                      <CopyButton value={draft.professor.homepage} label={tx('dossier.homepage')} />
                    </div>
                  </label>
                </div>
                </CollapsiblePanel>
              </section>

              {tabContentReady ? (
              <>
              <section className={`section-card dossier-core-card ${isDossierCoreCardExpanded('research') ? 'expanded' : 'collapsed'}`}>
                {renderDossierCoreSummary(
                  'research',
                  BookOpen,
                  tx('dossier.research'),
                  researchSummaryPrimary,
                  researchSummarySecondary,
                )}
                <CollapsiblePanel
                  open={isDossierCoreCardExpanded('research')}
                  className="dossier-core-collapse"
                  innerClassName="dossier-core-collapse-inner"
                  keepMounted
                >
                  <label className="textarea-field"><span>{tx('dossier.researchDirection')}</span>
                    <MarkdownTextarea value={localize(draft.professor.research)} onChange={(e) => onDraft({ ...draft, professor: { ...draft.professor, research: e.target.value } })} rows={3} />
                  </label>
                  <label className="textarea-field"><span>{tx('dossier.labGroup')}</span>
                    <MarkdownTextarea value={localize(draft.professor.lab)} onChange={(e) => onDraft({ ...draft, professor: { ...draft.professor, lab: e.target.value } })} rows={2} />
                  </label>
                </CollapsiblePanel>
              </section>

              <section className={`section-card dossier-core-card ${isDossierCoreCardExpanded('config') ? 'expanded' : 'collapsed'}`} id="dossier-config-card" data-tour="dossier-config">
                {renderDossierCoreSummary(
                  'config',
                  Hash,
                  tx('dossier.config'),
                  configSummaryPrimary,
                  configSummarySecondary,
                )}
                <CollapsiblePanel
                  open={isDossierCoreCardExpanded('config')}
                  className="dossier-core-collapse"
                  innerClassName="dossier-core-collapse-inner"
                  keepMounted
                >
                <div className="field-stack">
                  <label><span>{tx('dossier.deadline')}</span>
                    <DatePicker value={draft.deadline} onChange={(v) => onDraft({ ...draft, deadline: v })} placeholder={tx('dossier.selectDeadline')} />
                  </label>
                  <label><span>{tx('dossier.status')}</span>
                    <Select value={draft.status} options={statusOrder.map((s) => ({ value: s, label: statusLabel(s, tx) }))} onChange={(v) => onDraft({ ...draft, status: v as ApplicationStatus })} />
                  </label>
                  <label><span>{tx('dossier.priority')}</span>
                    <PrioritySlider
                      value={draft.priority}
                      onChange={(v) => onDraft({ ...draft, priority: v })}
                    />
                  </label>
                  <label><span>{tx('dossier.tags')}</span>
                    <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder={tx('dossier.addTag')}
                      onKeyDown={(e) => { if (e.key === 'Enter' && newTag.trim()) { e.preventDefault(); onDraft({ ...draft, tags: [...draft.tags, newTag.trim()] }); setNewTag('') } }} />
                    {draft.tags.length > 0 && (
                      <div className="tag-list">
                        {draft.tags.map((tag) => (
                          <span key={tag} className="tag-chip">{localize(tag)}
                            <button type="button" onClick={() => onDraft({ ...draft, tags: draft.tags.filter((t) => t !== tag) })} aria-label={`${tx('dossier.removeTag')} ${localize(tag)}`}><X size={10} /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </label>
                </div>
                </CollapsiblePanel>
              </section>

              <section className="section-card wide">
                <div className="section-title"><MessageSquare size={15} /><h3>{tx('dossier.notes')}</h3></div>
                <MarkdownTextarea className="plain-textarea" value={localize(draft.result)}
                  onChange={(e) => onDraft({ ...draft, result: e.target.value })}
                  placeholder={tx('dossier.notesPlaceholder')} />
              </section>
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
              <div className="resource-card-list" ref={dossierResourceListRef}>
                {tabContentReady ? renderDossierResourceCardList() : (
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
        {tab === 'materials' && (
          <div className="checklist-page" aria-busy={!tabContentReady || undefined}>
            <div className="checklist-hero">
              <div className="checklist-hero-info">
                <span className="eyebrow">{tx('dossier.checklistEyebrow')}</span>
                <div className="checklist-hero-title-row">
                  <h3>{tx('dossier.checklistTitle')}</h3>
                  <InfoTooltip
                    className="checklist-hero-help"
                    content={draft.materials.length === 0
                      ? tx('dossier.noMaterials')
                      : format(tx('dossier.checklistReminderHint'), { email: notificationTarget })}
                  />
                </div>
                <p>{draft.materials.length === 0
                  ? tx('dossier.noMaterials')
                  : format(tx('dossier.checklistReminderHint'), { email: notificationTarget })}</p>
              </div>
              <div className="checklist-hero-actions">
                <div
                  className="checklist-progress-ring"
                  role="progressbar"
                  aria-label={tx('dossier.checklistTitle')}
                  aria-valuemin={0}
                  aria-valuemax={Math.max(1, draft.materials.length)}
                  aria-valuenow={completedChecklistCount}
                  style={{
                    '--checklist-progress': `${draft.materials.length ? (completedChecklistCount / draft.materials.length) * 100 : 0}%`,
                  } as CSSProperties}
                >
                  <svg width="44" height="44" viewBox="0 0 44 44">
                    <circle cx="22" cy="22" r="18" fill="none" stroke="var(--border)" strokeWidth="4" />
                    <circle cx="22" cy="22" r="18" fill="none" stroke="var(--accent)" strokeWidth="4"
                      strokeLinecap="round" strokeDasharray={`${draft.materials.length ? (completedChecklistCount / draft.materials.length) * 113.1 : 0} 113.1`}
                      transform="rotate(-90 22 22)" style={{ transition: 'stroke-dasharray 0.6s var(--ease-out)' }} />
                  </svg>
                  <span>{completedChecklistCount}/{draft.materials.length}</span>
                </div>
                {(reminderChecklistCount > 0 || reminderFilterActive) && (
                  <button
                    type="button"
                    className={`checklist-hero-stat checklist-reminder-filter-btn${reminderFilterActive ? ' active' : ''}`}
                    onClick={toggleReminderFilter}
                    aria-pressed={reminderFilterActive}
                    title={reminderFilterActive
                      ? tx('dossier.reminderFilterClear', 'Show all checklist items')
                      : tx('dossier.reminderFilterApply', 'Show only items with reminders')}
                    aria-label={reminderFilterActive
                      ? tx('dossier.reminderFilterClear', 'Show all checklist items')
                      : tx('dossier.reminderFilterApply', 'Show only items with reminders')}
                  >
                    {reminderFilterActive ? <BellRing size={13} aria-hidden="true" /> : <Bell size={13} aria-hidden="true" />}
                    <strong>{reminderChecklistCount}</strong>
                    <span className="checklist-reminder-filter-label">
                      {reminderFilterActive
                        ? tx('dossier.reminderFilterOn', 'Reminders')
                        : tx('dossier.withReminder')}
                    </span>
                  </button>
                )}
                <button type="button" className="quiet-action checklist-hero-add-btn" onClick={createChecklistItem}>
                  <Plus size={14} /> {tx('dossier.addChecklistItem')}
                </button>
              </div>
            </div>

            {checklistUploadOpen ? createPortal(
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
                    <button type="button" className="checklist-icon-control" onClick={closeChecklistUpload} aria-label={tx('close')} disabled={checklistUploadExiting}>
                      <X size={14} />
                    </button>
                  </div>

                  <FileDropzone
                    key={checklistUploadTarget ? `${checklistUploadTarget.kind}:${checklistUploadTarget.id}` : 'upload'}
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
                          : format(tx('dossier.fileTypePresetHint'), { types: preset.accept.join(', ') })
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
                          <em>{uploadReservationEnabled ? tx('dossier.uploadReservationOn') : tx('dossier.uploadReservationOff')}</em>
                        </strong>
                        <small>{tx(checklistUploadTarget ? 'dossier.reserveUploadHint' : 'dossier.reserveUploadNeedsItem')}</small>
                      </span>
                    </label>
                  </div>

                  {uploadDraftFiles.length > 0 && (
                    <div className="checklist-upload-file-list">
                      {uploadDraftFiles.map((draftFile, index) => {
                        const usingBaseName = Boolean(uploadBaseName.trim())
                        const finalName = uploadDraftFinalNames[index] ?? buildUploadFileName(draftFile.file, uploadBaseName, index, uploadDraftFiles.length, draftFile.name)
                        const hasConflict = duplicateUploadNames.has(normalizeUploadFileName(finalName))
                        return (
                          <div key={draftFile.id} className={`checklist-upload-file-row ${usingBaseName ? 'readonly' : ''} ${hasConflict ? 'conflict' : ''}`}>
                            <span>{index + 1}</span>
                            <div className="checklist-upload-name-cell">
                              {usingBaseName ? (
                                <div className="checklist-upload-name-preview">
                                  <strong>{finalName}</strong>
                                  <small>{draftFile.file.name} · {formatFileSize(draftFile.file.size)}</small>
                                </div>
                              ) : (
                                <input
                                  value={draftFile.name}
                                  onChange={(event) => setUploadDraftFiles((current) =>
                                    current.map((item) => item.id === draftFile.id ? { ...item, name: event.target.value } : item),
                                  )}
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
                              onClick={() => setUploadDraftFiles((current) => current.filter((item) => item.id !== draftFile.id))}
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
                    {checklistUploadTarget ? (
                      <button
                        type="button"
                        className="quiet-action"
                        onClick={() => {
                          requestChecklistUploadClose(() => {
                            finalizeChecklistUploadClose()
                            onShare()
                          })
                        }}
                      >
                        <ExternalLink size={13} /> {tx('dossier.shareUpload')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`primary-action ${hasUploadNameConflict || hasUploadTypeMismatch ? 'blocked' : ''}`}
                      onClick={submitChecklistUpload}
                      disabled={uploadSubmitting || hasUploadNameConflict || hasUploadTypeMismatch || (uploadDraftFiles.length === 0 && !(uploadReservationEnabled && checklistUploadTarget))}
                      aria-disabled={hasUploadNameConflict || hasUploadTypeMismatch}
                      title={hasUploadNameConflict ? tx('dossier.uploadNameConflict') : hasUploadTypeMismatch ? uploadTypeMessage : undefined}
                    >
                      <UploadCloud size={13} /> {uploadSubmitting ? tx('working') : uploadDraftFiles.length > 0 ? tx('dossier.uploadNow') : tx('dossier.saveUploadPlan')}
                    </button>
                  </div>
                </div>
              </div>,
              document.body,
            ) : null}

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

              <div className="checklist-tool-grid">
                <div className="checklist-tool-group">
                  <div className="checklist-tool-label">
                    <FileText size={13} aria-hidden="true" />
                    <span>{tx('dossier.materialTools')}</span>
                    <em>{format(tx('dossier.visibleCount'), {
                      visible: tabContentReady ? visibleMaterials.length : draft.materials.length,
                      total: draft.materials.length,
                    })}</em>
                  </div>
                  <Select<MaterialFilter>
                    value={materialFilter}
                    options={materialFilterOptions}
                    onChange={(value) => {
                      setMaterialFilter(value)
                      if (value === 'with-reminder' || materialFilter === 'with-reminder') {
                        setTaskFilter(value === 'with-reminder' ? 'with-reminder' : (taskFilter === 'with-reminder' ? 'all' : taskFilter))
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
                    <em>{format(tx('dossier.visibleCount'), {
                      visible: tabContentReady ? visibleTasks.length : draft.tasks.length,
                      total: draft.tasks.length,
                    })}</em>
                  </div>
                  <Select<TaskFilter>
                    value={taskFilter}
                    options={taskFilterOptions}
                    onChange={(value) => {
                      setTaskFilter(value)
                      if (value === 'with-reminder' || taskFilter === 'with-reminder') {
                        setMaterialFilter(value === 'with-reminder' ? 'with-reminder' : (materialFilter === 'with-reminder' ? 'all' : materialFilter))
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
                  {hasChecklistFilters ? (
                    <button type="button" className="quiet-action compact-action" onClick={clearChecklistFilters}>
                      <X size={13} aria-hidden="true" /> {tx('dossier.clearChecklistFilters')}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <ExplorerSelectionBar
              visible={materialSelection.selectedCount > 1}
              label={format(tx('explorer.selectedCount'), { count: materialSelection.selectedCount })}
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

            {tabContentReady && draft.materials.length > 0 && visibleMaterials.length === 0 ? (
              <div className="checklist-empty compact">
                <div className="checklist-empty-icon"><Search size={24} /></div>
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
                  <div className="checklist-group-header">
                    <span>{groupLabel(group)}</span>
                    <span className="checklist-group-count">{items.length}</span>
                  </div>
                  {items.map((mat, materialIndex) => {
                    const submitted = mat.status === 'Submitted'
                    const externallyExpanded = expandedMaterials.has(mat.id)
                    const isRemoving = removingMaterialIds.has(mat.id)
                    const isRecommendation = isRecommendationMaterial(mat)
                    const groupValue: ChecklistGroup = isChecklistGroup(mat.group ?? '')
                      ? (mat.group as ChecklistGroup)
                      : 'Custom'
                    const recommenders = isRecommendation
                      ? normalizeRecommenders(mat, mat.requiredCount ?? 3)
                      : []
                    const materialAttachments = attachmentRows(mat)
                    const materialAttachmentLabel = materialAttachments.length > 1
                      ? format(tx('dossier.attachmentCount'), { count: materialAttachments.length })
                      : materialAttachments[0]?.file
                    const materialDownloadTarget = materialAttachments.find((row) => row.current) ?? materialAttachments[0]
                    const materialDragStyle = checklistDragStyle('material', mat.id)
                    const materialFilterStyle = checklistFilterAnimKey > 0
                      ? ({ '--filter-stagger': materialIndex } as CSSProperties)
                      : undefined

                    return (
                      <Fragment key={mat.id}>
                        {renderChecklistDropSlot('material', mat.id, 'before')}
                        <ChecklistDisclosureItem
                        id={`material-${mat.id}`}
                        kind="material"
                        itemId={mat.id}
                        tour={mat.id === 'tour-cv' ? 'checklist-material' : undefined}
                        externalOpen={externallyExpanded}
                        syncVersion={materialExpansionSyncVersion}
                        className={(isExpanded) => `checklist-item ${submitted ? 'done' : ''} ${isExpanded ? 'expanded' : ''} ${isRemoving ? 'is-removing' : ''} ${materialSelection.selectedCount > 1 && materialSelection.selectedIds.has(mat.id) ? 'explorer-selected' : ''} ${recentChecklistItem?.kind === 'material' && recentChecklistItem.id === mat.id ? 'checklist-item-new' : ''} ${checklistFilterAnimKey > 0 ? 'checklist-filter-enter' : ''} ${checklistDrag?.kind === 'material' && checklistDrag.id === mat.id ? 'dragging' : ''} ${checklistDropTarget?.kind === 'material' && checklistDropTarget.id === mat.id ? `drop-target drop-${checklistDropTarget.position}` : ''}`}
                        style={materialDragStyle || materialFilterStyle
                          ? { ...(materialDragStyle ?? {}), ...(materialFilterStyle ?? {}) }
                          : undefined}
                        ariaSelected={materialSelection.selectedIds.has(mat.id)}
                        onContextMenu={(event) => openMaterialContextMenu(event, mat)}
                      >
                        {(isExpanded, toggleExpanded) => (
                        <>
                        <div className="checklist-item-main">
                          <button
                            type="button"
                            className={`checklist-drag-handle ${materialSort !== 'manual' ? 'disabled' : ''}`}
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => startChecklistDrag(event, 'material', mat.id)}
                            title={materialSort === 'manual' ? tx('dossier.dragToReorder') : tx('dossier.reorderDisabledHint')}
                            aria-label={materialSort === 'manual' ? tx('dossier.dragToReorder') : tx('dossier.reorderDisabledHint')}
                            aria-disabled={materialSort !== 'manual'}
                          >
                            <GripVertical size={14} aria-hidden="true" />
                          </button>
                          <button type="button"
                            className={`checklist-check-btn ${submitted ? 'on' : mat.status === 'Missing' ? 'missing' : ''}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleMaterialCompletion(mat)
                            }}
                            title={submitted ? tx('dossier.markIncomplete') : tx('dossier.markComplete')}>
                            {submitted ? <CheckCircle2 size={19} /> : mat.status === 'Missing' ? <AlertCircle size={19} /> : <Circle size={19} />}
                          </button>
                          <div
                            className="checklist-item-body"
                            onClick={(event) => {
                              if (hasExplorerSelectionModifier(event)) {
                                event.stopPropagation()
                                materialSelection.applyGesture(mat.id, event)
                                return
                              }
                              toggleExpanded()
                              // A primary tap is an expand/collapse gesture on phones.
                              // Avoid rerendering the entire dossier solely to maintain
                              // an invisible single-item Explorer selection there.
                              if (
                                materialSelection.selectedCount > 1
                                || !(window.matchMedia?.('(pointer: coarse)').matches ?? false)
                              ) {
                                startTransition(() => materialSelection.selectOnly(mat.id))
                              }
                            }}
                          >
                            <span className="checklist-item-title-wrap">
                              <input className="checklist-item-title"
                                value={localize(mat.name)}
                                onChange={(e) => { e.stopPropagation(); updateMaterial(mat.id, { name: e.target.value }); }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (hasExplorerSelectionModifier(e)) materialSelection.applyGesture(mat.id, e)
                                }}
                                aria-label={tx('dossier.checklistItemTitle')} />
                              <span className="checklist-item-title-visual" aria-hidden="true">{localize(mat.name)}</span>
                            </span>
                            <div className="checklist-item-chips">
                              <label className="checklist-type-chip editable">
                                <input
                                  value={localize(mat.type)}
                                  size={Math.max(3, Math.min(18, localize(mat.type).length || 3))}
                                  onChange={(event) => updateMaterial(mat.id, { type: event.target.value })}
                                  onClick={(event) => event.stopPropagation()}
                                  onBlur={(event) => {
                                    if (!event.target.value.trim()) updateMaterial(mat.id, { type: tx('dossier.file') })
                                  }}
                                  aria-label={tx('dossier.materialType')}
                                />
                              </label>
                              <MaterialPill status={mat.status} />
                              <span className="checklist-group-chip">{groupLabel(mat.group || 'Core materials')}</span>
                              {mat.reminderEnabled && <span className="checklist-file-chip"><Bell size={10} /> {materialReminderSummary(mat)}</span>}
                              {materialAttachmentLabel && <span className="checklist-file-chip"><Paperclip size={10} /> {materialAttachmentLabel}</span>}
                              {mat.uploadReserved && materialAttachments.length === 0 && <span className="checklist-file-chip"><UploadCloud size={10} /> {tx('dossier.uploadReserved')}</span>}
                            </div>
                          </div>
                          <div className="checklist-item-right">
                            <button type="button" className="checklist-mini-btn"
                              onClick={(e) => { e.stopPropagation(); requestChecklistUpload({ kind: 'material', id: mat.id }); }}
                              title={tx('dossier.uploadAttachment')}><UploadCloud size={13} /></button>
                            {materialDownloadTarget?.fileId && (
                              <button type="button" className="checklist-mini-btn"
                                onClick={(e) => { e.stopPropagation(); onDownload(materialDownloadTarget.fileId, materialDownloadTarget.file || mat.name); }}
                                title={tx('dossier.download')}><Download size={13} /></button>
                            )}
                            <button type="button" className="checklist-mini-btn checklist-delete-btn"
                              onClick={(e) => { e.stopPropagation(); removeMaterials([mat.id]); }}
                              title={tx('dossier.remove')}><Trash2 size={13} /></button>
                            <button type="button" className={`checklist-expand-btn ${isExpanded ? 'open' : ''}`}
                              onClick={(e) => { e.stopPropagation(); toggleExpanded(); }}
                              aria-label={isExpanded ? tx('dossier.collapse') : tx('dossier.expand')}
                              aria-expanded={isExpanded}><ChevronDown size={15} /></button>
                          </div>
                        </div>
                        <CollapsiblePanel open={isExpanded} className="checklist-item-detail" innerClassName="checklist-item-detail-inner">
                            <div className="checklist-detail-grid">
                              <label>
                                <span>{tx('dossier.materialType')}</span>
                                <input
                                  value={localize(mat.type)}
                                  onChange={(event) => updateMaterial(mat.id, { type: event.target.value })}
                                  placeholder={tx('dossier.materialTypePlaceholder')}
                                />
                              </label>
                              <label>
                                <span>{tx('dossier.group')}</span>
                                <Select value={groupValue} options={checklistGroupOptions}
                                  onChange={(v) => updateMaterial(mat.id, { group: v })} size="small" />
                              </label>
                              {groupValue === 'Custom' && (
                                <label>
                                  <span>{tx('dossier.customGroup')}</span>
                                  <input value={mat.group === 'Custom' ? '' : mat.group ?? ''}
                                    onChange={(e) => updateMaterial(mat.id, { group: e.target.value })}
                                    placeholder={tx('dossier.customGroup')} />
                                </label>
                              )}
                              <label>
                                <span>{tx('dossier.status')}</span>
                                <Select value={mat.status} options={materialStatusOptions}
                                  onChange={(v) => updateMaterial(mat.id, { status: v })} size="small" />
                              </label>
                              <label>
                                <span>{tx('dossier.customStatus')}</span>
                                <input
                                  value={mat.status}
                                  onChange={(event) => updateMaterial(mat.id, { status: event.target.value })}
                                  onBlur={(event) => {
                                    if (!event.target.value.trim()) updateMaterial(mat.id, { status: 'Draft' })
                                  }}
                                  placeholder={tx('dossier.customStatusPlaceholder')}
                                />
                              </label>
                            </div>
                            <div className="checklist-config-row">
                              {renderMaterialReminderControl(mat)}
                              {renderAttachmentControl('material', mat, mat.name)}
                            </div>
                            {renderAttachmentTable('material', mat, mat.name)}
                            {isRecommendation && (
                              <div className="checklist-recommender-panel">
                                <div className="checklist-recommender-header">
                                  <span><Users size={13} /> {tx('dossier.recommenders')}</span>
                                  <div className="checklist-count-stepper">
                                    <button type="button" onClick={() => updateRecommenderCount(mat, (mat.requiredCount ?? 3) - 1)} disabled={(mat.requiredCount ?? 3) <= 1}><X size={11} /></button>
                                    <strong>{format(tx('dossier.recommenderCountValue'), { count: mat.requiredCount ?? 3 })}</strong>
                                    <button type="button" onClick={() => updateRecommenderCount(mat, (mat.requiredCount ?? 3) + 1)}><Plus size={11} /></button>
                                  </div>
                                </div>
                                <div className="checklist-recommender-list">
                                  {recommenders.map((rec, idx) => (
                                    <div key={rec.id} className="checklist-recommender-row">
                                      <span>{idx + 1}</span>
                                      <input value={rec.name} onChange={(e) => updateRecommender(mat, rec.id, { name: e.target.value })}
                                        placeholder={tx('dossier.recommenderName')} />
                                      <input value={rec.contact} onChange={(e) => updateRecommender(mat, rec.id, { contact: e.target.value })}
                                        placeholder={tx('dossier.recommenderContact')} />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            <label className="checklist-details-field">
                              <span>{tx('dossier.details')}</span>
                              <MarkdownTextarea value={localize(mat.details ?? '')}
                                onChange={(e) => updateMaterial(mat.id, { details: e.target.value })}
                                placeholder={tx('dossier.checklistDetailsPlaceholder')} rows={3} />
                            </label>
                        </CollapsiblePanel>
                        </>
                        )}
                        </ChecklistDisclosureItem>
                        {renderChecklistDropSlot('material', mat.id, 'after')}
                      </Fragment>
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
                  <button type="button" className="quiet-action compact-action" onClick={createChecklistTask}>
                    <Plus size={13} /> {tx('dossier.addTask')}
                  </button>
                </div>
              </div>

              <ExplorerSelectionBar
                visible={taskSelection.selectedCount > 1}
                label={format(tx('explorer.selectedCount'), { count: taskSelection.selectedCount })}
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
                    <div className="checklist-empty-icon"><CheckCircle2 size={24} /></div>
                    <span>{tx('dossier.noTasksHint')}</span>
                  </div>
                ) : visibleTasks.length === 0 ? (
                  <div className="checklist-empty compact checklist-filter-enter">
                    <div className="checklist-empty-icon"><Search size={24} /></div>
                    <span>{tx('dossier.noMatchingTasks')}</span>
                  </div>
                ) : (
                  visibleTasks.map((task, taskIndex) => {
                    const externallyExpanded = expandedChecklistTasks.has(task.id)
                    const isRemoving = removingTaskIds.has(task.id)
                    const taskAttachments = attachmentRows(task)
                    const taskAttachmentLabel = taskAttachments.length > 1
                      ? format(tx('dossier.attachmentCount'), { count: taskAttachments.length })
                      : taskAttachments[0]?.file
                    const taskDownloadTarget = taskAttachments.find((row) => row.current) ?? taskAttachments[0]
                    const taskDragStyle = checklistDragStyle('task', task.id)
                    const taskFilterStyle = checklistFilterAnimKey > 0
                      ? ({ '--filter-stagger': taskIndex } as CSSProperties)
                      : undefined
                    return (
                      <Fragment key={task.id}>
                        {renderChecklistDropSlot('task', task.id, 'before')}
                        <ChecklistDisclosureItem
                        id={`task-${task.id}`}
                        kind="task"
                        itemId={task.id}
                        externalOpen={externallyExpanded}
                        syncVersion={taskExpansionSyncVersion}
                        className={(isExpanded) => `checklist-item checklist-task-item ${task.done ? 'done' : ''} ${isExpanded ? 'expanded' : ''} ${isRemoving ? 'is-removing' : ''} ${taskSelection.selectedCount > 1 && taskSelection.selectedIds.has(task.id) ? 'explorer-selected' : ''} ${recentChecklistItem?.kind === 'task' && recentChecklistItem.id === task.id ? 'checklist-item-new' : ''} ${checklistFilterAnimKey > 0 ? 'checklist-filter-enter' : ''} ${checklistDrag?.kind === 'task' && checklistDrag.id === task.id ? 'dragging' : ''} ${checklistDropTarget?.kind === 'task' && checklistDropTarget.id === task.id ? `drop-target drop-${checklistDropTarget.position}` : ''}`}
                        style={taskDragStyle || taskFilterStyle
                          ? { ...(taskDragStyle ?? {}), ...(taskFilterStyle ?? {}) }
                          : undefined}
                        ariaSelected={taskSelection.selectedIds.has(task.id)}
                        onContextMenu={(event) => openTaskContextMenu(event, task)}
                      >
                        {(isExpanded, toggleExpanded) => (
                        <>
                        <div className="checklist-item-main" data-tour={task.id === 'tour-task-outline' ? 'checklist-task' : undefined}>
                          <button
                            type="button"
                            className={`checklist-drag-handle ${taskSort !== 'manual' ? 'disabled' : ''}`}
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => startChecklistDrag(event, 'task', task.id)}
                            title={taskSort === 'manual' ? tx('dossier.dragToReorder') : tx('dossier.reorderDisabledHint')}
                            aria-label={taskSort === 'manual' ? tx('dossier.dragToReorder') : tx('dossier.reorderDisabledHint')}
                            aria-disabled={taskSort !== 'manual'}
                          >
                            <GripVertical size={14} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className={`checklist-check-btn ${task.done ? 'on' : ''}`}
                            onClick={() => {
                              updateTaskDraft(task.id, { done: !task.done })
                              onToggleTask(task.id, !task.done)
                            }}
                            title={task.done ? tx('dossier.markIncomplete') : tx('dossier.markComplete')}
                          >
                            {task.done ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                          </button>
                          <div
                            className="checklist-item-body"
                            onClick={(event) => {
                              if (hasExplorerSelectionModifier(event)) {
                                event.stopPropagation()
                                taskSelection.applyGesture(task.id, event)
                                return
                              }
                              toggleExpanded()
                              if (
                                taskSelection.selectedCount > 1
                                || !(window.matchMedia?.('(pointer: coarse)').matches ?? false)
                              ) {
                                startTransition(() => taskSelection.selectOnly(task.id))
                              }
                            }}
                          >
                            <span className="checklist-item-title-wrap">
                              <input
                                className="checklist-item-title"
                                value={localize(task.title)}
                                onChange={(e) => updateTaskDraft(task.id, { title: e.target.value })}
                                onBlur={() => onUpdateTask?.(task.id, { title: task.title })}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (hasExplorerSelectionModifier(e)) taskSelection.applyGesture(task.id, e)
                                }}
                                aria-label={tx('dossier.taskPlaceholder')}
                              />
                              <span className="checklist-item-title-visual" aria-hidden="true">{localize(task.title)}</span>
                            </span>
                            <div className="checklist-item-chips">
                              <span className="checklist-type-chip">{tx('dossier.tasks')}</span>
                              <span className="checklist-group-chip">{formatDate(task.due, lang)}</span>
                              {task.reminderEnabled ? <span className="checklist-file-chip"><Bell size={10} /> {taskReminderSummary(task)}</span> : null}
                              {taskAttachmentLabel ? <span className="checklist-file-chip"><Paperclip size={10} /> {taskAttachmentLabel}</span> : null}
                              {task.attachmentRequired && taskAttachments.length === 0 ? <span className="checklist-file-chip"><Paperclip size={10} /> {tx('dossier.needsAttachment')}</span> : null}
                              {task.uploadReserved && taskAttachments.length === 0 ? <span className="checklist-file-chip"><UploadCloud size={10} /> {tx('dossier.uploadReserved')}</span> : null}
                            </div>
                          </div>
                          <div className="checklist-item-right">
                            <button
                              type="button"
                              className="checklist-mini-btn"
                              onClick={(e) => { e.stopPropagation(); requestChecklistUpload({ kind: 'task', id: task.id }); }}
                              title={tx('dossier.uploadAttachment')}
                            >
                              <UploadCloud size={13} />
                            </button>
                            {taskDownloadTarget?.fileId && (
                              <button
                                type="button"
                                className="checklist-mini-btn"
                                onClick={(e) => { e.stopPropagation(); onDownload(taskDownloadTarget.fileId, taskDownloadTarget.file || task.title); }}
                                title={tx('dossier.download')}
                              >
                                <Download size={13} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="checklist-mini-btn checklist-delete-btn"
                              onClick={(e) => { e.stopPropagation(); removeTasks([task.id]); }}
                              title={tx('dossier.remove')}
                            >
                              <Trash2 size={13} />
                            </button>
                            <button
                              type="button"
                              className={`checklist-expand-btn ${isExpanded ? 'open' : ''}`}
                              data-tour={task.id === 'tour-task-outline' ? 'checklist-task-expand' : undefined}
                              onClick={(e) => { e.stopPropagation(); toggleExpanded(); }}
                              aria-label={isExpanded ? tx('dossier.collapse') : tx('dossier.expand')}
                              aria-expanded={isExpanded}
                            >
                              <ChevronDown size={15} />
                            </button>
                          </div>
                        </div>
                        <CollapsiblePanel open={isExpanded} className="checklist-item-detail" innerClassName="checklist-item-detail-inner">
                            <div className="checklist-detail-grid">
                              <label>
                                <span>{tx('dossier.dueDate')}</span>
                                <DatePicker
                                  value={task.due}
                                  onChange={(value) => {
                                    updateTaskDraft(task.id, { due: value })
                                    onUpdateTask?.(task.id, { due: value })
                                  }}
                                  placeholder={tx('dossier.dueDate')}
                                />
                              </label>
                            </div>
                            <div className="checklist-config-row">
                              {renderTaskReminderControl(task)}
                              {renderAttachmentControl('task', task, task.title)}
                            </div>
                            {renderAttachmentTable('task', task, task.title)}
                            <label className="checklist-details-field">
                              <span>{tx('dossier.details')}</span>
                              <MarkdownTextarea
                                value={localize(task.details ?? '')}
                                onChange={(e) => updateTaskDraft(task.id, { details: e.target.value })}
                                onBlur={() => onUpdateTask?.(task.id, { details: task.details ?? '' })}
                                placeholder={tx('dossier.taskDetailsPlaceholder')}
                                rows={3}
                              />
                            </label>
                        </CollapsiblePanel>
                        </>
                        )}
                        </ChecklistDisclosureItem>
                        {renderChecklistDropSlot('task', task.id, 'after')}
                      </Fragment>
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

            {draft.materials.length === 0 && (
              <div className="checklist-empty">
                <div className="checklist-empty-icon"><FileText size={28} /></div>
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
        {tab === 'mail' && (
          <div className="correspondence-page" aria-busy={!tabContentReady || undefined}>
            <div className="correspondence-hero">
              <div className="correspondence-hero-info">
                <span className="eyebrow">{tx('dossier.correspondenceEyebrow')}</span>
                <h3>{tx('dossier.tabs.mail')}</h3>
                <p>{nonDraftCommunications.length > 0
                  ? format(tx('dossier.correspondenceCountHint'), { count: nonDraftCommunications.length })
                  : tx('dossier.noCommunications')}</p>
              </div>
            </div>

            <div className="correspondence-mailbox-row">
              <div className="correspondence-mailbox-item">
                <Send size={13} />
                <div><span>{tx('dossier.outboundMailbox')}</span><strong>{userSendFrom}</strong></div>
              </div>
              <div className="correspondence-mailbox-item">
                <Mail size={13} />
                <div><span>{tx('dossier.inboundMailbox')}</span><strong>{incomingMailbox}</strong></div>
              </div>
            </div>

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

            <div ref={correspondenceModeBarRef} className="correspondence-mode-bar" role="tablist" aria-label={tx('dossier.messageType')} data-tour="correspondence-modes">
              {([
                { mode: 'draft-email' as const, icon: PenLine, labelKey: 'dossier.correspondenceModes.draftEmail' },
                { mode: 'record-email' as const, icon: Mail, labelKey: 'dossier.correspondenceModes.recordEmail' },
                { mode: 'record-message' as const, icon: MessageCircle, labelKey: 'dossier.correspondenceModes.recordMessage' },
                { mode: 'note' as const, icon: StickyNote, labelKey: 'dossier.correspondenceModes.note' },
              ]).map(({ mode, icon: ModeIcon, labelKey }) => (
                <button key={mode} type="button" role="tab"
                  aria-selected={composerOpen && correspondenceMode === mode}
                  aria-expanded={composerOpen && correspondenceMode === mode}
                  data-tour={mode === 'draft-email' ? 'correspondence-draft-mode' : undefined}
                  className={composerOpen && correspondenceMode === mode ? 'active' : ''}
                  onClick={() => openCorrespondenceMode(mode)}
                  ref={(node) => {
                    correspondenceModeButtonRefs.current[mode] = node
                  }}>
                  <ModeIcon size={14} /><span>{tx(labelKey)}</span>
                </button>
              ))}
            </div>

            <CollapsiblePanel
              open={composerOpen}
              className="correspondence-composer-collapse"
            >
              {/* MODE 1: Draft Email */}
              {correspondenceMode === 'draft-email' && (
                <div key="draft-email" className={`correspondence-composer composer-mode-panel draft-composer ${aiPanelOpen && !aiInspectorHost ? 'ai-inspector-open' : ''}`}>
                  <div className="composer-head">
                    <div className="composer-title"><PenLine size={15} /><span>{tx('dossier.correspondenceModes.draftEmail')}</span></div>
                    <div className="composer-head-actions">
                      {onAiDraft ? <button type="button" className={`composer-ai-trigger ${aiPanelOpen ? 'active' : ''}`} onClick={() => openAiDraft()} aria-expanded={aiPanelOpen} data-tour="composer-ai-trigger">
                        <Sparkles size={13} aria-hidden="true" /> {tx('dossier.aiOpen')}
                      </button> : null}
                      <button type="button" className="composer-close-btn" onClick={closeComposer} aria-label={tx('dossier.closeComposer')} title={tx('dossier.closeComposer')}>
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="draft-composer-workspace">
                  <div className="draft-composer-main">
                  <div className="composer-delivery-group" aria-label={tx('dossier.emailRoute')}>
                    <div className="composer-delivery-head">
                      <span><Route size={13} aria-hidden="true" /> {tx('dossier.emailRoute')}</span>
                      <em className={emailSubjectReady && emailBodyReady ? 'ready' : ''}>
                        {emailSubjectReady && emailBodyReady ? tx('dossier.emailReady') : tx('dossier.emailDraftStatus')}
                      </em>
                    </div>
                    <div className="composer-route-info draft-route-info">
                      <div>
                        <span>{tx('dossier.emailFrom')}</span>
                        <strong>{correspondenceFrom || tx('dossier.emailNotConfigured')}</strong>
                      </div>
                      <span className="composer-route-connector" aria-hidden="true">
                        <ArrowUpRight size={14} />
                      </span>
                      <div>
                        <span>{tx('dossier.emailTo')}</span>
                        <strong>{correspondenceTo || tx('dossier.emailNotConfigured')}</strong>
                      </div>
                    </div>
                    <div className="composer-status-row" aria-label={tx('dossier.emailComposerStatus')}>
                      <span className={`composer-status-chip ${emailSubjectReady ? 'ready' : 'warning'}`}>
                        {emailSubjectReady ? <CheckCircle2 size={12} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
                        {emailSubjectReady ? tx('dossier.emailSubjectReady') : tx('dossier.emailNeedsSubject')}
                      </span>
                      <span className={`composer-status-chip ${emailBodyReady ? 'ready' : 'warning'}`}>
                        {emailBodyReady ? <CheckCircle2 size={12} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
                        {emailBodyReady ? tx('dossier.emailBodyReady') : tx('dossier.emailNeedsBody')}
                      </span>
                      <span className={`composer-status-chip ${emailAttachments.length > 0 ? 'ready' : 'muted'}`}>
                        <Paperclip size={12} aria-hidden="true" />
                        {emailAttachments.length > 0
                          ? format(tx('dossier.attachmentCount'), { count: emailAttachments.length })
                          : tx('dossier.emailNoAttachments')}
                      </span>
                      <span className={`composer-status-chip ${emailHasSchedule ? 'scheduled' : 'muted'}`}>
                        <Clock size={12} aria-hidden="true" />
                        {emailScheduleSummary}
                      </span>
                    </div>
                  </div>
                  <div className="composer-field"><label>{tx('dossier.emailSubject')}</label><input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder={tx('dossier.emailSubjectPlaceholder')} /></div>
                  <div className="composer-field">
                    <label>{tx('dossier.messageTime')}</label>
                    <div className="composer-time-row">
                      <DatePicker value={emailScheduleDate} onChange={setEmailScheduleDate} placeholder={tx('dossier.emailScheduleDate')} />
                      <TimePicker value={emailScheduleTime} onChange={setEmailScheduleTime} ariaLabel={tx('dossier.messageClock')} />
                    </div>
                  </div>
                  <MarkdownTextarea ref={composerBodyRef} defaultMode="source" className={`composer-body ${emailInsertAnimating ? 'ai-writing' : emailAiRestoreAnimating ? 'ai-restoring' : ''}`} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder={tx('dossier.emailBodyPlaceholder')} rows={10} />
                  <div className="composer-attachments">
                    <div className="composer-attachment-list">
                      {emailAttachments.map((att) => (
                        <span key={att.id} className="tag-chip">
                          <Paperclip size={10} />
                          {renamingAttachmentId === att.id ? (
                            <input
                              autoFocus
                              className="tag-chip-rename-input"
                              value={renameAttachmentValue}
                              onChange={(e) => setRenameAttachmentValue(e.target.value)}
                              onBlur={() => commitRenameAttachment(att.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); commitRenameAttachment(att.id) }
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
                          <button type="button" onClick={() => removeAttachment(att.id)} aria-label={tx('dossier.remove')}><X size={10} /></button>
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
                    <button type="button" className="primary-action" onClick={handleSendEmail} disabled={!hasComposerContent}><Send size={13} /> {tx('dossier.sendEmailNow')}</button>
                    {canUseDrafts ? (
                      <>
                        <button type="button" className="quiet-action" onClick={handleScheduleEmail} disabled={!emailSubjectReady || !emailScheduleDate}><Clock size={13} /> {tx('dossier.scheduleSend')}</button>
                        <button type="button" className="quiet-action save-action" onClick={handleSaveDraft} disabled={!hasComposerContent}><Save size={13} /> {tx('dossier.saveDraft')}</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="warning-action" onClick={closeComposer}><Trash2 size={13} /> {tx('dossier.discardComposer')}</button>
                        <button
                          type="button"
                          className="quiet-action save-action locked-draft-action"
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
                  {aiDraftPanel ? (aiInspectorHost ? createPortal(aiDraftPanel, aiInspectorHost) : aiDraftPanel) : null}
                  </div>
                </div>
              )}

              {/* MODE 2: Record Email */}
              {correspondenceMode === 'record-email' && (
                <div key="record-email" className="correspondence-composer composer-mode-panel record-composer">
                  <div className="composer-head">
                    <div className="composer-title"><Mail size={15} /><span>{tx('dossier.correspondenceModes.recordEmail')}</span></div>
                    <button type="button" className="composer-close-btn" onClick={closeComposer} aria-label={tx('dossier.closeComposer')} title={tx('dossier.closeComposer')}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="record-direction-toggle">
                    <button type="button" className={recordDirection === 'sent' ? 'active' : ''}
                      onClick={() => { setRecordDirection('sent'); setCorrespondenceKind('outgoing-email'); setRecordFromOverride(null); setRecordToOverride(null) }}><Send size={13} /> {tx('dossier.direction.sent')}</button>
                    <button type="button" className={recordDirection === 'received' ? 'active' : ''}
                      onClick={() => { setRecordDirection('received'); setCorrespondenceKind('incoming-email'); setRecordFromOverride(null); setRecordToOverride(null) }}><Mail size={13} /> {tx('dossier.direction.received')}</button>
                  </div>
                  <div className="composer-field">
                    <label>{tx('dossier.messageTime')}</label>
                    <div className="composer-time-row">
                      <DatePicker value={emailScheduleDate} onChange={setEmailScheduleDate} placeholder={tx('dossier.emailScheduleDate')} />
                      <TimePicker value={emailScheduleTime} onChange={setEmailScheduleTime} ariaLabel={tx('dossier.messageClock')} />
                    </div>
                  </div>
                  <div className="composer-field"><label>{tx('dossier.emailSubject')}</label><input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder={tx('dossier.recordEmailSubjectPlaceholder')} /></div>
                  <MarkdownTextarea className="composer-body record-body" value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder={tx('dossier.recordEmailSummaryPlaceholder')} rows={5} />
                  <div className={`composer-route-info editable ${activeRouteSwap === 'record' ? 'route-swapping' : ''}`}>
                    <label><span>{tx('dossier.emailFrom')}</span>
                      <input value={recordFromOverride ?? correspondenceFrom} onChange={(e) => setRecordFromOverride(e.target.value)} />
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
                    <label><span>{tx('dossier.emailTo')}</span>
                      <input value={recordToOverride ?? correspondenceTo} onChange={(e) => setRecordToOverride(e.target.value)} />
                    </label>
                  </div>
                  <div className="composer-actions">
                    <button type="button" className="primary-action" onClick={() => {
                      if (!emailSubject.trim() && !emailBody.trim()) return
                      onAddCommunication(buildCommunicationInput(correspondenceKind, emailSubject, emailBodyForCommunication, {
                        from: recordFromOverride ?? correspondenceFrom,
                        to: recordToOverride ?? correspondenceTo,
                      }))
                      clearEmailComposer()
                    }}><Plus size={14} /> {tx('dossier.addCorrespondence')}</button>
                  </div>
                </div>
              )}

              {/* MODE 3: Record Message */}
              {correspondenceMode === 'record-message' && (
                <div key="record-message" className="correspondence-composer composer-mode-panel record-composer">
                  <div className="composer-head">
                    <div className="composer-title"><MessageCircle size={15} /><span>{tx('dossier.correspondenceModes.recordMessage')}</span></div>
                    <button type="button" className="composer-close-btn" onClick={closeComposer} aria-label={tx('dossier.closeComposer')} title={tx('dossier.closeComposer')}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="record-direction-toggle">
                    <button type="button" className={recordDirection === 'sent' ? 'active' : ''}
                      onClick={() => { setRecordDirection('sent'); setCorrespondenceKind('outgoing-message') }}><Send size={13} /> {tx('dossier.direction.sent')}</button>
                    <button type="button" className={recordDirection === 'received' ? 'active' : ''}
                      onClick={() => { setRecordDirection('received'); setCorrespondenceKind('incoming-message') }}><MessageSquare size={13} /> {tx('dossier.direction.received')}</button>
                  </div>
                  <div className="composer-field">
                    <label>{tx('dossier.messageTime')}</label>
                    <div className="composer-time-row">
                      <DatePicker value={emailScheduleDate} onChange={setEmailScheduleDate} placeholder={tx('dossier.emailScheduleDate')} />
                      <TimePicker value={emailScheduleTime} onChange={setEmailScheduleTime} ariaLabel={tx('dossier.messageClock')} />
                    </div>
                  </div>
                  <div className="composer-field"><label>{tx('dossier.emailSubject')}</label><input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder={tx('dossier.messageSubjectPlaceholder')} /></div>
                  <MarkdownTextarea className="composer-body record-body" value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder={tx('dossier.messageSummaryPlaceholder')} rows={5} />
                  <div className="composer-actions">
                    <button type="button" className="primary-action" onClick={() => {
                      if (!emailSubject.trim() && !emailBody.trim()) return
                      onAddCommunication(buildCommunicationInput(correspondenceKind, emailSubject, emailBodyForCommunication))
                      clearEmailComposer()
                    }}><Plus size={14} /> {tx('dossier.addCorrespondence')}</button>
                  </div>
                </div>
              )}

              {/* MODE 4: Note */}
              {correspondenceMode === 'note' && (
                <div key="note" className="correspondence-composer composer-mode-panel note-composer">
                  <div className="composer-head">
                    <div className="composer-title"><StickyNote size={15} /><span>{tx('dossier.correspondenceModes.note')}</span></div>
                    <button type="button" className="composer-close-btn" onClick={closeComposer} aria-label={tx('dossier.closeComposer')} title={tx('dossier.closeComposer')}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="composer-field">
                    <label>{tx('dossier.messageTime')}</label>
                    <div className="composer-time-row">
                      <DatePicker value={emailScheduleDate} onChange={setEmailScheduleDate} placeholder={tx('dossier.emailScheduleDate')} />
                      <TimePicker value={emailScheduleTime} onChange={setEmailScheduleTime} ariaLabel={tx('dossier.messageClock')} />
                    </div>
                  </div>
                  <MarkdownTextarea className="composer-body note-body" value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder={tx('dossier.noteContentPlaceholder')} rows={6} />
                  <div className="composer-actions">
                    <button type="button" className="primary-action" onClick={() => {
                      if (!emailBody.trim()) return
                      onAddCommunication(buildCommunicationInput('note', formatDate(emailScheduleDate, lang), emailBodyForCommunication))
                      clearEmailComposer()
                    }}><Plus size={14} /> {tx('dossier.saveNote')}</button>
                  </div>
                </div>
              )}
            </CollapsiblePanel>

            {pendingComposerExit && (
              <ModalPortal>
                <div className={`dialog-layer composer-exit-layer${composerExitExiting ? ' exiting' : ''}`} onClick={(event) => {
                  if (event.target === event.currentTarget) requestComposerExitClose()
                }}>
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
                      <h3 id="composer-exit-title">{tx(correspondenceMode === 'draft-email' ? 'dossier.draftEmailExitTitle' : 'dossier.unsavedComposerTitle')}</h3>
                      <p id="composer-exit-message">{tx(correspondenceMode === 'draft-email' ? 'dossier.draftEmailExitMessage' : 'dossier.unsavedComposerMessage')}</p>
                    </div>
                    <div className="composer-exit-actions">
                      {correspondenceMode === 'draft-email' ? (
                        <>
                          <button type="button" className="primary-action" onClick={() => requestComposerExitClose(() => { void handlePendingComposerSend() })}>
                            <Send size={14} aria-hidden="true" /> {tx('dossier.sendComposer')}
                          </button>
                          {canUseDrafts && (
                            <button type="button" className="quiet-action" onClick={() => requestComposerExitClose(() => { void handlePendingComposerDraft() })}>
                              <FileText size={14} aria-hidden="true" /> {tx('dossier.saveDraft')}
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <button type="button" className="primary-action save-action" onClick={() => requestComposerExitClose(() => { void handlePendingComposerSave() })}>
                            <Save size={14} aria-hidden="true" /> {tx('dossier.saveComposer')}
                          </button>
                          {canUseDrafts && (
                          <button type="button" className="quiet-action" onClick={() => requestComposerExitClose(() => { void handlePendingComposerDraft() })}>
                            <FileText size={14} aria-hidden="true" /> {tx('dossier.saveAsDraft')}
                          </button>
                          )}
                        </>
                      )}
                      <button type="button" className="warning-action" onClick={() => requestComposerExitClose(handlePendingComposerDiscard)}>
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
            <div key={correspondenceView} className={`correspondence-view-panel ${correspondenceView === 'drafts' ? 'from-next' : 'from-prev'}`}>
              {!tabContentReady ? (
                <DossierDeferredRows className="correspondence-list-deferred" />
              ) : visibleCommunications.length === 0 ? (
                <div className="correspondence-empty-state">
                  <div className="correspondence-empty-icon">
                    {correspondenceView === 'drafts' ? <Archive size={28} /> : <MessageSquare size={28} />}
                  </div>
                  <span>{tx(correspondenceView === 'drafts' ? 'dossier.noDrafts' : 'dossier.noCommunications')}</span>
                  <p>{tx(correspondenceView === 'drafts' ? 'dossier.noDraftsHint' : 'dossier.noCommunicationsHint')}</p>
                </div>
              ) : (
                <>
                  <ExplorerSelectionBar
                    visible={communicationSelection.selectedCount > 1}
                    label={format(tx('explorer.selectedCount'), { count: communicationSelection.selectedCount })}
                    clearLabel={tx('explorer.clearSelection')}
                    onClear={communicationSelection.clearSelection}
                    actions={[
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
                  {visibleCommunications.map((item) => {
                    const dir = communicationDirection(item)
                    const TimIcon = communicationIcon(item)
                    const timestamp = `${formatDate(item.date, lang)}${item.time ? ` ${item.time}` : ''}`
                    const isNote = item.messageType === 'note' || item.channel === 'Note'
                    const isDraft = item.messageType === 'draft-email'
                    const isRemoving = removingCommunicationIds.has(item.id)
                    const isEditing = editingCommunicationId === item.id
                    const editDraft = isEditing ? communicationEditDraft : null
                    const senderLabel = dir === 'outgoing'
                      ? tx('dossier.messageSenderMe')
                      : dir === 'incoming'
                        ? professorDisplayName
                        : correspondenceTypeLabel(item)
                    return (
                      <div key={item.id} className={`correspondence-event ${dir} ${isNote ? 'is-note' : ''} ${isDraft ? 'is-draft' : ''} ${isRemoving ? 'is-removing' : ''}`}>
                        <div className="correspondence-event-rail">
                          <span className={`correspondence-event-dot ${dir} ${isNote ? 'note' : ''}`}><TimIcon size={10} /></span>
                        </div>
                        <article
                          id={`communication-${item.id}`}
                          className={`correspondence-event-card ${isNote ? 'note-card' : ''} ${isDraft ? 'draft-card' : ''} ${isEditing ? 'editing' : ''} ${communicationSelection.selectedCount > 1 && communicationSelection.selectedIds.has(item.id) ? 'explorer-selected' : ''}`}
                          data-tour={item.id === 'tour-comm-1' ? 'communication-card' : undefined}
                          aria-selected={communicationSelection.selectedIds.has(item.id)}
                          onClick={(event) => {
                            communicationSelection.applyGesture(item.id, event)
                          }}
                          onContextMenu={(event) => openCommunicationContextMenu(event, item)}
                        >
                          <div className="correspondence-event-head">
                            <span className="correspondence-event-type">
                              <span className="correspondence-event-sender">{senderLabel}</span>
                              <span>{correspondenceTypeLabel(item)}</span>
                            </span>
                            <span className="correspondence-event-time">{timestamp}</span>
                          </div>
                          <strong>{localize(item.subject)}</strong>
                          {(item.from || item.to) && !isNote ? (
                            <p className="correspondence-event-route">{item.from || tx('dossier.emailNotConfigured')} → {item.to || tx('dossier.emailNotConfigured')}</p>
                          ) : null}
                          <MarkdownContent value={localize(item.summary)} className="correspondence-event-body" />
                          {(item.attachments ?? []).length > 0 ? (
                            <div className="correspondence-event-attachments" aria-label={tx('profile.attachments')}>
                              {(item.attachments ?? []).map((attachment, index) => (
                                <span key={attachment.id ?? `${attachment.fileName}-${index}`}>
                                  <Paperclip size={10} aria-hidden="true" />
                                  {attachment.fileName}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="correspondence-event-actions" onClick={(event) => event.stopPropagation()}>
                            {onAiDraft && dir === 'incoming' && item.channel === 'Email' ? (
                              <button type="button" className="correspondence-ai-reply-btn" onClick={() => openAiDraft(item)} title={tx('dossier.aiReply')} aria-label={tx('dossier.aiReply')}>
                                <Reply size={13} aria-hidden="true" />
                              </button>
                            ) : null}
                            <CopyButton value={item.summary} label={tx('copySummary')} size={12} />
                            <button type="button" className={`correspondence-edit-btn${isEditing ? ' active' : ''}`}
                              onClick={() => startEditingCommunication(item)} title={isEditing ? tx('dossier.cancelEdit') : tx('explorer.edit')} aria-label={isEditing ? tx('dossier.cancelEdit') : tx('explorer.edit')} aria-expanded={isEditing} disabled={!onUpdateCommunication}>
                              {isEditing ? <X size={12} /> : <Pencil size={12} />}
                            </button>
                            <button type="button" className="correspondence-delete-btn"
                              onClick={() => setConfirmRemoveCommunicationId(item.id)} title={tx('dossier.delete')} aria-label={tx('dossier.delete')}><Trash2 size={12} /></button>
                          </div>
                          {isEditing && editDraft && (
                            <div className="correspondence-edit-panel" onClick={(event) => event.stopPropagation()}>
                              <div className="composer-field">
                                <label>{tx('dossier.emailSubject')}</label>
                                <input
                                  value={editDraft.subject ?? item.subject}
                                  onChange={(event) => updateCommunicationEditDraft({ subject: event.target.value })}
                                  placeholder={tx('dossier.emailSubjectPlaceholder')}
                                />
                              </div>
                              <div className="composer-field">
                                <label>{tx('dossier.messageTime')}</label>
                                <div className="composer-time-row">
                                  <DatePicker
                                    value={editDraft.date ?? item.date}
                                    onChange={(date) => updateCommunicationEditDraft({ date })}
                                    placeholder={tx('dossier.emailScheduleDate')}
                                  />
                                  <TimePicker
                                    value={editDraft.time ?? item.time ?? ''}
                                    onChange={(time) => updateCommunicationEditDraft({ time })}
                                    ariaLabel={tx('dossier.messageClock')}
                                  />
                                </div>
                              </div>
                              {!isNote && (
                                <div className={`composer-route-info editable ${activeRouteSwap === `communication-${item.id}` ? 'route-swapping' : ''}`}>
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
                          )}
                        </article>
                      </div>
                    )
                  })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ================================================================
             FUNDING — Scholarships
             ================================================================ */}
        {tab === 'funding' && (
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
                  setScholarshipAddOpen((open) => !open)
                  setScholarshipDraft((current) =>
                    current.name || current.amount || current.materials.length || current.tasks.length || current.timeline.length
                      ? current
                      : createScholarshipDraft(application.school.name),
                  )
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
                  submitScholarshipDraft()
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
                    onClick={() => {
                      setScholarshipAddOpen(false)
                      setScholarshipDraft(createScholarshipDraft(application.school.name))
                    }}
                  >
                    {tx('dossier.cancelEdit')}
                  </button>
                </div>
              </form>
            </CollapsiblePanel>

            <ExplorerSelectionBar
              visible={scholarshipSelection.selectedCount > 1}
              label={format(tx('explorer.selectedCount'), { count: scholarshipSelection.selectedCount })}
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
                <div className="funding-empty-icon"><GraduationCap size={24} /></div>
                <strong>{tx('dossier.noScholarships')}</strong>
                <p>{tx('dossier.noScholarshipsHint')}</p>
                <button type="button" className="primary-action" onClick={() => setScholarshipAddOpen(true)}>
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
                        <div className="funding-card-icon"><GraduationCap size={18} /></div>
                        <div className="funding-card-info">
                          <div className="funding-card-title-row">
                            <strong>{localize(item.name)}</strong>
                            <span className={`funding-status-chip ${item.status ?? 'Preparing'}`}>
                              {tx(`dossier.scholarshipStatus.${item.status ?? 'Preparing'}`, item.status ?? 'Preparing')}
                            </span>
                          </div>
                          <span>{displaySchool} · {displayIssuer}</span>
                        </div>
                        <div className="funding-card-actions" onClick={(event) => event.stopPropagation()}>
                          <button type="button" className={`funding-mini-btn${isEditing ? ' active' : ''}`} onClick={() => startEditingScholarship(item)} title={isEditing ? tx('dossier.cancelEdit') : tx('explorer.edit')} aria-label={isEditing ? tx('dossier.cancelEdit') : tx('explorer.edit')} aria-expanded={isEditing}>
                            {isEditing ? <X size={13} /> : <Pencil size={13} />}
                          </button>
                          <button type="button" className="funding-mini-btn funding-delete-btn" onClick={() => setConfirmRemoveScholarshipId(item.id)} title={tx('dossier.remove')} aria-label={tx('dossier.remove')}>
                            <Trash2 size={13} />
                          </button>
                          <button type="button" className={`funding-expand-btn ${isExpanded ? 'open' : ''}`} onClick={() => toggleScholarshipExpanded(item.id)} aria-label={isExpanded ? tx('dossier.collapse') : tx('dossier.expand')} aria-expanded={isExpanded}>
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
                              <strong>{completedMaterials}/{materials.length}</strong>
                            </div>
                            <div>
                              <span>{tx('dossier.scholarshipTasks')}</span>
                              <strong>{completedTasks}/{tasks.length}</strong>
                            </div>
                          </div>

                          <div className="funding-progress-line" aria-hidden="true">
                            <span style={{ width: `${progress}%` }} />
                          </div>
                      </CollapsiblePanel>

                      <CollapsiblePanel open={isExpanded || isEditing} className="funding-card-detail" innerClassName="funding-card-detail-inner" keepMounted={isEditing}>
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
                                {isSavingEdit
                                  ? <LoaderCircle className="spin-icon" size={14} aria-hidden="true" />
                                  : <Save size={14} aria-hidden="true" />}
                                {tx('dossier.saveEvent')}
                              </button>
                              <button type="button" className="ghost-action" onClick={() => requestCloseItemEditor('scholarship')} disabled={isSavingEdit}>
                                <X size={13} /> {tx('dossier.cancelEdit')}
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="funding-detail-readonly">
                            {item.notes ? (
                              <section className="funding-detail-notes">
                                <span className="funding-detail-heading"><StickyNote size={13} /> {tx('dossier.notes')}</span>
                                <MarkdownContent value={localize(item.notes)} />
                              </section>
                            ) : null}
                            <div className="funding-detail-columns">
                              <section className="funding-detail-materials">
                                <span className="funding-detail-heading"><FileText size={13} /> {tx('dossier.scholarshipMaterials')}</span>
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
                                        onContextMenu={(event) => openScholarshipMaterialContextMenu(event, item, material)}
                                      >
                                        <button
                                          type="button"
                                          className="funding-detail-line-main"
                                          onClick={() => toggleScholarshipMaterialCompletion(item, material)}
                                          aria-pressed={completed}
                                          aria-label={completed ? tx('dossier.markIncomplete') : tx('dossier.markComplete')}
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
                                <span className="funding-detail-heading"><CheckCircle2 size={13} /> {tx('dossier.scholarshipTasks')}</span>
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
                                          aria-label={task.done ? tx('dossier.markIncomplete') : tx('dossier.markComplete')}
                                          title={`${task.done ? tx('dossier.markIncomplete') : tx('dossier.markComplete')} · ${tx('explorer.changeStatus')}`}
                                        >
                                          <strong>{localize(task.title)}</strong>
                                          <span className="funding-detail-line-meta">
                                            <span className={`funding-task-status ${task.done ? 'complete' : 'open'}`}>
                                              {task.done ? tx('explorer.statusComplete') : tx('explorer.statusOpen')}
                                            </span>
                                            <span>{formatDate(task.due, lang)}</span>
                                          </span>
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </section>
                            </div>
                            <section className="funding-detail-timeline">
                              <span className="funding-detail-heading"><Clock size={13} /> {tx('dossier.scholarshipTimeline')}</span>
                              {events.length === 0 ? (
                                <p className="scholarship-mini-empty">{tx('dossier.scholarshipNoTimeline')}</p>
                              ) : (
                                <div className="funding-scholarship-timeline" role="list">
                                  {[...events]
                                    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
                                    .map((event, eventIndex, sorted) => {
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
                                            {!isLast ? <span className={`funding-scholarship-timeline-line ${status}`} /> : null}
                                          </div>
                                          <div className="funding-scholarship-timeline-card">
                                            <div className="funding-scholarship-timeline-card-head">
                                              <strong>{localize(event.title)}</strong>
                                              <time dateTime={event.date}>{formatDate(event.date, lang)}</time>
                                            </div>
                                            {event.note ? (
                                              <p className="funding-scholarship-timeline-note">{localize(event.note)}</p>
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
                fees={application.fees ?? []}
                onAdd={onAddFee}
                onUpdate={onUpdateFee}
                onDelete={onDeleteFee}
              />
            </div>
            ) : null}
          </div>
        )}

        {/* ================================================================
             TIMELINE — Collapsible tasks + grouped event timeline
             ================================================================ */}
        {tab === 'timeline' && (() => {
          const renderNowMarker = (key: string) => (
            <div key={key} className="timeline-now-marker" ref={nowMarkerRef} data-timeline-date={today}>
              <div className="timeline-now-rail"><div className="timeline-now-dot" /></div>
              <div className="timeline-now-label"><span>{tx('dossier.timeGroupToday')}</span></div>
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
                      : format(tx('dossier.eventCount'), { count: unifiedTimelineEvents.length })}
                </p>
              </div>
              {onAddTimelineEvent && (
                <button
                  type="button"
                  className={`primary-action timeline-hero-add-btn ${timelineAddOpen ? 'active' : ''}`}
                  onClick={() => { setTimelineAddOpen(!timelineAddOpen); setEditingEventId(null) }}
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
                  if (timelineTitle.trim()) {
                    onAddTimelineEvent(timelineTitle, timelineDate, timelineNote)
                    setTimelineTitle('')
                    setTimelineNote('')
                    setTimelineAddOpen(false)
                  }
                }}
              >
                <div className="timeline-add-panel-fields">
                  <input
                    value={timelineTitle}
                    onChange={(e) => setTimelineTitle(e.target.value)}
                    placeholder={tx('dossier.eventTitle')}
                    aria-label={tx('dossier.eventTitle')}
                    className="timeline-add-panel-input"
                    tabIndex={timelineAddOpen ? 0 : -1}
                  />
                  <DatePicker value={timelineDate} onChange={setTimelineDate} placeholder={tx('dossier.eventDate')} />
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
                  <button type="submit" className="primary-action timeline-add-btn"><Plus size={14} /> {tx('dossier.addEvent')}</button>
                  <button type="button" className="ghost-action" onClick={() => setTimelineAddOpen(false)}>{tx('dossier.cancelEdit')}</button>
                </div>
              </form>
              </CollapsiblePanel>
            )}

            {/* Timeline events */}
            <div className="timeline-section">
              <div className="timeline-section-header">
                <div className="timeline-section-heading">
                  <Clock size={16} /><h4>{tx('dossier.timeline')}</h4>
                  <span className="timeline-count-badge">{unifiedTimelineEvents.length}</span>
                </div>
              </div>

              {!tabContentReady ? (
                <DossierDeferredRows className="timeline-list-deferred" />
              ) : unifiedTimelineEvents.length === 0 ? (
                <div className="timeline-empty"><Clock size={24} /><span>{tx('dossier.noTimeline')}</span></div>
              ) : (
                <>
                  <ExplorerSelectionBar
                    visible={timelineSelection.selectedCount > 1}
                    label={format(tx('explorer.selectedCount'), { count: timelineSelection.selectedCount })}
                    clearLabel={tx('explorer.clearSelection')}
                    onClear={timelineSelection.clearSelection}
                    actions={[
                      {
                        id: 'delete',
                        label: tx('explorer.deleteSelected'),
                        icon: <Trash2 size={13} aria-hidden="true" />,
                        disabled: timelineSelection.selectedIdList.every((id) =>
                          !unifiedTimelineEvents.some((event) => event.id === id && event.manual),
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
                          const showNowMarker = timelineNowMarker?.groupIndex === gi && timelineNowMarker?.eventIndex === ei
                          const isEditing = editingEventId === event.id
                          const isFirstInGroup = ei === 0
                          const isLastInGroup = ei === group.events.length - 1
                          const isLastOverall = gi === groupedTimeline.length - 1 && isLastInGroup
                          const noteLong = event.note && event.note.length > 120
                          const noteExpanded = expandedNotes.has(event.id)
                          const canEditEvent = Boolean(event.manual && (onUpdateTimelineEvent || onRemoveTimelineEvent))
                          const relativeLabel = relativeTime(event.date, lang)
                          const showRelativeLabel = Boolean(relativeLabel) && relativeLabel !== formatDate(event.date, lang)
                          const isRemoving = removingTimelineIds.has(event.id)
                          const timelineRenderKey = `${group.key}:${event.date}:${event.source ?? 'manual'}:${event.id}:${ei}`

                          if (isEditing && event.manual && onUpdateTimelineEvent) {
                            return (
                              <Fragment key={timelineRenderKey}>
                                {showNowMarker && renderNowMarker('now-marker')}
                                <form
                                  className={`timeline-event timeline-event-editing animate-enter ${isRemoving ? 'is-removing' : ''}`}
                                  data-timeline-date={event.date}
                                    onSubmit={(e) => {
                                      e.preventDefault()
                                      saveTimelineEdit()
                                  }}
                                >
                                  <div className="timeline-event-rail">
                                    <div className={`timeline-event-dot ${eventStatus}`} />
                                    {!isLastOverall && <div className={`timeline-event-line ${eventStatus}`} />}
                                  </div>
                                  <div className="timeline-event-card timeline-event-card-edit">
                                    <input
                                      value={editTitle}
                                      onChange={(e) => setEditTitle(e.target.value)}
                                      className="timeline-edit-input"
                                      placeholder={tx('dossier.eventTitle')}
                                      autoFocus
                                    />
                                    <DatePicker value={editDate} onChange={setEditDate} placeholder={tx('dossier.eventDate')} />
                                    <MarkdownTextarea
                                      value={editNote}
                                      onChange={(e) => setEditNote(e.target.value)}
                                      className="timeline-edit-textarea"
                                      placeholder={tx('dossier.eventNote')}
                                      rows={2}
                                    />
                                    <div className="timeline-edit-actions">
                                      <button type="submit" className="primary-action save-action timeline-add-btn"><Save size={13} /> {tx('dossier.saveEvent')}</button>
                                      <button type="button" className="ghost-action" onClick={() => requestCloseItemEditor('timeline')}>{tx('dossier.cancelEdit')}</button>
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
                                className={`timeline-event ${isFirstInGroup ? 'timeline-event-first' : ''} ${isRemoving ? 'is-removing' : ''}`}
                                data-timeline-date={event.date}
                                data-timeline-scroll-reveal=""
                              >
                                <div className="timeline-event-rail">
                                  <div className={`timeline-event-dot ${eventStatus}`} />
                                  {!isLastOverall && <div className={`timeline-event-line ${eventStatus}`} />}
                                </div>
                                <div
                                  id={`timeline-event-${event.id}`}
                                  className={`timeline-event-card ${timelineSelection.selectedCount > 1 && timelineSelection.selectedIds.has(event.id) ? 'explorer-selected' : ''} ${event.nav ? 'timeline-event-card-navigable' : ''}`}
                                  data-tour={event.id === 'tour-timeline-shortlist' ? 'timeline-card' : undefined}
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
                                      <span className="timeline-event-date">{formatDate(event.date, lang)}</span>
                                      {showRelativeLabel && <span className="timeline-event-relative">{relativeLabel}</span>}
                                    </div>
                                    {event.nav && (
                                      <span className="timeline-event-nav-hint" aria-hidden="true"><ArrowUpRight size={13} /></span>
                                    )}
                                    {canEditEvent && (
                                      <div className="timeline-event-actions" onClick={(actionEvent) => actionEvent.stopPropagation()}>
                                        {onUpdateTimelineEvent && (
                                          <button
                                            type="button"
                                            className="timeline-event-action-btn"
                                            title={tx('dossier.editEvent')}
                                            onClick={() => {
                                              startEditingTimelineEvent(event)
                                            }}
                                          ><Pencil size={13} /></button>
                                        )}
                                        {onRemoveTimelineEvent && (
                                          <button
                                            type="button"
                                            className="timeline-event-action-btn timeline-event-delete-btn"
                                            title={tx('dossier.deleteEvent')}
                                            onClick={() => removeManualTimelineEvents([event.id])}
                                          ><Trash2 size={13} /></button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <strong>{localize(event.title)}</strong>
                                  {event.source ? <span className="timeline-source-chip">{event.source}</span> : null}
                                  {event.note && (
                                    <div className={`timeline-event-note ${noteLong && !noteExpanded ? 'collapsed' : ''}`}>
                                      <MarkdownContent value={localize(event.note)} />
                                      {noteLong && (
                                        <button
                                          type="button"
                                          className="timeline-note-toggle"
                                          onClick={() => {
                                            const next = new Set(expandedNotes)
                                            if (noteExpanded) { next.delete(event.id) } else { next.add(event.id) }
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

        {/* Team feedback stays outside the fieldset so comments remain available even when fields are grouped. */}
        {tab === 'review' && (() => {
          const comments = [...(draft.reviewComments ?? [])].reverse()
          const reviewCountStr = comments.length === 0
            ? tx('dossier.reviewEmpty')
            : String(comments.length)
          async function handleSubmitComment() {
            if (!reviewCommentText.trim() || !onAddReviewComment) return
            const sourceApplicationId = application.id
            setReviewCommentBusy(true)
            try {
              await onAddReviewComment(reviewCommentText.trim(), 'dossier')
              if (activeApplicationIdRef.current === sourceApplicationId) setReviewCommentText('')
            } finally {
              if (activeApplicationIdRef.current === sourceApplicationId) setReviewCommentBusy(false)
            }
          }
          const canRequestFeedback = Boolean(
            draft.teamId
            && session.user.id
            && draft.ownerId === session.user.id,
          )
          async function handleRequestFeedback() {
            if (!canRequestFeedback || feedbackBusy) return
            setFeedbackBusy(true)
            setFeedbackStatus(null)
            try {
              const result = await phdApi.requestApplicationFeedback(session.token, application.id, feedbackNote.trim())
              setFeedbackStatus(format(tx('team.requestFeedbackSent'), { count: result.notified }))
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
                  onClick={() => void handleRequestFeedback()}
                >
                  {feedbackBusy ? tx('team.requestFeedbackWorking') : tx('team.requestFeedback')}
                </button>
                {feedbackStatus ? <p className="review-request-feedback-ok" role="status">{feedbackStatus}</p> : null}
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
                    onClick={handleSubmitComment}
                  >
                    <MessageSquare size={13} aria-hidden="true" />
                    {reviewCommentBusy ? tx('working') : tx('dossier.reviewSubmit')}
                  </button>
                </div>
              </div>
            ) : null}

            {comments.length === 0 ? (
              <p className="muted">{tx('dossier.reviewEmpty')}</p>
            ) : (
              <ul className="review-comment-list">
                {comments.map((comment) => (
                  <li key={comment.id} id={`review-comment-${comment.id}`} className="review-comment-item">
                    <div className="review-comment-head">
                      <span className="review-comment-author">{comment.authorName}</span>
                      <span className="review-comment-time" title={comment.createdAt}>
                        {(() => {
                          try { return formatDate(comment.createdAt.slice(0, 10), lang) } catch { return comment.createdAt }
                        })()}
                      </span>
                    </div>
                    <MarkdownContent value={comment.body} className="review-comment-body" />
                  </li>
                ))}
              </ul>
            )}
          </div>
          )
        })()}

      </div>
      {pendingDraftExit && (
        <ModalPortal>
          <div className={`dialog-layer composer-exit-layer${draftExitExiting ? ' exiting' : ''}`} onClick={(event) => {
            if (event.target === event.currentTarget) requestDraftExitClose()
          }}>
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
                <h3 id="draft-exit-title">{tx('dossier.unsavedChangesTitle')}</h3>
                <p id="draft-exit-message">{tx('dossier.unsavedChangesMessage')}</p>
              </div>
              <div className="composer-exit-actions">
                <button type="button" className="primary-action save-action" onClick={() => requestDraftExitClose(() => { void handlePendingDraftSave() })} disabled={saving}>
                  <Save size={14} aria-hidden="true" /> {saving ? tx('dossier.saving') : tx('dossier.save')}
                </button>
                <button type="button" className="warning-action" onClick={() => requestDraftExitClose(handlePendingDraftDiscard)}>
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
          <div className={`dialog-layer composer-exit-layer${resourceSettingsExitExiting ? ' exiting' : ''}`} onClick={(event) => {
            if (event.target === event.currentTarget) requestResourceSettingsExitClose()
          }}>
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
                <button type="button" className="primary-action save-action" onClick={() => requestResourceSettingsExitClose(() => { void handlePendingResourceSettingsSave() })} disabled={saving}>
                  <Save size={14} aria-hidden="true" /> {saving ? tx('dossier.saving') : tx('dossier.save')}
                </button>
                <button type="button" className="warning-action" onClick={() => requestResourceSettingsExitClose(handlePendingResourceSettingsDiscard)}>
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
          <div className={`dialog-layer composer-exit-layer${itemEditExitExiting ? ' exiting' : ''}`} onClick={(event) => {
            if (event.target === event.currentTarget) requestItemEditExitClose()
          }}>
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
                <button type="button" className="primary-action save-action" onClick={() => requestItemEditExitClose(() => { void handlePendingItemEditSave() })} disabled={savingScholarshipId !== null}>
                  <Save size={14} aria-hidden="true" /> {tx('dossier.save')}
                </button>
                <button type="button" className="warning-action" onClick={() => requestItemEditExitClose(handlePendingItemEditDiscard)}>
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
      <ExplorerContextMenu menu={explorerMenu} onClose={closeExplorerMenu} />
      <ConfirmDialog
        open={confirmRemoveAttachment !== null}
        title={tx('dossier.removeAttachment')}
        message={tx('dossier.removeAttachmentConfirm')}
        confirmLabel={tx('dossier.remove')}
        cancelLabel={tx('cancel')}
        variant="danger"
        onConfirm={() => {
          if (confirmRemoveAttachment) {
            const { kind, itemId, fileId } = confirmRemoveAttachment
            if (kind === 'material') {
              const material = draft.materials.find((m) => m.id === itemId)
              if (material) removeChecklistAttachment('material', material, fileId)
            } else {
              const task = draft.tasks.find((t) => t.id === itemId)
              if (task) removeChecklistAttachment('task', task, fileId)
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
