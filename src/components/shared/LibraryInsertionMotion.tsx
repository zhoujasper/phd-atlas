import {
  useEffect,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react'

export type LibraryInsertionMotionItem = {
  key: string
  assetIds: readonly string[]
}

type LibraryInsertionMotionBoundaryProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  assetIds: readonly string[]
  items: readonly LibraryInsertionMotionItem[]
  enabled?: boolean
  children: ReactNode
  onAssetsAdded?: (assetIds: string[]) => void
}

const LIBRARY_INSERT_DURATION = 460
const LIBRARY_REFLOW_DURATION = 520

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function itemNodes(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('[data-library-motion-key]')]
}

/**
 * Keeps profile-library insertions local to the library surface:
 * the new card/row settles in while existing keyed siblings FLIP into their
 * new positions. DOM measurements and animation state stay in refs so this
 * transient motion never causes a screen-level React render.
 */
export function LibraryInsertionMotionBoundary({
  assetIds,
  items,
  enabled = true,
  children,
  className,
  onAssetsAdded,
  ...props
}: LibraryInsertionMotionBoundaryProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const previousAssetIdsRef = useRef(new Set<string>())
  const previousRectsRef = useRef(new Map<string, DOMRect>())
  const readyRef = useRef(false)
  const animationsRef = useRef(new Map<Animation, HTMLElement>())
  const assetIdsRef = useRef(assetIds)
  const itemsRef = useRef(items)
  const onAssetsAddedRef = useRef(onAssetsAdded)
  assetIdsRef.current = assetIds
  itemsRef.current = items
  onAssetsAddedRef.current = onAssetsAdded

  const assetIdentity = assetIds.join('\u0000')
  const itemIdentity = items
    .map((item) => `${item.key}\u0001${item.assetIds.join('\u0002')}`)
    .join('\u0003')

  useLayoutEffect(() => {
    const root = rootRef.current
    const currentAssetIdList = assetIdsRef.current
    const currentItems = itemsRef.current
    const currentAssetIds = new Set(currentAssetIdList)
    const nodes = root ? itemNodes(root) : []
    const currentRects = new Map<string, DOMRect>()

    // Batch every layout read before starting any animation writes.
    nodes.forEach((node) => {
      const key = node.dataset.libraryMotionKey
      if (key) currentRects.set(key, node.getBoundingClientRect())
    })

    if (!enabled) {
      readyRef.current = false
      previousAssetIdsRef.current = currentAssetIds
      previousRectsRef.current = currentRects
      return
    }

    if (!readyRef.current) {
      readyRef.current = true
      previousAssetIdsRef.current = currentAssetIds
      previousRectsRef.current = currentRects
      return
    }

    const addedAssetIds = currentAssetIdList.filter((id) => !previousAssetIdsRef.current.has(id))
    const previousRects = previousRectsRef.current
    previousAssetIdsRef.current = currentAssetIds
    previousRectsRef.current = currentRects
    if (addedAssetIds.length === 0) return

    onAssetsAddedRef.current?.(addedAssetIds)
    if (!root || prefersReducedMotion()) return

    animationsRef.current.forEach((node, animation) => {
      animation.cancel()
      node.style.removeProperty('will-change')
    })
    animationsRef.current.clear()

    const addedSet = new Set(addedAssetIds)
    const enteringKeys = new Set(
      currentItems
        .filter((item) => item.assetIds.some((id) => addedSet.has(id)))
        .map((item) => item.key),
    )

    nodes.forEach((node) => {
      const key = node.dataset.libraryMotionKey
      if (!key) return
      const before = previousRects.get(key)
      const after = currentRects.get(key)
      const entering = enteringKeys.has(key)
      const deltaX = before && after ? before.left - after.left : 0
      const deltaY = before && after ? before.top - after.top : 0
      const shifted = Math.abs(deltaX) >= 0.5 || Math.abs(deltaY) >= 0.5
      if (!entering && !shifted) return
      if (typeof node.animate !== 'function') return

      const startTransform = shifted
        ? `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${entering ? 0.975 : 1})`
        : 'translate3d(0, 10px, 0) scale(0.96)'
      const keyframes: Keyframe[] = entering
        ? [
            { opacity: 0.28, transform: startTransform },
            { opacity: 1, transform: 'translate3d(0, -2px, 0) scale(1.008)', offset: 0.72 },
            { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
          ]
        : [
            { transform: startTransform },
            { transform: 'translate3d(0, 0, 0) scale(1)' },
          ]

      node.style.willChange = entering ? 'transform, opacity' : 'transform'
      const animation = node.animate(keyframes, {
        duration: entering ? LIBRARY_INSERT_DURATION : LIBRARY_REFLOW_DURATION,
        easing: 'cubic-bezier(0.16, 0.72, 0.24, 1)',
        fill: 'both',
      })
      animationsRef.current.set(animation, node)
      void animation.finished
        .catch(() => undefined)
        .finally(() => {
          if (animationsRef.current.get(animation) !== node) return
          animationsRef.current.delete(animation)
          node.style.removeProperty('will-change')
        })
    })
  }, [assetIdentity, enabled, itemIdentity])

  useEffect(() => () => {
    animationsRef.current.forEach((node, animation) => {
      animation.cancel()
      node.style.removeProperty('will-change')
    })
    animationsRef.current.clear()
  }, [])

  return (
    <div
      {...props}
      ref={rootRef}
      className={['library-insertion-motion-boundary', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}
