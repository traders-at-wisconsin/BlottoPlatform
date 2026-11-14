import { nameOf } from '../hooks/useTournament'
import type { StandingRow } from '../lib/tournament'

type StandingsTableProps = {
  title: string
  rows: StandingRow[]
  players: Record<string, string>
  advanceCount?: number
  highlightUid?: string
}

function points(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function StandingsTable({
  title,
  rows,
  players,
  advanceCount,
  highlightUid,
}: StandingsTableProps) {
  return (
    <section className="standings">
      <header className="standings-header">
        <h3>{title}</h3>
        <span className="pill">{rows.length} players</span>
      </header>
      <div className="standings-scroll">
        <table className="standings-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Name</th>
              <th scope="col" title="Match points">Pts</th>
              <th scope="col" title="Wins-Ties-Losses">W-T-L</th>
              <th scope="col" title="Hills won (1st tiebreak)">Hills</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const advancing = advanceCount !== undefined && row.rank <= advanceCount
              const cutLine = advanceCount !== undefined && row.rank === advanceCount
              const classes = [
                advancing ? 'is-advancing' : '',
                cutLine ? 'is-cut' : '',
                row.uid === highlightUid ? 'is-you' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <tr key={row.uid} className={classes || undefined}>
                  <td className="num">{row.rank}</td>
                  <td className="name">
                    {nameOf(players, row.uid)}
                    {row.uid === highlightUid && <span className="you-tag">You</span>}
                  </td>
                  <td className="num strong">{points(row.points)}</td>
                  <td className="num">
                    {row.wins}-{row.ties}-{row.losses}
                  </td>
                  <td className="num">{row.hillsWon}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {advanceCount !== undefined && (
        <p className="standings-note">Top {advanceCount} advance (shaded)</p>
      )}
    </section>
  )
}
