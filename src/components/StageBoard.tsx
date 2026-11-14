import type { TournamentView } from '../hooks/useTournament'
import { matchState, rankGroup } from '../lib/tournament'
import { BracketMatch } from './BracketMatch'
import { StandingsTable } from './StandingsTable'

type StageBoardProps = {
  view: TournamentView
  highlightUid?: string
  /** Show only this group (a player's own view). */
  onlyGroupId?: string
}

function groupTitle(kind: 'groups' | 'bracket', groupCount: number, groupId: string, stageName: string) {
  if (kind === 'bracket') return groupCount === 1 ? stageName : `Match ${groupId}`
  return groupCount === 1 ? stageName : `Group ${groupId}`
}

export function StageBoard({ view, highlightUid, onlyGroupId }: StageBoardProps) {
  const { stage, scoredAllocs, players } = view
  if (!stage) return null
  const groupIds = Object.keys(stage.groups)
    .filter((id) => !onlyGroupId || id === onlyGroupId)
    .sort((a, b) => Number(a) - Number(b))

  return (
    <div className={`stage-board${groupIds.length > 1 ? ' is-multi' : ''}`}>
      {groupIds.map((groupId) => {
        const members = stage.groups[groupId]
        const title = groupTitle(stage.kind, groupIds.length, groupId, stage.name)
        return stage.kind === 'bracket' ? (
          <BracketMatch
            key={groupId}
            title={title}
            state={matchState(members, scoredAllocs)}
            players={players}
            highlightUid={highlightUid}
          />
        ) : (
          <StandingsTable
            key={groupId}
            title={title}
            rows={rankGroup(members, scoredAllocs, stage.seed)}
            players={players}
            advanceCount={Math.min(stage.advancePerGroup, members.length)}
            highlightUid={highlightUid}
          />
        )
      })}
    </div>
  )
}
