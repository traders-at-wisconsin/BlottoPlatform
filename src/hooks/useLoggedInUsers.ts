import { useEffect, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { database } from '../lib/firebase'

export type LoggedInUser = {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  signedInAt: number | null
}

export function useLoggedInUsers(enabled: boolean) {
  const [users, setUsers] = useState<LoggedInUser[]>([])
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) {
      setUsers([])
      setLoading(false)
      return
    }

    setLoading(true)
    const loggedInRef = ref(database, 'loggedInUsers')

    return onValue(
      loggedInRef,
      (snapshot) => {
        const value = snapshot.val() as Record<
          string,
          Omit<LoggedInUser, 'uid'> & { uid?: string }
        > | null

        if (!value) {
          setUsers([])
          setLoading(false)
          return
        }

        const next = Object.entries(value).map(([uid, data]) => ({
          uid,
          email: data.email ?? null,
          displayName: data.displayName ?? null,
          photoURL: data.photoURL ?? null,
          signedInAt:
            typeof data.signedInAt === 'number' ? data.signedInAt : null,
        }))

        next.sort((a, b) => {
          const nameA = (a.displayName || a.email || a.uid).toLowerCase()
          const nameB = (b.displayName || b.email || b.uid).toLowerCase()
          return nameA.localeCompare(nameB)
        })

        setUsers(next)
        setLoading(false)
      },
      () => {
        setUsers([])
        setLoading(false)
      },
    )
  }, [enabled])

  return { users, loading }
}
