import {
  memo,
  useLayoutEffect,
  useRef,
  type ComponentType,
} from 'react'

type UnknownCallback = (...args: unknown[]) => unknown

/**
 * Keeps an event callback referentially stable while forwarding calls to the
 * implementation from the latest committed render.
 */
export function useLatestCallback<TArguments extends unknown[], TResult>(
  callback: (...args: TArguments) => TResult,
) {
  const callbackRef = useRef(callback)
  const stableCallbackRef = useRef<((...args: TArguments) => TResult) | null>(null)

  useLayoutEffect(() => {
    callbackRef.current = callback
  }, [callback])

  if (stableCallbackRef.current === null) {
    stableCallbackRef.current = (...args: TArguments) => callbackRef.current(...args)
  }

  return stableCallbackRef.current
}

/**
 * Gives a large memoized screen stable `on*` event props without hiding callback
 * changes from React. The boundary itself always receives the newest props;
 * only its inner screen is memoized. Event proxies read from the latest
 * committed props, so skipped renders cannot retain stale closures.
 */
export function withLatestCallbackProps<TProps extends object>(
  Component: ComponentType<TProps>,
) {
  const MemoizedComponent = memo(Component)

  function LatestCallbackPropsBoundary(props: TProps) {
    const latestPropsRef = useRef(props)
    const callbackProxiesRef = useRef(new Map<keyof TProps, UnknownCallback>())

    useLayoutEffect(() => {
      latestPropsRef.current = props
    }, [props])

    const forwardedProps = { ...props } as Record<PropertyKey, unknown>

    for (const key of Object.keys(props) as Array<keyof TProps>) {
      // Function props used during render (for example `formatValue` or a
      // render prop) must participate in shallow equality. Only event-style
      // `on*` props are safe to dispatch after the commit through a proxy.
      if (typeof key !== 'string' || !key.startsWith('on') || typeof props[key] !== 'function') continue

      let proxy = callbackProxiesRef.current.get(key)
      if (!proxy) {
        proxy = (...args: unknown[]) => {
          const latestCallback = latestPropsRef.current[key]
          if (typeof latestCallback !== 'function') return undefined
          return Reflect.apply(latestCallback, undefined, args)
        }
        callbackProxiesRef.current.set(key, proxy)
      }

      forwardedProps[key] = proxy
    }

    return <MemoizedComponent {...(forwardedProps as TProps)} />
  }

  const componentName = Component.displayName ?? Component.name ?? 'Component'
  LatestCallbackPropsBoundary.displayName = `withLatestCallbackProps(${componentName})`

  return LatestCallbackPropsBoundary
}
