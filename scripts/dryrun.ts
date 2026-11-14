/**
 * Full tournament dry run against the LOCAL EMULATORS ONLY.
 *
 *   npm run dryrun            # 150 bots
 *   BOTS=200 npm run dryrun   # 200 bots
 *
 * Drives the real admin code (src/lib/tournamentDb.ts) through every stage to a
 * champion while N bot players submit, resubmit, leave drafts or do nothing.
 * Along the way it checks the security rules and that every auto-fill is right.
 * Games are ended early instead of waiting 90 seconds.
 *
 *   npm run bots              # rehearsal: bots join and play whenever YOU start
 *                             # games from the admin page (needs npm run emulators)
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from 'firebase/auth'
import {
  connectDatabaseEmulator,
  get,
  getDatabase,
  onValue,
  ref,
  set,
  update,
  type Database,
} from 'firebase/database'
import { app as mainApp, auth, database, usingEmulator } from '../src/lib/firebase'
import { serverNow } from '../src/hooks/useServerTime'
import * as T from '../src/lib/tournament'
import * as db from '../src/lib/tournamentDb'

if (!usingEmulator) {
  console.error('Refusing to run: set VITE_USE_EMULATOR=true (npm run dryrun does this).')
  process.exit(1)
}

const BOTS = Number(process.env.BOTS ?? process.argv[2] ?? 150)
const NAMESPACE = 'tradersatwisconsinblotto-default-rtdb'
const run = Date.now().toString(36)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let checks = 0
function check(condition: unknown, message: string) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`)
  checks += 1
}

async function denied(label: string, write: () => Promise<unknown>) {
  try {
    await write()
  } catch {
    checks += 1
    return
  }
  throw new Error(`CHECK FAILED: rules allowed ${label}`)
}

type Bot = { uid: string; name: string; app: FirebaseApp; db: Database }

async function makeBot(index: number): Promise<Bot> {
  const app = initializeApp(mainApp.options, `bot-${index}`)
  const botAuth = getAuth(app)
  connectAuthEmulator(botAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const botDb = getDatabase(app)
  connectDatabaseEmulator(botDb, '127.0.0.1', 9000)
  const cred = await createUserWithEmailAndPassword(botAuth, `bot${index}-${run}@dry.run`, 'password123')
  return { uid: cred.user.uid, name: `Bot ${index}`, app, db: botDb }
}

function randomAlloc(): T.Alloc {
  const cuts = Array.from({ length: T.HILLS - 1 }, () => Math.floor(Math.random() * (T.SOLDIERS + 1))).sort(
    (a, b) => a - b,
  )
  return [...cuts, T.SOLDIERS].map((cut, i) => cut - (i === 0 ? 0 : cuts[i - 1]))
}

type Expected = Record<string, { alloc: T.Alloc; auto: boolean }>

/** Each bot submits, resubmits, leaves only a draft, or does nothing. */
async function playBots(bots: Map<string, Bot>, gameId: string, participants: string[]): Promise<Expected> {
  const expected: Expected = {}
  await Promise.all(
    participants.map(async (uid) => {
      const bot = bots.get(uid)!
      const roll = Math.random()
      const path = (kind: string) => ref(bot.db, `${kind}/${gameId}/${uid}`)
      if (roll < 0.55) {
        const alloc = randomAlloc()
        await update(ref(bot.db), { [`submissions/${gameId}/${uid}`]: alloc, [`games/${gameId}/submitted/${uid}`]: true })
        expected[uid] = { alloc, auto: false }
      } else if (roll < 0.7) {
        await set(path('submissions'), randomAlloc())
        const final = randomAlloc()
        await set(path('submissions'), final) // resubmit overwrites
        expected[uid] = { alloc: final, auto: false }
      } else if (roll < 0.9) {
        const draft: T.Draft = Array.from({ length: T.HILLS }, () =>
          Math.random() < 0.4 ? Math.floor(Math.random() * 15) : null,
        )
        const filled: Record<string, number> = {}
        draft.forEach((v, i) => {
          if (v !== null) filled[i] = v
        })
        if (Object.keys(filled).length) await set(path('drafts'), filled)
        expected[uid] = { alloc: T.autofill(Object.keys(filled).length ? draft : null), auto: true }
      } else {
        expected[uid] = { alloc: T.autofill(null), auto: true }
      }
    }),
  )
  return expected
}

/** Rehearsal mode: bots join, then play each game you start from the admin page. */
async function botsOnly() {
  console.log(`Creating ${BOTS} bots…`)
  const bots: Bot[] = []
  for (let i = 0; i < BOTS; i += 10) {
    bots.push(...(await Promise.all(Array.from({ length: Math.min(10, BOTS - i) }, (_, k) => makeBot(i + k)))))
  }
  const status = (await get(ref(database, 'tournament/status'))).val()
  if (status && status !== 'registration') {
    console.error('Tournament already started: hard reset from the admin page first.')
    process.exit(1)
  }
  await Promise.all(bots.map((bot) => set(ref(bot.db, `players/${bot.uid}`), { name: bot.name })))
  console.log(`${BOTS} bots joined. Start the tournament from /admin; bots answer within 5-80s.`)
  console.log('To make yourself admin: sign up in the app, then in the Emulator UI (http://127.0.0.1:4000/database) add admins/<your uid> = true.')

  const seen = new Set<string>()
  onValue(ref(database, 'tournament/currentGameId'), async (snap) => {
    const gameId = snap.val() as string | null
    if (!gameId || seen.has(gameId)) return
    seen.add(gameId)
    const game = (await get(ref(database, `games/${gameId}`))).val()
    if (!game || game.status !== 'open') return
    const playing = bots.filter((bot) => game.participants?.[bot.uid])
    console.log(`Game ${game.number}: ${playing.length} bots playing`)
    for (const bot of playing) {
      setTimeout(() => {
        void playBots(new Map([[bot.uid, bot]]), gameId, [bot.uid]).catch(() => undefined)
      }, 5000 + Math.random() * 75000)
    }
  })
}

async function main() {
  if (process.env.BOTS_ONLY === 'true') return botsOnly()
  const started = Date.now()

  // Admin: the main app's auth, promoted with the emulator's owner token.
  const adminCred = await createUserWithEmailAndPassword(auth, `admin-${run}@dry.run`, 'password123')
  const adminUid = adminCred.user.uid
  const res = await fetch(`http://127.0.0.1:9000/admins/${adminUid}.json?ns=${NAMESPACE}`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer owner' },
    body: 'true',
  })
  check(res.ok, 'promote admin via emulator owner token')
  await db.hardReset(true)

  console.log(`Creating ${BOTS} bots…`)
  const bots = new Map<string, Bot>()
  for (let i = 0; i < BOTS; i += 10) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(10, BOTS - i) }, (_, k) => makeBot(i + k)),
    )
    batch.forEach((bot) => bots.set(bot.uid, bot))
  }
  await Promise.all([...bots.values()].map((bot) => set(ref(bot.db, `players/${bot.uid}`), { name: bot.name })))
  const [bot0, bot1] = [...bots.values()]

  // Rules: players can't touch tournament state or other players.
  await denied('player writing tournament', () => set(ref(bot0.db, 'tournament/status'), 'complete'))
  await denied('player writing another player', () => set(ref(bot0.db, `players/${bot1.uid}`), { name: 'x' }))
  await denied('player promoting self', () => set(ref(bot0.db, `admins/${bot0.uid}`), true))

  const lateBot = await makeBot(9999)
  const uids = [...bots.keys()]
  const plan = T.suggestStage(uids.length, 1)!
  await db.createStage(plan, uids, 0)
  await denied('joining after registration closed', () =>
    set(ref(lateBot.db, `players/${lateBot.uid}`), { name: 'Late' }),
  )

  let firstGame = true
  const eliminated = new Set<string>()
  for (;;) {
    const tournament = (await get(ref(database, 'tournament'))).val()
    if (tournament.status === 'complete') break
    const stageId: string = tournament.currentStageId
    const stageRaw = (await get(ref(database, `stages/${stageId}`))).val()
    const groups: T.Groups = {}
    Object.entries(stageRaw.groups).forEach(([g, members]) => {
      if (members) groups[g] = Object.values(members as object) as string[]
    })
    const stage: T.StageInfo = { kind: stageRaw.kind, groups, advancePerGroup: stageRaw.advancePerGroup, seed: stageRaw.seed }
    const stageUids = new Set(Object.values(groups).flat())
    uids.filter((uid) => !stageUids.has(uid)).forEach((uid) => eliminated.add(uid))
    const sizes = Object.values(groups).map((m) => m.length)
    console.log(`\n${stageRaw.name}: ${stageUids.size} players, ${stageRaw.kind}, groups [${sizes.join(', ')}]`)

    const allocs: T.GameAllocs[] = []
    let number = 0
    while (!T.stageComplete(stage, allocs)) {
      number += 1
      check(number < 30, 'stage finishes')
      const participants = T.nextParticipants(stage, allocs)
      await db.startGame(stageId, number, participants, serverNow())
      const gameId: string = (await get(ref(database, 'tournament/currentGameId'))).val()
      const playing = Object.keys(participants)
      const expected = await playBots(bots, gameId, playing)

      if (firstGame) {
        firstGame = false
        const [a, b] = playing
        const botA = bots.get(a)!
        await denied('sum of 99', () => set(ref(botA.db, `submissions/${gameId}/${a}`), [9, 10, 10, 10, 10, 10, 10, 10, 10, 10]))
        await denied('fractional soldiers', () => set(ref(botA.db, `submissions/${gameId}/${a}`), [10.5, 9.5, 10, 10, 10, 10, 10, 10, 10, 10]))
        await denied('negative soldiers', () => set(ref(botA.db, `submissions/${gameId}/${a}`), [-10, 30, 10, 10, 10, 10, 10, 10, 10, 10]))
        await denied('11 hills', () => set(ref(botA.db, `submissions/${gameId}/${a}`), [10, 10, 10, 10, 10, 10, 10, 10, 10, 5, 5]))
        await denied("writing someone else's submission", () => set(ref(botA.db, `submissions/${gameId}/${b}`), T.autofill(null)))
        await denied("reading someone else's submission", () => get(ref(botA.db, `submissions/${gameId}/${b}`)))
        await denied('reading all submissions', () => get(ref(botA.db, `submissions/${gameId}`)))
        await denied('reading drafts', () => get(ref(botA.db, `drafts/${gameId}`)))
        await denied('writing results', () => set(ref(botA.db, `results/${gameId}/${a}`), { a: T.autofill(null), auto: false }))
        check((await get(ref(botA.db, `submissions/${gameId}/${a}`))).exists() || expected[a].auto, 'player can read own submission')
      }
      const out = [...eliminated][0]
      if (out) {
        await denied('eliminated player submitting', () =>
          set(ref(bots.get(out)!.db, `submissions/${gameId}/${out}`), T.autofill(null)),
        )
      }

      await db.endGameNow(gameId, serverNow())
      await sleep(T.SUBMIT_GRACE_MS + 300)
      const late = bots.get(playing[0])!
      await denied('submitting after the deadline', () =>
        set(ref(late.db, `submissions/${gameId}/${playing[0]}`), T.autofill(null)),
      )
      check(await db.scoreGame(gameId), 'scoring locks the game')
      check(!(await db.scoreGame(gameId)), 'second scoring is refused')

      const results = (await get(ref(database, `results/${gameId}`))).val() as Record<string, { a: unknown; auto: boolean }>
      const game: T.GameAllocs = {}
      let autoCount = 0
      for (const uid of playing) {
        const got = T.readSlots(results[uid].a).map((n) => n ?? 0)
        check(T.isValidAlloc(got), `result for ${uid} is valid`)
        check(JSON.stringify(got) === JSON.stringify(expected[uid].alloc), `result for ${uid} matches (auto=${expected[uid].auto})`)
        check(results[uid].auto === expected[uid].auto, `auto flag for ${uid}`)
        if (results[uid].auto) autoCount += 1
        game[uid] = got
      }
      allocs.push(game)
      console.log(`  game ${number}: ${playing.length} played, ${autoCount} auto-filled`)
    }

    const advancers = T.stageAdvancers(stage, allocs)
    const next = T.suggestStage(advancers.length, stageRaw.index + 2)
    if (next) await db.createStage(next, advancers, stageRaw.index + 1)
    else await db.crownChampion(advancers[0])
  }

  const champion = (await get(ref(database, 'tournament/championUid'))).val()
  console.log(`\nChampion: ${bots.get(champion)?.name ?? champion}`)
  console.log(`${checks} checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
