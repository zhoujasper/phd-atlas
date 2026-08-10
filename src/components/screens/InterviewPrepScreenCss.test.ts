import { describe, expect, it } from 'vitest'
import interviewStyles from '../../styles/interview.css?raw'
import mainSource from '../../main.tsx?raw'
import interviewScreenSource from './InterviewPrepScreen.tsx?raw'

describe('Interview Prep responsive and motion contract', () => {
  it('keeps Interview styles on the lazy route instead of the startup entry', () => {
    expect(mainSource).not.toContain("import './styles/interview.css'")
    expect(interviewScreenSource).toContain("import '../../styles/interview.css'")
  })

  it('keeps the desktop workspace in three columns without an extra teacher rail', () => {
    expect(interviewStyles).toMatch(/\.interview-prep-layout\s*\{[^}]*grid-template-columns:\s*minmax\(220px, 258px\)\s+minmax\(420px, 1fr\)\s+minmax\(248px, 294px\)/s)
    expect(interviewStyles).toMatch(/\.interview-student-pane\s*\{\s*display:\s*none;/s)
  })

  it('uses a single active pane for the phone drill-down and touch-safe actions', () => {
    expect(interviewStyles).toContain('@media (max-width: 820px)')
    expect(interviewStyles).toMatch(/\.interview-prep-pane\[data-mobile-active='true'\]\s*\{[^}]*display:\s*flex/s)
    expect(interviewStyles).toMatch(/\.interview-save-button\s*\{[^}]*min-height:\s*44px/s)
    expect(interviewStyles).toContain('translate3d(10px, 0, 0)')
  })

  it('removes animated transforms for reduced-motion users', () => {
    expect(interviewStyles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(interviewStyles).toMatch(/\.interview-tab-panel,[\s\S]*?transform:\s*none\s*!important;/)
  })

  it('allows long localized recovery and action labels to wrap on narrow phones', () => {
    expect(interviewStyles).toMatch(/\.interview-save-button\s*\{[^}]*max-width:\s*min\(58vw, 220px\)[^}]*white-space:\s*normal/s)
    expect(interviewStyles).toMatch(/@media \(max-width: 440px\)[\s\S]*?\.interview-recovery-banner\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/)
    expect(interviewStyles).toMatch(/\.interview-inline-actions \.interview-action\s*\{[^}]*flex:\s*1 1 140px[^}]*white-space:\s*normal/s)
  })
})
