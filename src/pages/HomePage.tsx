import { AppHeader } from '../components/AppHeader'
import { AllocationForm } from '../components/AllocationForm'
import { LoadingScreen } from '../components/LoadingScreen'
import { ResultsTabs } from '../components/ResultsTabs'
import { useAuth } from '../contexts/AuthContext'
import { useActiveGroupingSet } from '../hooks/useActiveGroupingSet'
import { useActiveRound } from '../hooks/useActiveRound'
import { findUserGroup } from '../lib/allocation'
import './HomePage.css'

export function HomePage() {
  const { user } = useAuth()
  const { roundActive, round, loading: roundLoading } = useActiveRound(
    Boolean(user),
  )
  const { groupingSet, loading: groupingLoading } = useActiveGroupingSet(
    Boolean(user),
  )

  if (roundLoading || groupingLoading) return <LoadingScreen />

  const groupId =
    user && roundActive && round
      ? findUserGroup(round.groups, user.uid)
      : null

  const inRound = Boolean(user && round && groupId)
  const isScored = round?.status === 'scored'
  const standings =
    groupingSet && groupId ? (groupingSet.standings[groupId] ?? {}) : {}

  return (
    <div className="home-page">
      <AppHeader />

      <main className={`home-main${inRound ? ' home-main-allocate' : ''}`}>
        {inRound && user && round && groupId ? (
          isScored ? (
            <ResultsTabs
              groupId={groupId}
              roundScores={round.scores[groupId] ?? {}}
              standings={standings}
              highlightUid={user.uid}
            />
          ) : (
            <AllocationForm
              roundId={round.id}
              groupId={groupId}
              uid={user.uid}
            />
          )
        ) : (
          <p className="home-status">Round not started</p>
        )}
      </main>
    </div>
  )
}
