import { useServerNow } from '../hooks/useServerTime'

type CountdownProps = {
  endsAt: number
  size?: 'normal' | 'large'
}

export function secondsLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000))
}

export function Countdown({ endsAt, size = 'normal' }: CountdownProps) {
  const now = useServerNow(200)
  const left = secondsLeft(endsAt, now)
  const state = left === 0 ? ' is-done' : left <= 10 ? ' is-urgent' : ''
  const label = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  return (
    <div
      className={`countdown countdown-${size}${state}`}
      role="timer"
      aria-label={left === 0 ? "Time's up" : `${left} seconds left`}
    >
      <span className="countdown-value">{left === 0 ? "Time's up" : label}</span>
    </div>
  )
}
