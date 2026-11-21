import { Progress } from '@mantine/core'

/** 残席の割合をバーで表示 */
export function SeatMeter({ available, total }: { available: number; total: number }) {
  const ratio = total === 0 ? 0 : (available / total) * 100
  const color = available === 0 ? 'gray' : ratio < 20 ? 'red' : ratio < 50 ? 'yellow' : 'teal'
  return (
    <div className="seat-meter">
      <Progress value={ratio} color={color} size="sm" />
      <span className="seat-meter-label">
        {available === 0 ? '売り切れ' : `残り ${available} / ${total} 席`}
      </span>
    </div>
  )
}
