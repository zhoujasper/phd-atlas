import { createHash } from 'node:crypto'

function esc(text) {
  return String(text ?? '').replace(/[\\;,]/g, function(c) { return '\\' + c }).replace(/\n/g, '\\n')
}

const MAX_ICAL_BYTES = 4 * 1024 * 1024
const MAX_ICAL_EVENTS = 10_000

export class IcalFeedLimitError extends Error {
  constructor(message = 'Calendar feed exceeds the safe transfer limit.') {
    super(message)
    this.name = 'IcalFeedLimitError'
    this.code = 'CALENDAR_FEED_TOO_LARGE'
    this.status = 413
  }
}

function boundedText(value, maxLength) {
  const text = String(value ?? '')
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`
}

export function generateIcalFeed(applications, userName, options = {}) {
  const maxBytes = Math.min(MAX_ICAL_BYTES, Math.max(1024, Number(options.maxBytes) || MAX_ICAL_BYTES))
  const maxEvents = Math.min(MAX_ICAL_EVENTS, Math.max(1, Number(options.maxEvents) || MAX_ICAL_EVENTS))
  const chunks = [
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//PhD Atlas//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:'
      + esc('PhD Atlas - ' + boundedText(userName, 256))
      + '\r\nX-WR-CALDESC:PhD Atlas application deadlines and tasks\r\nREFRESH-INTERVAL;VALUE=DURATION:PT4H\r\n',
  ]
  let bytes = Buffer.byteLength(chunks[0], 'utf8')
  let eventCount = 0
  const appendEvent = (event) => {
    eventCount += 1
    if (eventCount > maxEvents) throw new IcalFeedLimitError('Calendar feed has too many events.')
    const chunk = `${event}\r\n`
    bytes += Buffer.byteLength(chunk, 'utf8')
    if (bytes + 15 > maxBytes) throw new IcalFeedLimitError()
    chunks.push(chunk)
  }

  for (var i = 0; i < applications.length; i++) {
    var app = applications[i]
    if (app.deadline) {
      appendEvent('BEGIN:VEVENT\r\nUID:deadline-' + createHash('sha1').update(app.id).digest('hex').slice(0, 28) + '\r\nDTSTART;VALUE=DATE:' + app.deadline.replace(/-/g, '') + '\r\nSUMMARY:' + esc('[DL] ' + boundedText(app.school.name, 512)) + '\r\nDESCRIPTION:' + esc('Program: ' + boundedText(app.program, 1024) + '\\nProfessor: ' + boundedText(app.professor?.english || '', 512) + '\\nStatus: ' + boundedText(app.status, 128)) + '\r\nCATEGORIES:PhD Atlas\r\nEND:VEVENT')
    }
    var tasks = app.tasks || []
    for (var j = 0; j < tasks.length; j++) {
      var t = tasks[j]
      if (!t.done && t.due) {
        appendEvent('BEGIN:VEVENT\r\nUID:task-' + createHash('sha1').update(t.id).digest('hex').slice(0, 28) + '\r\nDTSTART;VALUE=DATE:' + t.due.replace(/-/g, '') + '\r\nSUMMARY:' + esc('[Task] ' + boundedText(t.title, 512)) + '\r\nDESCRIPTION:' + esc('Application: ' + boundedText(app.school.name, 512) + '\\nProgram: ' + boundedText(app.program, 1024)) + '\r\nCATEGORIES:PhD Atlas\r\nEND:VEVENT')
      }
    }
  }
  chunks.push('END:VCALENDAR')
  return chunks.join('')
}
