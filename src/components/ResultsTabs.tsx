import { useState } from 'react'
import type { StandingEntry } from '../lib/groupingSets'
import type { PlayerScore } from '../lib/scoring'
import { GroupLeaderboard } from './GroupLeaderboard'
import { StandingsLeaderboard } from './StandingsLeaderboard'
import './ResultsTabs.css'

type ResultsTabsProps = {
  groupId: string
  roundScores: Record<string, PlayerScore>
  standings: Record<string, StandingEntry>
  highlightUid: string
}

type Tab = 'round' | 'overall'

export function ResultsTabs({
  groupId,
  roundScores,
  standings,
  highlightUid,
}: ResultsTabsProps) {
  const [tab, setTab] = useState<Tab>('round')

  return (
    <div className="results-tabs">
      <div className="results-tablist" role="tablist" aria-label="Results">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'round'}
          className={`results-tab${tab === 'round' ? ' is-active' : ''}`}
          onClick={() => setTab('round')}
        >
          This round
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'overall'}
          className={`results-tab${tab === 'overall' ? ' is-active' : ''}`}
          onClick={() => setTab('overall')}
        >
          Overall
        </button>
      </div>

      <div className="results-tabpanel" role="tabpanel">
        {tab === 'round' ? (
          <GroupLeaderboard
            groupId={groupId}
            scores={roundScores}
            highlightUid={highlightUid}
          />
        ) : (
          <StandingsLeaderboard
            groupId={groupId}
            standings={standings}
            highlightUid={highlightUid}
          />
        )}
      </div>
    </div>
  )
}
