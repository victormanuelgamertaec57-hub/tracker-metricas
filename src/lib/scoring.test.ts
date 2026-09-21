import { describe, it, expect, beforeEach } from 'vitest'
import type { Creative } from '../types'
import {
  computeDerivedMetrics,
  computeConfidence,
  computeCategory,
  detectFatigue,
  detectTrendingUp,
  scoreCreative,
  buildDiagnosis,
  getBenchmark,
  invalidateBenchmarkCache,
  DEFAULT_BENCHMARKS,
} from './scoring'

// Helpers para construir creativos de prueba
function makeCreative(overrides: Partial<Creative> = {}): Creative {
  return {
    id: 'test-1',
    name: 'Test Creative',
    niche: 'Berrinches',
    format: '9:16',
    launchDate: '2026-07-01',
    metrics: {
      spend: 100,
      impressions: 10000,
      clicks: 200,
      linkClicks: 180,
      videoPlays: 5000,
      hookViews: 3000, // reproducciones de 3s
      holdViews: 1600, // ThruPlays
      purchases: 8,
      revenue: 240,
      avgWatchTime: 6.5,
      frequency: 2.0,
      retention25: 70,
      retention50: 40,
      retention75: 20,
      retention95: 8,
      history: [],
    },
    ...overrides,
  }
}

const BERRINCHES = DEFAULT_BENCHMARKS['Berrinches']

describe('computeDerivedMetrics', () => {
  it('calcula CTR, hook rate, hold rate, CPC, CPM, CPA, ROAS correctamente', () => {
    const c = makeCreative()
    const d = computeDerivedMetrics(c)
    expect(d.ctr).toBeCloseTo(1.8, 1) // 180/10000*100
    expect(d.hookRate).toBeCloseTo(30, 1) // 3000/10000*100 (sobre impresiones)
    expect(d.holdRate).toBeCloseTo(16, 1) // 1600/10000*100 (sobre impresiones)
    expect(d.cpc).toBeCloseTo(0.556, 2) // 100/180
    expect(d.cpm).toBeCloseTo(10, 1) // 100/10000*1000
    expect(d.cpa).toBeCloseTo(12.5, 1) // 100/8
    expect(d.roas).toBeCloseTo(2.4, 1) // 240/100
  })

  it('maneja impressions=0 sin dividir por cero', () => {
    const c = makeCreative({
      metrics: { ...makeCreative().metrics, impressions: 0, linkClicks: 0 },
    })
    const d = computeDerivedMetrics(c)
    expect(d.ctr).toBe(0)
    expect(d.cpm).toBe(0)
  })

  it('maneja spend=0 sin dividir por cero', () => {
    const c = makeCreative({
      metrics: { ...makeCreative().metrics, spend: 0 },
    })
    const d = computeDerivedMetrics(c)
    expect(d.cpa).toBe(0) // sin purchases sí o sí
    expect(d.roas).toBe(0) // sin spend, ROAS = 0
  })

  it('maneja purchases=0 (CPA debe ser 0, no Infinity)', () => {
    const c = makeCreative({
      metrics: { ...makeCreative().metrics, purchases: 0, spend: 50 },
    })
    const d = computeDerivedMetrics(c)
    expect(d.cpa).toBe(0)
    expect(isFinite(d.cpa)).toBe(true)
  })

  it('maneja impressions=0 en hook/hold rate (= 0, sin dividir por cero)', () => {
    const c = makeCreative({
      metrics: { ...makeCreative().metrics, impressions: 0 },
    })
    const d = computeDerivedMetrics(c)
    expect(d.hookRate).toBe(0)
    expect(d.holdRate).toBe(0)
  })

  it('calcula hook/hold sobre impresiones, no sobre videoPlays', () => {
    // Regresion: antes hook = p25 / max(plays, p25) daba 100% siempre que
    // Meta reportaba plays en 0. videoPlays ya no participa en la formula.
    const base = makeCreative().metrics
    const conPlays = computeDerivedMetrics(makeCreative({ metrics: { ...base, videoPlays: 5000 } }))
    const sinPlays = computeDerivedMetrics(makeCreative({ metrics: { ...base, videoPlays: 0 } }))
    expect(sinPlays.hookRate).toBeCloseTo(30, 1)
    expect(sinPlays.hookRate).toBe(conPlays.hookRate)
    expect(sinPlays.holdRate).toBe(conPlays.holdRate)
  })

  it('caso real Anuncio 2: hook 49% y hold 19%, no 100% y 69%', () => {
    const c = makeCreative({
      metrics: {
        ...makeCreative().metrics,
        impressions: 16916,
        videoPlays: 13844,
        hookViews: 8334,
        holdViews: 3289,
      },
    })
    const d = computeDerivedMetrics(c)
    expect(d.hookRate).toBeCloseTo(49.3, 1)
    expect(d.holdRate).toBeCloseTo(19.4, 1)
  })
})

describe('computeConfidence', () => {
  it('devuelve "baja" cuando spend < 15 o purchases < 3', () => {
    expect(computeConfidence(makeCreative({ metrics: { ...makeCreative().metrics, spend: 10, purchases: 5 } }))).toBe('baja')
    expect(computeConfidence(makeCreative({ metrics: { ...makeCreative().metrics, spend: 100, purchases: 1 } }))).toBe('baja')
  })

  it('devuelve "media" cuando spend 15-49 o purchases 3-9', () => {
    expect(computeConfidence(makeCreative({ metrics: { ...makeCreative().metrics, spend: 30, purchases: 8 } }))).toBe('media')
    expect(computeConfidence(makeCreative({ metrics: { ...makeCreative().metrics, spend: 200, purchases: 5 } }))).toBe('media')
  })

  it('devuelve "alta" cuando spend >= 50 y purchases >= 10', () => {
    expect(computeConfidence(makeCreative({ metrics: { ...makeCreative().metrics, spend: 100, purchases: 15 } }))).toBe('alta')
    expect(computeConfidence(makeCreative({ metrics: { ...makeCreative().metrics, spend: 500, purchases: 50 } }))).toBe('alta')
  })

  it('en el límite exacto: spend=15 y purchases=3 → media (no baja)', () => {
    const c = makeCreative({ metrics: { ...makeCreative().metrics, spend: 15, purchases: 3 } })
    expect(computeConfidence(c)).toBe('media')
  })
})

describe('computeCategory', () => {
  it('composite >= 80 + confianza != baja → "ganador"', () => {
    expect(computeCategory(85, 'alta')).toBe('ganador')
    expect(computeCategory(80, 'media')).toBe('ganador')
  })

  it('composite >= 80 + confianza baja → degrada a "potencial"', () => {
    expect(computeCategory(85, 'baja')).toBe('potencial')
  })

  it('composite 65-79 → "bueno" si confianza != baja, "potencial" si baja', () => {
    expect(computeCategory(70, 'alta')).toBe('bueno')
    expect(computeCategory(70, 'baja')).toBe('potencial')
  })

  it('composite 45-64 → "regular"', () => {
    expect(computeCategory(50, 'alta')).toBe('regular')
    expect(computeCategory(45, 'baja')).toBe('regular')
  })

  it('composite < 45 → "malo"', () => {
    expect(computeCategory(30, 'alta')).toBe('malo')
    expect(computeCategory(0, 'alta')).toBe('malo')
  })
})

describe('detectFatigue', () => {
  it('NO detecta fatiga con history.length < 7 (mínimo requerido)', () => {
    const c = makeCreative({
      metrics: {
        ...makeCreative().metrics,
        history: [
          { date: '2026-07-01', ctr: 2.0, frequency: 1.0, roas: 1.0 },
          { date: '2026-07-02', ctr: 1.0, frequency: 3.0, roas: 0.5 },
        ],
      },
    })
    expect(detectFatigue(c).isFatigued).toBe(false)
  })

  it('NO detecta fatiga cuando CTR sube (no hay fatiga)', () => {
    const c = makeCreative({
      metrics: {
        ...makeCreative().metrics,
        history: [
          { date: '2026-07-01', ctr: 1.0, frequency: 1.0, roas: 1.0 },
          { date: '2026-07-02', ctr: 1.2, frequency: 1.5, roas: 1.2 },
          { date: '2026-07-03', ctr: 1.4, frequency: 2.0, roas: 1.4 },
          { date: '2026-07-04', ctr: 1.6, frequency: 2.5, roas: 1.6 },
          { date: '2026-07-05', ctr: 1.8, frequency: 3.0, roas: 1.8 },
          { date: '2026-07-06', ctr: 2.0, frequency: 3.5, roas: 2.0 },
          { date: '2026-07-07', ctr: 2.2, frequency: 4.0, roas: 2.2 },
        ],
      },
    })
    expect(detectFatigue(c).isFatigued).toBe(false)
  })

  it('SÍ detecta fatiga cuando frecuencia sube y CTR cae (umbral relativo)', () => {
    // CTR base ~3%, cae a ~1.5% (-50%, mucho más que el 15% relativo)
    // Frecuencia sube de 1.5 a 3.5 (+2.0, mucho más que 0.3)
    const c = makeCreative({
      metrics: {
        ...makeCreative().metrics,
        history: [
          { date: '2026-07-01', ctr: 3.0, frequency: 1.0, roas: 4.0 },
          { date: '2026-07-02', ctr: 3.1, frequency: 1.3, roas: 4.1 },
          { date: '2026-07-03', ctr: 3.0, frequency: 1.5, roas: 4.0 },
          { date: '2026-07-04', ctr: 2.5, frequency: 2.0, roas: 3.5 },
          { date: '2026-07-05', ctr: 2.0, frequency: 2.5, roas: 3.0 },
          { date: '2026-07-06', ctr: 1.7, frequency: 3.0, roas: 2.5 },
          { date: '2026-07-07', ctr: 1.5, frequency: 3.5, roas: 2.0 },
        ],
      },
    })
    const result = detectFatigue(c)
    expect(result.isFatigued).toBe(true)
    expect(result.reason).toBeDefined()
  })

  it('NO detecta fatiga con caída muy pequeña aunque frecuencia suba', () => {
    // CTR cae 5% (1.0 → 0.95), frecuencia sube mucho
    // Como la caída < 15% relativo del CTR base, no se considera fatiga
    const c = makeCreative({
      metrics: {
        ...makeCreative().metrics,
        history: [
          { date: '2026-07-01', ctr: 1.0, frequency: 1.0, roas: 1.0 },
          { date: '2026-07-02', ctr: 1.0, frequency: 1.2, roas: 1.0 },
          { date: '2026-07-03', ctr: 1.0, frequency: 1.5, roas: 1.0 },
          { date: '2026-07-04', ctr: 0.99, frequency: 1.8, roas: 1.0 },
          { date: '2026-07-05', ctr: 0.98, frequency: 2.5, roas: 1.0 },
          { date: '2026-07-06', ctr: 0.96, frequency: 3.5, roas: 1.0 },
          { date: '2026-07-07', ctr: 0.95, frequency: 4.0, roas: 1.0 },
        ],
      },
    })
    expect(detectFatigue(c).isFatigued).toBe(false)
  })
})

describe('detectTrendingUp', () => {
  it('NO detecta trending con history < 3', () => {
    const c = makeCreative({
      metrics: {
        ...makeCreative().metrics,
        history: [
          { date: '2026-07-01', ctr: 2.0, frequency: 1.0, roas: 2.0 },
        ],
      },
    })
    expect(detectTrendingUp(c).trending).toBe(false)
  })

  it('SÍ detecta trending cuando ROAS sube consistentemente', () => {
    const c = makeCreative({
      metrics: {
        ...makeCreative().metrics,
        history: [
          { date: '2026-07-01', ctr: 2.0, frequency: 1.0, roas: 1.0 },
          { date: '2026-07-02', ctr: 2.0, frequency: 1.0, roas: 1.2 },
          { date: '2026-07-03', ctr: 2.0, frequency: 1.0, roas: 1.4 },
          { date: '2026-07-04', ctr: 2.0, frequency: 1.0, roas: 1.6 },
          { date: '2026-07-05', ctr: 2.0, frequency: 1.0, roas: 1.8 },
        ],
      },
    })
    const r = detectTrendingUp(c)
    expect(r.trending).toBe(true)
    expect(r.metric).toBe('roas')
  })

  it('SÍ detecta trending cuando CTR sube en 2da mitad vs 1ra', () => {
    // 1ra mitad: CTR 1.0, 2da mitad: CTR 2.0 → mejora >10% relativo
    const c = makeCreative({
      metrics: {
        ...makeCreative().metrics,
        history: [
          { date: '2026-07-01', ctr: 1.0, frequency: 1.0, roas: 2.0 },
          { date: '2026-07-02', ctr: 1.0, frequency: 1.0, roas: 2.0 },
          { date: '2026-07-03', ctr: 1.0, frequency: 1.0, roas: 2.0 },
          { date: '2026-07-04', ctr: 2.0, frequency: 1.0, roas: 2.0 },
          { date: '2026-07-05', ctr: 2.0, frequency: 1.0, roas: 2.0 },
        ],
      },
    })
    const r = detectTrendingUp(c)
    expect(r.trending).toBe(true)
    expect(r.metric).toBe('ctr')
  })

  it('NO detecta trending cuando el ROAS se mantiene estable', () => {
    const c = makeCreative({
      metrics: {
        ...makeCreative().metrics,
        history: [
          { date: '2026-07-01', ctr: 2.0, frequency: 1.0, roas: 2.0 },
          { date: '2026-07-02', ctr: 2.0, frequency: 1.0, roas: 2.0 },
          { date: '2026-07-03', ctr: 2.0, frequency: 1.0, roas: 2.0 },
          { date: '2026-07-04', ctr: 2.0, frequency: 1.0, roas: 2.0 },
          { date: '2026-07-05', ctr: 2.0, frequency: 1.0, roas: 2.0 },
        ],
      },
    })
    expect(detectTrendingUp(c).trending).toBe(false)
  })
})

describe('getBenchmark', () => {
  // El cache es a nivel de módulo; entre tests hay que limpiarlo para que
  // un valor cacheado en un test anterior no contamine al siguiente.
  beforeEach(() => {
    invalidateBenchmarkCache()
  })

  it('devuelve el benchmark hardcodeado cuando no hay override en localStorage', () => {
    localStorage.removeItem('tracker-metricas:benchmarks')
    const b = getBenchmark('Berrinches')
    expect(b.niche).toBe('Berrinches')
    expect(b.ctrTarget).toBe(2.2)
  })

  it('devuelve el benchmark override desde localStorage si existe', () => {
    localStorage.setItem(
      'tracker-metricas:benchmarks',
      JSON.stringify({
        Berrinches: { ...BERRINCHES, ctrTarget: 5.0 },
      })
    )
    const b = getBenchmark('Berrinches')
    expect(b.ctrTarget).toBe(5.0)
    localStorage.removeItem('tracker-metricas:benchmarks')
  })

  it('devuelve benchmark genérico para nichos desconocidos', () => {
    const b = getBenchmark('Nicho Inventado')
    expect(b.niche).toBe('Nicho Inventado')
  })
})

describe('scoreCreative (integración)', () => {
  it('categoriza como ganador un creativo con métricas excelentes y confianza alta', () => {
    const c = makeCreative({
      metrics: {
        ...makeCreative().metrics,
        spend: 200,
        purchases: 30,
        // ROAS = 600/200 = 3.0 (target 2.5 ✓)
        revenue: 600,
        // CTR 1.8% (target 2.2, ~82% del target)
        // Pero al menos 65% para entrar en "bueno"+
        impressions: 5000,
        linkClicks: 150, // CTR = 3.0% > target 2.2
        videoPlays: 5000,
        hookViews: 2000, // 40% > target 30
        holdViews: 1200, // 24% > target 20
        frequency: 1.5,
      },
    })
    const s = scoreCreative(c)
    expect(s.category).toBe('ganador')
    expect(s.confidence).toBe('alta')
    expect(s.composite).toBeGreaterThanOrEqual(80)
  })

  it('NO marca como ganador un creativo con excelentes métricas pero confianza baja', () => {
    const c = makeCreative({
      metrics: {
        ...makeCreative().metrics,
        spend: 10, // < 15 → confianza baja
        purchases: 2, // < 3 → confianza baja
        revenue: 60,
      },
    })
    const s = scoreCreative(c)
    expect(s.confidence).toBe('baja')
    expect(s.category).not.toBe('ganador') // puede ser bueno o potencial, pero nunca ganador
  })
})

describe('métricas sin dato (null)', () => {
  // Creativo con buen hook (>= target 30) y hold > 0: condiciones para la nota
  // de "pierde tensión a mitad del video".
  const conHook = (retention95: number | null) =>
    makeCreative({
      metrics: { ...makeCreative().metrics, hookViews: 4000, retention95 },
    })

  it('retention95 bajo dispara la nota de pérdida de tensión', () => {
    const notes = buildDiagnosis(conHook(8), BERRINCHES, false, undefined, false, undefined, 'regular')
    expect(notes.some((n) => n.includes('pierde tensión'))).toBe(true)
  })

  it('retention95 null NO se trata como 0: no dispara la nota', () => {
    const notes = buildDiagnosis(conHook(null), BERRINCHES, false, undefined, false, undefined, 'regular')
    expect(notes.some((n) => n.includes('pierde tensión'))).toBe(false)
  })

  it('scoreCreative funciona con avgWatchTime y retención en null', () => {
    const c = makeCreative({
      metrics: {
        ...makeCreative().metrics,
        avgWatchTime: null,
        retention25: null,
        retention50: null,
        retention75: null,
        retention95: null,
      },
    })
    const s = scoreCreative(c)
    expect(Number.isFinite(s.composite)).toBe(true)
  })
})
