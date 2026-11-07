import {
  emptyAllocation,
  normalizeAllocation,
  type Allocation,
} from './allocation'
import type { RoundMember, RoundRecord } from './rounds'
import type { PlayerScore } from './scoring'
import { isGameVariantId, type GameVariantId } from './variants'

export type RoundView = {
  id: string
  createdAt: RoundRecord['createdAt']
  scoredAt?: RoundRecord['createdAt']
  groupingSetId: string | null
  variant: GameVariantId | null
  groupCount: number
  status: RoundRecord['status']
  groups: Record<string, RoundMember[]>
  scores: Record<string, Record<string, PlayerScore>>
}

export type RoundSummary = {
  id: string
  createdAt: number | null
  scoredAt: number | null
  groupingSetId: string | null
  variant: GameVariantId | null
  groupCount: number
  status: RoundRecord['status']
  playerCount: number
}

function memberHasAllocation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (!('allocation' in value)) return false
  const allocation = (value as { allocation?: unknown }).allocation
  return allocation != null && typeof allocation === 'object'
}

function readAllocation(value: unknown): Allocation | null {
  if (!memberHasAllocation(value)) return null
  return normalizeAllocation((value as { allocation: unknown }).allocation)
}

function normalizeMembers(raw: unknown): RoundMember[] {
  if (raw == null) return []

  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (typeof entry === 'string') {
          return {
            uid: entry,
            email: null,
            displayName: null,
            photoURL: null,
            hasAllocation: false,
            allocation: null,
          }
        }
        if (entry && typeof entry === 'object' && 'uid' in entry) {
          const member = entry as Partial<RoundMember>
          return {
            uid: String(member.uid),
            email: member.email ?? null,
            displayName: member.displayName ?? null,
            photoURL: member.photoURL ?? null,
            hasAllocation: memberHasAllocation(entry),
            allocation: readAllocation(entry),
          }
        }
        return null
      })
      .filter((member): member is RoundMember => member !== null)
  }

  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([uid, value]) => {
        if (!value || typeof value !== 'object') {
          return {
            uid,
            email: null,
            displayName: null,
            photoURL: null,
            hasAllocation: false,
            allocation: null,
          }
        }
        const member = value as Partial<RoundMember>
        return {
          uid,
          email: member.email ?? null,
          displayName: member.displayName ?? null,
          photoURL: member.photoURL ?? null,
          hasAllocation: memberHasAllocation(value),
          allocation: readAllocation(value),
        }
      })
      .sort((a, b) => {
        const nameA = (a.displayName || a.uid).toLowerCase()
        const nameB = (b.displayName || b.uid).toLowerCase()
        return nameA.localeCompare(nameB)
      })
  }

  return []
}

function allocationLooksEmpty(allocation: Allocation | null | undefined): boolean {
  if (!allocation) return true
  return Object.values(allocation).every((value) => value === 0)
}

function normalizeScores(
  raw: unknown,
  groups: Record<string, RoundMember[]>,
): Record<string, Record<string, PlayerScore>> {
  if (!raw || typeof raw !== 'object') return {}

  const scores: Record<string, Record<string, PlayerScore>> = {}

  Object.entries(raw as Record<string, unknown>).forEach(
    ([groupId, groupScores]) => {
      if (!groupScores || typeof groupScores !== 'object') {
        scores[groupId] = {}
        return
      }

      const membersByUid = new Map(
        (groups[groupId] ?? []).map((member) => [member.uid, member]),
      )

      scores[groupId] = {}
      Object.entries(groupScores as Record<string, unknown>).forEach(
        ([uid, value]) => {
          if (!value || typeof value !== 'object') return
          const score = value as Partial<PlayerScore>
          const fromScore = normalizeAllocation(
            'allocation' in score ? score.allocation : null,
          )
          const fromGroup = membersByUid.get(uid)?.allocation ?? null

          scores[groupId][uid] = {
            uid,
            displayName:
              score.displayName ?? membersByUid.get(uid)?.displayName ?? null,
            wins: typeof score.wins === 'number' ? score.wins : 0,
            games: typeof score.games === 'number' ? score.games : 0,
            allocation: !allocationLooksEmpty(fromScore)
              ? fromScore
              : (fromGroup ?? emptyAllocation()),
          }
        },
      )
    },
  )

  return scores
}

function toMillis(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseRoundSnapshot(
  id: string,
  value: unknown,
): RoundView | null {
  if (!value || typeof value !== 'object') return null

  const data = value as {
    createdAt?: RoundRecord['createdAt']
    scoredAt?: RoundRecord['createdAt']
    groupingSetId?: string
    variant?: unknown
    groupCount?: number
    status?: RoundRecord['status']
    groups?: Record<string, unknown>
    scores?: unknown
  }

  const groups: Record<string, RoundMember[]> = {}
  Object.entries(data.groups ?? {}).forEach(([key, members]) => {
    groups[key] = normalizeMembers(members)
  })

  return {
    id,
    createdAt: data.createdAt ?? 0,
    scoredAt: data.scoredAt,
    groupingSetId:
      typeof data.groupingSetId === 'string' ? data.groupingSetId : null,
    variant: isGameVariantId(data.variant) ? data.variant : null,
    groupCount: data.groupCount ?? Object.keys(groups).length,
    status: data.status === 'scored' ? 'scored' : 'created',
    groups,
    scores: normalizeScores(data.scores, groups),
  }
}

export function summarizeRound(round: RoundView): RoundSummary {
  const playerCount = Object.values(round.groups).reduce(
    (total, members) => total + members.length,
    0,
  )

  return {
    id: round.id,
    createdAt: toMillis(round.createdAt),
    scoredAt: toMillis(round.scoredAt),
    groupingSetId: round.groupingSetId,
    variant: round.variant,
    groupCount: round.groupCount,
    status: round.status,
    playerCount,
  }
}

export function formatRoundTime(value: number | null): string {
  if (value == null) return 'Unknown time'
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function sortedGroupEntries(round: {
  groups: Record<string, RoundMember[]>
}) {
  return Object.entries(round.groups).sort(([a], [b]) => {
    const numA = Number.parseInt(a, 10)
    const numB = Number.parseInt(b, 10)
    if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB
    return a.localeCompare(b)
  })
}
