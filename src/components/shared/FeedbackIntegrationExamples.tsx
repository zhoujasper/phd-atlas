import { useState } from 'react'
import { NetworkStatusBanner } from './NetworkStatusBanner'
import { ErrorRecoveryDialog } from './ErrorRecoveryDialog'
import { SaveStatusIndicator } from './SaveStatusIndicator'
import { ScreenSkeleton, PanelSkeleton } from './ScreenSkeleton'

/**
 * Integration examples for the enhanced feedback components.
 * Shows how to use NetworkStatusBanner, ErrorRecoveryDialog, SaveStatusIndicator,
 * and skeleton loaders throughout the application.
 */

// Example 1: Network Status Integration (App.tsx level)
export function NetworkStatusExample() {
  const [online, setOnline] = useState(navigator.onLine)
  const [reconnecting, setReconnecting] = useState(false)

  const handleRetry = () => {
    setReconnecting(true)
    // Trigger your reconnection logic
    setTimeout(() => {
      setReconnecting(false)
      setOnline(true)
    }, 2000)
  }

  return (
    <>
      <NetworkStatusBanner
        online={online}
        reconnecting={reconnecting}
        onRetry={handleRetry}
      />
      {/* Your app content */}
    </>
  )
}

// Example 2: Error Recovery Dialog (Save conflicts, network errors)
export function ErrorRecoveryExample() {
  const [errorOpen, setErrorOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    setRetrying(true)
    try {
      // Retry the failed operation
      await new Promise(resolve => setTimeout(resolve, 1500))
      setErrorOpen(false)
    } finally {
      setRetrying(false)
    }
  }

  const handleReload = () => {
    window.location.reload()
  }

  return (
    <>
      <button onClick={() => setErrorOpen(true)}>Trigger Error</button>

      <ErrorRecoveryDialog
        open={errorOpen}
        severity="conflict"
        onRetry={handleRetry}
        onReload={handleReload}
        onDismiss={() => setErrorOpen(false)}
        loading={retrying}
      />
    </>
  )
}

// Example 3: Save Status in DossierView toolbar
export function SaveStatusExample() {
  const [savePhase, setSavePhase] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [lastSaved, setLastSaved] = useState<Date | undefined>()

  const handleSave = async () => {
    setSavePhase('saving')
    try {
      await new Promise(resolve => setTimeout(resolve, 800))
      setSavePhase('saved')
      setLastSaved(new Date())
      setTimeout(() => setSavePhase('idle'), 2500)
    } catch {
      setSavePhase('error')
    }
  }

  return (
    <div className="dossier-actions">
      <SaveStatusIndicator
        phase={savePhase}
        lastSavedAt={lastSaved}
        errorMessage="Save failed — check your connection"
        autoHideMs={2000}
      />
      <button onClick={handleSave}>Save</button>
    </div>
  )
}

// Example 4: Screen-level skeleton during route loading
export function RouteSkeletonExample() {
  const [loading] = useState(true)

  if (loading) {
    return <ScreenSkeleton type="dashboard" />
  }

  return <div>Loaded content</div>
}

// Example 5: Panel skeleton for ApplicationPane/Inspector
export function PanelSkeletonExample() {
  const [loading] = useState(true)

  if (loading) {
    return <PanelSkeleton type="applications" />
  }

  return <div>Application list</div>
}

// Example 6: Optimistic UI update pattern
export function OptimisticUpdateExample() {
  const [items, setItems] = useState(['Item 1', 'Item 2'])
  const [savingId, setSavingId] = useState<number | null>(null)

  const handleAdd = async () => {
    const tempId = Date.now()
    const newItem = `Item ${items.length + 1}`

    // Optimistic update
    setItems([...items, newItem])
    setSavingId(tempId)

    try {
      // API call
      await new Promise(resolve => setTimeout(resolve, 1000))
      setSavingId(null)
    } catch (error) {
      // Rollback on failure
      setItems(items)
      setSavingId(null)
      // Show error
    }
  }

  return (
    <div>
      <ul>
        {items.map((item, i) => (
          <li key={i}>
            {item}
            {savingId === i && <span> (saving…)</span>}
          </li>
        ))}
      </ul>
      <button onClick={handleAdd}>Add Item</button>
    </div>
  )
}

// Example 7: Complete feedback integration in a feature component
export function CompleteIntegrationExample() {
  const [loading] = useState(true)
  const [savePhase, setSavePhase] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorOpen, setErrorOpen] = useState(false)
  const [errorSeverity, setErrorSeverity] = useState<'recoverable' | 'conflict' | 'critical'>('recoverable')

  const handleSave = async () => {
    setSavePhase('saving')
    try {
      await new Promise((resolve, reject) => {
        setTimeout(() => {
          // Simulate occasional conflict
          if (Math.random() > 0.8) {
            reject(new Error('conflict'))
          } else {
            resolve(true)
          }
        }, 800)
      })
      setSavePhase('saved')
    } catch (error) {
      setSavePhase('error')
      setErrorSeverity('conflict')
      setErrorOpen(true)
    }
  }

  if (loading) {
    return <ScreenSkeleton type="dossier" />
  }

  return (
    <>
      <div className="dossier-toolbar">
        <SaveStatusIndicator phase={savePhase} />
        <button onClick={handleSave}>Save</button>
      </div>

      <ErrorRecoveryDialog
        open={errorOpen}
        severity={errorSeverity}
        onRetry={handleSave}
        onReload={() => window.location.reload()}
        onDismiss={() => setErrorOpen(false)}
      />
    </>
  )
}
