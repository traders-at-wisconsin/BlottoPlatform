import { get, push, ref, serverTimestamp, update } from 'firebase/database'
import { database } from './firebase'
import { allocateUsersToGroups } from './rounds'

export type GroupMemberProfile = {
  displayName: string | null
}

export type GroupingSetGroups = Record<string, Record<string, GroupMemberProfile>>

export type GroupingSetRecord = {
  createdAt: object | number
  groupCount: number
  groups: GroupingSetGroups
}

export type StandingEntry = {
  uid: string
  displayName: string | null
  points: number
  matches: number
}

export async function createGroupingSet(
  members: Array<{ uid: string; displayName: string | null }>,
  groupCount: number,
): Promise<string> {
  if (members.length === 0) {
    throw new Error('Need at least one logged-in user to create groups.')
  }
  if (!Number.isInteger(groupCount) || groupCount < 1) {
    throw new Error('Enter a valid number of groups.')
  }
  if (groupCount > members.length) {
    throw new Error(
      'Number of groups cannot exceed the number of logged-in users.',
    )
  }

  const existing = (await get(ref(database, 'activeGroupingSet'))).val()
  if (typeof existing === 'string' && existing.length > 0) {
    throw new Error(
      'Groups are already set. Use Hard reset to start over.',
    )
  }

  const allocated = allocateUsersToGroups(members, groupCount)
  const groups: GroupingSetGroups = {}

  allocated.forEach((groupMembers, index) => {
    const groupId = String(index + 1)
    groups[groupId] = {}
    groupMembers.forEach((member) => {
      groups[groupId][member.uid] = {
        displayName: member.displayName,
      }
    })
  })

  const newRef = push(ref(database, 'groupingSets'))
  const groupingSetId = newRef.key
  if (!groupingSetId) {
    throw new Error('Could not create grouping set id.')
  }

  const record: GroupingSetRecord = {
    createdAt: serverTimestamp(),
    groupCount,
    groups,
  }

  await update(ref(database), {
    [`groupingSets/${groupingSetId}`]: record,
    activeGroupingSet: groupingSetId,
    roundActive: null,
  })

  return groupingSetId
}

export function findGroupInGroupingSet(
  groups: GroupingSetGroups | Record<string, Array<{ uid: string }>>,
  uid: string,
): string | null {
  for (const [groupId, members] of Object.entries(groups)) {
    if (Array.isArray(members)) {
      if (members.some((member) => member.uid === uid)) return groupId
      continue
    }
    if (members && typeof members === 'object' && uid in members) {
      return groupId
    }
  }
  return null
}
