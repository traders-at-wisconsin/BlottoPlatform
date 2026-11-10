import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { LoadingScreen } from './components/LoadingScreen'
import { AuthPage } from './pages/AuthPage'
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
      <AuthProvider>
        <ProtectedRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
