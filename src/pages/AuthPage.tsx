import { useState, type FormEvent } from 'react'
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
      ? 'Sign in'
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
                No account?{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => switchMode('signup')}
                >
                  Sign up
                </button>
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

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  )
}
