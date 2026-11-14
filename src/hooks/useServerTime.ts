import { useEffect, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { database } from '../lib/firebase'

let offset = 0
onValue(ref(database, '.info/serverTimeOffset'), (snapshot) => {
  offset = typeof snapshot.val() === 'number' ? snapshot.val() : 0
})

/** Firebase server time, corrected for this device's clock skew. */
export function serverNow(): number {
  return Date.now() + offset
}

/** Re-renders every `intervalMs` with the current server time. */
export function useServerNow(intervalMs = 250, enabled = true): number {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setNow(serverNow()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs, enabled])
  return now
}
