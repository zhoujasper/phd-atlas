import { isIP } from 'node:net'

const MAX_ANALYSIS_TEXT = 512 * 1024
const MAX_ANALYZED_LINKS = 100

const SHORTENER_HOSTS = new Set([
  'bit.ly',
  'cutt.ly',
  'goo.gl',
  'is.gd',
  'ow.ly',
  'rb.gy',
  'rebrand.ly',
  'shorturl.at',
  't.co',
  'tiny.cc',
  'tinyurl.com',
])

const SIGNAL_WEIGHTS = {
  'authentication-failed': 6,
  'reply-to-mismatch': 2,
  'deceptive-link': 6,
  'unsafe-link': 2,
  'credential-request': 3,
  'financial-request': 4,
  'prompt-injection': 6,
  'active-content': 3,
  'unsafe-attachment': 6,
}

const HIGH_CONFIDENCE_SIGNALS = new Set([
  'authentication-failed',
  'deceptive-link',
  'prompt-injection',
  'active-content',
  'unsafe-attachment',
])

function boundedText(value) {
  return String(value ?? '').slice(0, MAX_ANALYSIS_TEXT)
}

function plainHtmlText(value) {
  return boundedText(value)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/&(?:amp|#38);/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizedHostname(value) {
  try {
    const raw = String(value ?? '').trim()
    if (!/^(?:https?:)?\/\//i.test(raw)) return ''
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    return url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  } catch {
    return ''
  }
}

function domainsRelated(left, right) {
  if (!left || !right) return false
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

function visibleUrlHostname(value) {
  const match = String(value ?? '').match(/(?:https?:\/\/|www\.)[^\s<>"')]+/i)
  if (!match) return ''
  const candidate = match[0].toLowerCase().startsWith('www.')
    ? `https://${match[0]}`
    : match[0]
  return normalizedHostname(candidate)
}

function linkRisk(value) {
  try {
    const raw = String(value ?? '').trim()
    if (!/^(?:https?:)?\/\//i.test(raw)) return false
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
    return Boolean(
      url.protocol === 'http:'
      || url.username
      || url.password
      || isIP(hostname)
      || hostname.split('.').some((label) => label.startsWith('xn--'))
      || SHORTENER_HOSTS.has(hostname),
    )
  } catch {
    return false
  }
}

function analyzeLinks(html, text) {
  const signals = new Set()
  let linkCount = 0
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi
  for (const match of boundedText(html).matchAll(anchorPattern)) {
    linkCount += 1
    if (linkCount > MAX_ANALYZED_LINKS) break
    const href = match[2] ?? match[3] ?? ''
    const hrefHost = normalizedHostname(href)
    const textHost = visibleUrlHostname(plainHtmlText(match[4]))
    if (hrefHost && textHost && !domainsRelated(hrefHost, textHost)) {
      signals.add('deceptive-link')
    }
    if (linkRisk(href)) signals.add('unsafe-link')
    if (/^\s*(?:data|file|javascript|vbscript):/i.test(href)) signals.add('active-content')
  }

  const urlPattern = /https?:\/\/[^\s<>"')]+/gi
  for (const match of boundedText(text).matchAll(urlPattern)) {
    linkCount += 1
    if (linkCount > MAX_ANALYZED_LINKS) break
    if (linkRisk(match[0])) signals.add('unsafe-link')
  }
  return { signals, linkCount }
}

function headerSecurityText(headerLines) {
  const allowed = new Set([
    'authentication-results',
    'arc-authentication-results',
    'received-spf',
  ])
  return (headerLines ?? [])
    .filter((entry) => allowed.has(String(entry?.key ?? '').toLowerCase()))
    .map((entry) => String(entry?.line ?? entry?.value ?? ''))
    .join('\n')
    .slice(0, 64 * 1024)
}

function authenticationFailed(headerLines) {
  const value = headerSecurityText(headerLines)
  if (!value) return false
  const dmarcPassed = /\bdmarc\s*=\s*pass\b/i.test(value)
  const dmarcFailed = /\bdmarc\s*=\s*(?:fail|quarantine|reject|permerror)\b/i.test(value)
  const compositeFailed = /\b(?:compauth|arc)\s*=\s*fail\b/i.test(value)
  const spfFailed = /\bspf\s*=\s*(?:fail|softfail|permerror)\b/i.test(value)
    || /\breceived-spf\s*:\s*(?:fail|softfail|permerror)\b/i.test(value)
  const dkimFailed = /\bdkim\s*=\s*(?:fail|neutral|permerror)\b/i.test(value)
  return dmarcFailed || compositeFailed || (!dmarcPassed && spfFailed && dkimFailed)
}

function addressDomain(value) {
  const address = String(value ?? '').trim().toLowerCase()
  const separator = address.lastIndexOf('@')
  return separator > 0 ? address.slice(separator + 1).replace(/\.$/, '') : ''
}

function replyToMismatch(fromAddresses, replyToAddresses) {
  const fromDomains = [...new Set((fromAddresses ?? []).map(addressDomain).filter(Boolean))]
  const replyDomains = [...new Set((replyToAddresses ?? []).map(addressDomain).filter(Boolean))]
  if (fromDomains.length === 0 || replyDomains.length === 0) return false
  return !replyDomains.some((replyDomain) => (
    fromDomains.some((fromDomain) => domainsRelated(fromDomain, replyDomain))
  ))
}

function socialEngineeringSignals(subject, text, htmlText, linkCount) {
  const copy = `${boundedText(subject)}\n${boundedText(text)}\n${boundedText(htmlText)}`.toLowerCase()
  const signals = new Set()
  const credentialRequest = /\b(?:sign[\s-]?in|log[\s-]?in|password|credential|verify (?:your )?(?:account|identity)|security code|one[\s-]?time (?:code|password)|mfa|2fa)\b|登录|登入|密码|验证码|验证(?:账户|帐号|身份)/i.test(copy)
  const financialRequest = /\b(?:wire transfer|bank (?:account|details)|gift card|cryptocurrency|bitcoin|urgent payment|payment details|change (?:of )?bank|invoice (?:overdue|due))\b|汇款|转账|银行账户|礼品卡|加密货币|比特币|紧急付款|更换收款账户/i.test(copy)
  const urgency = /\b(?:urgent|immediately|within (?:the next )?(?:12|24|48) hours?|final warning|confidential|do not (?:call|contact|tell)|act now)\b|紧急|立即|马上|限时|最终警告|保密|不要联系/i.test(copy)

  if (credentialRequest && linkCount > 0) signals.add('credential-request')
  if (financialRequest && (urgency || linkCount > 0)) signals.add('financial-request')
  return signals
}

function hasPromptInjection(subject, text, htmlText) {
  const copy = `${boundedText(subject)}\n${boundedText(text)}\n${boundedText(htmlText)}`
  return /\b(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|prior|above|system|developer)\s+(?:instructions?|prompts?|messages?)\b/i.test(copy)
    || /<\|(?:system|assistant|developer)\|>/i.test(copy)
    || /(?:忽略|无视|绕过|覆盖).{0,24}(?:之前|以上|系统|开发者).{0,16}(?:指令|提示词?|消息)/u.test(copy)
}

function hasActiveHtml(value) {
  const html = boundedText(value)
  return /<(?:form|input|iframe|object|embed|script)\b/i.test(html)
    || /<meta\b[^>]*http-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)/i.test(html)
    || /\son[a-z]+\s*=/i.test(html)
    || /\b(?:href|src)\s*=\s*(?:"|')?\s*(?:data|file|javascript|vbscript):/i.test(html)
}

export function detectDeceptiveMailLinks(html) {
  return analyzeLinks(html, '').signals.has('deceptive-link')
}

export function isMailFlaggedForAi(communication) {
  const level = communication?.mailSecurity?.level
  return level === 'caution' || level === 'danger'
}

export function aiEligibleMailCommunications(communications) {
  return Array.isArray(communications)
    ? communications.filter((communication) => !isMailFlaggedForAi(communication))
    : []
}

export function analyzeInboundMailThreat({
  subject,
  text,
  html,
  headerLines,
  fromAddresses,
  replyToAddresses,
  blockedAttachmentCount = 0,
  acceptedAttachmentCount = 0,
} = {}) {
  const signals = new Set()
  const links = analyzeLinks(html, text)
  links.signals.forEach((signal) => signals.add(signal))

  if (authenticationFailed(headerLines)) signals.add('authentication-failed')
  if (replyToMismatch(fromAddresses, replyToAddresses)) signals.add('reply-to-mismatch')
  if (hasPromptInjection(subject, text, plainHtmlText(html))) signals.add('prompt-injection')
  if (hasActiveHtml(html)) signals.add('active-content')
  if (Number(blockedAttachmentCount) > 0) signals.add('unsafe-attachment')
  socialEngineeringSignals(subject, text, plainHtmlText(html), links.linkCount)
    .forEach((signal) => signals.add(signal))

  const orderedSignals = Object.keys(SIGNAL_WEIGHTS).filter((signal) => signals.has(signal))
  const score = orderedSignals.reduce((total, signal) => total + SIGNAL_WEIGHTS[signal], 0)
  const danger = orderedSignals.some((signal) => HIGH_CONFIDENCE_SIGNALS.has(signal)) || score >= 6
  const level = danger ? 'danger' : orderedSignals.length > 0 ? 'caution' : 'none'
  const quarantineAcceptedAttachments = level === 'danger' && Number(acceptedAttachmentCount) > 0

  return {
    level,
    signals: orderedSignals,
    linksDisabled: true,
    quarantineAcceptedAttachments,
    quarantinedAttachmentCount: Math.min(
      100_000,
      Math.max(0, Number(blockedAttachmentCount) || 0)
        + (quarantineAcceptedAttachments ? Math.max(0, Number(acceptedAttachmentCount) || 0) : 0),
    ),
  }
}
