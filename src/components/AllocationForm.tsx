import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ALLOCATION_MAX_TOTAL,
  ALLOCATION_SLOTS,
  emptyAllocation,
  submitAllocation,
  sumAllocation,
  watchAllocation,
  type Allocation,
} from '../lib/allocation'
import { WaitingForRoundEnd } from './WaitingForRoundEnd'
import './AllocationForm.css'

type AllocationFormProps = {
  roundId: string
  groupId: string
  uid: string
}

export function AllocationForm({
  roundId,
  groupId,
  uid,
}: AllocationFormProps) {
  const [values, setValues] = useState<Allocation>(() => emptyAllocation())
  const [submitted, setSubmitted] = useState(false)
  const [loadingExisting, setLoadingExisting] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoadingExisting(true)
    return watchAllocation(roundId, groupId, uid, (allocation) => {
      if (allocation) {
        setValues(allocation)
        setSubmitted(true)
      } else {
        setValues(emptyAllocation())
        setSubmitted(false)
      }
      setLoadingExisting(false)
    })
  }, [roundId, groupId, uid])

  const total = useMemo(() => sumAllocation(values), [values])
  const remaining = ALLOCATION_MAX_TOTAL - total
  const overBudget = total > ALLOCATION_MAX_TOTAL

  function updateSlot(slot: string, raw: string) {
    setError('')
    const parsed = raw === '' ? 0 : Number(raw)
    setValues((prev) => ({
      ...prev,
      [slot]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
    }))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')

    if (overBudget) {
      setError(`Allocations cannot sum to more than ${ALLOCATION_MAX_TOTAL}.`)
      return
    }

    setSubmitting(true)
    try {
      await submitAllocation(roundId, groupId, uid, values)
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingExisting) {
    return <p className="allocation-status">Loading allocation…</p>
  }

  if (submitted) {
    return <WaitingForRoundEnd groupId={groupId} />
  }

  return (
    <form className="allocation-form" onSubmit={handleSubmit}>
      <header className="allocation-header">
        <div>
          <p className="allocation-eyebrow">Group {groupId}</p>
          <h1>Allocate forces</h1>
        </div>
        <div className={`allocation-total${overBudget ? ' is-over' : ''}`}>
          <span>{total}</span>
          <small>/ {ALLOCATION_MAX_TOTAL}</small>
        </div>
      </header>

      <p className="allocation-copy">
        Put a number in each battlefield (1–{ALLOCATION_SLOTS}). Total cannot
        exceed {ALLOCATION_MAX_TOTAL}
        {remaining >= 0 ? ` · ${remaining} left` : ''}.
      </p>

      <div className="allocation-grid">
        {Array.from({ length: ALLOCATION_SLOTS }, (_, index) => {
          const slot = String(index + 1)
          return (
            <label key={slot} className="allocation-slot">
              <span>{slot}</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={values[slot] === 0 ? '' : values[slot]}
                placeholder="0"
                onChange={(e) => updateSlot(slot, e.target.value)}
                disabled={submitting}
              />
            </label>
          )
        })}
      </div>

      {error && (
        <p className="allocation-message is-error" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="allocation-submit"
        disabled={submitting || overBudget}
      >
        {submitting ? 'Submitting…' : 'Submit allocation'}
      </button>
    </form>
  )
}
