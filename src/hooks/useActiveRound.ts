import { useEffect, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { database } from '../lib/firebase'
import { parseRoundSnapshot, type RoundView } from '../lib/roundData'

export type ActiveRound = RoundView

export function useActiveRound(enabled: boolean) {
  const [roundActive, setRoundActive] = useState<string | null>(null)
  const [round, setRound] = useState<RoundView | null>(null)
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) {
      setRoundActive(null)
      setRound(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const activeRef = ref(database, 'roundActive')

    return onValue(
      activeRef,
      (snapshot) => {
        const value = snapshot.val()
        const id = typeof value === 'string' && value.length > 0 ? value : null
        setRoundActive(id)
        if (!id) {
          setRound(null)
          setLoading(false)
        }
      },
      () => {
        setRoundActive(null)
        setRound(null)
        setLoading(false)
      },
    )
  }, [enabled])

  useEffect(() => {
    if (!enabled || !roundActive) return

    setLoading(true)
    const roundRef = ref(database, `rounds/${roundActive}`)

    return onValue(
      roundRef,
      (snapshot) => {
        setRound(parseRoundSnapshot(roundActive, snapshot.val()))
        setLoading(false)
      },
      () => {
        setRound(null)
        setLoading(false)
      },
    )
  }, [enabled, roundActive])

  return { roundActive, round, loading }
}
