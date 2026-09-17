import type {
  Creative,
  NicheBenchmark,
  ScoreResult,
  SubScores,
  Confidence,
  Category,
} from '../types'

export const BENCHMARK_STORAGE_KEY = 'tracker-metricas:benchmarks'

// Cache a nivel de módulo para evitar leer + parsear localStorage en cada getBenchmark().
// Con N cards, scoreCreative() corre N veces por render → antes eran N lecturas + N JSON.parse.
// Ahora: primer hit por nicho = lectura + parse, los siguientes = lookup O(1) en el Map.
const benchmarkCache = new Map<string, NicheBenchmark>()

/**
 * Invalida el cache de benchmarks.
 * - Sin argumentos: limpia todo (útil en tests, o tras importar todo de cero).
 * - Con un nicho: borra solo esa entrada (útil al editar un nicho específico).
 * Llamar desde NicheSettings tras guardar, o desde donde sea que se muten los overrides.
 */
export function invalidateBenchmarkCache(niche?: string): void {
  if (niche === undefined) {
    benchmarkCache.clear()
  } else {
    benchmarkCache.delete(niche)
  }
}

// Benchmarks por defecto — el usuario los edita desde la pantalla de Ajustes por nicho.
export const DEFAULT_BENCHMARKS: Record<string, NicheBenchmark> = {
  Berrinches: {
    niche: 'Berrinches',
    ctrTarget: 2.2,
    hookRateTarget: 30,
    holdRateTarget: 20,
    roasTarget: 2.5,
    cpaTarget: 6,
    weights: { engagement: 0.4, result: 0.4, efficiency: 0.2 },
  },
  'Método Hormonal': {
    niche: 'Método Hormonal',
    ctrTarget: 1.8,
    hookRateTarget: 26,
    holdRateTarget: 18,
    roasTarget: 2.2,
    cpaTarget: 7,
    weights: { engagement: 0.35, result: 0.45, efficiency: 0.2 },
  },
  CalistenIA: {
    niche: 'CalistenIA',
    ctrTarget: 2.0,
    hookRateTarget: 28,
    holdRateTarget: 19,
    roasTarget: 2.3,
    cpaTarget: 6.5,
    weights: { engagement: 0.4, result: 0.4, efficiency: 0.2 },
  },
  // Tai Chi: nicho de bienestar para audiencia mayor. Engagement más bajo que
  // Método Hormonal por el ritmo pausado del contenido, pero conversión
  // comparable. Valores iniciales — ajustar con datos reales de campañas.
  'Tai Chi': {
    niche: 'Tai Chi',
    ctrTarget: 1.5,        // audiencia mayor, scrollea más lento → CTR menor
    hookRateTarget: 22,    // hooks menos agresivos, ritmo más calmado
    holdRateTarget: 16,    // retención decente gracias a contenido relajante
    roasTarget: 2.0,       // ticket similar a bienestar
    cpaTarget: 8,          // CPA algo más alto por menor volumen de búsqueda
    weights: { engagement: 0.3, result: 0.45, efficiency: 0.25 },
  },
}

export const GENERIC_BENCHMARK: NicheBenchmark = {
  niche: 'Genérico',
  ctrTarget: 2.0,
  hookRateTarget: 28,
  holdRateTarget: 19,
  roasTarget: 2.3,
  cpaTarget: 6.5,
  weights: { engagement: 0.4, result: 0.4, efficiency: 0.2 },
}

export function getBenchmark(niche: string): NicheBenchmark {
  // 1. Cache hit → devuelve sin tocar localStorage
  if (benchmarkCache.has(niche)) {
    return benchmarkCache.get(niche)!
  }

  // 2. Cache miss → leer localStorage, parsear, cachear y devolver
  let benchmark: NicheBenchmark
  try {
    const raw = localStorage.getItem(BENCHMARK_STORAGE_KEY)
    if (raw) {
      const stored: Record<string, NicheBenchmark> = JSON.parse(raw)
      if (stored[niche]) {
        benchmark = stored[niche]
        benchmarkCache.set(niche, benchmark)
        return benchmark
      }
    }
  } catch {
    // falla silenciosa, usar default
  }
  benchmark = DEFAULT_BENCHMARKS[niche] ?? { ...GENERIC_BENCHMARK, niche }
  benchmarkCache.set(niche, benchmark)
  return benchmark
}

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n))
}

function ratioScore(value: number, target: number) {
  if (target <= 0) return 0
  return clamp((value / target) * 100)
}

function inverseRatioScore(target: number, value: number) {
  // Para métricas donde menor es mejor (CPA, CPM)
  if (value <= 0) return 100
  return clamp((target / value) * 100)
}

export function computeDerivedMetrics(c: Creative) {
  const { metrics: m } = c
  const ctr = m.impressions > 0 ? (m.linkClicks / m.impressions) * 100 : 0
  const hookRate = m.videoPlays > 0 ? (m.hookViews / m.videoPlays) * 100 : 0
  const holdRate = m.videoPlays > 0 ? (m.holdViews / m.videoPlays) * 100 : 0
  const cpc = m.linkClicks > 0 ? m.spend / m.linkClicks : 0
  const cpm = m.impressions > 0 ? (m.spend / m.impressions) * 1000 : 0
  const cpa = m.purchases > 0 ? m.spend / m.purchases : 0
  const roas = m.spend > 0 ? m.revenue / m.spend : 0
  return { ctr, hookRate, holdRate, cpc, cpm, cpa, roas }
}

export function computeSubScores(
  c: Creative,
  benchmark: NicheBenchmark
): SubScores {
  const d = computeDerivedMetrics(c)

  const engagement =
    ratioScore(d.ctr, benchmark.ctrTarget) * 0.4 +
    ratioScore(d.hookRate, benchmark.hookRateTarget) * 0.35 +
    ratioScore(d.holdRate, benchmark.holdRateTarget) * 0.25

  const roasScore = ratioScore(d.roas, benchmark.roasTarget)
  const cpaScore = d.cpa > 0 ? inverseRatioScore(benchmark.cpaTarget, d.cpa) : 50
  const result = roasScore * 0.6 + cpaScore * 0.4

  const freq = c.metrics.frequency
  const freqScore = freq > 2 ? clamp(100 - (freq - 2) * 25) : 100
  const cpmScore = clamp(100 - (d.cpm - 8) * 5)
  const efficiency = freqScore * 0.6 + cpmScore * 0.4

  return {
    engagement: Math.round(engagement),
    result: Math.round(result),
    efficiency: Math.round(efficiency),
  }
}

export function computeConfidence(c: Creative): Confidence {
  const { spend, purchases } = c.metrics
  if (spend < 15 || purchases < 3) return 'baja'
  if (spend < 50 || purchases < 10) return 'media'
  return 'alta'
}

export function detectFatigue(c: Creative): { isFatigued: boolean; reason?: string } {
  const h = c.metrics.history
  if (h.length < 7) return { isFatigued: false }

  const mid = Math.floor(h.length / 2)
  const first = h.slice(0, mid)
  const second = h.slice(mid)
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length

  // Umbrales RELATIVOS al CTR base del creativo (primera mitad)
  const baseCtr = avg(first.map((p) => p.ctr))
  const ctrTrend = avg(second.map((p) => p.ctr)) - baseCtr
  const freqTrend =
    avg(second.map((p) => p.frequency)) - avg(first.map((p) => p.frequency))

  // Cae más del 15% relativo del CTR base Y la frecuencia sube más de 0.3
  const ctrThreshold = baseCtr > 0 ? baseCtr * 0.15 : 0.3

  if (freqTrend > 0.3 && ctrTrend < -ctrThreshold) {
    const pctDrop = baseCtr > 0 ? Math.abs(ctrTrend / baseCtr) * 100 : 0
    return {
      isFatigued: true,
      reason: `CTR cayó ${pctDrop.toFixed(0)}% relativo mientras frecuencia subió +${freqTrend.toFixed(1)} — audiencia saturada.`,
    }
  }

  return { isFatigued: false }
}

/**
 * Detecta si el creativo muestra momentum positivo:
 * CTR o ROAS mejorando 3+ días consecutivos (estricto, "estable" no cuenta)
 * o mejorando >10% relativo en 2da mitad vs 1ra.
 */
export function detectTrendingUp(c: Creative): { trending: boolean; metric?: 'ctr' | 'roas' } {
  const h = c.metrics.history
  if (h.length < 3) return { trending: false }

  // Camino 1: días consecutivos ESTRICTAMENTE mejorando
  // (estricto: un día igual al anterior NO cuenta como mejora, es estable)
  const ctrImproving = h.every((_p, i) => i === 0 || h[i].ctr > h[i - 1].ctr)
  const roasImproving = h.every((_p, i) => i === 0 || h[i].roas > h[i - 1].roas)

  if (ctrImproving && h.length >= 3) return { trending: true, metric: 'ctr' }
  if (roasImproving && h.length >= 3) return { trending: true, metric: 'roas' }

  // Camino 2: comparación primera mitad vs segunda mitad (más robusto)
  if (h.length < 5) return { trending: false }

  const mid = Math.floor(h.length / 2)
  const first = h.slice(0, mid)
  const second = h.slice(mid)
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length

  const ctrDelta = avg(second.map((p) => p.ctr)) - avg(first.map((p) => p.ctr))
  const roasDelta = avg(second.map((p) => p.roas)) - avg(first.map((p) => p.roas))

  const baseCtr = avg(first.map((p) => p.ctr))
  const baseRoas = avg(first.map((p) => p.roas))
  const ctrRelThreshold = baseCtr * 0.1 // 10% mejora relativa mínima
  const roasRelThreshold = baseRoas * 0.1

  if (ctrDelta > ctrRelThreshold && ctrDelta > roasDelta) {
    return { trending: true, metric: 'ctr' }
  }
  if (roasDelta > roasRelThreshold && roasDelta > ctrDelta) {
    return { trending: true, metric: 'roas' }
  }

  return { trending: false }
}

export function computeCategory(
  composite: number,
  confidence: Confidence
): Category {
  if (composite >= 80 && confidence !== 'baja') return 'ganador'
  if (composite >= 65) return confidence === 'baja' ? 'potencial' : 'bueno'
  if (composite >= 45) return 'regular'
  return 'malo'
}

export function buildDiagnosis(
  c: Creative,
  benchmark: NicheBenchmark,
  fatigued: boolean,
  fatigueReason: string | undefined,
  trendingUp: boolean,
  trendingMetric: 'ctr' | 'roas' | undefined,
  category: Category
): string[] {
  const d = computeDerivedMetrics(c)
  const notes: string[] = []

  if (
    d.hookRate >= benchmark.hookRateTarget &&
    d.roas < benchmark.roasTarget * 0.6
  ) {
    notes.push(
      'Buen enganche pero mal resultado: el problema probablemente está en la oferta o la landing, no en el creativo.'
    )
  }

  if (d.ctr < benchmark.ctrTarget * 0.7) {
    notes.push('CTR bajo frente al benchmark del nicho: el hook no está funcionando, vale la pena probar otro ángulo.')
  }

  if (fatigued && fatigueReason) {
    notes.push(`Fatiga detectada: ${fatigueReason} Vigilar de cerca antes de meterle más presupuesto.`)
  }

  if (d.holdRate > 0 && c.metrics.retention95 < 15 && d.hookRate >= benchmark.hookRateTarget) {
    notes.push('Buen gancho inicial pero pierde tensión a mitad del video — revisar el guion desde el 50%.')
  }

  const placements = c.metrics.demographics?.placementRoas ?? []
  const worst = placements.reduce(
    (acc, p) => (p.roas < acc.roas ? p : acc),
    { placement: '', roas: Infinity }
  )
  if (worst.placement && worst.roas < 1) {
    notes.push(`El ROAS en ${worst.placement} está por debajo de 1 — considera excluirlo para liberar presupuesto.`)
  }

  if (notes.length === 0) {
    if (trendingUp) {
      notes.push(
        `Momentum positivo detectado en ${trendingMetric === 'ctr' ? 'CTR' : 'ROAS'} — el creativo mejora consistentemente. Considera escalar gradualmente.`
      )
    } else if (category === 'ganador') {
      notes.push('Embudo saludable: buen enganche y buen resultado. Recomendación: escalar presupuesto gradualmente (20-30% cada 2-3 días).')
    } else {
      notes.push('Métricas dentro de rango esperado, sin señales críticas por ahora.')
    }
  }

  return notes
}

export function scoreCreative(c: Creative): ScoreResult {
  const benchmark = getBenchmark(c.niche)
  const sub = computeSubScores(c, benchmark)
  const composite = Math.round(
    sub.engagement * benchmark.weights.engagement +
      sub.result * benchmark.weights.result +
      sub.efficiency * benchmark.weights.efficiency
  )
  const confidence = computeConfidence(c)
  const category = computeCategory(composite, confidence)
  const { isFatigued, reason: fatigueReason } = detectFatigue(c)
  const { trending, metric: trendingMetric } = detectTrendingUp(c)
  const diagnosis = buildDiagnosis(c, benchmark, isFatigued, fatigueReason, trending, trendingMetric, category)
  const derived = computeDerivedMetrics(c)

  return {
    composite,
    category,
    confidence,
    subScores: sub,
    isFatigued,
    fatigueReason,
    trendingUp: trending,
    trendingMetric,
    diagnosis,
    derived,
  }
}
