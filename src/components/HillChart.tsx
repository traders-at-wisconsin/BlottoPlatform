import { HILLS, type Alloc, type HillRecord } from '../lib/tournament'

type HillChartProps = {
  alloc: Alloc
  records: HillRecord[]
  fieldAvg?: number[]
}

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0)

/**
 * Diverging bars: green up = share of opponents you beat on that hill,
 * red down = share you lost to. The soldier count is tinted by the net result.
 */
export function HillChart({ alloc, records, fieldAvg }: HillChartProps) {
  const opponents = records[0] ? records[0].won + records[0].tied + records[0].lost : 0
  const net = records.map((r) => (opponents ? (r.won - r.lost) / opponents : 0))
  const best = net.indexOf(Math.max(...net))
  const worst = net.indexOf(Math.min(...net))

  return (
    <figure className="hill-chart">
      <div className="hill-chart-grid" role="img" aria-label="Hills won and lost against your group">
        {Array.from({ length: HILLS }, (_, i) => {
          const r = records[i]
          const tint = net[i] >= 0 ? `rgba(51, 209, 122, ${net[i] * 0.55})` : `rgba(255, 84, 112, ${-net[i] * 0.55})`
          return (
            <div
              className="hill-col"
              key={i}
              title={`Hill ${i + 1}: ${alloc[i]} soldiers · won ${r.won}, tied ${r.tied}, lost ${r.lost} of ${opponents}`}
            >
              <span className="hill-soldiers" style={{ background: tint }}>
                {alloc[i]}
              </span>
              <span className="hill-bar">
                <span className="hill-up">
                  <span style={{ height: `${pct(r.won, opponents)}%` }} />
                </span>
                <span className="hill-down">
                  <span style={{ height: `${pct(r.lost, opponents)}%` }} />
                </span>
              </span>
              <span className="hill-label">H{i + 1}</span>
              <span className="hill-pct">{pct(r.won, opponents)}%</span>
              {fieldAvg && <span className="hill-avg">{fieldAvg[i].toFixed(1)}</span>}
            </div>
          )
        })}
      </div>
      <figcaption className="hill-caption">
        <span>
          <i className="swatch win" /> beat · <i className="swatch loss" /> lost to · % = share beaten
          {fieldAvg && ' · bottom row = field average'}
        </span>
        {opponents > 0 && (
          <span>
            Best <b>H{best + 1}</b> ({records[best].won}/{opponents}) · Worst <b>H{worst + 1}</b> (lost{' '}
            {records[worst].lost}/{opponents})
          </span>
        )}
      </figcaption>
    </figure>
  )
}
