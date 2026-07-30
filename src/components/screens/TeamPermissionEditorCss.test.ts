import { describe, expect, it } from 'vitest'
import teamSource from './TeamScreen.tsx?raw'
import editorSource from './TeamPermissionEditor.tsx?raw'
import teamStyles from '../../styles/team.css?raw'

const normalizedTeamStyles = teamStyles.replace(/\r\n/g, '\n')

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = normalizedTeamStyles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('Team permission editor CSS', () => {
  it('owns a dedicated item namespace instead of inheriting the removed matrix layout', () => {
    expect(editorSource).toContain('className="team-permission-item"')
    expect(editorSource).not.toContain('className="team-permission-row"')
    expect(normalizedTeamStyles).not.toContain('.team-permission-matrix')
    expect(normalizedTeamStyles).not.toMatch(/(?:^|\n)\.team-permission-row(?=[\s,{.:>])/)
  })

  it('lets switches own student and teacher permissions without a second entitlement layer', () => {
    const permissionSources = `${teamSource}\n${editorSource}`
    expect(permissionSources).not.toContain('team-permission-entitlement')
    expect(permissionSources).not.toContain("tx('team.permissionPlanTitle')")
    expect(permissionSources).not.toContain("tx('team.delegatedAccessPro')")
    expect(permissionSources).not.toContain("tx('team.teacherStudentProLimit')")
    expect(normalizedTeamStyles).not.toMatch(
      /(?:^|\n)\.(?:team-permission-entitlement|team-access-segment|team-student-pro-limit|team-delegated-access)(?=[\s,{.:>])/,
    )
  })

  it('flows through the expanded member row without a nested card boundary', () => {
    const editor = cssRule('.team-permission-editor')
    const teacherDetail = cssRule('.team-teacher-permission-detail-inner')
    const studentEditor = cssRule('.team-collaboration-detail-inner > .team-permission-editor')
    const teacherList = cssRule('.team-permission-role-sheet.role-teacher .team-permission-list')
    const item = cssRule('.team-permission-item')

    expect(editor).not.toContain('overflow:')
    expect(editor).not.toContain('border:')
    expect(editor).not.toContain('border-radius:')
    expect(editor).not.toContain('background:')
    expect(editor).toContain('container: team-permission-editor / inline-size')
    expect(teacherDetail).toContain('border-top: 1px solid var(--border)')
    expect(teacherDetail).toContain('padding: 12px 0 0')
    expect(studentEditor).toContain('margin-top: 12px')
    expect(teacherList).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(item).toContain('min-height: 42px')
    expect(item).toContain('grid-template-columns: 16px minmax(0, 1fr) 36px')
    expect(item).toContain('padding: 5px 8px 5px 10px')
    expect(item).not.toContain('border-radius:')
    expect(item).not.toContain('box-shadow:')
  })

  it('uses a balanced two-column student grid only when the editor itself is wide', () => {
    expect(normalizedTeamStyles).toMatch(
      /@container team-permission-editor \(min-width:\s*760px\)\s*\{[\s\S]*?\.team-permission-editor \.team-permission-role-sheet\.role-student \.team-permission-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /@container team-permission-editor \(min-width:\s*760px\)\s*\{[\s\S]*?\.team-permission-editor \.team-permission-role-sheet\.role-student \.team-permission-list > :nth-child\(even\)\s*\{[^}]*border-left:\s*1px solid var\(--border\);[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /@container team-permission-editor \(min-width:\s*760px\)\s*\{[\s\S]*?\.team-permission-editor \.team-permission-role-sheet\.role-student \.team-permission-list > \.team-permission-item:nth-last-child\(2\)\s*\{[^}]*border-bottom:\s*0;[^}]*\}/s,
    )
  })

  it('centers the unlimited disclosure in the permission row', () => {
    const limitTrigger = cssRule('.team-permission-limit-trigger')

    expect(limitTrigger).toContain('height: 28px')
    expect(limitTrigger).toContain('display: inline-flex')
    expect(limitTrigger).toContain('align-self: center')
    expect(limitTrigger).toContain('align-items: center')
    expect(limitTrigger).toContain('line-height: 1')
  })

  it('keeps frequent member actions compact on desktop and touch-sized on mobile', () => {
    const primaryAction = cssRule('.team-collaboration-primary-actions .quiet-action')

    expect(primaryAction).toContain('height: var(--action-height-compact)')
    expect(primaryAction).toContain('min-height: var(--action-height-compact)')
    expect(primaryAction).toContain('padding-inline: 8px')
    expect(primaryAction).toContain('font-size: 11px')
    expect(normalizedTeamStyles).toMatch(
      /@media \(max-width:\s*820px\)\s*\{[\s\S]*?\.team-collaboration-primary-actions \.quiet-action\s*\{[^}]*height:\s*32px;[^}]*min-height:\s*32px;[^}]*font-size:\s*12px;[^}]*\}/s,
    )
  })

  it('keeps a small visual switch inside a larger keyboard and touch target', () => {
    const switchButton = cssRule('.team-permission-switch')
    const switchTrack = cssRule('.team-permission-switch::before')
    const switchThumb = cssRule('.team-permission-switch > span')
    const switchEnabledThumb = cssRule('.team-permission-switch.enabled > span')
    const switchFocus = cssRule('.team-permission-switch:focus-visible')

    expect(switchButton).toContain('width: 36px')
    expect(switchButton).toContain('height: 28px')
    expect(switchTrack).toContain('inset: 5px 2px')
    expect(switchThumb).toContain('width: 14px')
    expect(switchThumb).toContain('height: 14px')
    expect(switchThumb).toContain('will-change: transform')
    expect(switchEnabledThumb).toContain('transform: translate3d(14px, 0, 0)')
    expect(switchFocus).toContain('box-shadow: 0 0 0 3px var(--accent-ring)')
  })

  it('updates the visual draft immediately and queues persistence without disabling the switch', () => {
    expect(editorSource).toContain('setDraft((current) => ({ ...current, ...patch }))')
    expect(editorSource).toContain('queueRef.current.push(operation)')
    expect(editorSource).toContain('disabled={disabled}')
    expect(editorSource).not.toContain('disabled={saving}')
    expect(normalizedTeamStyles).not.toMatch(/\.team-permission-editor\.is-saving\s*\{[^}]*opacity:/)
  })

  it('uses mounted shared disclosures for role details and inline usage limits', () => {
    const sheetGrid = cssRule('.team-permission-sheet-grid')
    const roleToggle = cssRule('.team-permission-role-toggle')
    const roleOpen = cssRule('.team-permission-role-toggle[aria-expanded="true"] .team-permission-role-chevron')

    expect(sheetGrid).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(roleToggle).toContain('grid-template-columns: 28px minmax(0, 1fr) 14px')
    expect(roleToggle).toContain('min-height: 48px')
    expect(roleOpen).toContain('transform: rotate(90deg)')
    expect(editorSource).toContain('<CollapsiblePanel')
    expect(editorSource).toContain('className="team-permission-role-collapse"')
    expect(editorSource).toContain('className="team-permission-limit-collapse"')
    expect(editorSource).toContain('openMs={360}')
    expect(editorSource).toContain('closeMs={280}')
    expect(editorSource).not.toContain('<AnchoredPopover')
    expect(normalizedTeamStyles).not.toContain('.team-permission-limit-popover')
  })

  it('accepts the -1 sentinel, displays infinity, and keeps the teacher grid responsive', () => {
    expect(editorSource).toContain("raw === '-1' || raw === '∞'")
    expect(editorSource).toContain("next === null ? '∞' : String(next)")
    expect(editorSource).toContain('inputMode="numeric"')
    expect(editorSource).toContain("tx('team.permissionLimitsHelp')")
    expect(editorSource).not.toContain('className={value === null ?')

    expect(cssRule('.team-permission-role-sheet.role-teacher .team-permission-list'))
      .toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(normalizedTeamStyles).toMatch(
      /@media \(max-width:\s*820px\)\s*\{[\s\S]*?\.team-permission-role-sheet\.role-teacher \.team-permission-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*\}/s,
    )
  })
})
