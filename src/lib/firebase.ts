import { initializeApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth'
import { connectDatabaseEmulator, getDatabase } from 'firebase/database'

const firebaseConfig = {
  apiKey: 'AIzaSyCRE7yQEmJLUS0hUCzwiEgOGpl6iy_L8Mo',
  authDomain: 'tradersatwisconsinblotto.firebaseapp.com',
  databaseURL: 'https://tradersatwisconsinblotto-default-rtdb.firebaseio.com',
  projectId: 'tradersatwisconsinblotto',
  storageBucket: 'tradersatwisconsinblotto.firebasestorage.app',
  messagingSenderId: '453896967786',
  appId: '1:453896967786:web:7209ceb9e8e863f146dc13',
  measurementId: 'G-2FC5ZCS29J',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const database = getDatabase(app)
export const googleProvider = new GoogleAuthProvider()

googleProvider.setCustomParameters({ prompt: 'select_account' })

/** `VITE_USE_EMULATOR=true npm run dev` runs against the local emulators (dry runs). */
const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env
export const usingEmulator =
  (import.meta.env?.VITE_USE_EMULATOR ?? nodeEnv?.VITE_USE_EMULATOR) === 'true'
if (usingEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectDatabaseEmulator(database, '127.0.0.1', 9000)
}

if (!usingEmulator) {
  void isSupported().then((supported) => {
    if (supported) getAnalytics(app)
  })
}
