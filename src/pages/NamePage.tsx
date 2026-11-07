import { useState, type FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import './AuthPage.css'

export function NamePage() {
  const { saveDisplayName } = useAuth()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Enter your name.')
      return
    }

    setSubmitting(true)
    try {
      await saveDisplayName(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your name.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <main className="auth-shell">
        <header className="auth-brand">
          <p className="auth-brand-mark">Blotto</p>
          <h1>What’s your name?</h1>
          <p className="auth-subtitle">
            This is the name other players see in groups and rounds.
          </p>
        </header>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Badger Trader"
              disabled={submitting}
              required
              autoFocus
            />
          </label>

          {error && (
            <p className="auth-message auth-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="primary-btn" disabled={submitting}>
            {submitting ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </main>
    </div>
  )
}
