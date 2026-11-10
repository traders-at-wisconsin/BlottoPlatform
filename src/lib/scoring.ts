import { get, ref, serverTimestamp, update } from 'firebase/database'
import {
  ALLOCATION_SLOTS,
  normalizeAllocation,
  type Allocation,
} from './allocation'
import { database } from './firebase'
import type { StandingEntry } from './groupingSets'

export type PlayerScore = {
  uid: string
  displayName: string | null
  /** Match points this round: +1 win, +0.5 tie, +0 loss */
  wins: number
  games: number
  allocation: Allocation
}

type ScorablePlayer = {
  uid: string
  displayName: string | null
  allocation: Allocation
}

/** Hill i is worth i points. Winner takes all; tie splits. */
export function scoreHills(
  a: Allocation,
  b: Allocation,
): { aPoints: number; bPoints: number } {
  let aPoints = 0
  let bPoints = 0

  for (let hill = 1; hill <= ALLOCATION_SLOTS; hill += 1) {
    const key = String(hill)
    const aSoldiers = a[key] ?? 0
    const bSoldiers = b[key] ?? 0

    if (aSoldiers > bSoldiers) {
      aPoints += hill
    } else if (bSoldiers > aSoldiers) {
      bPoints += hill
    } else {
      aPoints += hill / 2
      bPoints += hill / 2
    }
  }

  return { aPoints, bPoints }
}

export function scoreGroupPlayers(players: ScorablePlayer[]): PlayerScore[] {
  const records = new Map<string, PlayerScore>()

  players.forEach((player) => {
    records.set(player.uid, {
      uid: player.uid,
      displayName: player.displayName,
      wins: 0,
      games: 0,
      allocation: player.allocation,
    })
  })

  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const left = players[i]
      const right = players[j]
      const { aPoints, bPoints } = scoreHills(left.allocation, right.allocation)

      const leftRecord = records.get(left.uid)!
      const rightRecord = records.get(right.uid)!
      leftRecord.games += 1
      rightRecord.games += 1

      if (aPoints > bPoints) {
        leftRecord.wins += 1
      } else if (bPoints > aPoints) {
        rightRecord.wins += 1
      } else {
        leftRecord.wins += 0.5
        rightRecord.wins += 0.5
      }
    }
  }

  return [...records.values()].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (b.games !== a.games) return a.games - b.games
    const nameA = (a.displayName || a.uid).toLowerCase()
    const nameB = (b.displayName || b.uid).toLowerCase()
    return nameA.localeCompare(nameB)
  })
}

export function formatRecord(wins: number, games: number): string {
  const winsLabel = Number.isInteger(wins) ? String(wins) : wins.toFixed(1)
  return `${winsLabel}/${games}`
}

export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1)
}

function parseGroupPlayers(rawGroup: unknown): ScorablePlayer[] {
  if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) {
    return []
  }

  return Object.entries(rawGroup as Record<string, unknown>)
    .map(([uid, value]) => {
      if (!value || typeof value !== 'object') return null
      const member = value as {
        displayName?: string | null
        allocation?: unknown
      }
      if (member.allocation == null || typeof member.allocation !== 'object') {
        return null
      }
      return {
        uid,
        displayName: member.displayName ?? null,
        allocation: normalizeAllocation(member.allocation),
      }
    })
    .filter((player): player is ScorablePlayer => player !== null)
}

export async function endRoundAndScore(roundId: string): Promise<void> {
  const snapshot = await get(ref(database, `rounds/${roundId}`))
  if (!snapshot.exists()) {
    throw new Error('Active round not found.')
  }

  const value = snapshot.val() as {
    status?: string
    groupingSetId?: string
    groups?: Record<string, unknown>
  }

  if (value.status === 'scored') {
    throw new Error('This round has already been scored.')
  }

  if (!value.groupingSetId) {
    throw new Error('Round is missing a grouping set.')
  }

  const scores: Record<string, Record<string, PlayerScore>> = {}
  const standingUpdates: Record<string, StandingEntry> = {}
  let anyPlayers = false

  const existingStandingsSnap = await get(
    ref(database, `groupingSets/${value.groupingSetId}/standings`),
  )
  const existingStandings =
    (existingStandingsSnap.val() as Record<
      string,
      Record<string, StandingEntry>
    > | null) ?? {}

  Object.entries(value.groups ?? {}).forEach(([groupId, rawGroup]) => {
    const players = parseGroupPlayers(rawGroup)
    if (players.length === 0) {
      scores[groupId] = {}
      return
    }
    anyPlayers = true
    const ranked = scoreGroupPlayers(players)
    scores[groupId] = {}
    ranked.forEach((player) => {
      scores[groupId][player.uid] = player

      const prev = existingStandings[groupId]?.[player.uid]
      standingUpdates[`${groupId}/${player.uid}`] = {
        uid: player.uid,
        displayName: player.displayName,
        points: (prev?.points ?? 0) + player.wins,
        matches: (prev?.matches ?? 0) + player.games,
      }
    })
  })

  if (!anyPlayers) {
    throw new Error('No submitted allocations to score.')
  }

  const updates: Record<string, unknown> = {
    [`rounds/${roundId}/scores`]: scores,
    [`rounds/${roundId}/status`]: 'scored',
    [`rounds/${roundId}/scoredAt`]: serverTimestamp(),
  }

  Object.entries(standingUpdates).forEach(([path, entry]) => {
    updates[`groupingSets/${value.groupingSetId}/standings/${path}`] = entry
  })

  await update(ref(database), updates)
}

export function rankScores(
  scores: Record<string, PlayerScore> | PlayerScore[] | null | undefined,
): PlayerScore[] {
  const list = Array.isArray(scores)
    ? scores
    : scores
      ? Object.values(scores)
      : []

  return [...list].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (b.games !== a.games) return a.games - b.games
    const nameA = (a.displayName || a.uid).toLowerCase()
    const nameB = (b.displayName || b.uid).toLowerCase()
    return nameA.localeCompare(nameB)
  })
}

/**
 * Tied rows share the last place in the tie.
 * Two people tied for first are both rank 2. Third and fourth tied are both rank 4.
 */
export function tieRanks<T>(
  ordered: T[],
  tied: (left: T, right: T) => boolean,
): number[] {
  const ranks = new Array<number>(ordered.length)
  let index = 0

  while (index < ordered.length) {
    let end = index
    while (end + 1 < ordered.length && tied(ordered[end], ordered[end + 1])) {
      end += 1
    }
    const rank = end + 1
    for (let cursor = index; cursor <= end; cursor += 1) {
      ranks[cursor] = rank
    }
    index = end + 1
  }

  return ranks
}

export function rankStandings(
  standings: Record<string, StandingEntry> | StandingEntry[] | null | undefined,
): StandingEntry[] {
  const list = Array.isArray(standings)
    ? standings
    : standings
      ? Object.values(standings)
      : []

  return [...list].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.matches !== a.matches) return a.matches - b.matches
    const nameA = (a.displayName || a.uid).toLowerCase()
    const nameB = (b.displayName || b.uid).toLowerCase()
    return nameA.localeCompare(nameB)
  })
}
