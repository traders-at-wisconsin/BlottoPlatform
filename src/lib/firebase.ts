import { initializeApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getDatabase } from 'firebase/database'

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

isSupported().then((supported) => {
  if (supported) getAnalytics(app)
})
