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
  SCORE_DELAY_MS,
  stageAdvancers,
  stageComplete,
  suggestStage,
  type StagePlan,
} from '../lib/tournament'
import {
  createStage,
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
  const suggested = suggestStage(uids.length, 1)
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
              <span>{players[uid]}</span>
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
      {suggested ? (
        <PlanForm
          key={uids.length}
          title="Start the tournament"
          suggested={suggested}
          players={uids.length}
          submitLabel="Lock registration and draw groups"
          busy={busy}
          onSubmit={(plan) => run(() => createStage(plan, uids, 0))}
        />
      ) : (
        <p className="muted">Need at least 2 players to start.</p>
      )}
    </>
  )
}

function PlanForm({
  title,
  suggested,
  players,
  submitLabel,
  busy,
  onSubmit,
}: {
  title: string
  suggested: StagePlan
  players: number
  submitLabel: string
  busy: boolean
  onSubmit: (plan: StagePlan) => void
}) {
  const [plan, setPlan] = useState(suggested)
  const groupCount = plan.kind === 'bracket' ? Math.floor(players / 2) : plan.groupCount
  const size = Math.floor(players / Math.max(groupCount, 1))
  const advancing =
    plan.kind === 'bracket' ? groupCount : Math.min(plan.advancePerGroup, size) * groupCount
  const invalid =
    plan.kind === 'groups'
      ? plan.groupCount < 1 || plan.groupCount > players || plan.advancePerGroup < 1
      : players % 2 !== 0

  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="plan-grid">
        <label className="field">
          <span>Stage name</span>
          <input value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Format</span>
          <select
            value={plan.kind}
            onChange={(e) => setPlan({ ...plan, kind: e.target.value as StagePlan['kind'] })}
          >
            <option value="groups">Groups, {GAMES_PER_STAGE} games round robin</option>
            <option value="bracket">Head-to-head bracket, best of 3</option>
          </select>
        </label>
        {plan.kind === 'groups' && (
          <>
            <label className="field">
              <span>Groups</span>
              <input
                type="number"
                min={1}
                value={plan.groupCount}
                onChange={(e) => setPlan({ ...plan, groupCount: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Advance per group</span>
              <input
                type="number"
                min={1}
                value={plan.advancePerGroup}
                onChange={(e) => setPlan({ ...plan, advancePerGroup: Number(e.target.value) })}
              />
            </label>
          </>
        )}
      </div>
      <p className="muted">
        {plan.kind === 'groups'
          ? `${players} players → ${groupCount} group${groupCount === 1 ? '' : 's'} of ~${size} → ${advancing} advance`
          : `${players} players → ${groupCount} match${groupCount === 1 ? '' : 'es'} (1 v ${players}, 2 v ${players - 1}…) → ${advancing} advance`}
      </p>
      <button
        type="button"
        className="primary-btn"
        disabled={busy || invalid}
        onClick={() => onSubmit(plan)}
      >
        {submitLabel}
      </button>
    </section>
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
  const suggested = suggestStage(advancers.length, stage.index + 2)

  return (
    <>
      <section className="panel">
        <h2>{stage.name} complete</h2>
        <p className="muted">
          {advancers.length} advancing, in seed order:{' '}
          {advancers.map((uid, i) => `${i + 1}. ${nameOf(players, uid)}`).join(' · ')}
        </p>
      </section>
      {suggested ? (
        <PlanForm
          title="Next stage"
          suggested={suggested}
          players={advancers.length}
          submitLabel={`Start ${suggested.name}`}
          busy={busy}
          onSubmit={(plan) => run(() => createStage(plan, advancers, stage.index + 1))}
        />
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
    </>
  )
}
