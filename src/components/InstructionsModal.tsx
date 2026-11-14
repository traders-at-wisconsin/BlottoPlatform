import { useEffect } from 'react'
import { GAME_SECONDS, GAMES_PER_STAGE, HILLS, SOLDIERS } from '../lib/tournament'

type InstructionsModalProps = {
  open: boolean
  onClose: () => void
  /** Lead with the weighted-hill rules used by the final four. */
  weighted?: boolean
}

const SEEN_KEY = 'blotto-instructions-seen'
const WEIGHTED_SEEN_KEY = 'blotto-weighted-rules-seen'

function seen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export const instructionsSeen = () => seen(SEEN_KEY)
export const weightedRulesSeen = () => seen(WEIGHTED_SEEN_KEY)

function markSeen(weighted: boolean) {
  try {
    window.localStorage.setItem(SEEN_KEY, '1')
    if (weighted) window.localStorage.setItem(WEIGHTED_SEEN_KEY, '1')
  } catch {
    // Private mode: the popup just shows again next time.
  }
}

export function InstructionsModal({ open, onClose, weighted = false }: InstructionsModalProps) {
  function close() {
    markSeen(weighted)
    onClose()
  }

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-to-play"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">Colonel Blotto</p>
        <h2 id="how-to-play">{weighted ? 'Final four: new rules' : 'How to play'}</h2>

        {weighted && (
          <div className="weighted-rules">
            <h3>Weighted hills</h3>
            <ul>
              <li>
                Hill <strong>N is worth N points</strong>: hill 1 = 1 point, hill 10 = 10 points.
                55 points in total.
              </li>
              <li>
                Win a hill by placing more soldiers there, as before. Win the game by taking{' '}
                <strong>more points</strong>, not more hills.
              </li>
              <li>
                Head to head, <strong>best of 3</strong>. A tied game is replayed.
              </li>
            </ul>
            <div className="weighted-scale" aria-hidden="true">
              {Array.from({ length: HILLS }, (_, i) => (
                <span key={i} style={{ height: `${(i + 1) * 10}%` }}>
                  {i + 1}
                </span>
              ))}
            </div>
          </div>
        )}

        <h3>Each game</h3>
        <ul>
          <li>
            Split <strong>{SOLDIERS} soldiers</strong> across <strong>{HILLS} hills</strong>, using
            whole numbers that add up to exactly {SOLDIERS}.
          </li>
          <li>
            You play <strong>everyone in your group</strong>. Against each opponent, whoever puts
            more soldiers on a hill wins that hill. Equal numbers win nobody the hill.
          </li>
          <li>
            Win more hills than your opponent to win the match: <strong>1 point</strong>. A tie is
            worth ½ point.
          </li>
          <li>
            You have <strong>{GAME_SECONDS} seconds</strong>. You can edit and resubmit until the
            timer runs out.
          </li>
          <li>
            <strong>If you don’t submit</strong>, the hills you filled in are kept and your
            remaining soldiers are spread evenly over the hills you left blank.
          </li>
        </ul>

        <h3>The tournament</h3>
        <ul>
          <li>
            Each round is <strong>{GAMES_PER_STAGE} games</strong>. Your points add up across all{' '}
            {GAMES_PER_STAGE}. After each game, every allocation is revealed, so study the field.
          </li>
          <li>
            The top of each group advances. Ties are broken by hills won, then results between the
            tied players, then a random draw.
          </li>
          <li>
            The last 16 play a semifinal round. The top 4 play head to head, best of 3, on{' '}
            <strong>weighted hills</strong> (hill N is worth N points). Tied games are replayed.
            One champion is left.
          </li>
        </ul>

        <button type="button" className="primary-btn" onClick={close}>
          Got it
        </button>
      </div>
    </div>
  )
}
