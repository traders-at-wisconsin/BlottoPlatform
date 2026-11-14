import { useEffect, useRef, useState, type FormEvent } from 'react'
import { get, ref } from 'firebase/database'
import { database } from '../lib/firebase'
import { useServerNow } from '../hooks/useServerTime'
import { saveDraft, submitAllocation } from '../lib/tournamentDb'
import {
  autofill,
  draftTotal,
  HILLS,
  isValidAlloc,
  readSlots,
  SOLDIERS,
  type Draft,
} from '../lib/tournament'
import { Countdown } from './Countdown'
import './GameEntryForm.css'

type GameEntryFormProps = {
  gameId: string
  uid: string
  endsAt: number
  eyebrow: string
  opponentsLabel: string
}

const emptyDraft = (): Draft => Array.from({ length: HILLS }, () => null)

function sameSlots(a: Draft, b: Draft | null) {
  return Boolean(b) && a.every((value, i) => (value ?? 0) === (b![i] ?? 0))
}

export function GameEntryForm({ gameId, uid, endsAt, eyebrow, opponentsLabel }: GameEntryFormProps) {
  const [values, setValues] = useState<Draft>(emptyDraft)
  const [submittedSlots, setSubmittedSlots] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const touched = useRef(false)
  const now = useServerNow(250)
  const timeUp = now >= endsAt

  // Restore a saved submission (or draft) after a refresh.
  useEffect(() => {
    let cancelled = false
    touched.current = false
    setLoading(true)
    Promise.all([
      get(ref(database, `submissions/${gameId}/${uid}`)),
      get(ref(database, `drafts/${gameId}/${uid}`)),
    ])
      .then(([sub, draft]) => {
        if (cancelled) return
        if (sub.exists()) {
          const slots = readSlots(sub.val())
          setSubmittedSlots(slots)
          setValues(slots)
        } else {
          setSubmittedSlots(null)
          setValues(draft.exists() ? readSlots(draft.val()) : emptyDraft())
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [gameId, uid])

  // Autosave the draft so an unsubmitted entry keeps the hills filled in.
  useEffect(() => {
    if (!touched.current || timeUp) return
    const id = window.setTimeout(() => {
      void saveDraft(gameId, uid, values).catch(() => undefined)
    }, 400)
    return () => window.clearTimeout(id)
  }, [values, gameId, uid, timeUp])

  const total = draftTotal(values)
  const remaining = SOLDIERS - total
  const filled = values.map((v) => v ?? 0)
  const valid = isValidAlloc(filled)
  const isSubmitted = submittedSlots !== null
  const unchanged = isSubmitted && sameSlots(values, submittedSlots)
  const fallback = autofill(values)

  function updateSlot(hill: number, raw: string) {
    setError('')
    touched.current = true
    const cleaned = raw.replace(/[^0-9]/g, '')
    setValues((prev) => {
      const next = [...prev]
      next[hill] = cleaned === '' ? null : Math.min(Number(cleaned), 999)
      return next
    })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid) {
      setError(`Your hills must add up to exactly ${SOLDIERS}.`)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await submitAllocation(gameId, uid, filled)
      setSubmittedSlots([...values])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="allocation-status">Loading…</p>

  let status: string
  if (timeUp) {
    status = isSubmitted
      ? 'Time’s up. Your submission is locked in.'
      : 'Time’s up. Your entry will be auto-filled from what you entered.'
  } else if (unchanged) {
    status = 'Submitted ✓ You can still edit and resubmit until time runs out.'
  } else if (isSubmitted) {
    status = 'You have unsaved changes. Press Update or your earlier submission counts.'
  } else {
    status = 'Not submitted yet. If time runs out, blank hills share your remaining soldiers evenly.'
  }

  return (
    <form className="allocation-form" onSubmit={handleSubmit}>
      <header className="allocation-header">
        <div>
          <p className="allocation-eyebrow">{eyebrow}</p>
          <h1>Allocate forces</h1>
          <p className="allocation-sub">{opponentsLabel}</p>
        </div>
        <Countdown endsAt={endsAt} />
      </header>

      <div className={`allocation-total-bar${total > SOLDIERS ? ' is-over' : valid ? ' is-ok' : ''}`}>
        <span>
          <strong>{total}</strong> / {SOLDIERS}
        </span>
        <span>
          {remaining > 0 ? `${remaining} left` : remaining < 0 ? `${-remaining} over` : 'Ready'}
        </span>
      </div>

      <div className="allocation-grid">
        {values.map((value, hill) => (
          <label key={hill} className="allocation-slot">
            <span>Hill {hill + 1}</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={value ?? ''}
              placeholder={timeUp || isSubmitted ? '0' : String(fallback[hill])}
              onChange={(e) => updateSlot(hill, e.target.value)}
              disabled={timeUp || submitting}
              aria-label={`Hill ${hill + 1}`}
            />
          </label>
        ))}
      </div>

      <p className={`allocation-message${unchanged || (timeUp && isSubmitted) ? ' is-ok' : ''}`} role="status">
        {status}
      </p>
      {!timeUp && !isSubmitted && (
        <p className="allocation-hint">Grey numbers show what you’d get if time ran out now.</p>
      )}
      {error && (
        <p className="allocation-message is-error" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="allocation-submit"
        disabled={timeUp || submitting || !valid || unchanged}
      >
        {submitting ? 'Submitting…' : isSubmitted ? 'Update submission' : 'Submit'}
      </button>
    </form>
  )
}
