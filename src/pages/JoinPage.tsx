import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { onValue, ref } from 'firebase/database'
import { RegisterForm } from '../components/RegisterForm'
import { database } from '../lib/firebase'
import '../components/tournament.css'
import './AuthPage.css'

/** Signed-out landing page: join as a player, or follow along once registration closes. */
export function JoinPage() {
  const [status, setStatus] = useState<string | null | undefined>(undefined)
  useEffect(
    () =>
      onValue(
        ref(database, 'tournament/status'),
        (snap) => setStatus(snap.val()),
        () => setStatus(null),
      ),
    [],
  )
  const closed = status === 'running' || status === 'complete'

  return (
    <div className="auth-page">
      {closed ? (
        <main className="auth-shell">
          <header className="auth-brand">
            <p className="auth-brand-mark">Blotto</p>
            <h1>Registration is closed</h1>
            <p className="auth-subtitle">The tournament has started. Follow along live.</p>
          </header>
          <Link className="primary-btn" to="/board">
            Watch the leaderboard
          </Link>
          <footer className="auth-footer">
            <p>
              <Link to="/organizer">Organizer sign in</Link>
            </p>
          </footer>
        </main>
      ) : (
        <main>
          <RegisterForm />
        </main>
      )}
    </div>
  )
}
