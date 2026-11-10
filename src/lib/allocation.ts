import { onValue, ref, set } from 'firebase/database'
import { database } from './firebase'

export const ALLOCATION_SLOTS = 10
export const ALLOCATION_MAX_TOTAL = 100

export type Allocation = Record<string, number>

export function emptyAllocation(): Allocation {
  const values: Allocation = {}
  for (let i = 1; i <= ALLOCATION_SLOTS; i += 1) {
    values[String(i)] = 0
  }
  return values
}

export function normalizeAllocation(raw: unknown): Allocation {
  const values = emptyAllocation()
  if (!raw || typeof raw !== 'object') return values

  const record = raw as Record<string, unknown>
  for (let i = 1; i <= ALLOCATION_SLOTS; i += 1) {
    const key = String(i)
    const value = record[key]
    const num = typeof value === 'number' ? value : Number(value)
    values[key] = Number.isFinite(num) && num >= 0 ? num : 0
  }
  return values
}

export function sumAllocation(allocation: Allocation): number {
  return Object.values(allocation).reduce((total, value) => total + value, 0)
}

export function findUserGroup(
  groups: Record<string, Array<{ uid: string }>>,
  uid: string,
): string | null {
  for (const [groupId, members] of Object.entries(groups)) {
    if (members.some((member) => member.uid === uid)) {
      return groupId
    }
  }
  return null
}

/** rounds/{roundId}/groups/{groupId}/{uid}/allocation */
export function allocationPath(
  roundId: string,
  groupId: string,
  uid: string,
) {
  return `rounds/${roundId}/groups/${groupId}/${uid}/allocation`
}

function mapWriteError(error: unknown): string {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : ''

  if (code === 'PERMISSION_DENIED') {
    return 'Permission denied writing allocation. Check RTDB rules for groups/{group}/{uid}/allocation.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Failed to submit allocation.'
}

export async function submitAllocation(
  roundId: string,
  groupId: string,
  uid: string,
  allocation: Allocation,
): Promise<void> {
  const total = sumAllocation(allocation)
  if (total > ALLOCATION_MAX_TOTAL) {
    throw new Error(
      `Allocations cannot sum to more than ${ALLOCATION_MAX_TOTAL}.`,
    )
  }

  for (let i = 1; i <= ALLOCATION_SLOTS; i += 1) {
    const value = allocation[String(i)]
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('Each slot must be a number of 0 or more.')
    }
  }

  try {
    await set(ref(database, allocationPath(roundId, groupId, uid)), allocation)
  } catch (error) {
    throw new Error(mapWriteError(error))
  }
}

export function watchAllocation(
  roundId: string,
  groupId: string,
  uid: string,
  onChange: (allocation: Allocation | null) => void,
) {
  const allocationRef = ref(database, allocationPath(roundId, groupId, uid))
  return onValue(
    allocationRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onChange(null)
        return
      }
      onChange(normalizeAllocation(snapshot.val()))
    },
    () => onChange(null),
  )
}
