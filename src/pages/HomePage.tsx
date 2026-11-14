import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { secondsLeft } from '../components/Countdown'
import { GameEntryForm } from '../components/GameEntryForm'
import { InstructionsModal, instructionsSeen } from '../components/InstructionsModal'
import { LoadingScreen } from '../components/LoadingScreen'
import { StageBoard } from '../components/StageBoard'
import { useAuth } from '../contexts/AuthContext'
import { useServerNow } from '../hooks/useServerTime'
import { nameOf, useTournament, type TournamentView } from '../hooks/useTournament'
import { joinTournament } from '../lib/tournamentDb'
import { GAMES_PER_STAGE, HILLS, rankGroup } from '../lib/tournament'
import '../components/tournament.css'
import './HomePage.css'

export function HomePage() {
  const { user, isAdmin, adminLoading } = useAuth()
  const view = useTournament()
  const { tournament, players, stage, currentGame, loading } = view
  const uid = user?.uid ?? ''
  const [showHelp, setShowHelp] = useState(false)
  const joining = useRef(false)
  const now = useServerNow(500)

  const isPlayer = Boolean(players[uid])
  const registrationOpen = tournament.status === 'registration'

  // Signing in during registration is joining (organizers join explicitly).
  function join() {
    if (!user || joining.current) return
    joining.current = true
    void joinTournament(user.uid, user.displayName ?? 'Player').finally(() => {
      joining.current = false
    })
  }
  useEffect(() => {
    if (loading || adminLoading || isAdmin || !user || isPlayer || !registrationOpen) return
    join()
  })

  const inGame = Boolean(
    currentGame &&
      currentGame.status === 'open' &&
      currentGame.participants[uid] &&
      secondsLeft(currentGame.endsAt, now) > 0,
  )

  // Pop the instructions up once in the waiting room.
  useEffect(() => {
    if (!loading && isPlayer && !inGame && !instructionsSeen()) setShowHelp(true)
  }, [loading, isPlayer, inGame])

  if (loading || !user) return <LoadingScreen />

  const groupId = stage
    ? Object.keys(stage.groups).find((id) => stage.groups[id].includes(uid))
    : undefined

  let content: ReactNode
  if (tournament.status === 'complete') {
    content = <Champion view={view} uid={uid} />
  } else if (registrationOpen) {
    content = (
      <div className="panel center">
        <p className="eyebrow">Waiting room</p>
        <h1 className="display-title">
          {isPlayer ? 'You’re in' : isAdmin ? 'You’re an organizer' : 'Joining…'}
        </h1>
        <p className="muted">
          {Object.keys(players).length} players registered. The game starts when the host begins
          round 1. Keep this page open.
        </p>
        {isAdmin && !isPlayer && (
          <div className="row">
            <Link className="primary-btn" to="/admin">
              Admin console
            </Link>
            <button type="button" className="secondary-btn" onClick={join}>
              Join as a player
            </button>
          </div>
        )}
      </div>
    )
  } else if (!isPlayer) {
    content = (
      <div className="panel center">
        <h1 className="display-title">Registration is closed</h1>
        <p className="muted">The tournament has already started. You can follow along live.</p>
        <Link className="primary-btn" to="/board">
          Watch the leaderboard
        </Link>
      </div>
    )
  } else if (inGame && currentGame && stage && groupId) {
    const opponents = stage.groups[groupId].length - 1
    content = (
      <GameEntryForm
        key={currentGame.id}
        gameId={currentGame.id}
        uid={uid}
        endsAt={currentGame.endsAt}
        eyebrow={`${stage.name} · ${
          stage.kind === 'bracket' ? 'Head to head' : `Group ${groupId}`
        } · Game ${currentGame.number}${stage.kind === 'groups' ? ` of ${GAMES_PER_STAGE}` : ''}`}
        opponentsLabel={
          stage.kind === 'bracket'
            ? `Against ${nameOf(players, stage.groups[groupId].find((p) => p !== uid) ?? '')}`
            : `You play all ${opponents} other players in your group.`
        }
      />
    )
  } else if (stage && groupId) {
    content = <Standings view={view} uid={uid} groupId={groupId} now={now} />
  } else {
    content = (
      <div className="panel center">
        <p className="eyebrow">{stage?.name ?? 'Tournament'}</p>
        <h1 className="display-title">You’ve been eliminated</h1>
        <p className="muted">Thanks for playing! Follow the rest of the tournament live.</p>
        <Link className="primary-btn" to="/board">
          Watch the leaderboard
        </Link>
      </div>
    )
  }

  return (
    <div className="home-page">
      <AppHeader />
      <main className={`home-main${inGame ? ' home-main-allocate' : ' home-main-wide'}`}>
        {content}
        {!inGame && (
          <div className="row home-links">
            <button type="button" className="secondary-btn" onClick={() => setShowHelp(true)}>
              How to play
            </button>
            <Link className="secondary-btn" to="/board" target="_blank" rel="noreferrer">
              Full leaderboard ↗
            </Link>
          </div>
        )}
      </main>
      <InstructionsModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  )
}

function Standings({
  view,
  uid,
  groupId,
  now,
}: {
  view: TournamentView
  uid: string
  groupId: string
  now: number
}) {
  const { stage, currentGame, scoredGames, results } = view
  if (!stage) return null
  const lastGame = scoredGames[scoredGames.length - 1]
  const mine = lastGame ? results[lastGame.id]?.[uid] : undefined
  const members = stage.groups[groupId]
  const lastRow =
    lastGame && mine
      ? rankGroup(members, [view.scoredAllocs[view.scoredAllocs.length - 1]], stage.seed).find(
          (row) => row.uid === uid,
        )
      : undefined

  let headline: string
  if (currentGame && currentGame.status !== 'scored' && currentGame.stageId === stage.id) {
    headline = currentGame.participants[uid]
      ? secondsLeft(currentGame.endsAt, now) > 0
        ? 'Game in progress'
        : 'Time’s up: scoring…'
      : 'Your match is decided. Other matches are still playing.'
  } else if (!lastGame) {
    headline =
      stage.index === 0 ? `You’re in Group ${groupId}` : `You advanced to the ${stage.name}!`
  } else {
    headline = `After game ${lastGame.number}`
  }

  return (
    <div className="home-stack">
      <div className="panel">
        <p className="eyebrow">
          {stage.name}
          {stage.kind === 'groups' ? ` · Group ${groupId}` : ''}
        </p>
        <h1 className="display-title">{headline}</h1>
        <p className="muted">Waiting for the host to start the next game.</p>
      </div>

      {mine && lastRow && (
        <div className="panel">
          <div className="row spread">
            <h2>Your game {lastGame.number}</h2>
            {mine.auto && <span className="pill pill-live">Auto-filled</span>}
          </div>
          <div className="alloc-strip" aria-label="Your allocation">
            {mine.a.slice(0, HILLS).map((n, i) => (
              <div key={i}>
                {n}
                <small>H{i + 1}</small>
              </div>
            ))}
          </div>
          {stage.kind === 'groups' && (
            <p className="muted">
              This game: {lastRow.wins} wins, {lastRow.ties} ties, {lastRow.losses} losses ·{' '}
              {lastRow.hillsWon} hills won
            </p>
          )}
        </div>
      )}

      <StageBoard view={view} highlightUid={uid} onlyGroupId={groupId} />
    </div>
  )
}

function Champion({ view, uid }: { view: TournamentView; uid: string }) {
  const champion = view.tournament.championUid
  return (
    <div className="home-stack">
      <div className="banner">
        <p className="eyebrow">Champion</p>
        <h1 className="display-title">{champion ? nameOf(view.players, champion) : '—'}</h1>
        {champion === uid && <p>Congratulations, you won the tournament!</p>}
      </div>
      <StageBoard view={view} highlightUid={uid} />
    </div>
  )
}
