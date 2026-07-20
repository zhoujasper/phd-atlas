import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDict, preloadLanguage, t, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { AvatarCropDialog } from './AvatarCropDialog'
import { UserAvatar } from './UserAvatar'

async function renderDialog(onSave = vi.fn()) {
  await preloadLanguage('en', ['settings'])
  const result = render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => t('en', path, fallback),
    }}>
      <AvatarCropDialog
        open
        name="Lina Zhao"
        email="student.lina@example.com"
        onClose={vi.fn()}
        onSave={onSave}
      />
    </I18nContext.Provider>,
  )
  return { ...result, onSave }
}

describe('AvatarCropDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens as an accessible crop studio with save disabled until a photo is selected', async () => {
    await renderDialog()

    expect(screen.getByRole('dialog', { name: 'Choose your avatar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose photo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save avatar' })).toBeDisabled()
    expect(screen.getByText('Shared across your team')).toBeInTheDocument()
  })

  it('rejects unsupported uploads before they enter the crop workspace', async () => {
    const { onSave } = await renderDialog()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()

    fireEvent.change(input!, {
      target: { files: [new File(['hello'], 'avatar.txt', { type: 'text/plain' })] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a PNG, JPEG, or WebP image.')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('moves the large crop image with the pointer offset', async () => {
    class MockImage {
      decoding = ''
      naturalWidth = 640
      naturalHeight = 320
      onload: null | (() => void) = null
      onerror: null | (() => void) = null

      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', MockImage)
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })

    await preloadLanguage('en', ['settings'])
    render(
      <I18nContext.Provider value={{
        lang: 'en',
        t: getDict('en'),
        format: tpl,
        tx: (path, fallback) => t('en', path, fallback),
      }}>
        <AvatarCropDialog
          open
          currentAvatar="data:image/png;base64,AAAA"
          name="Lina Zhao"
          email="student.lina@example.com"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    const largeImage = await waitFor(() => {
      const image = document.querySelector<HTMLImageElement>('.avatar-crop-image')
      expect(image).not.toBeNull()
      return image!
    })
    const stage = document.querySelector<HTMLElement>('.avatar-crop-stage')!

    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 140, clientY: 100 })

    await waitFor(() => {
      expect(largeImage.style.left).toBe('calc(50% + 40px)')
      expect(largeImage.style.top).toBe('calc(50% + 0px)')
    })
  })
})

describe('UserAvatar', () => {
  it('uses the cropped image when present and falls back to an initial otherwise', () => {
    const { rerender } = render(<UserAvatar avatarUrl="data:image/png;base64,AAAA" name="Lina" />)
    expect(document.querySelector('.user-avatar-image')).toHaveAttribute('src', 'data:image/png;base64,AAAA')

    rerender(<UserAvatar name="Lina" />)
    expect(screen.getByText('L')).toBeInTheDocument()
  })
})
