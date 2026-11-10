import { useEffect, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { database } from '../lib/firebase'
import type {
  GroupingSetGroups,
  StandingEntry,
} from '../lib/groupingSets'

export type GroupingSetView = {
  id: string
  createdAt: number | null
  groupCount: number
  groups: GroupingSetGroups
  standings: Record<string, Record<string, StandingEntry>>
}

function parseStandings(
  raw: unknown,
): Record<string, Record<string, StandingEntry>> {
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, Record<string, StandingEntry>> = {}

  Object.entries(raw as Record<string, unknown>).forEach(([groupId, group]) => {
    if (!group || typeof group !== 'object') {
      result[groupId] = {}
      return
    }
    result[groupId] = {}
    Object.entries(group as Record<string, unknown>).forEach(([uid, value]) => {
      if (!value || typeof value !== 'object') return
      const entry = value as Partial<StandingEntry>
      result[groupId][uid] = {
        uid,
        displayName: entry.displayName ?? null,
        points: typeof entry.points === 'number' ? entry.points : 0,
        matches: typeof entry.matches === 'number' ? entry.matches : 0,
      }
    })
  })

  return result
}

export function useActiveGroupingSet(enabled: boolean) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [groupingSet, setGroupingSet] = useState<GroupingSetView | null>(null)
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) {
      setActiveId(null)
      setGroupingSet(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const activeRef = ref(database, 'activeGroupingSet')

    return onValue(
      activeRef,
      (snapshot) => {
        const value = snapshot.val()
        const id = typeof value === 'string' && value.length > 0 ? value : null
        setActiveId(id)
        if (!id) {
          setGroupingSet(null)
          setLoading(false)
        }
      },
      () => {
        setActiveId(null)
        setGroupingSet(null)
        setLoading(false)
      },
    )
  }, [enabled])

  useEffect(() => {
    if (!enabled || !activeId) return

    setLoading(true)
    const setRef = ref(database, `groupingSets/${activeId}`)

    return onValue(
      setRef,
      (snapshot) => {
        const value = snapshot.val() as {
          createdAt?: number
          groupCount?: number
          groups?: GroupingSetGroups
          standings?: unknown
        } | null

        if (!value) {
          setGroupingSet(null)
          setLoading(false)
          return
        }

        setGroupingSet({
          id: activeId,
          createdAt: typeof value.createdAt === 'number' ? value.createdAt : null,
          groupCount: value.groupCount ?? Object.keys(value.groups ?? {}).length,
          groups: value.groups ?? {},
          standings: parseStandings(value.standings),
        })
        setLoading(false)
      },
      () => {
        setGroupingSet(null)
        setLoading(false)
      },
    )
  }, [enabled, activeId])

  return { activeGroupingSetId: activeId, groupingSet, loading }
}
