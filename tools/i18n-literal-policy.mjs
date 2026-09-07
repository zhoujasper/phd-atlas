// Reviewed unchanged names, protocols, shortcuts and native-language cognates.
// Never exempt a whole namespace (including _staticText), or arbitrary short
// English labels. New unchanged words require an explicit language review here.
const technical = new Set('ABCD-EFGH-JKLM|AES-256|AES-256-GCM|Alipay|Alt|CPU|ChaCha20-Poly1305|Chat Completions|Claude Desktop|Codex|Ctrl|Ctrl / Cmd + F|DNA|Esc|GitHub|HTML|ID|IMAP|Jasper Zhou|MCP / Skill|Markdown|Microsoft SQL Server|MySQL / MariaDB|Outlook|PDF|PDF / DOCX|PID|POP3|PhD Atlas|PostgreSQL|Pro|Responses API|SHA-256|SQLite|URL|WeChat Pay|Word|ZIP|AI|h-index'.split('|'))
const cognates = {
  de: 'Admin|Administrator|Atom|Banknote|Bot|Campus|China|Coach|Code|Dollar|Dossier|Feedback|Film|Filter|Format|Hardware|Homepage|Hostname|Institution|International|Interview|Interviews|Kanban|Laptop|Layout|Link|Links|Material|Minute|Monitor|Motivation|Name|Navigation|Neutral|Offline|Online|Optional|Orange|Palette|Person|Plan|Portal|Portfolio|Prof. Amelia Chen|Professor|Region|Rose|Route|Schema|Server|Sigma|Status|Student|Student: {name}|System|Team|Terminal|Tests|Text|Timer|Token|Upgrade|Version {count}|Version {version}|Video|Website|Zoom {level}%',
  fr: '15 minutes|30 minutes|Actions|Active|Archives|Attention|Bot|Campus|Canada|Coach|Code|Communication|Configuration|Conversation|Date|Destination|Direction|Discussion|Document|Documents|Dossier|Europe|Film|Format|Globe|Guide|Hong Kong|Image|Images|Kanban|Message|Messages|Microscope|Minute|Motivation|Navigation|Notes|Notifications|Orange|Page {page}|Palette|Participants|Permissions|Plan|Port|Questions|Quotas|Restrictions|Rose|Sigma|Signature|Sources|Style|Total|Urgent|Version {count}|Version {version}|Versions|Visa|Visible|Zoom {level}%|citations|dossier|min|notes|questions|restrictions|{count} citations|{count} pages|{count} questions|Services|Substitutions',
  es: 'Actor|Asia|Australia|Base|Campus|Color|Hardware|Hong Kong|Idea|Inspector|Kanban|Manual|Material|Monitor|Neutral|No|Panel|Personal|Plan|Portal|Prof. Amelia Chen|Sigma|Terminal|Total|Visa|Visible|Zoom {level}%|min|supervisor',
  pt: 'Backup|Base|Campus|China|Feedback|Hardware|Hong Kong|Item {index}|Kanban|Link|Manual|Material|Monitor|Portal|Professor|Sigma|Status|Total|Zoom {level}%|min|professor',
  it: 'Africa|Asia|Australia|Backup|Base|Bot|Canada|Feedback|File|Hong Kong|Idea|Kanban|Oceania|Password|Quota|Quota MB|Schema|Server|Sigma|Singapore|Video|Zoom {level}%|min|password|privacy|{count} feedback',
  vi: 'Canada|Email|Kanban|Sigma|Singapore|Video|Visa|website',
}
const reviewedWords = new Map(Object.entries(cognates).map(([language, words]) => [language, new Set(words.split('|'))]))
const csvExample = 'email,role,responsible_teachers\nalex@school.edu,student,"teacher@school.edu | user_teacher_id"\njordan@school.edu,teacher,'

export function isReviewedLiteral(language, key, value) {
  if (!/[A-Za-z]/.test(value.replace(/\{[^}]+\}/g, ''))) return true
  if (technical.has(value) || reviewedWords.get(language)?.has(value)) return true
  if (/^https?:\/\/\S+$/.test(value) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return true
  if (value === 'P{value}' && key === 'kanban.priorityValue') return true
  if (value === '{size} MB' && key === 'upgrade.storageValue') return true
  if (value === csvExample && key === 'team.bulkInvitePlaceholder') return true
  return language === 'vi' && key === 'notificationPublisher.csvTemplateFilename' && value === 'notification-groups-template.csv'
}

export function containsTranslationMarker(language, key, source, value) {
  if (/__|\b(?:FIXME|I18N_PH|TRANSLATE_ME)\b|lorem ipsum|待翻译|未翻译/i.test(value)) return true
  if (/\bTODO\b/.test(value)) {
    // Spanish TODO is the translated ALL archive badge, not a developer TODO.
    return !(language === 'es' && key === 'settings.completeArchiveExt' && source === 'ALL' && value === 'TODO')
  }
  return language !== 'en' && /\bTBD\b/.test(value)
}

export function looksLikeSharedEnglish(value) {
  const clean = value.replace(/\{[^}]+\}|https?:\/\/\S+|\S+@\S+/g, '')
  return (clean.match(/[A-Za-z]{2,}/g) ?? []).length >= 3
}
