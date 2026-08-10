import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ApplicationRecord } from '../../data/applications'
import { applications as seedApplications } from '../../data/applications'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { Dashboard } from './Dashboard'
import { KanbanBoard } from './KanbanBoard'

/**
 * The lazy-loading audit judged most screens "pass" by reading them. That
 * catches a list that maps everything, but not a memo that quietly went
 * quadratic, and it cannot tell anyone later that a change made things worse.
 *
 * These budgets are deliberately loose. jsdom timing is noisy and nothing here
 * predicts a real frame rate. What they do catch is the failure that actually
 * makes a workspace feel stuck: work that scales with the whole dataset
 * instead of with what is on screen. A screen that renders 40 cards out of 400
 * stays fast when the account grows; one that renders 400 does not, and the
 * node-count assertions are the ones worth trusting.
 */

const messages: Record<string, string> = {
  'dashboard.scrollApplicationsRight': 'Scroll application cards right',
  'dashboard.scrollApplicationsLeft': 'Scroll application cards left',
  'dashboard.openApplicationCard': 'Open {name}',
  'kanban.showMore': 'Show {count} more',
}

const i18nCalls = { tx: 0, format: 0 }
const i18n: I18nContextValue = {
  lang: 'en',
  t: {},
  tx: (path, fallback) => { i18nCalls.tx += 1; return messages[path] ?? fallback ?? path },
  format: (template, values) => (i18nCalls.format += 1, Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  )),
}

function manyApplications(count: number): ApplicationRecord[] {
  const seed = seedApplications[0]
  const statuses: ApplicationRecord['status'][] = ['Draft', 'Submitted', 'Interview', 'Offer']
  return Array.from({ length: count }, (_, index) => ({
    ...structuredClone(seed),
    id: `budget-app-${index + 1}`,
    status: statuses[index % statuses.length],
    school: { ...structuredClone(seed.school), name: `University ${index + 1}` },
  }))
}

function renderWithI18n(node: React.ReactElement) {
  return render(<I18nContext.Provider value={i18n}>{node}</I18nContext.Provider>)
}

/** Median of repeated renders; a single sample in jsdom is mostly noise. */
function medianRenderMs(run: () => { unmount: () => void }, samples = 5) {
  const timings: number[] = []
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now()
    const view = run()
    timings.push(performance.now() - started)
    view.unmount()
  }
  return timings.sort((left, right) => left - right)[Math.floor(samples / 2)]
}

const LARGE = 400
const RENDER_BUDGET_MS = 600
const HANDOFF_SHELL_BUDGET_MS = 250

describe('workspace render budgets', () => {
  it('keeps the dashboard bounded by the viewport rather than the dataset', () => {
    i18nCalls.tx = 0; i18nCalls.format = 0
    const items = manyApplications(LARGE)
    let cardCount = 0
    const elapsed = medianRenderMs(() => {
      const view = renderWithI18n(<Dashboard applications={items} onSelect={() => {}} />)
      cardCount = view.container.querySelectorAll('.stat-application-card').length
      return view
    })

    console.log(`dashboard ${LARGE} apps: ${cardCount} cards, ${elapsed.toFixed(1)}ms, i18n tx=${i18nCalls.tx} format=${i18nCalls.format}`)
    expect(cardCount).toBeGreaterThan(0)
    // The specific batch size is the component's business; what matters is
    // that four hundred records do not all become DOM nodes at once.
    expect(cardCount).toBeLessThan(LARGE / 4)
    expect(elapsed).toBeLessThan(RENDER_BUDGET_MS)
  })

  it('keeps kanban columns bounded per column', () => {
    i18nCalls.tx = 0; i18nCalls.format = 0
    const items = manyApplications(LARGE)
    let cardCount = 0
    const elapsed = medianRenderMs(() => {
      const view = renderWithI18n(
        <KanbanBoard
          applications={items}
          onSelect={() => {}}
          onStatusChange={() => {}}
        />,
      )
      cardCount = view.container.querySelectorAll('.kanban-card').length
      return view
    })

    expect(cardCount).toBeGreaterThan(0)
    expect(cardCount).toBeLessThan(LARGE / 2)
    expect(elapsed).toBeLessThan(RENDER_BUDGET_MS)
    console.log(`kanban ${LARGE} apps: ${cardCount} cards, ${elapsed.toFixed(1)}ms, i18n tx=${i18nCalls.tx} format=${i18nCalls.format}`)
  })

  it('keeps the first workspace-to-board commit to a lightweight scaffold', () => {
    i18nCalls.tx = 0; i18nCalls.format = 0
    const items = manyApplications(LARGE)
    let cardCount = 0
    let previewCount = 0
    const elapsed = medianRenderMs(() => {
      const view = renderWithI18n(
        <KanbanBoard
          applications={items}
          onSelect={() => {}}
          onStatusChange={() => {}}
          deferInactiveView
        />,
      )
      cardCount = view.container.querySelectorAll('.kanban-card').length
      previewCount = view.container.querySelectorAll('.kanban-column-preview').length
      return view
    })

    expect(cardCount).toBe(0)
    expect(previewCount).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(HANDOFF_SHELL_BUDGET_MS)
    console.log(`kanban handoff shell ${LARGE} apps: ${previewCount} previews, ${elapsed.toFixed(1)}ms`)
  })

  it('scales sublinearly with the dataset', () => {
    // The assertion that matters. If render cost tracked the dataset, ten
    // times the records would cost roughly ten times as much; a screen bounded
    // by its viewport should stay close to flat. The multiplier is generous
    // because fixture construction and jsdom both add noise.
    const small = manyApplications(40)
    const large = manyApplications(400)

    const smallMs = medianRenderMs(() =>
      renderWithI18n(<Dashboard applications={small} onSelect={() => {}} />))
    const largeMs = medianRenderMs(() =>
      renderWithI18n(<Dashboard applications={large} onSelect={() => {}} />))

    // Threshold is loose on purpose: true linearity would land near 10x, and
    // measured values sit around 4.5x with jsdom noise pushing past 5.
    const growth = largeMs / Math.max(smallMs, 1)
    console.log(`dashboard 40 apps ${smallMs.toFixed(1)}ms -> 400 apps ${largeMs.toFixed(1)}ms (${growth.toFixed(2)}x)`)
    expect(growth, `10x the records cost ${growth.toFixed(1)}x the render`).toBeLessThan(8)
  })
})
