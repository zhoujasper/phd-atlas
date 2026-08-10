import { describe, expect, it } from 'vitest'
import appSource from '../../App.tsx?raw'
import workspaceStyles from '../../index.css?raw'
import applicationPaneSource from './ApplicationPane.tsx?raw'
import inspectorSource from './Inspector.tsx?raw'

const normalizedWorkspaceStyles = workspaceStyles.replace(/\r\n/g, '\n')

describe('application selection motion CSS', () => {
  it('lets one measured surface own the complete project-switch slide', () => {
    expect(normalizedWorkspaceStyles).toMatch(
      /\.application-selection-slider\s*\{[^}]*box-shadow:\s*var\(--shadow-xs\);[^}]*transform:\s*translate3d\(0,\s*var\(--application-selection-y,\s*0\),\s*0\)\s*scaleY\(var\(--application-selection-scale-y,\s*1\)\);[^}]*transition:[^}]*transform 240ms var\(--ease-fluid\)/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.rail-active-indicator\s*\{[^}]*box-shadow:\s*var\(--shadow-xs\);[^}]*transition:[^}]*transform 280ms var\(--ease-spring\)/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.application-selection-slider::before\s*\{[^}]*content:\s*none;/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.application-list\.has-selection-slider \.application-line\.selected\s*\{[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*none;[^}]*transform:\s*none;/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.application-selection-slider\.is-moving ~ \.application-line:hover,\s*\.application-selection-slider\.is-moving ~ \.application-line:active\s*\{[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*none;[^}]*transform:\s*none;[^}]*border-color 0ms linear[^}]*transform 0ms linear/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.application-selection-slider\.is-moving ~ \.application-line:hover::before,\s*\.application-selection-slider\.is-moving ~ \.application-line:active::before\s*\{[^}]*opacity:\s*0;[^}]*transition:\s*none;/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.application-selection-slider\.is-moving ~ \.application-line:hover > \.line-main,\s*\.application-selection-slider\.is-moving ~ \.application-line:active > \.line-main\s*\{[^}]*transform:\s*none;[^}]*transition:\s*none;/s,
    )
  })

  it('uses longer semantic status rails without a pointer-selection glow', () => {
    expect(applicationPaneSource).toContain(
      'className={`line-status status-${statusCssSlug(application.status)}`}',
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.line-status\s*\{[^}]*height:\s*36px;[^}]*background:\s*var\(--status-chart-custom\);/s,
    )

    const statusTokens = {
      draft: 'status-draft',
      preparing: 'status-preparing',
      submitted: 'status-submitted-app',
      interview: 'status-interview',
      waitlist: 'status-waitlist',
      accepted: 'status-accepted',
      rejected: 'status-rejected',
    }

    for (const [status, token] of Object.entries(statusTokens)) {
      expect(normalizedWorkspaceStyles).toMatch(
        new RegExp(`\\.line-status\\.status-${status}\\s*\\{[^}]*background:\\s*var\\(--${token}\\)`),
      )
    }

    expect(normalizedWorkspaceStyles).toMatch(
      /\.application-line\.selected \.line-status\s*\{[^}]*box-shadow:\s*none;/s,
    )
    expect(normalizedWorkspaceStyles).not.toContain('0 0 0 3px rgba(0, 113, 227, 0.2)')
  })

  it('keeps compositor scoping and the immediate reduced-motion path', () => {
    expect(normalizedWorkspaceStyles).toMatch(
      /\.application-selection-slider\.is-moving\s*\{[^}]*will-change:\s*transform;/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.application-selection-slider\s*\{[^}]*contain:\s*layout paint style;[^}]*backface-visibility:\s*hidden;/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.application-selection-slider,[\s\S]*?transition-duration:\s*0\.01ms !important;/s,
    )
  })

  it('keeps pointer feedback ahead of the keyed dossier render', () => {
    expect(applicationPaneSource).toContain('applicationRowGeometryRef')
    expect(applicationPaneSource).toMatch(
      /const cachedGeometry = targetId[\s\S]*applicationRowGeometryRef\.current\.get\(targetId\)/s,
    )
    expect(applicationPaneSource).toMatch(
      /new ResizeObserver\(\(\) => \{\s*measureApplicationRows\(\)\s*syncSelectionSlider\(\)/s,
    )
    expect(applicationPaneSource).toContain(
      'const APPLICATION_SELECTION_MOTION_FALLBACK_MS = 320',
    )
    expect(applicationPaneSource).toContain(
      "slider.style.setProperty('--application-selection-scale-y', String(nextScaleY))",
    )
    expect(applicationPaneSource).toMatch(
      /window\.setTimeout\(\s*scheduleSelectionSliderMotionFinish,\s*APPLICATION_SELECTION_MOTION_FALLBACK_MS,\s*\)/s,
    )
    expect(applicationPaneSource).toMatch(
      /scheduleSelectionSliderMotionFinish[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame\(\(\) => \{/s,
    )
    expect(appSource).not.toContain('scheduleApplicationSelectionAfterPaint')
    expect(appSource).not.toContain('applicationSelectionFrameRef')
    expect(appSource).toMatch(
      /The application row has already primed its selection surface[\s\S]*beginSelection\(\)/s,
    )
  })

  it('bounds the urgent record commit and keeps the explorer collection stable', () => {
    expect(appSource).toMatch(
      /deferDossierContent:\s*true/s,
    )
    expect(appSource).toContain('forceCssFallback: true')
    expect(appSource).toContain('if (!normalizedApplicationQuery) return true')
    expect(appSource).toContain('return filteredApplications')
    expect(appSource).toContain('visibleApplicationIndexById')
    expect(appSource).toContain('const inspectorApplication = currentInspectorApplication')
    expect(appSource).toContain('application={inspectorApplication}')
    expect(inspectorSource).toContain('key={application.id}')
    expect(inspectorSource).toContain('inspector-record-handoff')
    expect(normalizedWorkspaceStyles).toMatch(
      /\.inspector-default-content\.inspector-record-handoff\s*\{[^}]*animation:\s*inspector-record-handoff 230ms var\(--ease-out\) both;[^}]*will-change:\s*opacity;/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /@keyframes inspector-record-handoff[\s\S]*?from\s*\{\s*opacity:\s*0\.86;\s*\}[\s\S]*?to\s*\{\s*opacity:\s*1;\s*\}/s,
    )
    expect(appSource).toContain("if (scope === 'dossier-record') return 72")
  })
})
