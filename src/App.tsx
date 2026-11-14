import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { LoadingScreen } from './components/LoadingScreen'
import { AuthPage } from './pages/AuthPage'
import { BoardPage } from './pages/BoardPage'
import { HomePage } from './pages/HomePage'
import { JoinPage } from './pages/JoinPage'
import { AdminPage } from './pages/AdminPage'

function OrganizerRoute() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (user && !user.isAnonymous) return <Navigate to="/admin" replace />
  return <AuthPage />
}

function ProtectedRoutes() {
  const { user, loading, joining } = useAuth()

  if (loading) return <LoadingScreen />
  // Stay on the join form until an anonymous player's registration finishes.
  if (!user || joining) return <JoinPage />

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public leaderboard: no sign-in, works on any device. */}
        <Route path="/board" element={<BoardPage />} />
        <Route
          path="*"
          element={
            <AuthProvider>
              <Routes>
                <Route path="/organizer" element={<OrganizerRoute />} />
                <Route path="*" element={<ProtectedRoutes />} />
              </Routes>
            </AuthProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
