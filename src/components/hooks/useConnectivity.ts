import { useSyncExternalStore } from 'react'
import {
  getConnectivitySnapshot,
  subscribeConnectivity,
} from '../../connectivity'

export function useConnectivity() {
  const snapshot = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getConnectivitySnapshot,
  )

  return snapshot
}
