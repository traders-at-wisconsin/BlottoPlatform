import { useEffect, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { database } from '../lib/firebase'
import { parseRoundSnapshot, type RoundView } from '../lib/roundData'

export function useRound(roundId: string | null, enabled = true) {
  const [round, setRound] = useState<RoundView | null>(null)
  const [loading, setLoading] = useState(Boolean(enabled && roundId))

  useEffect(() => {
    if (!enabled || !roundId) {
      setRound(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const roundRef = ref(database, `rounds/${roundId}`)

    return onValue(
      roundRef,
      (snapshot) => {
        setRound(parseRoundSnapshot(roundId, snapshot.val()))
        setLoading(false)
      },
      () => {
        setRound(null)
        setLoading(false)
      },
    )
  }, [enabled, roundId])

  return { round, loading }
}
