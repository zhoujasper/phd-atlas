import { today } from '../../appModel'
import type { ApplicationRecord } from '../../data/applications'
import { t as translate, type Language } from '../../i18n'
import { safeExternalHttpUrl, safeMailtoHref, safeTelHref } from '../../safeLinks'

export type DossierResourceCard = NonNullable<ApplicationRecord['dossierCards']>[number]
export type DossierResourceField = DossierResourceCard['fields'][number]
export type DossierResourceFieldType = DossierResourceField['type']
export type DossierResourceCardSettingsDraft = Pick<DossierResourceCard, 'title' | 'icon' | 'color' | 'width' | 'fields'>
export type DossierResourceCardWidth = NonNullable<DossierResourceCard['width']>
export type DossierResourceFieldWidth = NonNullable<DossierResourceField['width']>
export type DossierResourceDefaultValues = Pick<ApplicationRecord, 'program' | 'deadline' | 'tags'> & {
  school: Pick<ApplicationRecord['school'], 'website'>
  professor: Pick<ApplicationRecord['professor'], 'email' | 'homepage' | 'social' | 'phone'>
}

export const dossierResourceFieldTypes: DossierResourceFieldType[] = [
  'url',
  'text',
  'textarea',
  'email',
  'phone',
  'contact',
  'tags',
  'date',
]

export const dossierResourceColors = [
  { value: 'accent', labelKey: 'dossier.resourceColors.accent' },
  { value: 'blue', labelKey: 'dossier.resourceColors.blue' },
  { value: 'green', labelKey: 'dossier.resourceColors.green' },
  { value: 'orange', labelKey: 'dossier.resourceColors.orange' },
  { value: 'red', labelKey: 'dossier.resourceColors.red' },
  { value: 'violet', labelKey: 'dossier.resourceColors.violet' },
  { value: 'slate', labelKey: 'dossier.resourceColors.slate' },
] as const

export type DossierResourceColor = typeof dossierResourceColors[number]['value']
export const dossierResourceCardWidths: DossierResourceCardWidth[] = ['half', 'full']
export const dossierResourceFieldWidths: DossierResourceFieldWidth[] = ['half', 'full']

export type DossierResourceIconPreset = {
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

export const dossierResourceIconPresets = [
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

const dossierResourceIconIds = new Set(dossierResourceIconPresets.map((preset) => preset.id))

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

function createDossierResourceId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function isDossierResourceFieldType(value: unknown): value is DossierResourceFieldType {
  return typeof value === 'string' && dossierResourceFieldTypes.includes(value as DossierResourceFieldType)
}

export function normalizeDossierResourceColor(value: unknown): DossierResourceColor {
  return dossierResourceColors.some((color) => color.value === value) ? value as DossierResourceColor : 'accent'
}

export function normalizeDossierResourceCardWidth(value: unknown): DossierResourceCardWidth {
  return value === 'full' ? 'full' : 'half'
}

export function preferredDossierResourceFieldWidth(type: DossierResourceFieldType): DossierResourceFieldWidth {
  return type === 'textarea' || type === 'tags' ? 'full' : 'half'
}

export function normalizeDossierResourceFieldWidth(
  value: unknown,
  type: DossierResourceFieldType,
): DossierResourceFieldWidth {
  if (type === 'textarea') return 'full'
  return value === 'half' || value === 'full' ? value : preferredDossierResourceFieldWidth(type)
}

export function normalizeDossierResourceIcon(value: unknown) {
  return typeof value === 'string' && dossierResourceIconIds.has(value) ? value : 'link'
}

function isDossierResourceBuiltinValue(value: string, key: string) {
  const trimmed = value.trim()
  if (!trimmed) return true
  return dossierResourceBuiltinLanguages.some((language) => translate(language, key) === trimmed)
}

export function localizeDossierResourceCardTitle(
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

export function localizeDossierResourceFieldLabel(
  field: DossierResourceField,
  tx: (key: string, fallback?: string) => string,
) {
  const labelKey = defaultDossierResourceFieldLabelKeys[field.id] ?? `dossier.resourceFieldTypes.${field.type}`
  if (isDossierResourceBuiltinValue(field.label, labelKey)) return tx(labelKey)
  return field.label
}

export function createDefaultDossierResourceCards(
  draft: DossierResourceDefaultValues,
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

export function normalizeDossierResourceCards(
  cards: ApplicationRecord['dossierCards'],
  draft: DossierResourceDefaultValues,
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

export function createDossierResourceField(
  type: DossierResourceFieldType,
  tx: (key: string, fallback?: string) => string,
  width: DossierResourceFieldWidth = preferredDossierResourceFieldWidth(type),
): DossierResourceField {
  return {
    id: createDossierResourceId('resource-field'),
    type,
    label: tx(`dossier.resourceFieldTypes.${type}`),
    value: type === 'date' ? today : '',
    width,
  }
}

export function createDossierResourceCard(
  tx: (key: string, fallback?: string) => string,
  width: DossierResourceCardWidth = 'half',
): DossierResourceCard {
  const stamp = new Date().toISOString()
  return {
    id: createDossierResourceId('resource-card'),
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

export function normalizedExternalHref(value: string) {
  return safeExternalHttpUrl(value)
}

export function mailtoHref(value: string) {
  return safeMailtoHref(value)
}

export function phoneHref(value: string) {
  return safeTelHref(value)
}

export function resourceTags(value: string) {
  return value
    .split(/[,，\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export function resourceFieldSummary(field: DossierResourceField) {
  if (field.type === 'tags') return resourceTags(field.value).slice(0, 3).join(' · ')
  if (field.type === 'textarea') return field.value.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
  return field.value.trim()
}
