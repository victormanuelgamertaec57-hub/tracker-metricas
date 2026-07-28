export type Health = 'good' | 'bad' | 'neutral'

export const healthColor: Record<Health, string> = {
  good: 'var(--cat-ganador)',
  bad: 'var(--cat-apagar)',
  neutral: 'var(--text-primary)',
}

/**
 * Clasifica una métrica como saludable, no saludable o normal
 * comparándola contra un valor objetivo (benchmark).
 * @param higherIsBetter true para CTR/ROAS/Hook rate, false para CPA/CPM/Frecuencia
 */
export function classifyHealth(
  value: number,
  target: number,
  higherIsBetter: boolean,
  tolerance = 0.15
): Health {
  if (target <= 0) return 'neutral'
  const ratio = value / target
  if (higherIsBetter) {
    if (ratio >= 1 + tolerance) return 'good'
    if (ratio <= 1 - tolerance * 2.5) return 'bad'
    return 'neutral'
  } else {
    if (ratio <= 1 - tolerance) return 'good'
    if (ratio >= 1 + tolerance * 2.5) return 'bad'
    return 'neutral'
  }
}
