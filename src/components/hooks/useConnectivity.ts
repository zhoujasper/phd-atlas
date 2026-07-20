import { useEffect, useSyncExternalStore } from 'react'
import {
  getConnectivitySnapshot,
  startConnectivityMonitoring,
  subscribeConnectivity,
} from '../../connectivity'

export function useConnectivity() {
  const snapshot = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getConnectivitySnapshot,
  )

  useEffect(() => startConnectivityMonitoring(), [])
  return snapshot
}

