import { useMemo, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { GroupLeaderboard } from '../components/GroupLeaderboard'
import { LoadingScreen } from '../components/LoadingScreen'
import { useAuth } from '../contexts/AuthContext'
import { useActiveGroupingSet } from '../hooks/useActiveGroupingSet'
import { useActiveRound } from '../hooks/useActiveRound'
import { useLoggedInUsers } from '../hooks/useLoggedInUsers'
import { hardResetGame } from '../lib/adminReset'
import { displayNameOf } from '../lib/displayName'
import { createGroupingSet, type StandingEntry } from '../lib/groupingSets'
import { sortedGroupEntries, type RoundView } from '../lib/roundData'
import { createRound } from '../lib/rounds'
import {
  endRoundAndScore,
  formatPoints,
  rankStandings,
  tieRanks,
} from '../lib/scoring'
import { GAME_VARIANTS, type GameVariantId } from '../lib/variants'
import '../components/GroupLeaderboard.css'
import './AdminPage.css'

type AdminView = 'rounds' | 'groups'

export function AdminPage() {
  const { isAdmin, adminLoading } = useAuth()
  const { users, loading: usersLoading } = useLoggedInUsers(isAdmin)
  const { groupingSet, loading: groupingLoading } =
    useActiveGroupingSet(isAdmin)
  const { round: activeRound, loading: activeLoading } =
    useActiveRound(isAdmin)

  const [view, setView] = useState<AdminView>('rounds')
  const [groupCount, setGroupCount] = useState('2')
  const [variant, setVariant] = useState<GameVariantId>('classic_blotto')
  const [creatingSet, setCreatingSet] = useState(false)
  const [creatingRound, setCreatingRound] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const groupsReady = Boolean(groupingSet)
  const hasLiveRound = Boolean(activeRound && activeRound.status === 'created')
  const canCreateRound = groupsReady && !hasLiveRound

  const preview = useMemo(() => {
    const count = Number.parseInt(groupCount, 10)
    if (!Number.isInteger(count) || count < 1 || users.length === 0) return null
    if (count > users.length) return null
    const base = Math.floor(users.length / count)
    const remainder = users.length % count
    return {
      larger: remainder,
      largerSize: base + 1,
      smaller: count - remainder,
      smallerSize: base,
    }
  }, [groupCount, users.length])

  const groupingEntries = useMemo(() => {
    if (!groupingSet) return []
    return Object.entries(groupingSet.groups).sort(([a], [b]) => {
      const numA = Number.parseInt(a, 10)
      const numB = Number.parseInt(b, 10)
      if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB
      return a.localeCompare(b)
    })
  }, [groupingSet])

  if (adminLoading) return <LoadingScreen />
  if (!isAdmin) return <Navigate to="/" replace />
  if (activeLoading || groupingLoading) return <LoadingScreen />

  async function handleHardReset() {
    const confirmed = window.confirm(
      'Hard reset clears groups, rounds, and scores. Logged-in users stay signed in. Continue?',
    )
    if (!confirmed) return

    setError('')
    setSuccess('')
    setResetting(true)
    try {
      await hardResetGame()
      setView('rounds')
      setGroupCount('2')
      setVariant('classic_blotto')
      setSuccess('Reset complete. Set the number of groups to begin.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hard reset failed.')
    } finally {
      setResetting(false)
    }
  }

  async function handleCreateGroups(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSuccess('')
    const count = Number.parseInt(groupCount, 10)
    setCreatingSet(true)
    try {
      await createGroupingSet(
        users.map((user) => ({
          uid: user.uid,
          displayName: user.displayName,
        })),
        count,
      )
      setView('rounds')
      setSuccess('Groups set.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set groups.')
    } finally {
      setCreatingSet(false)
    }
  }

  async function handleCreateRound(event: FormEvent) {
    event.preventDefault()
    if (!groupingSet) return
    setError('')
    setSuccess('')
    setCreatingRound(true)
    try {
      await createRound(groupingSet.id, variant)
      setSuccess('Round started.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create round.')
    } finally {
      setCreatingRound(false)
    }
  }

  async function handleEndAndScore() {
    if (!activeRound) return
    setError('')
    setSuccess('')
    setScoring(true)
    try {
      await endRoundAndScore(activeRound.id)
      setSuccess('Round scored.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to score round.')
    } finally {
      setScoring(false)
    }
  }

  return (
    <div className="admin-page">
      <AppHeader />
      <main className="admin-main">
        <header className="admin-top">
          <h1>Admin</h1>
          <button
            type="button"
            className="hard-reset-btn"
            onClick={() => void handleHardReset()}
            disabled={resetting}
          >
            {resetting ? 'Resetting…' : 'Hard reset'}
          </button>
        </header>

        {error && (
          <p className="admin-message admin-error" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="admin-message admin-success" role="status">
            {success}
          </p>
        )}

        {!groupsReady ? (
          <>
            <section className="admin-section">
              <div className="admin-section-header">
                <h2>Logged in users</h2>
                <span className="admin-count">{users.length}</span>
              </div>
              {usersLoading ? (
                <p className="admin-empty">Loading users…</p>
              ) : users.length === 0 ? (
                <p className="admin-empty">No users currently logged in.</p>
              ) : (
                <ul className="user-list">
                  {users.map((entry) => (
                    <li key={entry.uid} className="user-row">
                      <div className="user-meta">
                        <p className="user-name">{displayNameOf(entry)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="admin-section">
              <div className="admin-section-header">
                <h2>Set groups</h2>
              </div>
              <form className="create-round-form" onSubmit={handleCreateGroups}>
                <label className="field">
                  <span>Number of groups</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(users.length, 1)}
                    step={1}
                    value={groupCount}
                    onChange={(e) => setGroupCount(e.target.value)}
                    disabled={creatingSet || users.length === 0}
                  />
                </label>
                {preview && (
                  <p className="round-preview">
                    {users.length} users → {groupCount} groups
                    {preview.larger > 0
                      ? ` (${preview.larger}×${preview.largerSize}, ${preview.smaller}×${preview.smallerSize})`
                      : ` (${preview.smaller}×${preview.smallerSize})`}
                  </p>
                )}
                <button
                  type="submit"
                  className="create-round-btn"
                  disabled={creatingSet || usersLoading || users.length === 0}
                >
                  {creatingSet ? 'Setting…' : 'Set groups'}
                </button>
              </form>
            </section>
          </>
        ) : (
          <>
            <div className="admin-view-tabs" role="tablist" aria-label="Admin views">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'rounds'}
                className={`admin-view-tab${view === 'rounds' ? ' is-active' : ''}`}
                onClick={() => setView('rounds')}
              >
                Round manager
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'groups'}
                className={`admin-view-tab${view === 'groups' ? ' is-active' : ''}`}
                onClick={() => setView('groups')}
              >
                Groups
              </button>
            </div>

            {view === 'groups' ? (
              <section className="admin-section">
                <div className="admin-section-header">
                  <h2>Groups</h2>
                  <span className="admin-count">
                    {groupingSet?.groupCount ?? 0}
                  </span>
                </div>
                <div className="group-grid">
                  {groupingEntries.map(([groupId, members]) => {
                    const standings = buildGroupStandings(
                      members,
                      groupingSet?.standings[groupId] ?? {},
                    )
                    const ranks = tieRanks(
                      standings,
                      (left, right) => left.points === right.points,
                    )
                    return (
                      <article key={groupId} className="group-card">
                        <div className="group-card-header">
                          <h3>Group {groupId}</h3>
                          <span className="admin-count">
                            {standings.length}
                          </span>
                        </div>
                        <table className="rank-table admin-rank-table">
                          <thead>
                            <tr>
                              <th scope="col">Rank</th>
                              <th scope="col">Name</th>
                              <th scope="col">Wins</th>
                            </tr>
                          </thead>
                          <tbody>
                            {standings.map((entry, index) => (
                              <tr key={entry.uid}>
                                <td className="rank-col">{ranks[index]}</td>
                                <td className="name-col">
                                  {displayNameOf(entry)}
                                </td>
                                <td className="wins-col">
                                  {formatPoints(entry.points)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </article>
                    )
                  })}
                </div>
              </section>
            ) : (
              <section className="admin-section">
                <div className="admin-section-header">
                  <h2>Round manager</h2>
                  {activeRound ? (
                    <span
                      className={`status-pill${
                        activeRound.status === 'scored'
                          ? ' is-scored'
                          : ' is-live'
                      }`}
                    >
                      {activeRound.status === 'scored' ? 'Scored' : 'Live'}
                    </span>
                  ) : (
                    <span className="status-pill">No round</span>
                  )}
                </div>

                {!activeRound && canCreateRound && (
                  <form
                    className="create-round-form"
                    onSubmit={handleCreateRound}
                  >
                    <label className="field">
                      <span>Round style</span>
                      <select
                        value={variant}
                        onChange={(e) =>
                          setVariant(e.target.value as GameVariantId)
                        }
                        disabled={creatingRound}
                      >
                        {Object.values(GAME_VARIANTS).map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="round-preview">
                      {GAME_VARIANTS[variant].description}
                    </p>
                    <button
                      type="submit"
                      className="create-round-btn"
                      disabled={creatingRound}
                    >
                      {creatingRound ? 'Starting…' : 'Start round'}
                    </button>
                  </form>
                )}

                {activeRound && activeRound.status === 'created' && (
                  <LiveRoundPanel
                    round={activeRound}
                    scoring={scoring}
                    onEndAndScore={() => void handleEndAndScore()}
                  />
                )}

                {activeRound && activeRound.status === 'scored' && (
                  <>
                    <p className="round-preview">
                      Round finished. Results by group:
                    </p>
                    <div className="group-grid scored-grid">
                      {sortedGroupEntries(activeRound).map(([groupId]) => (
                        <GroupLeaderboard
                          key={groupId}
                          groupId={groupId}
                          scores={activeRound.scores[groupId] ?? {}}
                        />
                      ))}
                    </div>
                    {canCreateRound && (
                      <form
                        className="create-round-form"
                        onSubmit={handleCreateRound}
                      >
                        <div className="admin-section-header">
                          <h2>Start next round</h2>
                        </div>
                        <label className="field">
                          <span>Round style</span>
                          <select
                            value={variant}
                            onChange={(e) =>
                              setVariant(e.target.value as GameVariantId)
                            }
                            disabled={creatingRound}
                          >
                            {Object.values(GAME_VARIANTS).map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="submit"
                          className="create-round-btn"
                          disabled={creatingRound}
                        >
                          {creatingRound ? 'Starting…' : 'Start round'}
                        </button>
                      </form>
                    )}
                  </>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function buildGroupStandings(
  members: Record<string, { displayName: string | null }>,
  standings: Record<string, StandingEntry>,
): StandingEntry[] {
  const entries: StandingEntry[] = Object.entries(members).map(
    ([uid, profile]) => {
      const existing = standings[uid]
      return {
        uid,
        displayName: existing?.displayName ?? profile.displayName,
        points: existing?.points ?? 0,
        matches: existing?.matches ?? 0,
      }
    },
  )
  return rankStandings(entries)
}

function LiveRoundPanel({
  round,
  scoring,
  onEndAndScore,
}: {
  round: RoundView
  scoring: boolean
  onEndAndScore: () => void
}) {
  const groupEntries = sortedGroupEntries(round)
  const totalPlayers = groupEntries.reduce(
    (sum, [, members]) => sum + members.length,
    0,
  )
  const totalSubmitted = groupEntries.reduce(
    (sum, [, members]) =>
      sum + members.filter((member) => member.hasAllocation).length,
    0,
  )

  return (
    <div className="round-detail">
      <p className="round-preview">
        {GAME_VARIANTS[round.variant ?? 'classic_blotto']?.label ?? 'Original'}
        {' · '}
        {totalSubmitted}/{totalPlayers} players submitted
      </p>

      <div className="admin-actions">
        <button
          type="button"
          className="end-round-btn"
          onClick={onEndAndScore}
          disabled={scoring}
        >
          {scoring ? 'Scoring…' : 'End round and score'}
        </button>
      </div>

      <div className="group-grid">
        {groupEntries.map(([groupId, members]) => {
          const submittedCount = members.filter((m) => m.hasAllocation).length
          const totalCount = members.length

          return (
            <article key={groupId} className="group-card">
              <div className="group-card-header">
                <h3>Group {groupId}</h3>
                <span
                  className={`submit-fraction${
                    totalCount > 0 && submittedCount === totalCount
                      ? ' is-complete'
                      : ''
                  }`}
                >
                  {submittedCount}/{totalCount} submitted
                </span>
              </div>
              {totalCount > 0 && (
                <div className="group-progress" aria-hidden="true">
                  <div
                    className="group-progress-bar"
                    style={{
                      width: `${
                        totalCount === 0
                          ? 0
                          : (submittedCount / totalCount) * 100
                      }%`,
                    }}
                  />
                </div>
              )}
              <ul className="user-list group-member-list">
                {members.map((member) => (
                  <li key={member.uid} className="user-row">
                    <div className="user-meta">
                      <p className="user-name">{displayNameOf(member)}</p>
                    </div>
                    <span
                      className={`submit-badge${
                        member.hasAllocation ? ' is-submitted' : ''
                      }`}
                    >
                      {member.hasAllocation ? 'Submitted' : 'Waiting'}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          )
        })}
      </div>
    </div>
  )
}
