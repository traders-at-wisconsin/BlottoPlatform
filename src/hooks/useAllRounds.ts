import { useEffect, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { database } from '../lib/firebase'
import {
  parseRoundSnapshot,
  summarizeRound,
  type RoundSummary,
} from '../lib/roundData'

export function useAllRounds(enabled: boolean) {
  const [rounds, setRounds] = useState<RoundSummary[]>([])
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) {
      setRounds([])
      setLoading(false)
      return
    }

    setLoading(true)
    const roundsRef = ref(database, 'rounds')

    return onValue(
      roundsRef,
      (snapshot) => {
        const value = snapshot.val() as Record<string, unknown> | null
        if (!value) {
          setRounds([])
          setLoading(false)
          return
        }

        const next = Object.entries(value)
          .map(([id, raw]) => {
            const parsed = parseRoundSnapshot(id, raw)
            return parsed ? summarizeRound(parsed) : null
          })
          .filter((round): round is RoundSummary => round !== null)
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

        setRounds(next)
        setLoading(false)
      },
      () => {
        setRounds([])
        setLoading(false)
      },
    )
  }, [enabled])

  return { rounds, loading }
}
