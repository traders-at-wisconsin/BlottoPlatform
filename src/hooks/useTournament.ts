import { useEffect, useMemo, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { database } from '../lib/firebase'
import {
  readSlots,
  type Alloc,
  type GameAllocs,
  type Groups,
  type StageKind,
} from '../lib/tournament'

export type TournamentStatus = 'registration' | 'running' | 'complete'

export type TournamentRoot = {
  status: TournamentStatus
  currentStageId: string | null
  currentGameId: string | null
  championUid: string | null
}

export type StageView = {
  id: string
  index: number
  name: string
  kind: StageKind
  groupCount: number
  advancePerGroup: number
  seed: string
  groups: Groups
}

export type GameStatus = 'open' | 'scoring' | 'scored'

export type GameView = {
  id: string
  stageId: string
  number: number
  status: GameStatus
  endsAt: number
  participants: Record<string, string>
  submitted: Record<string, true>
}

export type GameResults = Record<string, { a: Alloc; auto: boolean }>

function useValue<T>(path: string, parse: (raw: unknown) => T) {
  const [state, setState] = useState<{ value: T; loaded: boolean }>(() => ({
    value: parse(null),
    loaded: false,
  }))
  useEffect(() => {
    return onValue(
      ref(database, path),
      (snapshot) => setState({ value: parse(snapshot.val()), loaded: true }),
      () => setState({ value: parse(null), loaded: true }),
    )
    // parse is a module-level function; path is the only real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
  return state
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
}

function parseTournament(raw: unknown): TournamentRoot {
  const t = asRecord(raw)
  return {
    status: t.status === 'running' || t.status === 'complete' ? t.status : 'registration',
    currentStageId: typeof t.currentStageId === 'string' ? t.currentStageId : null,
    currentGameId: typeof t.currentGameId === 'string' ? t.currentGameId : null,
    championUid: typeof t.championUid === 'string' ? t.championUid : null,
  }
}

function parsePlayers(raw: unknown): Record<string, string> {
  const players: Record<string, string> = {}
  Object.entries(asRecord(raw)).forEach(([uid, value]) => {
    const name = asRecord(value).name
    players[uid] = typeof name === 'string' && name.trim() ? name.trim() : 'Player'
  })
  return players
}

function parseGroups(raw: unknown): Groups {
  const groups: Groups = {}
  // Group ids are "1", "2", ... so RTDB may hand them back as a sparse array.
  Object.entries(asRecord(raw)).forEach(([groupId, members]) => {
    if (!members || typeof members !== 'object') return
    groups[groupId] = Object.values(asRecord(members)).filter(
      (uid): uid is string => typeof uid === 'string',
    )
  })
  return groups
}

function parseStages(raw: unknown): StageView[] {
  return Object.entries(asRecord(raw))
    .map(([id, value]) => {
      const s = asRecord(value)
      return {
        id,
        index: Number(s.index) || 0,
        name: typeof s.name === 'string' ? s.name : 'Stage',
        kind: (s.kind === 'bracket' ? 'bracket' : 'groups') as StageKind,
        groupCount: Number(s.groupCount) || 1,
        advancePerGroup: Number(s.advancePerGroup) || 1,
        seed: typeof s.seed === 'string' ? s.seed : '',
        groups: parseGroups(s.groups),
      }
    })
    .sort((a, b) => a.index - b.index)
}

function parseGames(raw: unknown): GameView[] {
  return Object.entries(asRecord(raw))
    .map(([id, value]) => {
      const g = asRecord(value)
      const status: GameStatus =
        g.status === 'scored' || g.status === 'scoring' ? g.status : 'open'
      return {
        id,
        stageId: typeof g.stageId === 'string' ? g.stageId : '',
        number: Number(g.number) || 0,
        status,
        endsAt: Number(g.endsAt) || 0,
        participants: asRecord(g.participants) as Record<string, string>,
        submitted: asRecord(g.submitted) as Record<string, true>,
      }
    })
    .sort((a, b) => a.number - b.number)
}

function parseResults(raw: unknown): GameResults {
  const results: GameResults = {}
  Object.entries(asRecord(raw)).forEach(([uid, value]) => {
    const r = asRecord(value)
    results[uid] = { a: readSlots(r.a).map((n) => n ?? 0), auto: r.auto === true }
  })
  return results
}

/** Live view of the whole tournament: the same data for players, admins and the public board. */
export function useTournament() {
  const tournament = useValue('tournament', parseTournament)
  const players = useValue('players', parsePlayers)
  const stages = useValue('stages', parseStages)
  const games = useValue('games', parseGames)

  const stage =
    stages.value.find((s) => s.id === tournament.value.currentStageId) ?? null
  const stageGames = useMemo(
    () => games.value.filter((g) => stage && g.stageId === stage.id),
    [games.value, stage],
  )
  const scoredIds = stageGames.filter((g) => g.status === 'scored').map((g) => g.id)
  const scoredKey = scoredIds.join(',')

  const [results, setResults] = useState<Record<string, GameResults>>({})
  useEffect(() => {
    const ids = scoredKey ? scoredKey.split(',') : []
    const unsubscribes = ids.map((id) =>
      onValue(ref(database, `results/${id}`), (snapshot) => {
        setResults((prev) => ({ ...prev, [id]: parseResults(snapshot.val()) }))
      }),
    )
    return () => unsubscribes.forEach((off) => off())
  }, [scoredKey])

  const scoredGames = stageGames.filter((g) => g.status === 'scored' && results[g.id])
  const scoredAllocs: GameAllocs[] = useMemo(
    () =>
      scoredGames.map((g) => {
        const allocs: GameAllocs = {}
        Object.entries(results[g.id]).forEach(([uid, r]) => {
          allocs[uid] = r.a
        })
        return allocs
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoredGames.map((g) => g.id).join(','), results],
  )

  const currentGame =
    games.value.find((g) => g.id === tournament.value.currentGameId) ?? null
  const resultsLoading = scoredIds.some((id) => !results[id])

  return {
    loading:
      !tournament.loaded || !players.loaded || !stages.loaded || !games.loaded || resultsLoading,
    tournament: tournament.value,
    players: players.value,
    stages: stages.value,
    stage,
    stageGames,
    scoredGames,
    scoredAllocs,
    results,
    currentGame,
  }
}

export type TournamentView = ReturnType<typeof useTournament>

export function nameOf(players: Record<string, string>, uid: string): string {
  return players[uid] ?? 'Player'
}
