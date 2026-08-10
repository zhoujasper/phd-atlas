import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Contract test for the scholarship timeline UI refinement.
 * Verifies that the "Add Event" button, timeline cards, and input fields
 * follow the Apple-like refined design without nested box appearance.
 */

const indexCssPath = join(__dirname, '../../index.css')
const indexCss = readFileSync(indexCssPath, 'utf-8')

describe('Scholarship Timeline UI CSS Contract', () => {
  test('Add Event button is refined and compact', () => {
    const addButtonBlock = indexCss.match(/\.scholarship-subsection-add\s*\{[^}]+\}/s)?.[0]
    expect(addButtonBlock, 'Add button block should exist').toBeDefined()

    // Height should be 24px, not 28px
    expect(addButtonBlock).toMatch(/min-height:\s*24px/)
    expect(addButtonBlock).toMatch(/height:\s*24px/)

    // Padding should be compact: 0 8px
    expect(addButtonBlock).toMatch(/padding:\s*0\s+8px/)

    // Should use accent color, not surface-secondary
    expect(addButtonBlock).toMatch(/background:\s*var\(--accent\)/)
    expect(addButtonBlock).toMatch(/color:\s*white/)

    // Font should be refined
    expect(addButtonBlock).toMatch(/font-size:\s*11px/)
    expect(addButtonBlock).toMatch(/font-weight:\s*600/)

    // Border radius should be small (5px), not pill
    expect(addButtonBlock).toMatch(/border-radius:\s*5px/)
  })

  test('Add Event button has refined hover effect', () => {
    const hoverBlock = indexCss.match(
      /\.scholarship-subsection-(?:head button:hover|add:hover)[^}]*\{[^}]+\}/gs
    )
    expect(hoverBlock, 'Hover block should exist').toBeDefined()
    const hoverText = hoverBlock?.join('\n') || ''

    // Should have opacity and scale transform, not color changes
    expect(hoverText).toMatch(/opacity:\s*0\.88/)
    expect(hoverText).toMatch(/transform:\s*scale\(0\.98\)/)
  })

  test('Mini list has proper spacing without nested container', () => {
    const miniListBlock = indexCss.match(/\.scholarship-mini-list\s*\{[^}]+\}/s)?.[0]
    expect(miniListBlock, 'Mini list block should exist').toBeDefined()

    // Should have gap between items
    expect(miniListBlock).toMatch(/gap:\s*8px/)

    // Should NOT have background color (removing nested appearance)
    expect(miniListBlock).not.toMatch(/background:\s*var\(--surface-secondary\)/)

    // Should NOT have border-radius on container
    expect(miniListBlock).not.toMatch(/border-radius:\s*var\(--radius\)/)

    // Should NOT have overflow hidden
    expect(miniListBlock).not.toMatch(/overflow:\s*hidden/)
  })

  test('Timeline rows are independent cards with borders', () => {
    const rowBlock = indexCss.match(/\.scholarship-mini-row\s*\{[^}]+\}/s)?.[0]
    expect(rowBlock, 'Mini row block should exist').toBeDefined()

    // Should have full border, not just border-top
    expect(rowBlock).toMatch(/border:\s*1px\s+solid\s+var\(--border\)/)

    // Should have border-radius
    expect(rowBlock).toMatch(/border-radius:\s*var\(--radius\)/)

    // Should have background
    expect(rowBlock).toMatch(/background:\s*var\(--surface\)/)

    // Padding should be uniform
    expect(rowBlock).toMatch(/padding:\s*10px\s+12px/)
  })

  test('Timeline rows have margin between them, not borders', () => {
    const presenceSpacing = indexCss.match(
      /\.scholarship-timeline-row-presence\s*\+\s*\.scholarship-timeline-row-presence[^}]*\{[^}]+\}/s
    )?.[0]
    expect(presenceSpacing, 'Row presence spacing should exist').toBeDefined()

    // Should use margin-top for spacing
    expect(presenceSpacing).toMatch(/margin-top:\s*8px/)

    // Should NOT use border-top
    expect(presenceSpacing).not.toMatch(/border-top/)
  })

  test('Timeline text controls are refined and compact', () => {
    const textControlBlock = indexCss.match(/\.scholarship-timeline-text-control\s*\{[^}]+\}/s)?.[0]
    expect(textControlBlock, 'Text control block should exist').toBeDefined()

    // Height should be 32px, not 36px
    expect(textControlBlock).toMatch(/min-height:\s*32px/)

    // Padding should be refined
    expect(textControlBlock).toMatch(/padding-inline:\s*7px/)

    // Border radius should be 5px
    expect(textControlBlock).toMatch(/border-radius:\s*5px/)

    // Background should be surface-secondary, not surface
    expect(textControlBlock).toMatch(/background:\s*var\(--surface-secondary\)/)
  })

  test('Timeline input fields have correct dimensions', () => {
    const inputBlock = indexCss.match(/\.scholarship-timeline-text-control\s+input\s*\{[^}]+\}/s)?.[0]
    expect(inputBlock, 'Input block should exist').toBeDefined()

    // Height should be 30px, not 34px
    expect(inputBlock).toMatch(/min-height:\s*30px/)
    expect(inputBlock).toMatch(/height:\s*30px/)

    // Font size should be refined
    expect(inputBlock).toMatch(/font-size:\s*12\.5px/)
  })

  test('Date picker matches input field styling', () => {
    const datePickerBlock = indexCss.match(
      /\.scholarship-timeline-field\s+\.date-picker-display\s*\{[^}]+\}/s
    )?.[0]
    expect(datePickerBlock, 'Date picker block should exist').toBeDefined()

    // Height should match text inputs: 32px
    expect(datePickerBlock).toMatch(/min-height:\s*32px/)
    expect(datePickerBlock).toMatch(/height:\s*32px/)

    // Font size should match
    expect(datePickerBlock).toMatch(/font-size:\s*12\.5px/)

    // Should have surface-secondary background
    expect(datePickerBlock).toMatch(/background:\s*var\(--surface-secondary\)/)

    // Should have 5px border radius
    expect(datePickerBlock).toMatch(/border-radius:\s*5px/)
  })

  test('Field labels have refined typography', () => {
    const labelBlock = indexCss.match(/\.scholarship-timeline-field-label\s*\{[^}]+\}/s)?.[0]
    expect(labelBlock, 'Field label block should exist').toBeDefined()

    // Should have proper font weight
    expect(labelBlock).toMatch(/font-weight:\s*600/)

    // Should have improved line height
    expect(labelBlock).toMatch(/line-height:\s*1\.2/)

    // Should be uppercase
    expect(labelBlock).toMatch(/text-transform:\s*uppercase/)

    // Should have letter spacing
    expect(labelBlock).toMatch(/letter-spacing:\s*0\.02em/)
  })

  test('Display timeline cards are lightweight', () => {
    const timelineCardBlock = indexCss.match(/\.funding-scholarship-timeline-card\s*\{[^}]+\}/s)?.[0]
    expect(timelineCardBlock, 'Timeline card block should exist').toBeDefined()

    // Should be completely transparent - no border, no background (eliminates frame-in-frame)
    expect(timelineCardBlock).toMatch(/padding:\s*0/)
    expect(timelineCardBlock).toMatch(/border:\s*none/)
    expect(timelineCardBlock).toMatch(/border-radius:\s*0/)
    expect(timelineCardBlock).toMatch(/background:\s*transparent/)
  })

  test('Timeline card hover effect is subtle', () => {
    const hoverBlock = indexCss.match(
      /\.funding-scholarship-timeline-event:hover\s+\.funding-scholarship-timeline-card\s*\{[^}]+\}/s
    )?.[0]
    expect(hoverBlock, 'Card hover block should exist').toBeDefined()

    // Should remain transparent on hover - no frame-in-frame effect
    expect(hoverBlock).toMatch(/transparent/)
    expect(hoverBlock).toMatch(/border-color:\s*transparent/)
    expect(hoverBlock).toMatch(/background:\s*transparent/)
  })

  test('Timeline row animations are refined', () => {
    const presenceBlock = indexCss.match(/\.scholarship-timeline-row-presence\s*\{[^}]+\}/s)?.[0]
    expect(presenceBlock, 'Timeline presence block should exist').toBeDefined()

    // Transform should be -6px, not -8px
    expect(presenceBlock).toMatch(/transform:\s*translate3d\(0,\s*-6px,\s*0\)/)

    // Animation timings should be refined
    expect(presenceBlock).toMatch(/340ms/)
    expect(presenceBlock).toMatch(/280ms/)
  })

  test('Focus ring is refined', () => {
    const focusBlock = indexCss.match(
      /\.scholarship-timeline-text-control:focus-within\s*\{[^}]+\}/s
    )?.[0]
    expect(focusBlock, 'Focus block should exist').toBeDefined()

    // Box shadow should be 1.5px, not 2px
    expect(focusBlock).toMatch(/box-shadow:\s*0\s+0\s+0\s+1\.5px/)
  })

  test('Funding add button is refined', () => {
    const addBtnBlock = indexCss.match(/\.funding-add-btn\s*\{[^}]+\}/s)?.[0]
    expect(addBtnBlock, 'Funding add button block should exist').toBeDefined()

    // Height should be 32px, not 36px
    expect(addBtnBlock).toMatch(/min-height:\s*32px/)

    // Padding should be refined
    expect(addBtnBlock).toMatch(/padding:\s*0\s+14px/)

    // Border radius should be 6px
    expect(addBtnBlock).toMatch(/border-radius:\s*6px/)

    // Font should be explicit
    expect(addBtnBlock).toMatch(/font-size:\s*13px/)
    expect(addBtnBlock).toMatch(/font-weight:\s*600/)
  })

  test('Funding meta grid removes nested box appearance', () => {
    const metaGridDivBlock = indexCss.match(/\.funding-card-meta-grid\s+div\s*\{[^}]+\}/s)?.[0]
    expect(metaGridDivBlock, 'Meta grid div block should exist').toBeDefined()

    // Should have padding for card-like appearance
    expect(metaGridDivBlock).toMatch(/padding:\s*8px\s+10px/)

    // Should have border-radius
    expect(metaGridDivBlock).toMatch(/border-radius:\s*6px/)

    // Should have transparent background by default
    expect(metaGridDivBlock).toMatch(/background:\s*transparent/)

    // Should have transition
    expect(metaGridDivBlock).toMatch(/transition/)
  })

  test('Funding meta grid has hover effect', () => {
    const hoverBlock = indexCss.match(/\.funding-card-meta-grid\s+div:hover\s*\{[^}]+\}/s)?.[0]
    expect(hoverBlock, 'Meta grid hover should exist').toBeDefined()

    // Should show subtle background on hover
    expect(hoverBlock).toMatch(/background:\s*var\(--surface-secondary\)/)
  })

  test('Funding meta grid typography is refined', () => {
    const labelBlock = indexCss.match(/\.funding-card-meta-grid\s+span\s*\{[^}]+\}/s)?.[0]
    expect(labelBlock, 'Meta grid label block should exist').toBeDefined()

    // Font size should be 10px
    expect(labelBlock).toMatch(/font-size:\s*10px/)

    // Letter spacing should be refined
    expect(labelBlock).toMatch(/letter-spacing:\s*0\.03em/)

    const valueBlock = indexCss.match(/\.funding-card-meta-grid\s+strong\s*\{[^}]+\}/s)?.[0]
    expect(valueBlock, 'Meta grid value block should exist').toBeDefined()

    // Font size should be 13px
    expect(valueBlock).toMatch(/font-size:\s*13px/)
  })
})
