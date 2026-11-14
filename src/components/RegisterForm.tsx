import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { normalizeEmail, registerPlayer, WISC_EMAIL } from '../lib/tournamentDb'
import { GoogleIcon } from './GoogleIcon'
import '../pages/AuthPage.css'

function splitName(name: string | null | undefined): [string, string] {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ['', '']
  if (parts.length === 1) return [parts[0], '']
  return [parts.slice(0, -1).join(' '), parts[parts.length - 1]]
}

/**
 * Player sign-up: first + last name and a wisc.edu email, or Google.
 * Used signed-out (creates an anonymous session) and signed-in-but-unregistered
 * (e.g. right after Google sign-in, or to retry with a different email).
 */
export function RegisterForm() {
  const { user, signInWithGoogle, joinAnonymously } = useAuth()
  const isGoogle = Boolean(user?.providerData.some((p) => p.providerId === 'google.com'))
  const [defaultFirst, defaultLast] = splitName(user?.displayName)
  const [first, setFirst] = useState(defaultFirst)
  const [last, setLast] = useState(defaultLast)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!first.trim() || !last.trim()) {
      setError('Enter your first and last name.')
      return
    }
    const finalEmail = isGoogle ? normalizeEmail(user?.email ?? '') : normalizeEmail(email)
    if (!isGoogle && !WISC_EMAIL.test(finalEmail)) {
      setError('Use your @wisc.edu email, or continue with Google.')
      return
    }
    setSubmitting(true)
    try {
      await joinAnonymously((uid) => registerPlayer(uid, { first, last, email: finalEmail }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleGoogle() {
    setError('')
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
    }
  }

  return (
    <div className="auth-shell register-shell">
      <header className="auth-brand">
        <p className="auth-brand-mark">Blotto</p>
        <h1>Join the tournament</h1>
        <p className="auth-subtitle">
          {isGoogle ? `Signed in as ${user?.email}. ` : ''}Your name is shown on the leaderboard.
        </p>
      </header>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="register-names">
          <label className="field">
            <span>First name</span>
            <input
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              autoComplete="given-name"
              maxLength={30}
              disabled={submitting}
              autoFocus
            />
          </label>
          <label className="field">
            <span>Last name</span>
            <input
              value={last}
              onChange={(e) => setLast(e.target.value)}
              autoComplete="family-name"
              maxLength={30}
              disabled={submitting}
            />
          </label>
        </div>
        {!isGoogle && (
          <label className="field">
            <span>UW–Madison email</span>
            <input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="netid@wisc.edu"
              autoComplete="email"
              autoCapitalize="none"
              disabled={submitting}
            />
          </label>
        )}

        {error && (
          <p className="auth-message auth-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="primary-btn" disabled={submitting}>
          {submitting ? 'Joining…' : 'Join'}
        </button>
      </form>

      {!user && (
        <>
          <div className="auth-divider" role="separator">
            <span>or</span>
          </div>
          <button type="button" className="google-btn" onClick={() => void handleGoogle()} disabled={submitting}>
            <GoogleIcon />
            Continue with Google
          </button>
          <footer className="auth-footer">
            <p>
              <Link to="/organizer">Organizer sign in</Link>
            </p>
          </footer>
        </>
      )}
    </div>
  )
}
