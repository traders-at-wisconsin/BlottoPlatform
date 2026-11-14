/**
 * Realtime Database reads and writes for the tournament.
 *
 * Layout (database.rules.json enforces who can do what):
 *   tournament                    { status, currentStageId, currentGameId, championUid }
 *   players/{uid}                 { name, joinedAt }           player writes own while registration is open
 *   stages/{stageId}              { index, name, kind, groupCount, advancePerGroup, seed, groups }
 *   games/{gameId}                { stageId, number, status, startedAt, endsAt, participants, submitted }
 *   submissions/{gameId}/{uid}    final allocation              private: owner + admin
 *   drafts/{gameId}/{uid}         in-progress allocation        private: owner + admin
 *   results/{gameId}/{uid}        { a, auto }                   public once the game is scored
 */
import {
  get,
  push,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from 'firebase/database'
import { database } from './firebase'
import {
  autofill,
  buildStageGroups,
  GAME_SECONDS,
  isValidAlloc,
  newSeed,
  readSlots,
  type Alloc,
  type Draft,
  type StagePlan,
} from './tournament'

export async function joinTournament(uid: string, name: string) {
  await set(ref(database, `players/${uid}`), {
    name: name.slice(0, 40),
    joinedAt: serverTimestamp(),
  })
}

export async function removePlayer(uid: string) {
  await remove(ref(database, `players/${uid}`))
}

export async function createStage(
  plan: StagePlan,
  orderedPlayers: string[],
  index: number,
): Promise<string> {
  const seed = newSeed()
  const stageId = push(ref(database, 'stages')).key!
  await update(ref(database), {
    [`stages/${stageId}`]: {
      index,
      name: plan.name,
      kind: plan.kind,
      groupCount: plan.groupCount,
      advancePerGroup: plan.advancePerGroup,
      seed,
      groups: buildStageGroups(plan, orderedPlayers, seed),
      createdAt: serverTimestamp(),
    },
    'tournament/status': 'running',
    'tournament/currentStageId': stageId,
    'tournament/currentGameId': null,
  })
  return stageId
}

export async function crownChampion(uid: string) {
  await update(ref(database, 'tournament'), {
    status: 'complete',
    championUid: uid,
    currentGameId: null,
  })
}

export async function startGame(
  stageId: string,
  number: number,
  participants: Record<string, string>,
  serverNow: number,
) {
  const gameId = push(ref(database, 'games')).key!
  await update(ref(database), {
    [`games/${gameId}`]: {
      stageId,
      number,
      status: 'open',
      startedAt: serverTimestamp(),
      // +1s so the countdown visibly starts at the full 90.
      endsAt: serverNow + (GAME_SECONDS + 1) * 1000,
      participants,
    },
    'tournament/currentGameId': gameId,
  })
}

export async function endGameNow(gameId: string, serverNow: number) {
  await set(ref(database, `games/${gameId}/endsAt`), serverNow)
}

/**
 * Lock the game, then fill every participant's final allocation: their
 * submission if valid, otherwise their draft autofilled. Safe for two admins:
 * only the one whose transaction flips open -> scoring does the work.
 * `force` re-runs a game stuck in 'scoring' (e.g. the admin tab closed mid-way).
 */
export async function scoreGame(gameId: string, force = false): Promise<boolean> {
  const lock = await runTransaction(ref(database, `games/${gameId}/status`), (status) => {
    // The first call may see null before the server value arrives; returning
    // it unchanged makes the SDK retry with the real value.
    if (status === null) return null
    if (status === 'open' || (force && status === 'scoring')) return 'scoring'
    return undefined
  })
  if (!lock.committed || lock.snapshot.val() !== 'scoring') return false

  const [gameSnap, subsSnap, draftsSnap] = await Promise.all([
    get(ref(database, `games/${gameId}/participants`)),
    get(ref(database, `submissions/${gameId}`)),
    get(ref(database, `drafts/${gameId}`)),
  ])
  const participants = (gameSnap.val() ?? {}) as Record<string, string>
  const submissions = (subsSnap.val() ?? {}) as Record<string, unknown>
  const drafts = (draftsSnap.val() ?? {}) as Record<string, unknown>

  const results: Record<string, { a: Alloc; auto: boolean }> = {}
  for (const uid of Object.keys(participants)) {
    const submitted = submissions[uid] ? readSlots(submissions[uid]) : null
    if (submitted && isValidAlloc(submitted)) {
      results[uid] = { a: submitted as Alloc, auto: false }
    } else {
      results[uid] = { a: autofill(drafts[uid] ? readSlots(drafts[uid]) : null), auto: true }
    }
  }

  await update(ref(database), {
    [`results/${gameId}`]: results,
    [`games/${gameId}/status`]: 'scored',
    [`games/${gameId}/scoredAt`]: serverTimestamp(),
  })
  return true
}

/** Clears the tournament. Keeps sign-ins, admins and (unless asked) the player list. */
export async function hardReset(clearPlayers: boolean) {
  await update(ref(database), {
    tournament: null,
    stages: null,
    games: null,
    submissions: null,
    drafts: null,
    results: null,
    ...(clearPlayers ? { players: null } : {}),
  })
}

// ---------------------------------------------------------------------------
// Player writes during a game

export async function saveDraft(gameId: string, uid: string, draft: Draft) {
  const filled: Record<string, number> = {}
  draft.forEach((value, hill) => {
    if (value !== null) filled[String(hill)] = value
  })
  const path = `drafts/${gameId}/${uid}`
  if (Object.keys(filled).length === 0) await remove(ref(database, path))
  else await set(ref(database, path), filled)
}

export async function submitAllocation(gameId: string, uid: string, alloc: Alloc) {
  if (!isValidAlloc(alloc)) throw new Error('Use whole numbers that add up to exactly 100.')
  try {
    await update(ref(database), {
      [`submissions/${gameId}/${uid}`]: alloc,
      [`games/${gameId}/submitted/${uid}`]: true,
    })
  } catch (error) {
    const code = (error as { code?: string })?.code ?? ''
    if (code.toUpperCase().includes('PERMISSION')) {
      throw new Error('Time is up — this game is closed.')
    }
    throw error
  }
}
