import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerLanguage } from '../../i18n'
import chineseShare from '../../i18n/zh/share.json'
import type { ApplicationRecord, ShareSection } from '../../data/applications'
import coreStyles from '../../index.css?raw'
import { I18nContext, useI18nValue } from '../hooks/useI18n'
import { ShareDialog } from './ShareDialog'

const allSections: ShareSection[] = [
  'overview',
  'materials',
  'tasks',
  'communications',
  'funding',
  'timeline',
  'versions',
]

const application = {
  id: 'share-dialog-i18n',
  school: {
    name: '示例大学',
  },
  shares: [],
} as unknown as ApplicationRecord

function ChineseShareProvider({ children }: { children: ReactNode }) {
  const value = useI18nValue('zh', ['core', 'shared', 'share'])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

describe('ShareDialog localization and selected-state paint', () => {
  beforeAll(() => {
    registerLanguage('zh', chineseShare, 'share')
  })

  afterEach(() => {
    cleanup()
  })

  it('resolves the active-share quota from the share namespace', () => {
    render(
      <ChineseShareProvider>
        <ShareDialog
          open
          application={application}
          expiry="7d"
          permission="view"
          sections={allSections}
          activeShareCount={0}
          shareQuota={5}
          onExpiry={vi.fn()}
          onPermission={vi.fn()}
          onSections={vi.fn()}
          onClose={vi.fn()}
          onCreate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </ChineseShareProvider>,
    )

    expect(screen.getByText('活跃分享链接')).toBeInTheDocument()
    expect(screen.getByText('0/5 条活跃链接')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('settings.shareCount')
    expect(document.body).not.toHaveTextContent('share.activeCount')
  })

  it('keeps the one-pixel selected outline inside the animated clip', () => {
    expect(coreStyles).toMatch(
      /\.share-section-picker-shell > \*\s*\{[^}]*overflow:\s*hidden/s,
    )
    expect(coreStyles).toMatch(
      /\.share-section-picker\s*\{[^}]*padding:\s*1px;[^}]*margin:\s*-1px;/s,
    )
    expect(coreStyles).toMatch(
      /\.share-section-option\.selected\s*\{[^}]*box-shadow:\s*0 0 0 1px var\(--border-accent\)/s,
    )
  })
})
