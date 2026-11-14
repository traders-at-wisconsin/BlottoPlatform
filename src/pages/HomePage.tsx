import { useEffect, useState, type ReactNode } from 'react'
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
import { RegisterForm } from '../components/RegisterForm'
import { HillChart } from '../components/HillChart'
import {
  fieldAverage,
  GAMES_PER_STAGE,
  hillRecords,
  matchState,
  rankGroup,
} from '../lib/tournament'
import '../components/tournament.css'
import './HomePage.css'

export function HomePage() {
  const { user, isAdmin } = useAuth()
  const view = useTournament()
  const { tournament, players, stage, currentGame, loading } = view
  const uid = user?.uid ?? ''
  const [showHelp, setShowHelp] = useState(false)
  const [organizerJoining, setOrganizerJoining] = useState(false)
  const now = useServerNow(500)

  const isPlayer = Boolean(players[uid])
  const registrationOpen = tournament.status === 'registration'

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
  } else if (registrationOpen && !isPlayer && (!isAdmin || organizerJoining)) {
    // Signed in (e.g. with Google) but not registered yet.
    content = <RegisterForm />
  } else if (registrationOpen) {
    content = (
      <div className="panel center">
        <p className="eyebrow">Waiting room</p>
        <h1 className="display-title">
          {isPlayer ? `You’re in, ${players[uid]}` : 'You’re an organizer'}
        </h1>
        <p className="muted">
          {Object.keys(players).length} players registered. The game starts when the host begins
          round 1. Keep this page open.
        </p>
        <Quip />
        {isAdmin && !isPlayer && (
          <div className="row">
            <Link className="primary-btn" to="/admin">
              Admin console
            </Link>
            <button type="button" className="secondary-btn" onClick={() => setOrganizerJoining(true)}>
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
  const lastAllocs = view.scoredAllocs[view.scoredAllocs.length - 1]
  const lastRow =
    lastGame && mine
      ? rankGroup(members, [lastAllocs], stage.seed).find((row) => row.uid === uid)
      : undefined
  const bracketWinner =
    stage.kind === 'bracket' ? matchState(members, view.scoredAllocs).winner : null

  let headline: string
  if (bracketWinner) {
    headline = bracketWinner === uid ? 'You advanced!' : 'Knocked out'
  } else if (currentGame && currentGame.status !== 'scored' && currentGame.stageId === stage.id) {
    headline =
      secondsLeft(currentGame.endsAt, now) > 0 ? 'Game in progress' : 'Time’s up: scoring…'
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
        <p className="muted">
          {bracketWinner && bracketWinner !== uid
            ? 'Great run. Stick around for the rest of the bracket.'
            : 'Waiting for the host to start the next game.'}
        </p>
        <Quip />
      </div>

      {mine && lastRow && stage.kind === 'groups' && (
        <div className="panel">
          <div className="row spread">
            <h2>Your game {lastGame.number}</h2>
            {mine.auto && <span className="pill pill-live">Auto-filled</span>}
          </div>
          <p className="game-line mono">
            <b className="win-text">{lastRow.wins}W</b> <span>{lastRow.ties}T</span>{' '}
            <b className="loss-text">{lastRow.losses}L</b> · {lastRow.hillsWon} hills won · #
            {lastRow.rank} of {members.length} this game
          </p>
          <HillChart
            alloc={mine.a}
            records={hillRecords(uid, lastAllocs, members)}
            fieldAvg={fieldAverage(lastAllocs, members)}
          />
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

const QUIPS = [
  'There is no pure-strategy Nash equilibrium here. Randomize accordingly.',
  'Every allocation is published after each game. Your edge has a half-life.',
  'Concentrate or diversify? The field decides, not you.',
  'Overfitting to last game is a strategy. So is fading it.',
  'Ties on a hill win nothing. Odd numbers are cheap insurance.',
  'Past performance does not guarantee future hills.',
]

function Quip() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * QUIPS.length))
  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => (i + 1) % QUIPS.length), 8000)
    return () => window.clearInterval(id)
  }, [])
  return <p className="quip mono">&gt; {QUIPS[index]}</p>
}
