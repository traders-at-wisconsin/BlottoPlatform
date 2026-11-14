import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { GoogleIcon } from '../components/GoogleIcon'
import { useAuth } from '../contexts/AuthContext'
import './AuthPage.css'

type Mode = 'signin' | 'signup' | 'reset'

export function AuthPage() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword } =
    useAuth()

  const [mode, setMode] = useState<Mode>('signin')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
    setInfo('')
    setPassword('')
    setConfirmPassword('')
  }

  async function handleGoogle() {
    setError('')
    setInfo('')
    setGoogleLoading(true)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
    } finally {
      setGoogleLoading(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setInfo('')

    if (!email.trim()) {
      setError('Enter your email address.')
      return
    }

    if (mode === 'reset') {
      setSubmitting(true)
      try {
        await resetPassword(email)
        setInfo('Password reset email sent. Check your inbox.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Reset failed.')
      } finally {
        setSubmitting(false)
      }
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    if (mode === 'signup') {
      if (!displayName.trim()) {
        setError('Enter your name.')
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }
    }

    setSubmitting(true)
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password)
      } else {
        await signUpWithEmail(email, password, displayName)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const title =
    mode === 'signin'
      ? 'Organizer sign in'
      : mode === 'signup'
        ? 'Create account'
        : 'Reset password'

  const subtitle =
    mode === 'signin'
      ? null
      : mode === 'signup'
        ? 'Join Blotto and allocate your forces.'
        : 'We’ll email you a link to reset your password.'

  return (
    <div className="auth-page">
      <main className="auth-shell">
        <header className="auth-brand">
          <p className="auth-brand-mark">Blotto</p>
          <h1>{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        </header>

        {mode !== 'reset' && (
          <>
            <button
              type="button"
              className="google-btn"
              onClick={handleGoogle}
              disabled={googleLoading || submitting}
            >
              <GoogleIcon />
              {googleLoading ? 'Connecting…' : 'Continue with Google'}
            </button>

            <div className="auth-divider" role="separator">
              <span>or</span>
            </div>
          </>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {mode === 'signup' && (
            <label className="field">
              <span>Name</span>
              <input
                type="text"
                name="name"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="The name players will see"
                disabled={submitting}
                required
                autoFocus
              />
            </label>
          )}

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@wisc.edu"
              disabled={submitting}
              required
            />
          </label>

          {mode !== 'reset' && (
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                name="password"
                autoComplete={
                  mode === 'signin' ? 'current-password' : 'new-password'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                disabled={submitting}
                required
              />
            </label>
          )}

          {mode === 'signup' && (
            <label className="field">
              <span>Confirm password</span>
              <input
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                disabled={submitting}
                required
              />
            </label>
          )}

          {error && (
            <p className="auth-message auth-error" role="alert">
              {error}
            </p>
          )}
          {info && (
            <p className="auth-message auth-info" role="status">
              {info}
            </p>
          )}

          <button
            type="submit"
            className="primary-btn"
            disabled={submitting || googleLoading}
          >
            {submitting
              ? 'Please wait…'
              : mode === 'signin'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : 'Send reset link'}
          </button>
        </form>

        <footer className="auth-footer">
          {mode === 'signin' && (
            <>
              <button
                type="button"
                className="link-btn"
                onClick={() => switchMode('reset')}
              >
                Forgot password?
              </button>
              <p>
                Playing? <Link to="/">Join as a player</Link>
              </p>
            </>
          )}
          {mode === 'signup' && (
            <p>
              Already have an account?{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => switchMode('signin')}
              >
                Sign in
              </button>
            </p>
          )}
          {mode === 'reset' && (
            <p>
              Remembered it?{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => switchMode('signin')}
              >
                Back to sign in
              </button>
            </p>
          )}
        </footer>
      </main>
    </div>
  )
}
