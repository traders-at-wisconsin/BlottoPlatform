import { Fragment } from 'react'
import { ALLOCATION_SLOTS } from '../lib/allocation'
import { displayNameOf } from '../lib/displayName'
import { formatPoints, rankScores, tieRanks, type PlayerScore } from '../lib/scoring'
import './GroupLeaderboard.css'

type GroupLeaderboardProps = {
  groupId: string
  scores: Record<string, PlayerScore> | PlayerScore[]
  highlightUid?: string
}

export function GroupLeaderboard({
  groupId,
  scores,
  highlightUid,
}: GroupLeaderboardProps) {
  const ranked = rankScores(scores)
  const ranks = tieRanks(ranked, (left, right) => left.wins === right.wins)
  const hills = Array.from({ length: ALLOCATION_SLOTS }, (_, i) => String(i + 1))

  return (
    <section className="leaderboard" aria-labelledby="leaderboard-heading">
      <header className="leaderboard-header">
        <p className="leaderboard-eyebrow">Group {groupId}</p>
        <h1 id="leaderboard-heading">This round</h1>
      </header>

      {ranked.length === 0 ? (
        <p className="leaderboard-empty">No scores for this group.</p>
      ) : (
        <div className="rank-card">
        <table className="rank-table">
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Name</th>
              <th scope="col">Wins</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((player, index) => {
              const label = displayNameOf(player)
              const isYou = highlightUid === player.uid

              return (
                <Fragment key={player.uid}>
                  <tr className={isYou ? 'rank-summary is-you' : 'rank-summary'}>
                    <td className="rank-col">{ranks[index]}</td>
                    <td className="name-col">
                      <span className="leaderboard-name">
                        {label}
                        {isYou ? (
                          <span className="leaderboard-you">You</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="wins-col">{formatPoints(player.wins)}</td>
                  </tr>
                  <tr className={isYou ? 'is-you' : undefined}>
                    <td className="allocation-col" colSpan={3}>
                      <table
                        className="allocation-table"
                        aria-label={`${label} allocation`}
                      >
                        <tbody>
                          <tr>
                            {hills.map((hill) => (
                              <td key={`a-${hill}`}>
                                {player.allocation?.[hill] ?? 0}
                              </td>
                            ))}
                          </tr>
                          <tr className="allocation-hills">
                            {hills.map((hill) => (
                              <td key={`h-${hill}`}>{hill}</td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
        </div>
      )}
    </section>
  )
}
