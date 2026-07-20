import { createHash } from 'node:crypto'

function esc(text) {
  return String(text ?? '').replace(/[\\;,]/g, function(c) { return '\\' + c }).replace(/\n/g, '\\n')
}

export function generateIcalFeed(applications, userName) {
  var events = []
  for (var i = 0; i < applications.length; i++) {
    var app = applications[i]
    if (app.deadline) {
      events.push('BEGIN:VEVENT\r\nUID:deadline-' + createHash('sha1').update(app.id).digest('hex').slice(0, 28) + '\r\nDTSTART;VALUE=DATE:' + app.deadline.replace(/-/g, '') + '\r\nSUMMARY:' + esc('[DL] ' + app.school.name) + '\r\nDESCRIPTION:' + esc('Program: ' + app.program + '\\nProfessor: ' + (app.professor?.english || '') + '\\nStatus: ' + app.status) + '\r\nCATEGORIES:PhD Atlas\r\nEND:VEVENT')
    }
    var tasks = app.tasks || []
    for (var j = 0; j < tasks.length; j++) {
      var t = tasks[j]
      if (!t.done && t.due) {
        events.push('BEGIN:VEVENT\r\nUID:task-' + createHash('sha1').update(t.id).digest('hex').slice(0, 28) + '\r\nDTSTART;VALUE=DATE:' + t.due.replace(/-/g, '') + '\r\nSUMMARY:' + esc('[Task] ' + t.title) + '\r\nDESCRIPTION:' + esc('Application: ' + app.school.name + '\\nProgram: ' + app.program) + '\r\nCATEGORIES:PhD Atlas\r\nEND:VEVENT')
      }
    }
  }
  return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//PhD Atlas//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:' + esc('PhD Atlas - ' + userName) + '\r\nX-WR-CALDESC:PhD Atlas application deadlines and tasks\r\nREFRESH-INTERVAL;VALUE=DURATION:PT4H\r\n' + events.join('\r\n') + '\r\nEND:VCALENDAR'
}
