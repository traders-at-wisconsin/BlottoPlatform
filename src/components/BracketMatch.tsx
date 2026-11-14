import { nameOf } from '../hooks/useTournament'
import {
  HILLS,
  hillValue,
  WINS_NEEDED,
  type BracketGame,
  type MatchState,
  type Scoring,
} from '../lib/tournament'

type BracketMatchProps = {
  title: string
  state: MatchState
  players: Record<string, string>
  highlightUid?: string
  scoring?: Scoring
}

export function BracketMatch({
  title,
  state,
  players,
  highlightUid,
  scoring = 'classic',
}: BracketMatchProps) {
  const winnerName = state.winner ? nameOf(players, state.winner) : null
  return (
    <section className="bracket-match">
      <header className="standings-header">
        <h3>{title}</h3>
        <span className={`pill${state.winner ? ' pill-done' : ' pill-live'}`}>
          {winnerName ? `${winnerName} advances` : `First to ${WINS_NEEDED}`}
        </span>
      </header>
      {state.players.map((uid) => {
        const won = state.winner === uid
        const out = Boolean(state.winner) && !won
        return (
          <div
            key={uid}
            className={['bracket-row', won ? 'is-winner' : '', out ? 'is-out' : '', uid === highlightUid ? 'is-you' : '']
              .filter(Boolean)
              .join(' ')}
          >
            <span className="name">
              {nameOf(players, uid)}
              {uid === highlightUid && <span className="you-tag">You</span>}
              {won && <span className="result-tag advanced">Advanced</span>}
              {out && <span className="result-tag out">Out</span>}
            </span>
            <span className="bracket-wins">{state.wins[uid] ?? 0}</span>
          </div>
        )
      })}
      {state.games.length > 0 && (
        <div className="h2h-list">
          {state.games.map((game, index) => (
            <HeadToHead
              key={index}
              number={index + 1}
              game={game}
              order={state.players}
              players={players}
              scoring={scoring}
            />
          ))}
        </div>
      )}
      <p className="standings-note">
        {scoring === 'weighted'
          ? 'Weighted hills: hill N is worth N points (55 total) · tied games are replayed'
          : 'Hill-by-hill, each game · tied games are replayed'}
      </p>
    </section>
  )
}

function HeadToHead({
  number,
  game,
  order,
  players,
  scoring,
}: {
  number: number
  game: BracketGame
  order: string[]
  players: Record<string, string>
  scoring: Scoring
}) {
  const weighted = scoring === 'weighted'
  const [a, b] = order
  const verdict = game.winner ? `${nameOf(players, game.winner)} wins` : 'Tie · replayed'
  return (
    <div className="h2h">
      <div className="h2h-head">
        <span>G{number}</span>
        <span className="mono">
          {game.score[a]}–{game.score[b]}
          {weighted ? ' pts' : ' hills'}
        </span>
        <span className={game.winner ? '' : 'muted'}>{verdict}</span>
      </div>
      <div className="h2h-grid">
        <span className="h2h-name" />
        {Array.from({ length: HILLS }, (_, i) => (
          <span key={i} className="h2h-hill">
            H{i + 1}
            {weighted && <em>{hillValue(i, scoring)}pt</em>}
          </span>
        ))}
        {[a, b].map((uid) => {
          const other = uid === a ? b : a
          return [
            <span key={`${uid}-n`} className="h2h-name">
              {nameOf(players, uid)}
            </span>,
            ...Array.from({ length: HILLS }, (_, i) => {
              const mine = game.allocs[uid][i]
              const theirs = game.allocs[other][i]
              const cls = mine > theirs ? 'win' : mine < theirs ? 'loss' : 'tie'
              return (
                <span key={`${uid}-${i}`} className={`h2h-cell ${cls}`}>
                  {mine}
                </span>
              )
            }),
          ]
        })}
      </div>
    </div>
  )
}
