import { ref, update } from 'firebase/database'
import { database } from './firebase'

/** Wipe game state back to scratch. Keeps auth users, admins, and loggedInUsers. */
export async function hardResetGame(): Promise<void> {
  await update(ref(database), {
    activeGroupingSet: null,
    roundActive: null,
    groupingSets: null,
    rounds: null,
  })
}
