import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './AppHeader.css'

type HeaderBarProps = {
  isAdmin: boolean
  onSignOut: () => void
}

export function HeaderBar({ isAdmin, onSignOut }: HeaderBarProps) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <header className="app-header">
      <Link to="/" className="app-brand">
        <span className="brand-mark" aria-hidden="true">◆</span>BLOTTO
        <span className="brand-sub">traders@wisconsin</span>
      </Link>

      <div className="app-header-menu" ref={rootRef}>
        <button
          type="button"
          className={`menu-button${open ? ' is-open' : ''}`}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="menu-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>

        {open && (
          <div className="header-menu" id={menuId} role="menu">
            {isAdmin && (
              <Link
                to="/admin"
                className="header-menu-item"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                Admin
              </Link>
            )}
            <button
              type="button"
              className="header-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onSignOut()
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

export function AppHeader() {
  const { isAdmin, logOut } = useAuth()
  return <HeaderBar isAdmin={isAdmin} onSignOut={() => void logOut()} />
}
