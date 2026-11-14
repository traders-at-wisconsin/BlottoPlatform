import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { Countdown } from '../components/Countdown'
import { LoadingScreen } from '../components/LoadingScreen'
import { StageBoard } from '../components/StageBoard'
import { useAuth } from '../contexts/AuthContext'
import { serverNow, useServerNow } from '../hooks/useServerTime'
import { nameOf, useTournament, type GameView, type TournamentView } from '../hooks/useTournament'
import {
  GAME_SECONDS,
  GAMES_PER_STAGE,
  nextParticipants,
  projectFormat,
  SCORE_DELAY_MS,
  stageAdvancers,
  stageComplete,
  type ProjectedStage,
} from '../lib/tournament'
import { onValue, ref } from 'firebase/database'
import { database } from '../lib/firebase'
import {
  startNextStage,
  crownChampion,
  endGameNow,
  hardReset,
  removePlayer,
  scoreGame,
  startGame,
} from '../lib/tournamentDb'
import '../components/tournament.css'
import './AdminPage.css'

function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

export function AdminPage() {
  const { isAdmin, adminLoading } = useAuth()
  const view = useTournament()
  const { busy, error, run } = useAction()

  if (adminLoading || view.loading) return <LoadingScreen />
  if (!isAdmin) return <Navigate to="/" replace />

  const { tournament, players } = view

  async function handleReset() {
    const clearPlayers = window.confirm(
      'Hard reset: clears all stages, games and results.\n\nOK = also clear the player list (everyone re-joins).\nCancel = choose whether to keep players.',
    )
    if (!clearPlayers && !window.confirm('Reset the tournament but KEEP the player list?')) return
    await run(() => hardReset(clearPlayers))
  }

  return (
    <div className="admin-page">
      <AppHeader />
      <main className="admin-main admin-stack">
        <header className="row spread">
          <h1 className="display-title">Admin</h1>
          <div className="row">
            <Link className="secondary-btn" to="/board" target="_blank" rel="noreferrer">
              Public board ↗
            </Link>
            <button type="button" className="danger-btn" disabled={busy} onClick={() => void handleReset()}>
              Hard reset
            </button>
          </div>
        </header>

        {error && (
          <p className="admin-message admin-error" role="alert">
            {error}
          </p>
        )}

        {tournament.status === 'registration' && (
          <Registration players={players} busy={busy} run={run} />
        )}
        {tournament.status === 'running' && <Running view={view} busy={busy} run={run} />}
        {tournament.status === 'complete' && (
          <div className="banner">
            <p className="eyebrow">Champion</p>
            <h2 className="display-title">
              {tournament.championUid ? nameOf(players, tournament.championUid) : '—'}
            </h2>
          </div>
        )}
        {tournament.status !== 'registration' && <StageBoard view={view} />}
      </main>
    </div>
  )
}

type ActionProps = {
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<void>
}

function Registration({ players, busy, run }: ActionProps & { players: Record<string, string> }) {
  const uids = useMemo(
    () => Object.keys(players).sort((a, b) => players[a].localeCompare(players[b])),
    [players],
  )
  const [emails, setEmails] = useState<Record<string, string>>({})
  useEffect(
    () =>
      onValue(ref(database, 'registrations'), (snap) => {
        const next: Record<string, string> = {}
        Object.entries((snap.val() ?? {}) as Record<string, { email?: string }>).forEach(([uid, reg]) => {
          if (reg?.email) next[uid] = reg.email
        })
        setEmails(next)
      }),
    [],
  )
  return (
    <>
      <section className="panel">
        <div className="row spread">
          <h2>Registration open</h2>
          <span className="stat">{uids.length}</span>
        </div>
        <p className="muted">
          Players join by signing in and entering a name. Remove duplicates or joke names before you
          start; registration locks when round 1 is drawn.
        </p>
        <ul className="player-list">
          {uids.map((uid) => (
            <li key={uid}>
              <span title={emails[uid]}>
                {players[uid]} <small className="muted">{emails[uid]}</small>
              </span>
              <button
                type="button"
                className="link-btn"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove ${players[uid]}?`)) void run(() => removePlayer(uid))
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Start the tournament</h2>
        {uids.length >= 2 ? (
          <>
            <FormatPreview stages={projectFormat(uids.length)} />
            <button
              type="button"
              className="primary-btn"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Lock registration with ${uids.length} players and draw Round 1?`)) {
                  void run(() => startNextStage(uids, 0))
                }
              }}
            >
              Lock registration and start ({uids.length} players)
            </button>
          </>
        ) : (
          <p className="muted">Need at least 2 players to start.</p>
        )}
      </section>
    </>
  )
}

function FormatPreview({ stages }: { stages: ProjectedStage[] }) {
  return (
    <ol className="format-preview">
      {stages.map((stage, i) => (
        <li key={i}>
          <strong>{stage.name}</strong>{' '}
          <span className="muted">
            {stage.kind === 'bracket'
              ? `${stage.players} players, ${stage.groupSizes.length === 1 ? 'head to head' : `${stage.groupSizes.length} head-to-head matches`}, best of 3`
              : `${stage.players} players in ${stage.groupSizes.length === 1 ? '1 group' : `${stage.groupSizes.length} groups of ${Math.min(...stage.groupSizes)}${Math.max(...stage.groupSizes) !== Math.min(...stage.groupSizes) ? `–${Math.max(...stage.groupSizes)}` : ''}`}, ${GAMES_PER_STAGE} games, top ${stage.advancePerGroup}${stage.groupSizes.length > 1 ? ' per group' : ''} advance`}
            {' → '}
            {stage.advancing === 1 ? 'champion' : `${stage.advancing} advance`}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Running({ view, busy, run }: ActionProps & { view: TournamentView }) {
  const { stage, stageGames, scoredAllocs, currentGame, players } = view
  if (!stage) return <p className="muted">No active stage.</p>

  const liveGame = stageGames.find((g) => g.status !== 'scored') ?? null
  const scoredCount = stageGames.filter((g) => g.status === 'scored').length
  const complete = !liveGame && stageComplete(stage, scoredAllocs)

  return (
    <>
      <section className="panel">
        <div className="row spread">
          <div>
            <p className="eyebrow">Current stage</p>
            <h2>{stage.name}</h2>
          </div>
          <span className="pill">
            {stage.kind === 'groups'
              ? `Game ${scoredCount} of ${GAMES_PER_STAGE} done`
              : `${scoredCount} games played`}
          </span>
        </div>

        {liveGame && <LiveGame game={liveGame} view={view} busy={busy} run={run} />}

        {!liveGame && !complete && (
          <button
            type="button"
            className="primary-btn"
            disabled={busy}
            onClick={() =>
              void run(() =>
                startGame(
                  stage.id,
                  stageGames.length + 1,
                  nextParticipants(stage, scoredAllocs),
                  serverNow(),
                ),
              )
            }
          >
            Start game {stageGames.length + 1} ({GAME_SECONDS}s)
          </button>
        )}
        {!liveGame && currentGame?.status === 'scored' && !complete && (
          <p className="muted">Players are seeing results. Start the next game when ready.</p>
        )}
      </section>

      {complete && <Advance view={view} busy={busy} run={run} key={stage.id} players={players} />}
    </>
  )
}

function LiveGame({ game, view, busy, run }: ActionProps & { game: GameView; view: TournamentView }) {
  const now = useServerNow(500)
  const scoringFor = useRef<string | null>(null)

  // Score automatically once the deadline and grace window have passed.
  useEffect(() => {
    if (game.status !== 'open' || now < game.endsAt + SCORE_DELAY_MS) return
    if (scoringFor.current === game.id) return
    scoringFor.current = game.id
    void run(() => scoreGame(game.id)).finally(() => {
      scoringFor.current = null
    })
  }, [game.status, game.endsAt, game.id, now, run])

  const participants = Object.keys(game.participants)
  const submitted = participants.filter((uid) => game.submitted[uid]).length
  const groups = new Map<string, { total: number; done: number }>()
  for (const [uid, groupId] of Object.entries(game.participants)) {
    const entry = groups.get(groupId) ?? { total: 0, done: 0 }
    entry.total += 1
    if (game.submitted[uid]) entry.done += 1
    groups.set(groupId, entry)
  }
  const timeUp = now >= game.endsAt

  return (
    <div className="live-game">
      <div className="row spread">
        <div>
          <p className="eyebrow">Game {game.number} · live</p>
          <span className="stat">
            {submitted}/{participants.length}
          </span>{' '}
          <span className="muted">submitted</span>
        </div>
        <Countdown endsAt={game.endsAt} />
      </div>
      <div className="progress">
        <div style={{ width: `${participants.length ? (submitted / participants.length) * 100 : 0}%` }} />
      </div>
      {groups.size > 1 && (
        <p className="muted">
          {[...groups.entries()]
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([groupId, g]) => `${view.stage?.kind === 'bracket' ? 'Match' : 'Group'} ${groupId}: ${g.done}/${g.total}`)
            .join(' · ')}
        </p>
      )}
      <div className="row">
        {game.status === 'open' && !timeUp && (
          <button
            type="button"
            className="secondary-btn"
            disabled={busy}
            onClick={() => {
              if (window.confirm('End this game now? Unsubmitted players are auto-filled.')) {
                void run(() => endGameNow(game.id, serverNow()))
              }
            }}
          >
            End now
          </button>
        )}
        {timeUp && game.status === 'open' && <p className="muted">Time’s up. Scoring in a moment…</p>}
        {game.status === 'scoring' && (
          <>
            <p className="muted">Scoring…</p>
            {now > game.endsAt + SCORE_DELAY_MS + 15_000 && (
              <button
                type="button"
                className="secondary-btn"
                disabled={busy}
                onClick={() => void run(() => scoreGame(game.id, true))}
              >
                Retry scoring
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Advance({
  view,
  busy,
  run,
  players,
}: ActionProps & { view: TournamentView; players: Record<string, string> }) {
  const { stage, scoredAllocs } = view
  const advancers = useMemo(
    () => (stage ? stageAdvancers(stage, scoredAllocs) : []),
    [stage, scoredAllocs],
  )
  if (!stage) return null
  const remainingFormat = projectFormat(advancers.length, stage.index + 2)

  return (
    <section className="panel">
      <h2>{stage.name} complete</h2>
      <p className="muted">
        {advancers.length} advancing, in seed order:{' '}
        {advancers.map((uid, i) => `${i + 1}. ${nameOf(players, uid)}`).join(' · ')}
      </p>
      {remainingFormat.length > 0 ? (
        <>
          <FormatPreview stages={remainingFormat} />
          <button
            type="button"
            className="primary-btn"
            disabled={busy}
            onClick={() => void run(() => startNextStage(advancers, stage.index + 1))}
          >
            Start {remainingFormat[0].name}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="primary-btn"
          disabled={busy || advancers.length !== 1}
          onClick={() => void run(() => crownChampion(advancers[0]))}
        >
          Crown {advancers[0] ? nameOf(players, advancers[0]) : ''} champion
        </button>
      )}
    </section>
  )
}
