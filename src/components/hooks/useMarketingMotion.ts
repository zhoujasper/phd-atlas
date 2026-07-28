import { useEffect, type RefObject } from 'react'

function motionIsReduced() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Adds a one-shot reveal state to marketing sections without putting scroll
 * position in React state. Content remains fully visible when observers are
 * unavailable or reduced motion is requested.
 */
export function useMarketingReveal(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined

    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-marketing-reveal]'))
    if (targets.length === 0) return undefined

    if (motionIsReduced() || typeof IntersectionObserver === 'undefined') {
      targets.forEach((target) => target.setAttribute('data-marketing-visible', 'true'))
      return undefined
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        ;(entry.target as HTMLElement).setAttribute('data-marketing-visible', 'true')
        observer.unobserve(entry.target)
      })
    }, {
      rootMargin: '0px 0px -8% 0px',
      threshold: 0.12,
    })

    targets.forEach((target) => observer.observe(target))
    return () => observer.disconnect()
  }, [rootRef])
}

/**
 * Writes pointer position and restrained tilt directly to a product stage.
 * The interaction is enabled only for precise pointers and releases cleanly.
 */
export function usePointerTilt(
  stageRef: RefObject<HTMLElement | null>,
  maximumTilt = 2.4,
) {
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || motionIsReduced() || typeof window.matchMedia !== 'function') return undefined

    const precisePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    if (!precisePointer.matches) return undefined

    let frame = 0
    let pointerX = 0
    let pointerY = 0

    const writePointer = () => {
      frame = 0
      const bounds = stage.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return
      const normalizedX = Math.min(1, Math.max(0, (pointerX - bounds.left) / bounds.width))
      const normalizedY = Math.min(1, Math.max(0, (pointerY - bounds.top) / bounds.height))
      stage.style.setProperty('--marketing-pointer-x', `${normalizedX * 100}%`)
      stage.style.setProperty('--marketing-pointer-y', `${normalizedY * 100}%`)
      stage.style.setProperty('--marketing-tilt-x', `${(0.5 - normalizedY) * maximumTilt}deg`)
      stage.style.setProperty('--marketing-tilt-y', `${(normalizedX - 0.5) * maximumTilt}deg`)
    }

    const onPointerMove = (event: PointerEvent) => {
      pointerX = event.clientX
      pointerY = event.clientY
      if (frame === 0) frame = window.requestAnimationFrame(writePointer)
    }

    const onPointerLeave = () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
        frame = 0
      }
      stage.style.setProperty('--marketing-pointer-x', '50%')
      stage.style.setProperty('--marketing-pointer-y', '50%')
      stage.style.setProperty('--marketing-tilt-x', '0deg')
      stage.style.setProperty('--marketing-tilt-y', '0deg')
    }

    stage.addEventListener('pointermove', onPointerMove, { passive: true })
    stage.addEventListener('pointerleave', onPointerLeave)
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      stage.removeEventListener('pointermove', onPointerMove)
      stage.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [maximumTilt, stageRef])
}
