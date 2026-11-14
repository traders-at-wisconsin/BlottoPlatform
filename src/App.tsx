import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { LoadingScreen } from './components/LoadingScreen'
import { AuthPage } from './pages/AuthPage'
import { BoardPage } from './pages/BoardPage'
import { HomePage } from './pages/HomePage'
import { NamePage } from './pages/NamePage'
import { AdminPage } from './pages/AdminPage'

function ProtectedRoutes() {
  const { user, loading, needsDisplayName } = useAuth()

  if (loading) return <LoadingScreen />
  if (!user) return <AuthPage />
  if (needsDisplayName) return <NamePage />

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
              <ProtectedRoutes />
            </AuthProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
