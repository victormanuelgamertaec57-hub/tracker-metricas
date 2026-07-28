import type { Health } from '../lib/health'
import { healthColor } from '../lib/health'

export function MetricStat({
  label,
  value,
  health = 'neutral',
}: {
  label: string
  value: string
  health?: Health
}) {
  return (
    <div>
      <p className="text-[10px] m-0" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      <p
        className="text-[13px] font-medium m-0 mt-0.5 tabular-nums"
        style={{ color: healthColor[health] }}
      >
        {value}
      </p>
    </div>
  )
}
