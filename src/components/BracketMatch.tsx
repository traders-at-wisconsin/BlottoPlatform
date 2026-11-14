import { nameOf } from '../hooks/useTournament'
import { WINS_NEEDED, type MatchState } from '../lib/tournament'

type BracketMatchProps = {
  title: string
  state: MatchState
  players: Record<string, string>
  highlightUid?: string
}

export function BracketMatch({ title, state, players, highlightUid }: BracketMatchProps) {
  return (
    <section className="bracket-match">
      <header className="standings-header">
        <h3>{title}</h3>
        <span className={`pill${state.winner ? ' pill-done' : ''}`}>
          {state.winner ? 'Decided' : `First to ${WINS_NEEDED}`}
        </span>
      </header>
      {state.players.map((uid) => (
        <div
          key={uid}
          className={[
            'bracket-row',
            state.winner === uid ? 'is-winner' : '',
            state.winner && state.winner !== uid ? 'is-out' : '',
            uid === highlightUid ? 'is-you' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="name">
            {nameOf(players, uid)}
            {uid === highlightUid && <span className="you-tag">You</span>}
          </span>
          <span className="bracket-games">
            {state.games.map((game, index) => (
              <span
                key={index}
                className={`bracket-game${game.winner === uid ? ' is-won' : ''}${game.winner === null ? ' is-tie' : ''}`}
                title={game.winner === null ? 'Tied game (replayed)' : undefined}
              >
                {game.hills[uid]}
              </span>
            ))}
          </span>
          <span className="bracket-wins">{state.wins[uid] ?? 0}</span>
        </div>
      ))}
      <p className="standings-note">Hills won each game · tied games are replayed</p>
    </section>
  )
}
