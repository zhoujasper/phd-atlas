import {
  Archive,
  ChevronLeft,
  ArrowUpRight,
  AtSign,
  Bell,
  Building2,
  Calendar,
  Check,
  CheckCheck,
  Compass,
  Clock,
  FileText,
  Inbox,
  Mail,
  MailOpen,
  Megaphone,
  Paperclip,
  Pencil,
  Send,
  ShieldCheck,
  UserCog,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { UserAvatar } from './UserAvatar'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { NotificationRecord, NotificationType, TeamMember, TeamRole } from '../../api/phdApi'
import { relativeTime } from '../../appModel'
import type { ApplicationRecord } from '../../data/applications'
import { localeForLanguage } from '../../i18n'
import { notificationDisplayText } from '../../notificationMessages'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'
import { Skeleton } from './Skeleton'
import { InlinePresence } from './InlinePresence'
import { ExplorerContextMenu, type ExplorerContextMenuState } from './ExplorerContextMenu'

type Tx = (path: string, fallback?: string) => string
type Format = (template: string, values: Record<string, string | number>) => string
type NotificationApplicationRecord = ApplicationRecord & {
  ownerName?: string
  ownerEmail?: string
  currentUserApplicationRole?: TeamRole | null
}
type NotificationCommunication = ApplicationRecord['communications'][number]

const NOTIFICATION_ICONS: Record<NotificationType, typeof Bell> = {
  task_due: CheckCheck,
  material_reminder: FileText,
  deadline_approaching: Calendar,
  new_email_imported: Mail,
  team_invite: Users,
  team_message: Users,
  team_update: UserCog,
  membership_update: ShieldCheck,
  admin_announcement: Megaphone,
  push_test: Bell,
  discover_match: Compass,
  discover_deadline: Calendar,
  discover_research_complete: Compass,
  discover_research_failed: Compass,
}

const TEAM_NOTIFICATION_TYPES = new Set<NotificationType>([
  'team_invite',
  'team_message',
  'team_update',
  'membership_update',
])

function metadataString(item: NotificationRecord, key: string) {
  const value = item.metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstMetadataString(item: NotificationRecord, keys: string[]) {
  for (const key of keys) {
    const value = metadataString(item, key)
    if (value) return value
  }
  return null
}

function metadataList(item: NotificationRecord, key: string) {
  const value = item.metadata?.[key]
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean)
  }
  return []
}

function joinMetadataList(values: string[], tx: Tx) {
  return values.length > 0 ? values.join(tx('notifications.detail.listSeparator')) : tx('notifications.detail.notRecorded')
}

function parseEmailSender(title: string) {
  return /^New email from (.+)$/.exec(title)?.[1]
    ?? /^收到\s*(.+?)\s*的新邮件$/.exec(title)?.[1]
    ?? null
}

function parseEmailSubject(body: string) {
  return /^"(.+?)"/.exec(body)?.[1]
    ?? /^“(.+?)”/.exec(body)?.[1]
    ?? null
}

function parseTeamActor(item: NotificationRecord) {
  const candidates = [
    /^(.+?) commented on /,
    /^(.+?) changed \d+ fields?/,
    /^(.+?) updated your /,
    /^(.+?) removed your /,
    /^(.+?) 评论了/,
    /^(.+?) 修改了/,
    /^(.+?) 更新了/,
    /^(.+?) 已将/,
  ]
  for (const pattern of candidates) {
    const match = pattern.exec(item.title) ?? pattern.exec(item.body)
    if (match?.[1]?.trim()) return match[1].trim()
  }
  return null
}

function notificationTypeLabel(type: NotificationType, tx: Tx) {
  return tx(`notifications.detail.type.${type}`, type.replaceAll('_', ' '))
}

function tabLabel(tab: string | null | undefined, tx: Tx) {
  if (!tab) return null
  return tx(`notifications.detail.tab.${tab}`, tab)
}

function targetDescription(item: NotificationRecord, tx: Tx) {
  const targetPath = item.targetPath?.trim()
  if (targetPath?.startsWith('/team/applications/')) return tx('notifications.detail.destinationTeamApplication')
  if (targetPath === '/team' || targetPath?.startsWith('/team?')) return tx('notifications.detail.destinationTeam')
  if (targetPath?.startsWith('/team/members')) return tx('notifications.detail.destinationTeamMembers')
  if (targetPath?.startsWith('/settings')) return tx('notifications.detail.destinationSettings')
  if (targetPath?.startsWith('/applications/')) return tx('notifications.detail.destinationApplication')
  return tabLabel(item.targetTab, tx) ?? targetPath ?? tx('notifications.detail.destinationWorkspace')
}

function roleLabel(role: string | null | undefined, tx: Tx) {
  if (role === 'owner') return tx('notifications.detail.roleOwner')
  if (role === 'admin') return tx('notifications.detail.roleTeacher')
  if (role === 'member') return tx('notifications.detail.roleStudent')
  return null
}

function deliveryChannelLabel(channel: string, tx: Tx) {
  if (channel === 'in_app') return tx('notifications.detail.inApp')
  if (channel === 'email') return tx('notifications.detail.email')
  return channel
}

function deliveryChannels(item: NotificationRecord, tx: Tx) {
  const channels = metadataList(item, 'channels')
  if (channels.length > 0) return joinMetadataList(channels.map((channel) => deliveryChannelLabel(channel, tx)), tx)
  if (item.emailedAt) return tx('notifications.detail.email')
  return tx('notifications.detail.inApp')
}

function audienceValueLabel(value: string, tx: Tx) {
  if (value === 'all') return tx('notifications.detail.audienceAll')
  if (value === 'admins') return tx('notifications.detail.audienceAdmins')
  if (value === 'users') return tx('notifications.detail.audienceUsers')
  if (value === 'free') return tx('notifications.detail.audienceFree')
  if (value === 'pro') return tx('notifications.detail.audiencePro')
  if (value === 'team') return tx('notifications.detail.audienceTeam')
  if (value === 'teachers') return tx('notifications.detail.audienceTeachers')
  if (value === 'students') return tx('notifications.detail.audienceStudents')
  if (value === 'my_students') return tx('notifications.detail.audienceMyStudents')
  return value
}

function formatNotificationDate(value: string | null | undefined, lang: string) {
  if (!value) return ''
  const normalized = value.includes('T') ? value : `${value}T00:00:00`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(localeForLanguage(lang), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: value.includes('T') ? '2-digit' : undefined,
    minute: value.includes('T') ? '2-digit' : undefined,
  }).format(date)
}

function applicationLabel(application: NotificationApplicationRecord | null, tx: Tx) {
  if (!application) return tx('notifications.detail.notRecorded')
  return `${application.school.name} · ${application.program}`
}

function findNotificationCommunication(
  item: NotificationRecord,
  application: NotificationApplicationRecord | null,
) {
  const communicationId = metadataString(item, 'communicationId')
  if (!communicationId || !application) return null
  return application.communications.find((communication) => communication.id === communicationId) ?? null
}

function resolveActor(
  item: NotificationRecord,
  teamMembers: TeamMember[],
  tx: Tx,
) {
  const actorId = firstMetadataString(item, ['actorId', 'authorId', 'teacherId'])
  const member = actorId
    ? teamMembers.find((candidate) => candidate.userId === actorId || candidate.id === actorId)
    : null
  const name = firstMetadataString(item, ['actorName', 'authorName', 'teacherName', 'senderName'])
    ?? member?.displayName
    ?? parseTeamActor(item)
    ?? tx('notifications.detail.unknownTeacher')
  const email = firstMetadataString(item, ['actorEmail', 'authorEmail', 'teacherEmail', 'senderEmail'])
    ?? member?.invitedEmail
    ?? ''
  const role = roleLabel(firstMetadataString(item, ['actorRole', 'authorRole']) ?? member?.role, tx)
  return { name, email, role, avatarUrl: member?.avatarUrl }
}

function NotificationDetail({
  item,
  application,
  teamMembers,
  teamName,
  lang,
  tx,
  format,
  onBack,
  onJump,
  jumping,
}: {
  item: NotificationRecord | null
  application: NotificationApplicationRecord | null
  teamMembers: TeamMember[]
  teamName?: string | null
  lang: string
  tx: Tx
  format: Format
  onBack: () => void
  onJump: (notification: NotificationRecord) => void
  jumping: boolean
}) {
  if (!item) {
    return (
      <aside className="notification-center-detail notification-center-detail-empty">
        <Inbox size={26} aria-hidden="true" />
        <strong>{tx('notifications.detail.emptyTitle')}</strong>
        <span>{tx('notifications.detail.emptyBody')}</span>
      </aside>
    )
  }

  const copy = notificationDisplayText(item, tx, format)
  const Icon = NOTIFICATION_ICONS[item.type] ?? Bell
  const isEmail = item.type === 'new_email_imported'
  const isTeam = TEAM_NOTIFICATION_TYPES.has(item.type)
  const isAnnouncement = item.type === 'admin_announcement'
  const canJump = Boolean(item.applicationId || item.targetPath)

  return (
    <aside className={`notification-center-detail ${isEmail ? 'email-detail' : ''} ${isTeam ? 'team-detail' : ''} ${isAnnouncement ? 'announcement-detail' : ''}`}>
      <button type="button" className="notification-detail-back" onClick={onBack}>
        <ChevronLeft size={15} aria-hidden="true" />
        <span>{tx('notifications.backToList')}</span>
      </button>
      <div className="notification-detail-topline">
        <span className={`notification-detail-icon type-${item.type}`} aria-hidden="true">
          <Icon size={15} />
        </span>
        <span>{notificationTypeLabel(item.type, tx)}</span>
        <time dateTime={item.createdAt}>{formatNotificationDate(item.createdAt, lang)}</time>
      </div>

      {isEmail ? (
        <NotificationEmailDetail
          item={item}
          copy={copy}
          application={application}
          communication={findNotificationCommunication(item, application)}
          lang={lang}
          tx={tx}
        />
      ) : isAnnouncement ? (
        <NotificationAnnouncementDetail
          item={item}
          copy={copy}
          lang={lang}
          tx={tx}
          format={format}
        />
      ) : isTeam ? (
        <NotificationTeamDetail
          item={item}
          copy={copy}
          application={application}
          teamMembers={teamMembers}
          teamName={teamName}
          tx={tx}
        />
      ) : (
        <NotificationGenericDetail item={item} copy={copy} application={application} lang={lang} tx={tx} />
      )}

      <div className="notification-detail-footer">
        <span>
          <em>{tx('notifications.detail.destination')}</em>
          <strong>{targetDescription(item, tx)}</strong>
        </span>
        <button
          type="button"
          className="notification-detail-jump"
          onClick={() => onJump(item)}
          disabled={!canJump || jumping}
          aria-label={format(tx('notifications.detail.goToTargetFor'), { title: copy.title })}
        >
          <ArrowUpRight size={14} aria-hidden="true" />
          {jumping ? tx('notifications.detail.jumping') : tx('notifications.detail.goToTarget')}
        </button>
      </div>
    </aside>
  )
}

function NotificationEmailDetail({
  item,
  copy,
  application,
  communication,
  lang,
  tx,
}: {
  item: NotificationRecord
  copy: { title: string; body: string }
  application: NotificationApplicationRecord | null
  communication: NotificationCommunication | null
  lang: string
  tx: Tx
}) {
  const subject = communication?.subject
    ?? firstMetadataString(item, ['emailSubject', 'subject'])
    ?? parseEmailSubject(item.body)
    ?? copy.title
  const sender = communication?.from
    ?? firstMetadataString(item, ['sender', 'from', 'senderEmail'])
    ?? parseEmailSender(item.title)
    ?? application?.professor.email
    ?? tx('notifications.detail.notRecorded')
  const recipient = communication?.to
    ?? firstMetadataString(item, ['recipient', 'to', 'recipientEmail'])
    ?? metadataList(item, 'emailRecipients')[0]
    ?? tx('notifications.detail.notRecorded')
  const date = communication?.date
    ? `${communication.date}${communication.time ? `T${communication.time}` : ''}`
    : item.createdAt
  const body = communication?.summary || copy.body
  const attachments = communication?.attachments ?? []

  return (
    <div className="notification-email-reader">
      <div className="notification-email-subject">
        <span className="notification-type-chip">{tx('notifications.detail.emailImported')}</span>
        <h3>{subject}</h3>
        <p>{applicationLabel(application, tx)}</p>
      </div>

      <dl className="notification-email-meta" aria-label={tx('notifications.detail.emailEnvelope')}>
        <div>
          <dt><Mail size={11} aria-hidden="true" /> {tx('notifications.detail.emailSubject')}</dt>
          <dd>{subject}</dd>
        </div>
        <div>
          <dt><AtSign size={11} aria-hidden="true" /> {tx('notifications.detail.emailFrom')}</dt>
          <dd>{sender}</dd>
        </div>
        <div>
          <dt><AtSign size={11} aria-hidden="true" /> {tx('notifications.detail.emailTo')}</dt>
          <dd>{recipient}</dd>
        </div>
        <div>
          <dt><Clock size={11} aria-hidden="true" /> {tx('notifications.detail.emailDate')}</dt>
          <dd>{formatNotificationDate(date, lang)}</dd>
        </div>
      </dl>

      <div className="notification-email-body">
        <span className="notification-section-label">{tx('notifications.detail.emailBody')}</span>
        <p>{body}</p>
      </div>

      {attachments.length > 0 ? (
        <div className="notification-email-attachments" aria-label={tx('notifications.detail.attachments')}>
          {attachments.map((attachment, index) => (
            <span key={attachment.id ?? `${attachment.fileName}-${index}`}>
              <Paperclip size={11} aria-hidden="true" />
              {attachment.fileName}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function NotificationAnnouncementDetail({
  item,
  copy,
  lang,
  tx,
  format,
}: {
  item: NotificationRecord
  copy: { title: string; body: string }
  lang: string
  tx: Tx
  format: Format
}) {
  const actorName = firstMetadataString(item, ['actorName', 'authorName', 'senderName'])
    ?? tx('notifications.detail.systemSender')
  const actorEmail = firstMetadataString(item, ['actorEmail', 'authorEmail', 'senderEmail'])
  const recipientName = firstMetadataString(item, ['recipientName'])
  const recipientEmail = firstMetadataString(item, ['recipientEmail'])
  const emailRecipients = metadataList(item, 'emailRecipients')
  const audiences = metadataList(item, 'audiences')
  const groups = metadataList(item, 'groupIds')
  const recipientLabel = recipientName && recipientEmail
    ? `${recipientName} · ${recipientEmail}`
    : recipientName ?? recipientEmail ?? joinMetadataList(emailRecipients, tx)
  const audienceLabel = audiences.length > 0
    ? joinMetadataList(audiences.map((audience) => audienceValueLabel(audience, tx)), tx)
    : groups.length > 0
      ? joinMetadataList(groups, tx)
      : tx('notifications.detail.notRecorded')
  const hasEmailChannel = metadataList(item, 'channels').includes('email') || Boolean(item.emailedAt)

  return (
    <div className="notification-announcement-reader">
      <div className="notification-announcement-hero">
        <span className="notification-type-chip">{tx('notifications.detail.announcement')}</span>
        <h3>{copy.title}</h3>
        <p>{format(tx('notifications.detail.publishedBy'), { name: actorName })}</p>
      </div>

      <div className="notification-announcement-body">
        <span className="notification-section-label">{tx('notifications.detail.announcementBody')}</span>
        <p>{copy.body}</p>
      </div>

      <dl className="notification-detail-grid notification-announcement-meta">
        <div>
          <dt><UserRound size={12} aria-hidden="true" /> {tx('notifications.detail.announcementFrom')}</dt>
          <dd>
            <strong>{actorName}</strong>
            {actorEmail ? <span>{actorEmail}</span> : null}
          </dd>
        </div>
        <div>
          <dt><Send size={12} aria-hidden="true" /> {tx('notifications.detail.delivery')}</dt>
          <dd>
            <strong>{deliveryChannels(item, tx)}</strong>
            {item.emailedAt ? <span>{format(tx('notifications.detail.emailDeliveredAt'), { date: formatNotificationDate(item.emailedAt, lang) })}</span> : null}
          </dd>
        </div>
        <div>
          <dt><Users size={12} aria-hidden="true" /> {tx('notifications.detail.recipient')}</dt>
          <dd>{recipientLabel}</dd>
        </div>
        <div>
          <dt><Megaphone size={12} aria-hidden="true" /> {tx('notifications.detail.audience')}</dt>
          <dd>{audienceLabel}</dd>
        </div>
      </dl>

      {hasEmailChannel ? (
        <div className="notification-announcement-mail">
          <span className="notification-section-label">{tx('notifications.detail.emailPreview')}</span>
          <dl className="notification-email-meta" aria-label={tx('notifications.detail.emailEnvelope')}>
            <div>
              <dt><Mail size={11} aria-hidden="true" /> {tx('notifications.detail.emailSubject')}</dt>
              <dd>{copy.title}</dd>
            </div>
            <div>
              <dt><AtSign size={11} aria-hidden="true" /> {tx('notifications.detail.emailFrom')}</dt>
              <dd>{actorEmail ?? actorName}</dd>
            </div>
            <div>
              <dt><AtSign size={11} aria-hidden="true" /> {tx('notifications.detail.emailTo')}</dt>
              <dd>{joinMetadataList(emailRecipients.length > 0 ? emailRecipients : [recipientEmail ?? recipientName ?? ''].filter(Boolean), tx)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  )
}

function NotificationTeamDetail({
  item,
  copy,
  application,
  teamMembers,
  teamName,
  tx,
}: {
  item: NotificationRecord
  copy: { title: string; body: string }
  application: NotificationApplicationRecord | null
  teamMembers: TeamMember[]
  teamName?: string | null
  tx: Tx
}) {
  const actor = resolveActor(item, teamMembers, tx)
  const changedFields = metadataList(item, 'changedRoots')
  const rawChangedFields = changedFields.length > 0 ? changedFields : metadataList(item, 'changedFields')
  const resolvedTeamName = firstMetadataString(item, ['teamName']) ?? teamName ?? tx('notifications.detail.notRecorded')
  const ownerName = application?.ownerName ?? metadataString(item, 'ownerName')
  const route = targetDescription(item, tx)

  return (
    <div className="notification-team-reader">
      <div className="notification-team-overview">
        <UserAvatar
          avatarUrl={actor.avatarUrl}
          name={actor.name}
          email={actor.email}
          className="notification-team-avatar"
        />
        <div>
          <span className="notification-type-chip">{tx('notifications.detail.teamMessage')}</span>
          <h3>{copy.title}</h3>
          <p>{copy.body}</p>
        </div>
      </div>

      <dl className="notification-detail-grid">
        <div>
          <dt><UserRound size={12} aria-hidden="true" /> {tx('notifications.detail.teacher')}</dt>
          <dd>
            <strong>{actor.name}</strong>
            {actor.email ? <span>{actor.email}</span> : null}
          </dd>
        </div>
        <div>
          <dt><ShieldCheck size={12} aria-hidden="true" /> {tx('notifications.detail.teacherView')}</dt>
          <dd>
            <strong>{actor.role ?? tx('notifications.detail.roleTeacher')}</strong>
            <span>{route}</span>
          </dd>
        </div>
        <div>
          <dt><Users size={12} aria-hidden="true" /> {tx('notifications.detail.team')}</dt>
          <dd>{resolvedTeamName}</dd>
        </div>
        <div>
          <dt><Building2 size={12} aria-hidden="true" /> {tx('notifications.detail.application')}</dt>
          <dd>
            <strong>{applicationLabel(application, tx)}</strong>
            {ownerName ? <span>{formatOwner(ownerName, tx)}</span> : null}
          </dd>
        </div>
      </dl>

      {rawChangedFields.length > 0 ? (
        <div className="notification-detail-chip-block">
          <span>{tx('notifications.detail.changedFields')}</span>
          <div>
            {rawChangedFields.slice(0, 8).map((field) => (
              <em key={field}>{field}</em>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function formatOwner(ownerName: string, tx: Tx) {
  return tx('notifications.detail.studentOwner').split('{name}').join(ownerName)
}

function NotificationGenericDetail({
  item,
  copy,
  application,
  lang,
  tx,
}: {
  item: NotificationRecord
  copy: { title: string; body: string }
  application: NotificationApplicationRecord | null
  lang: string
  tx: Tx
}) {
  return (
    <div className="notification-generic-reader">
      <h3>{copy.title}</h3>
      <p>{copy.body}</p>
      <dl className="notification-detail-grid">
        <div>
          <dt><Calendar size={12} aria-hidden="true" /> {tx('notifications.detail.triggerDate')}</dt>
          <dd>{formatNotificationDate(item.triggerDate, lang)}</dd>
        </div>
        <div>
          <dt><Building2 size={12} aria-hidden="true" /> {tx('notifications.detail.application')}</dt>
          <dd>{applicationLabel(application, tx)}</dd>
        </div>
      </dl>
    </div>
  )
}

function isCompactNotificationViewport() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 820px)').matches
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const MARK_ALL_CLEAR_ROW_MS = 220
const MARK_ALL_CLEAR_BUFFER_MS = 20

export function NotificationCenter({
  open,
  notifications,
  loading,
  applicationRecords = [],
  teamMembers = [],
  teamName,
  onClose,
  onMarkRead,
  onMarkUnread,
  onMarkAllRead,
  onArchive,
  onOpenNotification,
}: {
  open: boolean
  notifications: NotificationRecord[]
  loading: boolean
  applicationRecords?: NotificationApplicationRecord[]
  teamMembers?: TeamMember[]
  teamName?: string | null
  onClose: () => void
  onMarkRead: (ids: string[]) => void
  onMarkUnread: (ids: string[]) => void
  onMarkAllRead: () => void
  onArchive: (ids: string[]) => void
  onOpenNotification: (notification: NotificationRecord) => void
}) {
  const { tx, format, lang } = useI18n()
  const closeTimerRef = useRef<number | null>(null)
  const jumpTimerRef = useRef<number | null>(null)
  const markAllClearTimerRef = useRef<number | null>(null)
  const markAllSettleFrameRef = useRef<number | null>(null)
  const selectionAnchorIdRef = useRef<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread' | 'archived'>('all')
  const [editing, setEditing] = useState(false)
  const [selectionContextMenu, setSelectionContextMenu] = useState<ExplorerContextMenuState | null>(null)
  const [isCompactViewport, setIsCompactViewport] = useState(isCompactNotificationViewport)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [jumpingId, setJumpingId] = useState<string | null>(null)
  /** Ids currently playing the mark-all unread → read clear animation. */
  const [clearingUnreadIds, setClearingUnreadIds] = useState<Set<string>>(() => new Set())
  const [clearingAllUnread, setClearingAllUnread] = useState(false)
  const dialogHeightRef = useRef<number | null>(null)
  const dialogHeightAnimationRef = useRef<{
    frame: number | null
    timeout: number | null
    removeTransitionEnd: (() => void) | null
  }>({ frame: null, timeout: null, removeTransitionEnd: null })

  const requestClose = useCallback(() => {
    if (closeTimerRef.current !== null || jumpTimerRef.current !== null) return
    setExiting(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      onClose()
    }, getMotionDelay(120))
  }, [onClose])

  const requestModalClose = useCallback(() => {
    if (selectionContextMenu) {
      setSelectionContextMenu(null)
      return
    }
    requestClose()
  }, [requestClose, selectionContextMenu])

  const dialogRef = useModalA11y<HTMLElement>({ open, onClose: requestModalClose })
  const hasUnread = notifications.some((item) => !item.readAt && !item.archivedAt)
  const unreadCount = notifications.filter((item) => !item.readAt && !item.archivedAt).length
  const filteredNotifications = useMemo(
    () => notifications.filter((item) => {
      if (filter === 'archived') return Boolean(item.archivedAt)
      if (filter === 'unread') return !item.archivedAt && !item.readAt
      return !item.archivedAt
    }),
    [filter, notifications],
  )
  const visibleIds = useMemo(() => filteredNotifications.map((item) => item.id), [filteredNotifications])
  const selectedItems = useMemo(
    () => filteredNotifications.filter((item) => selectedIds.has(item.id)),
    [filteredNotifications, selectedIds],
  )
  const selectedCount = selectedItems.length
  const selectedUnreadCount = selectedItems.filter((item) => !item.readAt).length
  const selectedReadCount = selectedCount - selectedUnreadCount
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
  const applicationById = useMemo(() => {
    const map = new Map<string, NotificationApplicationRecord>()
    applicationRecords.forEach((application) => map.set(application.id, application))
    return map
  }, [applicationRecords])
  const activeItem = useMemo(
    () => filteredNotifications.find((item) => item.id === activeId) ?? filteredNotifications[0] ?? null,
    [activeId, filteredNotifications],
  )
  const activeApplication = activeItem?.applicationId
    ? applicationById.get(activeItem.applicationId) ?? null
    : null

  useEffect(() => {
    const dialogHeightAnimation = dialogHeightAnimationRef.current
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
      if (jumpTimerRef.current !== null) window.clearTimeout(jumpTimerRef.current)
      if (markAllClearTimerRef.current !== null) window.clearTimeout(markAllClearTimerRef.current)
      if (markAllSettleFrameRef.current !== null) window.cancelAnimationFrame(markAllSettleFrameRef.current)
      if (dialogHeightAnimation.frame !== null) window.cancelAnimationFrame(dialogHeightAnimation.frame)
      if (dialogHeightAnimation.timeout !== null) window.clearTimeout(dialogHeightAnimation.timeout)
      dialogHeightAnimation.removeTransitionEnd?.()
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(max-width: 820px)')
    const syncViewport = () => setIsCompactViewport(mediaQuery.matches)
    syncViewport()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncViewport)
      return () => mediaQuery.removeEventListener('change', syncViewport)
    }
    if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(syncViewport)
      return () => mediaQuery.removeListener(syncViewport)
    }
    return undefined
  }, [])

  useEffect(() => {
    if (!open) return
    setExiting(false)
    setJumpingId(null)
    setFilter('all')
    setEditing(false)
    setSelectionContextMenu(null)
    setMobileDetailOpen(false)
    setSelectedIds(new Set())
    selectionAnchorIdRef.current = null
    setClearingUnreadIds(new Set())
    setClearingAllUnread(false)
    if (markAllClearTimerRef.current !== null) {
      window.clearTimeout(markAllClearTimerRef.current)
      markAllClearTimerRef.current = null
    }
    if (markAllSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(markAllSettleFrameRef.current)
      markAllSettleFrameRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setActiveId((current) => (current && visibleIds.includes(current) ? current : visibleIds[0] ?? null))
  }, [open, visibleIds])

  useEffect(() => {
    const visibleIdSet = new Set(visibleIds)
    setSelectedIds((current) => {
      const next = new Set<string>()
      let changed = false
      current.forEach((id) => {
        if (visibleIdSet.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      })
      return changed ? next : current
    })
  }, [visibleIds])

  useEffect(() => {
    if (!editing || selectedCount === 0) setSelectionContextMenu(null)
  }, [editing, selectedCount])

  useLayoutEffect(() => {
    if (!open) {
      dialogHeightRef.current = null
      return
    }

    const dialog = dialogRef.current
    if (!dialog) return

    const animation = dialogHeightAnimationRef.current
    if (animation.frame !== null) window.cancelAnimationFrame(animation.frame)
    if (animation.timeout !== null) window.clearTimeout(animation.timeout)
    animation.removeTransitionEnd?.()
    animation.frame = null
    animation.timeout = null
    animation.removeTransitionEnd = null

    const previousHeight = dialogHeightRef.current
    const hasInlineHeight = dialog.style.height !== ''
    const renderedHeight = dialog.getBoundingClientRect().height
    const fromHeight = hasInlineHeight ? renderedHeight : previousHeight ?? renderedHeight

    dialog.style.height = ''
    const targetHeight = dialog.getBoundingClientRect().height
    dialogHeightRef.current = targetHeight

    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (previousHeight === null || reduceMotion || Math.abs(fromHeight - targetHeight) < 1) return

    dialog.style.height = `${fromHeight}px`
    void dialog.offsetHeight

    const settle = () => {
      if (animation.timeout !== null) window.clearTimeout(animation.timeout)
      animation.timeout = null
      animation.removeTransitionEnd?.()
      animation.removeTransitionEnd = null
      dialog.style.height = ''
    }
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === dialog && event.propertyName === 'height') settle()
    }
    dialog.addEventListener('transitionend', onTransitionEnd)
    animation.removeTransitionEnd = () => dialog.removeEventListener('transitionend', onTransitionEnd)
    animation.frame = window.requestAnimationFrame(() => {
      animation.frame = null
      dialog.style.height = `${targetHeight}px`
    })
    animation.timeout = window.setTimeout(settle, 360)
  }, [dialogRef, filter, filteredNotifications.length, loading, mobileDetailOpen, open])

  const runMarkAllRead = useCallback(() => {
    if (clearingAllUnread) return

    const unreadIds = notifications
      .filter((item) => !item.readAt && !item.archivedAt)
      .map((item) => item.id)
    if (unreadIds.length === 0) return

    if (prefersReducedMotion()) {
      onMarkAllRead()
      setSelectedIds(new Set())
      selectionAnchorIdRef.current = null
      return
    }

    // Keep a short, compositor-friendly acknowledgement before the optimistic
    // update. Avoiding per-row height interpolation prevents long lists from
    // repeatedly reflowing while their unread state is cleared.
    setClearingAllUnread(true)
    setClearingUnreadIds(new Set(unreadIds))
    setSelectedIds(new Set())
    selectionAnchorIdRef.current = null

    const delay = MARK_ALL_CLEAR_ROW_MS + MARK_ALL_CLEAR_BUFFER_MS
    if (markAllClearTimerRef.current !== null) window.clearTimeout(markAllClearTimerRef.current)
    markAllClearTimerRef.current = window.setTimeout(() => {
      markAllClearTimerRef.current = null
      onMarkAllRead()
      markAllSettleFrameRef.current = window.requestAnimationFrame(() => {
        markAllSettleFrameRef.current = null
        setClearingUnreadIds(new Set())
        setClearingAllUnread(false)
      })
    }, delay)
  }, [clearingAllUnread, notifications, onMarkAllRead])

  if (!open) return null

  const selectNotification = (
    id: string,
    { shift = false, additive = false }: { shift?: boolean; additive?: boolean } = {},
  ) => {
    const anchorId = selectionAnchorIdRef.current
    const anchorIndex = anchorId ? visibleIds.indexOf(anchorId) : -1
    const targetIndex = visibleIds.indexOf(id)

    setEditing(true)
    setSelectedIds((current) => {
      const next = additive ? new Set(current) : new Set<string>()
      if (shift && anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex]
        visibleIds.slice(start, end + 1).forEach((visibleId) => next.add(visibleId))
      } else if (additive && next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    selectionAnchorIdRef.current = id
  }

  const toggleSelection = (id: string) => selectNotification(id, { additive: true })

  const toggleAll = () => {
    selectionAnchorIdRef.current = allSelected ? null : visibleIds[0] ?? null
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id))
      } else {
        visibleIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const clearSelection = () => {
    selectionAnchorIdRef.current = null
    setSelectedIds(new Set())
  }

  const selectFilter = (nextFilter: 'all' | 'unread' | 'archived') => {
    setFilter(nextFilter)
    setEditing(false)
    clearSelection()
  }

  const toggleEditing = () => {
    if (editing) clearSelection()
    else selectionAnchorIdRef.current = null
    setEditing((current) => !current)
  }

  const runSelectedAction = (action: 'read' | 'unread' | 'archive') => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (action === 'read') onMarkRead(ids)
    if (action === 'unread') onMarkUnread(ids)
    if (action === 'archive') onArchive(ids)
    clearSelection()
  }

  const openSelectedNotificationsContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    item: NotificationRecord,
  ) => {
    if (!editing || selectedCount === 0 || !selectedIds.has(item.id)) return

    event.preventDefault()
    event.stopPropagation()
    setSelectionContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: format(tx('notifications.selectedCount'), { count: selectedCount }),
      subtitle: tx('notifications.bulkHint'),
      items: [
        {
          id: 'notification-mark-read',
          label: tx('notifications.markRead'),
          icon: <CheckCheck size={14} aria-hidden="true" />,
          disabled: selectedUnreadCount === 0,
          accessKey: 'r',
          onSelect: () => runSelectedAction('read'),
        },
        {
          id: 'notification-mark-unread',
          label: tx('notifications.markUnread'),
          icon: <MailOpen size={14} aria-hidden="true" />,
          disabled: selectedReadCount === 0,
          accessKey: 'u',
          onSelect: () => runSelectedAction('unread'),
        },
        {
          id: 'notification-archive',
          label: tx('notifications.archive'),
          icon: <Archive size={14} aria-hidden="true" />,
          accessKey: 'a',
          onSelect: () => runSelectedAction('archive'),
        },
        {
          id: 'notification-clear-selection',
          label: tx('notifications.clearSelection'),
          icon: <X size={14} aria-hidden="true" />,
          accessKey: 'x',
          onSelect: clearSelection,
        },
      ],
    })
  }

  const openDetail = (item: NotificationRecord) => {
    setActiveId(item.id)
    if (!item.readAt && filter === 'unread') setFilter('all')
    if (isCompactViewport) setMobileDetailOpen(true)
    if (!item.readAt) onMarkRead([item.id])
  }

  const handleNotificationItemClick = (
    item: NotificationRecord,
    modifiers: { shift: boolean; additive: boolean },
  ) => {
    if (editing || modifiers.shift || modifiers.additive) {
      selectNotification(item.id, {
        shift: modifiers.shift,
        additive: modifiers.additive || (editing && !modifiers.shift),
      })
      return
    }
    openDetail(item)
  }

  const jumpToNotification = (item: NotificationRecord) => {
    setActiveId(item.id)
    if (!item.readAt) onMarkRead([item.id])
    if (jumpTimerRef.current !== null) window.clearTimeout(jumpTimerRef.current)
    setJumpingId(item.id)
    setExiting(true)
    jumpTimerRef.current = window.setTimeout(() => {
      jumpTimerRef.current = null
      onOpenNotification(item)
    }, getMotionDelay(140))
  }

  const listIsInteractive = !isCompactViewport || !mobileDetailOpen
  const detailIsInteractive = !isCompactViewport || mobileDetailOpen

  return (
    <>
    <ModalPortal>
      <div className={`dialog-layer notification-center-layer ${exiting ? 'exiting' : ''}`} onClick={(event) => {
      if (event.target === event.currentTarget) requestClose()
    }}>
      <section
        ref={dialogRef}
        className={`new-dialog notification-center${mobileDetailOpen ? ' mobile-detail-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={tx('notifications.title')}
      >
        <div
          className="dialog-head notification-center-head"
          aria-hidden={isCompactViewport && mobileDetailOpen || undefined}
          inert={isCompactViewport && mobileDetailOpen || undefined}
        >
          <div>
            <span className="eyebrow">{tx('notifications.eyebrow')}</span>
            <h2>{tx('notifications.title')}</h2>
            <p>{tx('notifications.subtitle')}</p>
          </div>
          <div className="notification-center-head-actions">
            {unreadCount > 0 ? (
              <span
                className={`notification-center-count-badge${clearingAllUnread ? ' is-clearing' : ''}`}
                aria-hidden={clearingAllUnread || undefined}
              >
                {format(tx('notifications.unreadCount'), { count: unreadCount })}
              </span>
            ) : null}
            <button type="button" className="icon-action" onClick={requestClose} aria-label={tx('close')}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        {!loading && notifications.length > 0 ? (
          <div
            className="notification-center-controls"
            aria-hidden={isCompactViewport && mobileDetailOpen || undefined}
            inert={isCompactViewport && mobileDetailOpen || undefined}
          >
            <div className={`notification-center-toolbar${editing ? ' is-editing' : ''}`}>
              <div className={`notification-center-toolbar-leading${editing ? ' is-editing' : ''}`}>
                <div
                  className={`notification-center-filter is-${filter}`}
                  role="group"
                  aria-label={tx('notifications.filter')}
                >
                  <span className="notification-center-filter-indicator" aria-hidden="true" />
                  <button
                    type="button"
                    className={filter === 'all' ? 'active' : ''}
                    aria-pressed={filter === 'all'}
                    onClick={() => selectFilter('all')}
                  >
                    {tx('notifications.all')}
                  </button>
                  <button
                    type="button"
                    className={filter === 'unread' ? 'active' : ''}
                    aria-pressed={filter === 'unread'}
                    onClick={() => selectFilter('unread')}
                  >
                    {tx('notifications.unread')}
                  </button>
                  <button
                    type="button"
                    className={filter === 'archived' ? 'active' : ''}
                    aria-pressed={filter === 'archived'}
                    onClick={() => selectFilter('archived')}
                  >
                    {tx('notifications.archived')}
                  </button>
                </div>
                <div
                  className="notification-center-select-all-slot"
                  aria-hidden={!editing || undefined}
                  inert={!editing || undefined}
                >
                  <label className="notification-center-select-all notification-center-select-all-inline">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label={editing ? tx('notifications.selectAll') : undefined}
                      tabIndex={editing ? 0 : -1}
                    />
                    <span className="notification-center-check" aria-hidden="true">
                      {allSelected ? <Check size={12} /> : null}
                    </span>
                    <span>{tx('notifications.selectAll')}</span>
                  </label>
                </div>
              </div>
              <div className="notification-center-toolbar-actions">
                <InlinePresence
                  present={editing && selectedCount > 0}
                  className="notification-center-selection-presence"
                  durationMs={220}
                  parentGap="6px"
                  layout="instant"
                >
                  <span className="notification-center-selection-actions">
                    <span className="notification-center-selection-label">
                      <span className="explorer-selection-dot" aria-hidden="true" />
                      <strong>{format(tx('notifications.selectedCount'), { count: selectedCount })}</strong>
                    </span>
                    <button type="button" onClick={() => runSelectedAction('read')} disabled={selectedUnreadCount === 0}>
                      <CheckCheck size={12} aria-hidden="true" /> {tx('notifications.markRead')}
                    </button>
                    <button type="button" onClick={() => runSelectedAction('unread')} disabled={selectedReadCount === 0}>
                      <MailOpen size={12} aria-hidden="true" /> {tx('notifications.markUnread')}
                    </button>
                    <button type="button" onClick={() => runSelectedAction('archive')}>
                      <Archive size={12} aria-hidden="true" /> {tx('notifications.archive')}
                    </button>
                    <button type="button" className="icon-only" onClick={clearSelection} aria-label={tx('notifications.clearSelection')} title={tx('notifications.clearSelection')}>
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                </InlinePresence>
                <InlinePresence
                  present={!editing && filter !== 'archived' && (hasUnread || clearingAllUnread)}
                  className="notification-center-read-all-presence"
                  durationMs={180}
                  parentGap="6px"
                  layout="instant"
                >
                  <button
                    type="button"
                    className={`quiet-action notification-center-read-all${clearingAllUnread ? ' is-clearing' : ''}`}
                    onClick={runMarkAllRead}
                    disabled={clearingAllUnread}
                    aria-busy={clearingAllUnread || undefined}
                  >
                    <CheckCheck size={13} aria-hidden="true" /> {tx('notifications.markAllRead')}
                  </button>
                </InlinePresence>
                {filter !== 'archived' ? (
                  <button
                    type="button"
                    className={`quiet-action notification-center-manage${editing ? ' active' : ''}`}
                    onClick={toggleEditing}
                    aria-pressed={editing}
                  >
                    <InlinePresence present={editing} durationMs={180} parentGap="6px" layout="instant">
                      <span className="notification-center-manage-label"><Check size={13} aria-hidden="true" />{tx('notifications.done')}</span>
                    </InlinePresence>
                    <InlinePresence present={!editing} durationMs={180} parentGap="6px" layout="instant">
                      <span className="notification-center-manage-label"><Pencil size={13} aria-hidden="true" />{tx('notifications.manage')}</span>
                    </InlinePresence>
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="notification-center-loading" aria-label={tx('notifications.loading')} aria-busy="true">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="notification-center-loading-row">
                <Skeleton width={34} height={34} radius={17} />
                <div>
                  <Skeleton width={index % 2 === 0 ? '72%' : '58%'} height={12} />
                  <Skeleton width={index % 3 === 0 ? '88%' : '76%'} height={10} />
                </div>
              </div>
            ))}
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="notification-center-empty">
            <Bell size={28} aria-hidden="true" className="notification-center-empty-icon" />
            <span>{filter === 'unread' ? tx('notifications.emptyUnread') : filter === 'archived' ? tx('notifications.emptyArchived') : tx('notifications.empty')}</span>
          </div>
        ) : (
          <div className="notification-center-shell">
            <div
              className="notification-center-list-pane"
              aria-hidden={!listIsInteractive || undefined}
              inert={!listIsInteractive || undefined}
            >
              <ul
                className={`notification-center-list${clearingAllUnread ? ' is-clearing-all' : ''}${clearingAllUnread && filter === 'unread' ? ' is-clearing-exit' : ''}`}
              >
                {filteredNotifications.map((item) => {
                const Icon = NOTIFICATION_ICONS[item.type] ?? Bell
                const unread = !item.readAt
                const isClearingUnread = clearingUnreadIds.has(item.id)
                const copy = notificationDisplayText(item, tx, format)
                const active = activeItem?.id === item.id
                return (
                  <li
                    key={item.id}
                    className={isClearingUnread ? 'is-clearing-unread-row' : undefined}
                  >
                    <div
                      className={[
                        'notification-center-item',
                        unread || isClearingUnread ? 'unread' : '',
                        isClearingUnread ? 'is-clearing-unread' : '',
                        selectedIds.has(item.id) ? 'selected' : '',
                        active ? 'active' : '',
                        editing ? 'is-editing' : '',
                      ].filter(Boolean).join(' ')}
                      onMouseDown={(event) => {
                        if (event.button === 2 && editing && selectedIds.has(item.id)) event.preventDefault()
                      }}
                      onContextMenu={(event) => openSelectedNotificationsContextMenu(event, item)}
                    >
                      <div
                        className="notification-center-select-slot"
                        aria-hidden={!editing || undefined}
                        inert={!editing || undefined}
                      >
                        <label className="notification-center-select">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleSelection(item.id)}
                            aria-label={editing ? format(tx('notifications.selectItem'), { title: copy.title }) : undefined}
                            tabIndex={editing ? 0 : -1}
                          />
                          <span className="notification-center-check" aria-hidden="true">
                            {selectedIds.has(item.id) ? <Check size={12} /> : null}
                          </span>
                        </label>
                      </div>
                      <button
                        type="button"
                        className="notification-center-open"
                        onClick={(event) => handleNotificationItemClick(item, {
                          shift: event.shiftKey,
                          additive: event.ctrlKey || event.metaKey,
                        })}
                        aria-pressed={editing ? selectedIds.has(item.id) : active}
                        aria-label={editing
                          ? undefined
                          : format(tx('notifications.viewDetails'), { title: copy.title })}
                      >
                        <span className={`notification-center-icon type-${item.type}`} aria-hidden="true">
                          <Icon size={14} />
                        </span>
                        <span className="notification-center-copy">
                          <strong>{copy.title}</strong>
                          <span className="notification-center-body">{copy.body}</span>
                          <em>{relativeTime(item.createdAt.slice(0, 10), lang)}</em>
                        </span>
                        {unread || isClearingUnread ? (
                          <span
                            className={`notification-center-dot${isClearingUnread ? ' is-clearing' : ''}`}
                            aria-hidden="true"
                          />
                        ) : null}
                      </button>
                      <span
                        className="notification-center-row-actions"
                        aria-hidden={editing || undefined}
                        inert={editing || undefined}
                      >
                          <button
                            type="button"
                            className="notification-center-mini-btn"
                            onClick={() => (unread ? onMarkRead([item.id]) : onMarkUnread([item.id]))}
                            aria-label={unread ? tx('notifications.markRead') : tx('notifications.markUnread')}
                            title={unread ? tx('notifications.markRead') : tx('notifications.markUnread')}
                          >
                            {unread ? <CheckCheck size={13} aria-hidden="true" /> : <MailOpen size={13} aria-hidden="true" />}
                          </button>
                          <button
                            type="button"
                            className="notification-center-mini-btn"
                            onClick={() => onArchive([item.id])}
                            aria-label={tx('notifications.archive')}
                            title={tx('notifications.archive')}
                          >
                            <Archive size={13} aria-hidden="true" />
                          </button>
                      </span>
                    </div>
                  </li>
                )
                })}
              </ul>
            </div>
            <div
              className="notification-center-detail-pane"
              aria-hidden={!detailIsInteractive || undefined}
              inert={!detailIsInteractive || undefined}
            >
              <NotificationDetail
                key={activeItem?.id ?? 'empty'}
                item={activeItem}
                application={activeApplication}
                teamMembers={teamMembers}
                teamName={teamName}
                lang={lang}
                tx={tx}
                format={format}
                onBack={() => setMobileDetailOpen(false)}
                onJump={jumpToNotification}
                jumping={Boolean(activeItem && jumpingId === activeItem.id)}
              />
            </div>
          </div>
        )}
      </section>
      </div>
    </ModalPortal>
    <ExplorerContextMenu menu={selectionContextMenu} onClose={() => setSelectionContextMenu(null)} />
    </>
  )
}
