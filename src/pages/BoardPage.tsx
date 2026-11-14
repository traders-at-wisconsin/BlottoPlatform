import { Link } from 'react-router-dom'
import { Countdown, secondsLeft } from '../components/Countdown'
import { LoadingScreen } from '../components/LoadingScreen'
import { StageBoard } from '../components/StageBoard'
import { useServerNow } from '../hooks/useServerTime'
import { nameOf, useTournament } from '../hooks/useTournament'
import { GAMES_PER_STAGE } from '../lib/tournament'
import '../components/tournament.css'
import './BoardPage.css'

/** Public, no sign-in: open on a projector or any phone. */
export function BoardPage() {
  const view = useTournament()
  const now = useServerNow(500)
  const { tournament, players, stage, currentGame, scoredGames } = view

  if (view.loading) return <LoadingScreen />

  const live =
    currentGame && currentGame.status !== 'scored' && currentGame.stageId === stage?.id
      ? currentGame
      : null
  const participants = live ? Object.keys(live.participants) : []
  const submitted = live ? participants.filter((uid) => live.submitted[uid]).length : 0
  const lastGame = scoredGames[scoredGames.length - 1]

  let status: string
  if (tournament.status === 'registration') {
    status = `${Object.keys(players).length} players registered`
  } else if (tournament.status === 'complete') {
    status = 'Tournament complete'
  } else if (live) {
    status = secondsLeft(live.endsAt, now) > 0 ? `${submitted}/${participants.length} submitted` : 'Scoring…'
  } else if (lastGame) {
    status = `Results after game ${lastGame.number}`
  } else {
    status = 'Groups drawn · waiting for game 1'
  }

  return (
    <div className="board-page">
      <header className="board-header">
        <div>
          <Link to="/" className="board-brand">
            Blotto
          </Link>
          <h1 className="display-title">
            {tournament.status === 'registration' ? 'Waiting room' : stage?.name ?? 'Tournament'}
            {live && (
              <span className="board-game">
                {' '}
                · Game {live.number}
                {stage?.kind === 'groups' ? ` of ${GAMES_PER_STAGE}` : ''}
              </span>
            )}
          </h1>
          <p className="board-status">{status}</p>
        </div>
        {live && <Countdown endsAt={live.endsAt} size="large" />}
      </header>

      {live && (
        <div className="progress board-progress">
          <div style={{ width: `${participants.length ? (submitted / participants.length) * 100 : 0}%` }} />
        </div>
      )}

      <main className="board-main">
        {tournament.status === 'complete' && tournament.championUid && (
          <div className="banner board-banner">
            <p className="eyebrow">Champion</p>
            <h2 className="display-title">{nameOf(players, tournament.championUid)}</h2>
          </div>
        )}
        {tournament.status === 'registration' ? (
          <ul className="board-registered">
            {Object.values(players)
              .sort((a, b) => a.localeCompare(b))
              .map((name, index) => (
                <li key={`${name}-${index}`}>{name}</li>
              ))}
          </ul>
        ) : (
          <StageBoard view={view} />
        )}
      </main>
    </div>
  )
}
