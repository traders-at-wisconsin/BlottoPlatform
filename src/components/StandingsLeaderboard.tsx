import { displayNameOf } from '../lib/displayName'
import type { StandingEntry } from '../lib/groupingSets'
import { formatPoints, rankStandings, tieRanks } from '../lib/scoring'
import './GroupLeaderboard.css'

type StandingsLeaderboardProps = {
  groupId: string
  standings: Record<string, StandingEntry> | StandingEntry[]
  highlightUid?: string
}

export function StandingsLeaderboard({
  groupId,
  standings,
  highlightUid,
}: StandingsLeaderboardProps) {
  const ranked = rankStandings(standings)
  const ranks = tieRanks(ranked, (left, right) => left.points === right.points)

  return (
    <section className="leaderboard" aria-labelledby="standings-heading">
      <header className="leaderboard-header">
        <p className="leaderboard-eyebrow">Group {groupId}</p>
        <h1 id="standings-heading">Overall</h1>
      </header>

      {ranked.length === 0 ? (
        <p className="leaderboard-empty">No standings yet.</p>
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
                <tr
                  key={player.uid}
                  className={isYou ? 'is-you' : undefined}
                >
                  <td className="rank-col">{ranks[index]}</td>
                  <td className="name-col">
                    <span className="leaderboard-name">
                      {label}
                      {isYou ? (
                        <span className="leaderboard-you">You</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="wins-col">{formatPoints(player.points)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}
    </section>
  )
}
