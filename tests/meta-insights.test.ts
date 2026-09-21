import { describe, it, expect } from 'vitest'
import { normalizeAggregate } from '../netlify/functions/meta-insights'

const act = (value: number) => [{ action_type: 'video_view', value: String(value) }]

// Fila con la forma real de la Graph API: las métricas de video llegan como
// listas de acciones, no como números. Valores del ad de "Anuncio 2".
function row(overrides: Record<string, unknown> = {}) {
  return {
    date_start: '2026-05-27',
    date_stop: '2026-09-21',
    spend: '54.44',
    impressions: '16916',
    clicks: '1100',
    inline_link_clicks: '1004',
    reach: '16000',
    frequency: '1.05',
    actions: [
      { action_type: 'video_view', value: '8334' },
      { action_type: 'link_click', value: '1004' },
    ],
    video_play_actions: act(13844),
    video_thruplay_watched_actions: act(3289),
    video_p25_watched_actions: act(7044),
    video_p50_watched_actions: act(4891),
    video_p75_watched_actions: act(3568),
    video_p95_watched_actions: act(2764),
    video_avg_time_watched_actions: act(11),
    ...overrides,
  }
}

describe('normalizeAggregate (meta-insights)', () => {
  it('lee video_play_actions como lista de acciones (no da 0)', () => {
    // Regresion: parseInt sobre la lista daba NaN -> 0, y el fallback a p25
    // dejaba hook rate en 100%.
    const m = normalizeAggregate([row()] as never)
    expect(m.videoPlays).toBe(13844)
  })

  it('hook = reproducciones de 3s y hold = ThruPlays', () => {
    const m = normalizeAggregate([row()] as never)
    expect(m.hookViews).toBe(8334)
    expect(m.holdViews).toBe(3289)
  })

  it('retención = pXX / reproducciones y tiempo promedio de Meta', () => {
    const m = normalizeAggregate([row()] as never)
    expect(m.retention25).toBeCloseTo(50.9, 1)
    expect(m.retention95).toBeCloseTo(20.0, 1)
    expect(m.avgWatchTime).toBe(11)
  })

  it('sin campos de retención ni tiempo promedio -> null (sin dato), no 0', () => {
    const m = normalizeAggregate([
      row({
        video_p25_watched_actions: undefined,
        video_p50_watched_actions: undefined,
        video_p75_watched_actions: undefined,
        video_p95_watched_actions: undefined,
        video_avg_time_watched_actions: undefined,
      }),
    ] as never)
    expect(m.retention25).toBeNull()
    expect(m.retention50).toBeNull()
    expect(m.retention75).toBeNull()
    expect(m.retention95).toBeNull()
    expect(m.avgWatchTime).toBeNull()
  })

  it('listas vacías ([]) de retención y tiempo promedio -> null, no 0', () => {
    const m = normalizeAggregate([
      row({
        video_p25_watched_actions: [],
        video_p50_watched_actions: [],
        video_p75_watched_actions: [],
        video_p95_watched_actions: [],
        video_avg_time_watched_actions: [],
      }),
    ] as never)
    expect(m.retention25).toBeNull()
    expect(m.retention95).toBeNull()
    expect(m.avgWatchTime).toBeNull()
  })

  it('promedia el tiempo visto ponderado por reproducciones de cada día', () => {
    const m = normalizeAggregate([
      row({ video_play_actions: act(100), video_avg_time_watched_actions: act(10) }),
      row({ video_play_actions: act(300), video_avg_time_watched_actions: act(2) }),
    ] as never)
    expect(m.avgWatchTime).toBeCloseTo(4, 5) // (10*100 + 2*300) / 400
  })
})
