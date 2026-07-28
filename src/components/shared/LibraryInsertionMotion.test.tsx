import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LibraryInsertionMotionBoundary,
  type LibraryInsertionMotionItem,
} from './LibraryInsertionMotion'

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')

afterEach(() => {
  if (originalAnimate) {
    Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  }
  vi.restoreAllMocks()
})

function rect(top: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: 200,
    bottom: top + 80,
    left: 0,
    width: 200,
    height: 80,
    toJSON: () => ({}),
  }
}

function MotionLibrary({
  assetIds,
  items,
  onAssetsAdded,
}: {
  assetIds: string[]
  items: LibraryInsertionMotionItem[]
  onAssetsAdded?: (ids: string[]) => void
}) {
  return (
    <LibraryInsertionMotionBoundary
      assetIds={assetIds}
      items={items}
      onAssetsAdded={onAssetsAdded}
    >
      {items.map((item) => (
        <div key={item.key} data-library-motion-key={item.key}>
          {item.key}
        </div>
      ))}
    </LibraryInsertionMotionBoundary>
  )
}

describe('LibraryInsertionMotionBoundary', () => {
  it('animates the created item in and FLIPs existing siblings into their new positions', () => {
    let order = ['asset:a', 'asset:b', 'action:add']
    const animate = vi.fn(function animate(
      this: HTMLElement,
      _keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      _options?: number | KeyframeAnimationOptions,
    ) {
      return {
        cancel: vi.fn(),
        finished: Promise.resolve(),
      } as unknown as Animation
    })
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      const key = this.dataset.libraryMotionKey
      return rect(Math.max(0, order.indexOf(key || '')) * 100)
    })
    const onAssetsAdded = vi.fn()
    const initialItems: LibraryInsertionMotionItem[] = [
      { key: 'asset:a', assetIds: ['a'] },
      { key: 'asset:b', assetIds: ['b'] },
      { key: 'action:add', assetIds: [] },
    ]
    const view = render(
      <MotionLibrary
        assetIds={['a', 'b']}
        items={initialItems}
        onAssetsAdded={onAssetsAdded}
      />,
    )
    expect(animate).not.toHaveBeenCalled()

    order = ['asset:new', ...order]
    const nextItems: LibraryInsertionMotionItem[] = [
      { key: 'asset:new', assetIds: ['new'] },
      ...initialItems,
    ]
    view.rerender(
      <MotionLibrary
        assetIds={['new', 'a', 'b']}
        items={nextItems}
        onAssetsAdded={onAssetsAdded}
      />,
    )

    expect(onAssetsAdded).toHaveBeenCalledWith(['new'])
    expect(animate.mock.instances.map((node) => (node as HTMLElement).dataset.libraryMotionKey))
      .toEqual(expect.arrayContaining(['asset:new', 'asset:a', 'asset:b', 'action:add']))
    const shiftedCallIndex = animate.mock.instances.findIndex(
      (node) => (node as HTMLElement).dataset.libraryMotionKey === 'asset:a',
    )
    expect(animate.mock.calls[shiftedCallIndex]?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ transform: expect.stringContaining('translate3d(0px, -100px, 0)') }),
    ]))
  })

  it('animates an existing family shell when the new asset joins that family', () => {
    const animate = vi.fn(function animate(
      this: HTMLElement,
      _keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      _options?: number | KeyframeAnimationOptions,
    ) {
      return {
        cancel: vi.fn(),
        finished: Promise.resolve(),
      } as unknown as Animation
    })
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect(0))
    const view = render(
      <MotionLibrary
        assetIds={['cv-1']}
        items={[{ key: 'family:cv', assetIds: ['cv-1'] }]}
      />,
    )

    view.rerender(
      <MotionLibrary
        assetIds={['cv-2', 'cv-1']}
        items={[{ key: 'family:cv', assetIds: ['cv-2', 'cv-1'] }]}
      />,
    )

    expect(animate).toHaveBeenCalledOnce()
    expect((animate.mock.instances[0] as HTMLElement).dataset.libraryMotionKey).toBe('family:cv')
    expect(animate.mock.calls[0]?.[0]).toHaveLength(3)
  })
})
