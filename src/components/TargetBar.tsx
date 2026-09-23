import { barScale } from '../lib/analysisVisuals'
import { classifyHealth } from '../lib/health'

const HEALTH_BAR_COLOR = {
  good: 'var(--cat-ganador)',
  neutral: 'var(--cat-regular)',
  bad: 'var(--cat-apagar)',
} as const

/**
 * Barra horizontal con el valor y una marca vertical en el objetivo. La usan el
 * panel de análisis (una métrica por barra, escala propia) y el chat (varios
 * creativos en la misma métrica, con `scaleMax` común).
 */
export function TargetBar({
  label,
  value,
  target,
  decimals,
  unit = '%',
  scaleMax,
  color: colorOverride,
  stackLabel = false,
}: {
  label: string
  value: number | null
  // null = sin objetivo (p. ej. el score): no se dibuja la marca.
  target: number | null
  decimals: number
  unit?: string
  scaleMax?: number
  color?: string
  // Etiqueta en su propia línea (nombres largos en un panel angosto, como el chat).
  stackLabel?: boolean
}) {
  const { fillPct, targetPct } = barScale(value ?? 0, target, scaleMax)
  const hasTarget = target !== null && target > 0
  const color =
    value === null
      ? 'var(--text-muted)'
      : colorOverride ?? (hasTarget ? HEALTH_BAR_COLOR[classifyHealth(value, target, true)] : 'var(--accent)')
  return (
    <div className="mb-3 last:mb-0">
      <div className={`text-[12px] mb-1 ${stackLabel ? '' : 'flex items-baseline justify-between gap-2'}`}>
        <span
          className={stackLabel ? 'block break-words' : 'min-w-0 truncate'}
          style={{ color: 'var(--text-primary)' }}
          title={stackLabel ? undefined : label}
        >
          {label}
        </span>
        <span className={`tabular-nums ${stackLabel ? 'block' : 'shrink-0'}`}>
          <b style={{ color }}>{value === null ? 'sin dato' : `${value.toFixed(decimals)}${unit}`}</b>
          {hasTarget && <span style={{ color: 'var(--text-muted)' }}> · objetivo {target.toFixed(decimals)}{unit}</span>}
        </span>
      </div>
      <div className="relative h-2.5 rounded-full" style={{ background: 'var(--divider-strong)' }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fillPct}%`, background: color }} />
        {hasTarget && (
          <div
            className="absolute -top-1 -bottom-1 w-0.5 rounded"
            style={{ left: `calc(${targetPct}% - 1px)`, background: 'var(--text-primary)' }}
            title={`Objetivo del nicho: ${target.toFixed(decimals)}${unit}`}
          />
        )}
      </div>
    </div>
  )
}
