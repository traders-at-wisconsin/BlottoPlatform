import { get, push, ref, serverTimestamp, update } from 'firebase/database'
import type { Allocation } from './allocation'
import { database } from './firebase'
import {
  coerceGroupMap,
  includeLoggedInPlayers,
} from './groupMembership'
import { isGameVariantId, type GameVariantId } from './variants'

export type RoundMember = {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  hasAllocation: boolean
  allocation: Allocation | null
}

export type RoundGroupMap = Record<
  string,
  Record<
    string,
    {
      displayName: string | null
    }
  >
>

export type RoundRecord = {
  createdAt: object | number
  groupingSetId: string
  variant: GameVariantId
  groupCount: number
  status: 'created' | 'scored'
  groups: RoundGroupMap
}

/** Shuffle, then deal round-robin so group sizes differ by at most 1. */
export function allocateUsersToGroups<T>(
  users: T[],
  groupCount: number,
): T[][] {
  if (groupCount < 1) {
    throw new Error('Group count must be at least 1.')
  }

  const shuffled = [...users]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = temp
  }

  const groups: T[][] = Array.from({ length: groupCount }, () => [])
  shuffled.forEach((user, index) => {
    groups[index % groupCount].push(user)
  })

  return groups
}

export async function createRound(
  groupingSetId: string,
  variant: GameVariantId,
): Promise<string> {
  if (!isGameVariantId(variant)) {
    throw new Error('Choose a valid game variant.')
  }

  const activeRoundId = (await get(ref(database, 'roundActive'))).val()
  if (typeof activeRoundId === 'string' && activeRoundId.length > 0) {
    const activeRoundSnap = await get(ref(database, `rounds/${activeRoundId}`))
    const status = activeRoundSnap.val()?.status
    if (status !== 'scored' && activeRoundSnap.exists()) {
      throw new Error(
        'End and score the current active round before creating a new one.',
      )
    }
  }

  const groupingSnap = await get(ref(database, `groupingSets/${groupingSetId}`))
  if (!groupingSnap.exists()) {
    throw new Error('Active grouping set not found.')
  }

  const grouping = groupingSnap.val() as {
    groupCount?: number
    groups?: unknown
  }

  const existingGroups = coerceGroupMap(grouping.groups)
  if (Object.keys(existingGroups).length === 0) {
    throw new Error('Grouping set has no groups.')
  }

  const loggedInSnap = await get(ref(database, 'loggedInUsers'))
  const loggedIn =
    (loggedInSnap.val() as Record<
      string,
      { displayName?: unknown } | null
    > | null) ?? {}
  const groups = includeLoggedInPlayers(existingGroups, loggedIn)

  const newRoundRef = push(ref(database, 'rounds'))
  const roundId = newRoundRef.key
  if (!roundId) {
    throw new Error('Could not create round id.')
  }

  const round: RoundRecord = {
    createdAt: serverTimestamp(),
    groupingSetId,
    variant,
    groupCount: grouping.groupCount ?? Object.keys(groups).length,
    status: 'created',
    groups,
  }

  await update(ref(database), {
    [`rounds/${roundId}`]: round,
    roundActive: roundId,
    [`groupingSets/${groupingSetId}/groups`]: groups,
  })

  return roundId
}
