import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { phdApi } from '../api/phdApi'
import { useI18n } from '../components/hooks/useI18n'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { LaunchScreen } from '../components/shared/LaunchScreen'

function activationCodeFromPath(pathname: string) {
  const prefix = '/admin/'
  if (!pathname.startsWith(prefix)) return ''
  const encoded = pathname.slice(prefix.length).replace(/\/+$/, '')
  if (!encoded || encoded.includes('/')) return ''
  try {
    return decodeURIComponent(encoded)
  } catch {
    return ''
  }
}

function leaveAdmin() {
  window.location.replace('/')
}

export function AdminAccessGate({ children }: { children: ReactNode }) {
  const { tx } = useI18n()
  const [allowed, setAllowed] = useState(false)
  const [askRemember, setAskRemember] = useState(false)
  const [remembering, setRemembering] = useState(false)
  const runIdRef = useRef(0)

  const finishActivation = useCallback(() => {
    window.history.replaceState({}, '', '/admin')
    setAskRemember(false)
    setAllowed(true)
  }, [])

  useEffect(() => {
    const runId = ++runIdRef.current
    let cancelled = false
    const isCurrent = () => !cancelled && runIdRef.current === runId
    const code = activationCodeFromPath(window.location.pathname)

    void (async () => {
      try {
        if (code) {
          const result = await phdApi.activateAdminAccess(code)
          if (!isCurrent() || !result.allowed) return
          if (result.hidden) {
            setAskRemember(true)
          } else {
            finishActivation()
          }
          return
        }
        const result = await phdApi.adminAccessStatus()
        if (!isCurrent()) return
        if (!result.allowed) {
          leaveAdmin()
          return
        }
        setAllowed(true)
      } catch {
        if (isCurrent()) leaveAdmin()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [finishActivation])

  if (allowed) return children

  return (
    <>
      <LaunchScreen
        message={tx('admin.adminEntry.checking')}
        detail={tx('admin.adminEntry.checkingDetail')}
      />
      <ConfirmDialog
        open={askRemember}
        title={tx('admin.adminEntry.rememberTitle')}
        message={tx('admin.adminEntry.rememberBody')}
        confirmLabel={remembering ? tx('admin.adminEntry.remembering') : tx('admin.adminEntry.remember')}
        cancelLabel={tx('admin.adminEntry.notNow')}
        onConfirm={() => {
          if (remembering) return
          setRemembering(true)
          void phdApi.rememberAdminAccess()
            .catch(() => null)
            .finally(finishActivation)
        }}
        onCancel={finishActivation}
      />
    </>
  )
}
