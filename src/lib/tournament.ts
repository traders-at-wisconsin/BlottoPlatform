/**
 * Pure tournament logic: no Firebase, no I/O. Every client (players, admin,
 * public board) runs the same code on the same published allocations, so any
 * result can be reproduced from public data.
 */

export const SOLDIERS = 100
export const HILLS = 10
export const GAME_SECONDS = 90
export const GAMES_PER_STAGE = 3
export const WINS_NEEDED = 2
/** Must match the grace window in database.rules.json. */
export const SUBMIT_GRACE_MS = 1500
/** Admin client scores this long after the deadline, after the grace window. */
export const SCORE_DELAY_MS = 3000

export type Alloc = number[]
/** One slot per hill; null = left blank. */
export type Draft = Array<number | null>
/** uid -> final allocation for one game. */
export type GameAllocs = Record<string, Alloc>
export type Groups = Record<string, string[]>
export type StageKind = 'groups' | 'bracket'

export type StagePlan = {
  name: string
  kind: StageKind
  groupCount: number
  advancePerGroup: number
}

// ---------------------------------------------------------------------------
// Allocations

export function isValidAlloc(value: unknown): value is Alloc {
  return (
    Array.isArray(value) &&
    value.length === HILLS &&
    value.every((n) => Number.isInteger(n) && n >= 0) &&
    value.reduce((sum: number, n: number) => sum + n, 0) === SOLDIERS
  )
}

/** Read a Realtime Database value (array, sparse array or object) into hill slots. */
export function readSlots(raw: unknown): Draft {
  const slots: Draft = Array.from({ length: HILLS }, () => null)
  if (!raw || typeof raw !== 'object') return slots
  const record = raw as Record<string, unknown>
  for (let i = 0; i < HILLS; i += 1) {
    const value = record[i] ?? record[String(i)]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      slots[i] = Math.floor(value)
    }
  }
  return slots
}

export function draftTotal(draft: Draft): number {
  return draft.reduce<number>((sum, n) => sum + (n ?? 0), 0)
}

/**
 * Allocation for a player who did not submit: keep every hill they filled in,
 * split the remaining soldiers evenly across the hills they left blank.
 * Leftover soldiers from uneven division go to the lowest-numbered blank hills.
 * If the filled hills already exceed 100, the draft is unusable and every hill
 * gets an even share.
 */
export function autofill(draft: Draft | null): Alloc {
  const slots = draft ?? Array.from({ length: HILLS }, () => null)
  const filledTotal = draftTotal(slots)
  if (filledTotal > SOLDIERS) return evenSplit(Array.from({ length: HILLS }, (_, i) => i))

  const result = slots.map((n) => n ?? 0)
  let blanks = slots.flatMap((n, i) => (n === null ? [i] : []))
  // Every hill filled but short of 100: spread the rest across all hills.
  if (blanks.length === 0) blanks = Array.from({ length: HILLS }, (_, i) => i)

  const remaining = SOLDIERS - filledTotal
  const base = Math.floor(remaining / blanks.length)
  const extra = remaining % blanks.length
  blanks.forEach((hill, index) => {
    result[hill] += base + (index < extra ? 1 : 0)
  })
  return result
}

function evenSplit(hills: number[]): Alloc {
  const result = Array.from({ length: HILLS }, () => 0)
  const base = Math.floor(SOLDIERS / hills.length)
  const extra = SOLDIERS % hills.length
  hills.forEach((hill, index) => {
    result[hill] = base + (index < extra ? 1 : 0)
  })
  return result
}

// ---------------------------------------------------------------------------
// Matches

export type MatchResult = { aHills: number; bHills: number; aPoints: number }

/** More soldiers wins a hill; equal is nobody's. More hills wins; equal is a tie. */
export function playMatch(a: Alloc, b: Alloc): MatchResult {
  let aHills = 0
  let bHills = 0
  for (let i = 0; i < HILLS; i += 1) {
    if (a[i] > b[i]) aHills += 1
    else if (b[i] > a[i]) bHills += 1
  }
  const aPoints = aHills > bHills ? 1 : aHills < bHills ? 0 : 0.5
  return { aHills, bHills, aPoints }
}

// ---------------------------------------------------------------------------
// Seeded randomness

export function hashString(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function newSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Seeded shuffle, then deal round-robin so group sizes differ by at most 1. */
export function drawGroups(uids: string[], groupCount: number, seed: string): Groups {
  const count = Math.max(1, Math.min(groupCount, uids.length))
  const shuffled = [...uids].sort()
  const random = mulberry32(hashString(seed))
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const groups: Groups = {}
  for (let g = 0; g < count; g += 1) groups[String(g + 1)] = []
  shuffled.forEach((uid, index) => groups[String((index % count) + 1)].push(uid))
  return groups
}

/** Seeds in order (best first) -> head-to-head pairs: 1 v N, 2 v N-1, ... */
export function seedBracket(ordered: string[]): Groups {
  const groups: Groups = {}
  const half = Math.floor(ordered.length / 2)
  for (let i = 0; i < half; i += 1) {
    groups[String(i + 1)] = [ordered[i], ordered[ordered.length - 1 - i]]
  }
  return groups
}

// ---------------------------------------------------------------------------
// Group standings across a stage's games

export type StandingRow = {
  uid: string
  rank: number
  points: number
  hillsWon: number
  wins: number
  ties: number
  losses: number
  played: number
}

/**
 * Everyone in the group plays everyone in each game. Ranked by:
 * 1. match points (win 1, tie 0.5), 2. hills won, 3. points in matches among
 * the tied players, 4. a seeded random draw.
 */
export function rankGroup(members: string[], games: GameAllocs[], seed: string): StandingRow[] {
  const rows = new Map<string, StandingRow>()
  members.forEach((uid) =>
    rows.set(uid, { uid, rank: 0, points: 0, hillsWon: 0, wins: 0, ties: 0, losses: 0, played: 0 }),
  )

  for (const game of games) {
    const present = members.filter((uid) => game[uid])
    for (let i = 0; i < present.length; i += 1) {
      for (let j = i + 1; j < present.length; j += 1) {
        const a = rows.get(present[i])!
        const b = rows.get(present[j])!
        const result = playMatch(game[a.uid], game[b.uid])
        a.played += 1
        b.played += 1
        a.hillsWon += result.aHills
        b.hillsWon += result.bHills
        a.points += result.aPoints
        b.points += 1 - result.aPoints
        if (result.aPoints === 1) {
          a.wins += 1
          b.losses += 1
        } else if (result.aPoints === 0) {
          b.wins += 1
          a.losses += 1
        } else {
          a.ties += 1
          b.ties += 1
        }
      }
    }
  }

  const sorted = [...rows.values()].sort(
    (a, b) => b.points - a.points || b.hillsWon - a.hillsWon,
  )

  const ordered: StandingRow[] = []
  let start = 0
  while (start < sorted.length) {
    let end = start + 1
    while (
      end < sorted.length &&
      sorted[end].points === sorted[start].points &&
      sorted[end].hillsWon === sorted[start].hillsWon
    ) {
      end += 1
    }
    ordered.push(...breakTie(sorted.slice(start, end), games, seed))
    start = end
  }
  ordered.forEach((row, index) => {
    row.rank = index + 1
  })
  return ordered
}

function breakTie(tied: StandingRow[], games: GameAllocs[], seed: string): StandingRow[] {
  if (tied.length < 2) return tied
  const h2h = new Map<string, number>(tied.map((row) => [row.uid, 0]))
  for (const game of games) {
    for (let i = 0; i < tied.length; i += 1) {
      for (let j = i + 1; j < tied.length; j += 1) {
        const a = game[tied[i].uid]
        const b = game[tied[j].uid]
        if (!a || !b) continue
        const { aPoints } = playMatch(a, b)
        h2h.set(tied[i].uid, h2h.get(tied[i].uid)! + aPoints)
        h2h.set(tied[j].uid, h2h.get(tied[j].uid)! + 1 - aPoints)
      }
    }
  }
  return [...tied].sort(
    (a, b) =>
      h2h.get(b.uid)! - h2h.get(a.uid)! ||
      hashString(`${seed}:${a.uid}`) - hashString(`${seed}:${b.uid}`),
  )
}

// ---------------------------------------------------------------------------
// Bracket matches (best of 3, tied games replayed)

export type BracketGame = { hills: Record<string, number>; winner: string | null }
export type MatchState = {
  players: string[]
  wins: Record<string, number>
  games: BracketGame[]
  winner: string | null
}

export function matchState(players: string[], games: GameAllocs[]): MatchState {
  const [a, b] = players
  const wins: Record<string, number> = { [a]: 0, [b]: 0 }
  const played: BracketGame[] = []
  let winner: string | null = null
  for (const game of games) {
    if (winner || !game[a] || !game[b]) continue
    const result = playMatch(game[a], game[b])
    const gameWinner = result.aPoints === 1 ? a : result.aPoints === 0 ? b : null
    if (gameWinner) wins[gameWinner] += 1
    played.push({ hills: { [a]: result.aHills, [b]: result.bHills }, winner: gameWinner })
    if (gameWinner && wins[gameWinner] >= WINS_NEEDED) winner = gameWinner
  }
  return { players, wins, games: played, winner }
}

// ---------------------------------------------------------------------------
// Stage flow

export type StageInfo = {
  kind: StageKind
  groups: Groups
  advancePerGroup: number
  seed: string
}

export function stageComplete(stage: StageInfo, games: GameAllocs[]): boolean {
  if (stage.kind === 'groups') return games.length >= GAMES_PER_STAGE
  return Object.values(stage.groups).every((pair) => matchState(pair, games).winner)
}

/** uid -> group id for everyone who plays the next game of this stage. */
export function nextParticipants(stage: StageInfo, games: GameAllocs[]): Record<string, string> {
  const participants: Record<string, string> = {}
  for (const [groupId, members] of Object.entries(stage.groups)) {
    if (stage.kind === 'bracket' && matchState(members, games).winner) continue
    members.forEach((uid) => {
      participants[uid] = groupId
    })
  }
  return participants
}

function sortedGroupIds(groups: Groups): string[] {
  return Object.keys(groups).sort((a, b) => Number(a) - Number(b))
}

/** Advancers ordered as seeds: every group's 1st, then every group's 2nd, ... */
export function stageAdvancers(stage: StageInfo, games: GameAllocs[]): string[] {
  const groupIds = sortedGroupIds(stage.groups)
  if (stage.kind === 'bracket') {
    return groupIds.map((id) => matchState(stage.groups[id], games).winner).filter(
      (uid): uid is string => Boolean(uid),
    )
  }
  const ranked = groupIds.map((id) =>
    rankGroup(stage.groups[id], games, stage.seed)
      .slice(0, stage.advancePerGroup)
      .map((row) => row.uid),
  )
  const longest = Math.max(0, ...ranked.map((list) => list.length))
  const ordered: string[] = []
  for (let place = 0; place < longest; place += 1) {
    ranked.forEach((list) => {
      if (list[place]) ordered.push(list[place])
    })
  }
  return ordered
}

/**
 * Default plan for the next stage given how many players remain. Large fields
 * play group stages down to 16, 16 play the semifinal for 4 spots, the final 4
 * play a best-of-3 bracket. Returns null when a champion is decided.
 */
export function suggestStage(players: number, stageNumber: number): StagePlan | null {
  if (players <= 1) return null
  if (players === 2) return { name: 'Championship', kind: 'bracket', groupCount: 1, advancePerGroup: 1 }
  if (players === 4) return { name: 'Finals', kind: 'bracket', groupCount: 2, advancePerGroup: 1 }
  if (players === 3) return { name: 'Playoff', kind: 'groups', groupCount: 1, advancePerGroup: 2 }
  if (players <= 16) return { name: 'Semifinal', kind: 'groups', groupCount: 1, advancePerGroup: 4 }
  const name = `Round ${stageNumber}`
  if (players >= 64) return { name, kind: 'groups', groupCount: 4, advancePerGroup: 12 }
  if (players >= 32) return { name, kind: 'groups', groupCount: 2, advancePerGroup: 8 }
  return { name, kind: 'groups', groupCount: 1, advancePerGroup: 16 }
}

/** Groups for a new stage. Brackets pair seeds 1 v N; group stages draw by seed. */
export function buildStageGroups(plan: StagePlan, orderedPlayers: string[], seed: string): Groups {
  return plan.kind === 'bracket'
    ? seedBracket(orderedPlayers)
    : drawGroups(orderedPlayers, plan.groupCount, seed)
}

export type ProjectedStage = StagePlan & { players: number; groupSizes: number[]; advancing: number }

/** The whole format, picked automatically from the number of players. */
export function projectFormat(players: number, firstStageNumber = 1): ProjectedStage[] {
  const stages: ProjectedStage[] = []
  let remaining = players
  for (let stageNumber = firstStageNumber; ; stageNumber += 1) {
    const plan = suggestStage(remaining, stageNumber)
    if (!plan) return stages
    const groupCount = plan.kind === 'bracket' ? Math.floor(remaining / 2) : Math.min(plan.groupCount, remaining)
    const groupSizes = Array.from({ length: groupCount }, (_, i) =>
      Math.floor(remaining / groupCount) + (i < remaining % groupCount ? 1 : 0),
    )
    const advancing =
      plan.kind === 'bracket'
        ? groupCount
        : groupSizes.reduce((sum, size) => sum + Math.min(plan.advancePerGroup, size), 0)
    stages.push({ ...plan, players: remaining, groupSizes, advancing })
    remaining = advancing
  }
}
