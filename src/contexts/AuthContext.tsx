import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInAnonymously,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import { onValue, ref } from 'firebase/database'
import { auth, database, googleProvider } from '../lib/firebase'
import { clearPresence, usePresence, writePresence } from '../hooks/usePresence'

type AuthContextValue = {
  user: User | null
  loading: boolean
  isAdmin: boolean
  adminLoading: boolean
  signInWithGoogle: () => Promise<void>
  /** True while an anonymous player is being signed in and registered. */
  joining: boolean
  joinAnonymously: (register: (uid: string) => Promise<void>) => Promise<void>
  signInWithEmail: (email: string, password: string) => Promise<void>
  signUpWithEmail: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<void>
  saveDisplayName: (displayName: string) => Promise<void>
  resetPassword: (email: string) => Promise<void>
  logOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function mapAuthError(error: unknown): string {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : ''

  switch (code) {
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/user-disabled':
      return 'This account has been disabled.'
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.'
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.'
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.'
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was cancelled.'
    case 'auth/popup-blocked':
      return 'Pop-up blocked. Allow pop-ups and try again.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.'
    case 'auth/missing-email':
      return 'Enter your email address.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

function uidIsAdmin(admins: unknown, uid: string): boolean {
  // RTDB: admins/{uid} = true (security rules check this exact shape)
  return Boolean(
    admins &&
      typeof admins === 'object' &&
      (admins as Record<string, unknown>)[uid] === true,
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminLoading, setAdminLoading] = useState(false)
  const [profileEpoch, setProfileEpoch] = useState(0)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setLoading(false)
      if (!nextUser) {
        setIsAdmin(false)
        setAdminLoading(false)
      }
    })
  }, [])

  usePresence(user)

  useEffect(() => {
    if (!user) return

    setAdminLoading(true)
    const adminsRef = ref(database, 'admins')

    return onValue(
      adminsRef,
      (snapshot) => {
        setIsAdmin(uidIsAdmin(snapshot.val(), user.uid))
        setAdminLoading(false)
      },
      () => {
        setIsAdmin(false)
        setAdminLoading(false)
      },
    )
  }, [user])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isAdmin,
      adminLoading,
      joining,
      async joinAnonymously(register) {
        setJoining(true)
        try {
          const credential = auth.currentUser
            ? { user: auth.currentUser }
            : await signInAnonymously(auth)
          await register(credential.user.uid)
        } catch (error) {
          const code = (error as { code?: string })?.code ?? ''
          if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
            throw new Error('Sign-up is not enabled yet. Ask an organizer.')
          }
          throw error
        } finally {
          setJoining(false)
        }
      },
      async signInWithGoogle() {
        try {
          await signInWithPopup(auth, googleProvider)
        } catch (error) {
          throw new Error(mapAuthError(error))
        }
      },
      async signInWithEmail(email, password) {
        try {
          await signInWithEmailAndPassword(auth, email.trim(), password)
        } catch (error) {
          throw new Error(mapAuthError(error))
        }
      },
      async signUpWithEmail(email, password, displayName) {
        const name = displayName.trim()
        if (!name) throw new Error('Enter your name.')
        try {
          const credential = await createUserWithEmailAndPassword(
            auth,
            email.trim(),
            password,
          )
          await updateProfile(credential.user, { displayName: name })
          await credential.user.reload()
          await writePresence(credential.user)
          setProfileEpoch((epoch) => epoch + 1)
        } catch (error) {
          throw new Error(mapAuthError(error))
        }
      },
      async saveDisplayName(displayName) {
        if (!user) throw new Error('You need to be signed in.')
        const name = displayName.trim()
        if (!name) throw new Error('Enter your name.')
        try {
          await updateProfile(user, { displayName: name })
          await user.reload()
          await writePresence(user)
          setProfileEpoch((epoch) => epoch + 1)
        } catch (error) {
          throw new Error(mapAuthError(error))
        }
      },
      async resetPassword(email) {
        try {
          await sendPasswordResetEmail(auth, email.trim())
        } catch (error) {
          throw new Error(mapAuthError(error))
        }
      },
      async logOut() {
        try {
          if (user) await clearPresence(user.uid)
          await signOut(auth)
        } catch (error) {
          throw new Error(mapAuthError(error))
        }
      },
    }),
    [user, loading, isAdmin, adminLoading, profileEpoch, joining],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
