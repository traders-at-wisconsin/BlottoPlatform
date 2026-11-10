import './WaitingForRoundEnd.css'

type WaitingForRoundEndProps = {
  groupId: string
}

export function WaitingForRoundEnd({ groupId }: WaitingForRoundEndProps) {
  return (
    <div className="waiting-screen" role="status" aria-live="polite">
      <div className="waiting-orb" aria-hidden="true">
        <span className="waiting-ring waiting-ring-a" />
        <span className="waiting-ring waiting-ring-b" />
        <span className="waiting-core" />
      </div>

      <p className="waiting-eyebrow">Group {groupId}</p>
      <h1 className="waiting-title">Waiting for round end</h1>
      <p className="waiting-copy">
        Your allocation is locked in. Hang tight while everyone else finishes.
      </p>
    </div>
  )
}
