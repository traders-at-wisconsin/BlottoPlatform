import { useEffect } from 'react'
import {
  onDisconnect,
  onValue,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from 'firebase/database'
import type { User } from 'firebase/auth'
import { auth, database } from '../lib/firebase'
import { playerName } from '../lib/displayName'

/** Same lobby record for Google and email/password accounts. */
export function presenceRecord(user: User) {
  return {
    uid: user.uid,
    email: user.email ?? '',
    displayName: playerName(user.displayName) ?? '',
    photoURL: user.photoURL ?? '',
    signedInAt: serverTimestamp(),
  }
}

export async function writePresence(user: User) {
  await set(ref(database, `loggedInUsers/${user.uid}`), presenceRecord(user))
}

function currentAccount(user: User): User {
  return auth.currentUser?.uid === user.uid ? auth.currentUser : user
}

export function usePresence(user: User | null) {
  const uid = user?.uid ?? null

  useEffect(() => {
    if (!uid) return

    const userStatusRef = ref(database, `loggedInUsers/${uid}`)
    const connectedRef = ref(database, '.info/connected')

    const unsubscribe = onValue(connectedRef, (snapshot) => {
      if (snapshot.val() !== true) return
      const account = auth.currentUser
      if (!account || account.uid !== uid) return

      void onDisconnect(userStatusRef)
        .remove()
        .then(() => {
          const latest = auth.currentUser
          if (!latest || latest.uid !== uid) return
          return set(userStatusRef, presenceRecord(latest))
        })
    })

    return () => {
      unsubscribe()
      void remove(userStatusRef)
    }
  }, [uid])

  useEffect(() => {
    if (!user) return
    const account = currentAccount(user)
    const name = playerName(account.displayName)
    if (!name) return

    void update(ref(database, `loggedInUsers/${account.uid}`), {
      uid: account.uid,
      email: account.email ?? '',
      displayName: name,
      photoURL: account.photoURL ?? '',
    })
  }, [user, user?.displayName, user?.email, user?.photoURL])
}

export async function clearPresence(uid: string) {
  await remove(ref(database, `loggedInUsers/${uid}`))
}
