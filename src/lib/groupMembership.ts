export type NamedMember = {
  displayName: string | null
}

export function playerName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

/** Turn a Realtime Database group map (object or array) into group id → members. */
export function coerceGroupMap(
  raw: unknown,
): Record<string, Record<string, NamedMember>> {
  if (!raw || typeof raw !== 'object') return {}

  const groups: Record<string, Record<string, NamedMember>> = {}
  Object.entries(raw as Record<string, unknown>).forEach(([groupId, members]) => {
    if (!members || typeof members !== 'object') return
    const next: Record<string, NamedMember> = {}
    Object.entries(members as Record<string, unknown>).forEach(
      ([uid, profile]) => {
        if (!uid) return
        const name =
          profile && typeof profile === 'object' && 'displayName' in profile
            ? (profile as { displayName?: unknown }).displayName
            : null
        next[uid] = { displayName: playerName(name) }
      },
    )
    groups[groupId] = next
  })
  return groups
}

function smallestGroupId(
  groups: Record<string, Record<string, NamedMember>>,
): string | null {
  const ids = Object.keys(groups)
  if (ids.length === 0) return null
  return [...ids].sort((a, b) => {
    const size = Object.keys(groups[a]).length - Object.keys(groups[b]).length
    if (size !== 0) return size
    const numA = Number.parseInt(a, 10)
    const numB = Number.parseInt(b, 10)
    if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB
    return a.localeCompare(b)
  })[0]
}

/**
 * Keep everyone already assigned, then place any logged-in player who is
 * missing into the smallest group. Email and Google accounts are treated alike.
 */
export function includeLoggedInPlayers(
  groups: Record<string, Record<string, NamedMember>>,
  loggedIn: Record<string, { displayName?: unknown } | null | undefined>,
): Record<string, Record<string, NamedMember>> {
  const next: Record<string, Record<string, NamedMember>> = {}
  Object.entries(groups).forEach(([groupId, members]) => {
    next[groupId] = { ...members }
  })

  const placed = new Set(
    Object.values(next).flatMap((members) => Object.keys(members)),
  )

  Object.entries(loggedIn).forEach(([uid, profile]) => {
    if (!uid || placed.has(uid)) return
    const groupId = smallestGroupId(next)
    if (!groupId) return
    next[groupId][uid] = {
      displayName: playerName(profile?.displayName),
    }
    placed.add(uid)
  })

  return next
}
