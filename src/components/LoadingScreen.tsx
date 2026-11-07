import './LoadingScreen.css'

export function LoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <p className="loading-brand">Blotto</p>
      <p className="loading-text">Loading…</p>
    </div>
  )
}
