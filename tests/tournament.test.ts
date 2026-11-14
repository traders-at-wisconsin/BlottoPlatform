import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  autofill,
  drawGroups,
  isValidAlloc,
  matchState,
  nextParticipants,
  playMatch,
  rankGroup,
  readSlots,
  stageAdvancers,
  stageComplete,
  suggestStage,
  type GameAllocs,
} from '../src/lib/tournament.ts'

const even = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]

test('validates allocations: 10 whole numbers summing to exactly 100', () => {
  assert.ok(isValidAlloc(even))
  assert.ok(!isValidAlloc([...even.slice(0, 9), 9]))
  assert.ok(!isValidAlloc([10.5, 9.5, 10, 10, 10, 10, 10, 10, 10, 10]))
  assert.ok(!isValidAlloc([-10, 30, 10, 10, 10, 10, 10, 10, 10, 10]))
  assert.ok(!isValidAlloc(even.slice(0, 9)))
})

test('plays a match on equal-value hills', () => {
  const a = [20, 20, 20, 20, 20, 0, 0, 0, 0, 0]
  const b = [0, 0, 0, 0, 0, 20, 20, 20, 20, 20]
  assert.deepEqual(playMatch(a, b), { aHills: 5, bHills: 5, aPoints: 0.5 })
  assert.deepEqual(playMatch(even, even), { aHills: 0, bHills: 0, aPoints: 0.5 })
  const c = [11, 11, 11, 11, 11, 11, 11, 11, 12, 0]
  assert.equal(playMatch(c, even).aPoints, 1)
  assert.equal(playMatch(c, even).aHills, 9)
})

test('autofill keeps filled hills and splits the rest evenly over blanks', () => {
  assert.deepEqual(autofill(null), even)
  assert.deepEqual(autofill([50, null, null, null, null, null, null, null, null, 0]), [
    50, 7, 7, 6, 6, 6, 6, 6, 6, 0,
  ])
  const result = autofill([30, 30, null, null, null, null, null, null, null, null])
  assert.deepEqual(result, [30, 30, 5, 5, 5, 5, 5, 5, 5, 5])
  // every hill filled but under 100: rest spread across all hills
  assert.ok(isValidAlloc(autofill([5, 5, 5, 5, 5, 5, 5, 5, 5, 5])))
  // overfilled draft is unusable: even split
  assert.deepEqual(autofill([90, 90, null, null, null, null, null, null, null, null]), even)
  for (let i = 0; i < 200; i += 1) {
    const draft = Array.from({ length: 10 }, () =>
      Math.random() < 0.5 ? null : Math.floor(Math.random() * 20),
    )
    assert.ok(isValidAlloc(autofill(draft)), JSON.stringify(draft))
  }
})

test('readSlots handles arrays, sparse arrays and objects', () => {
  assert.deepEqual(readSlots({ 3: 20, 0: 0 }), [0, null, null, 20, null, null, null, null, null, null])
  // eslint-disable-next-line no-sparse-arrays
  assert.deepEqual(readSlots([5, , 3]), [5, null, 3, null, null, null, null, null, null, null])
})

test('ranks by points, then hills won, then head-to-head, then seed', () => {
  const strong = [12, 12, 12, 12, 12, 12, 12, 12, 4, 0]
  const game: GameAllocs = { a: strong, b: even, c: even }
  const rows = rankGroup(['a', 'b', 'c'], [game], 'seed')
  assert.equal(rows[0].uid, 'a')
  assert.equal(rows[0].points, 2)
  assert.equal(rows[0].played, 2)
  // b and c are fully tied: deterministic seeded order
  const again = rankGroup(['c', 'b', 'a'], [game], 'seed')
  assert.deepEqual(rows.map((r) => r.uid), again.map((r) => r.uid))
})

test('bracket: best of 3 with tied games replayed', () => {
  const win = [11, 11, 11, 11, 11, 11, 11, 11, 12, 0]
  const tie: GameAllocs = { x: even, y: even }
  const xWins: GameAllocs = { x: win, y: even }
  let state = matchState(['x', 'y'], [xWins, tie])
  assert.equal(state.winner, null)
  assert.equal(state.wins.x, 1)
  state = matchState(['x', 'y'], [xWins, tie, xWins])
  assert.equal(state.winner, 'x')
  const stage = { kind: 'bracket' as const, groups: { 1: ['x', 'y'], 2: ['p', 'q'] }, advancePerGroup: 1, seed: 's' }
  const games = [{ ...xWins, p: win, q: even }, { ...xWins, p: even, q: even }]
  assert.ok(!stageComplete(stage, games))
  assert.deepEqual(nextParticipants(stage, games), { p: '2', q: '2' })
})

test('full format reaches 16, then 4, then a champion', () => {
  for (const field of [150, 173, 200]) {
    const uids = Array.from({ length: field }, (_, i) => `p${i}`)
    let plan = suggestStage(uids.length, 1)!
    assert.equal(plan.groupCount, 4)
    let remaining = uids
    let stageNumber = 1
    const names: string[] = []
    while (plan) {
      names.push(plan.name)
      const groups =
        plan.kind === 'bracket'
          ? Object.fromEntries(
              Array.from({ length: remaining.length / 2 }, (_, i) => [
                String(i + 1),
                [remaining[i], remaining[remaining.length - 1 - i]],
              ]),
            )
          : drawGroups(remaining, plan.groupCount, `s${stageNumber}`)
      const stage = { kind: plan.kind, groups, advancePerGroup: plan.advancePerGroup, seed: 's' }
      const games: GameAllocs[] = []
      while (!stageComplete(stage, games)) {
        const game: GameAllocs = {}
        for (const uid of Object.keys(nextParticipants(stage, games))) {
          game[uid] = autofill(Array.from({ length: 10 }, () => (Math.random() < 0.3 ? Math.floor(Math.random() * 25) : null)))
        }
        games.push(game)
        assert.ok(games.length < 50)
      }
      remaining = stageAdvancers(stage, games)
      stageNumber += 1
      plan = suggestStage(remaining.length, stageNumber)!
    }
    assert.equal(remaining.length, 1)
    assert.deepEqual(names, ['Round 1', 'Round 2', 'Semifinal', 'Finals', 'Championship'])
  }
})
