import { describe, it, expect } from 'vitest'
import type { Creative } from '../types'
import {
  CHAT_STORAGE_KEY,
  buildComparisonView,
  buildCreativeSummaries,
  chatCreatives,
  CHAT_MAX_CREATIVES,
  loadChatHistory,
  saveChatHistory,
  toHistoryPayload,
  type ChatMessage,
} from './chat'
import { DEFAULT_BENCHMARKS } from './scoring'

function makeCreative(overrides: Partial<Omit<Creative, 'metrics'>> & { metrics?: Partial<Creative['metrics']> } = {}): Creative {
  const { metrics, ...rest } = overrides
  return {
    id: 'c-1',
    name: 'Creativo 1',
    niche: 'Berrinches',
    format: '9:16',
    launchDate: '2026-07-01',
    ...rest,
    metrics: {
      spend: 100,
      impressions: 10000,
      clicks: 200,
      linkClicks: 180,
      videoPlays: 5000,
      hookViews: 3000,
      holdViews: 1600,
      purchases: 8,
      revenue: 240,
      avgWatchTime: 6.5,
      frequency: 2.0,
      retention25: 70,
      retention50: 40,
      retention75: 20,
      retention95: 8,
      history: [],
      ...metrics,
    },
  }
}

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  }
}

describe('buildCreativeSummaries', () => {
  it('usa el scoring de la app y los objetivos del nicho', () => {
    const [s] = buildCreativeSummaries([makeCreative()])
    const b = DEFAULT_BENCHMARKS['Berrinches']
    expect(s).toMatchObject({
      id: 'c-1',
      nombre: 'Creativo 1',
      hookRate: 30,
      holdRate: 16,
      ctr: 1.8,
      hookRateObjetivo: b.hookRateTarget,
      holdRateObjetivo: b.holdRateTarget,
      ctrObjetivo: b.ctrTarget,
      gasto: 100,
      compras: 8,
      roas: 2.4,
    })
    expect(typeof s.score).toBe('number')
  })

  it('números corruptos de datos viejos se mandan como 0, no NaN', () => {
    const [s] = buildCreativeSummaries([makeCreative({ metrics: { spend: NaN, purchases: undefined as unknown as number } })])
    expect(s.gasto).toBe(0)
    expect(s.compras).toBe(0)
    expect(Number.isFinite(s.score)).toBe(true)
  })

  it('sin impresiones las tasas son "sin dato" (null), no 0', () => {
    const [s] = buildCreativeSummaries([makeCreative({ metrics: { impressions: 0 } })])
    expect(s.hookRate).toBeNull()
    expect(s.holdRate).toBeNull()
    expect(s.ctr).toBeNull()
  })
})

describe('buildComparisonView', () => {
  const a = makeCreative({ id: 'a', name: 'A', metrics: { hookViews: 2000 } }) // hook 20 %
  const b = makeCreative({ id: 'b', name: 'B', metrics: { hookViews: 4000 } }) // hook 40 %

  it('usa valores reales y una escala común para todas las barras', () => {
    const v = buildComparisonView({ metrica: 'hookRate', creativeIds: ['a', 'b'] }, [a, b])!
    expect(v.rows.map((r) => r.value)).toEqual([20, 40])
    // max(objetivo 30 × 2, 40 × 1.1) = 60
    expect(v.scaleMax).toBe(60)
    expect(v.unit).toBe('%')
  })

  it('cada creativo lleva el objetivo de su propio nicho y el nicho en la etiqueta', () => {
    const h = makeCreative({ id: 'h', name: 'H', niche: 'Método Hormonal' })
    const v = buildComparisonView({ metrica: 'ctr', creativeIds: ['a', 'h'] }, [a, h])!
    expect(v.rows.map((r) => r.target)).toEqual([DEFAULT_BENCHMARKS['Berrinches'].ctrTarget, DEFAULT_BENCHMARKS['Método Hormonal'].ctrTarget])
    expect(v.rows[1].label).toBe('H · Método Hormonal')
  })

  it('el score va en escala 0-100 sin objetivo', () => {
    const v = buildComparisonView({ metrica: 'score', creativeIds: ['a', 'b'] }, [a, b])!
    expect(v.scaleMax).toBe(100)
    expect(v.rows.every((r) => r.target === null)).toBe(true)
    expect(v.unit).toBe('')
  })

  it('null si quedan menos de 2 creativos (ids borrados)', () => {
    expect(buildComparisonView({ metrica: 'ctr', creativeIds: ['a', 'borrado'] }, [a, b])).toBeNull()
  })
})

describe('historial del chat', () => {
  const msgs: ChatMessage[] = [
    { id: '1', role: 'user', text: 'hola' },
    { id: '2', role: 'assistant', text: 'respuesta', comparaciones: [{ metrica: 'ctr', creativeIds: ['a', 'b'] }] },
  ]

  it('guarda y recupera la conversación; vacía borra la clave', () => {
    const s = memoryStorage()
    saveChatHistory(msgs, s)
    expect(loadChatHistory(s)).toEqual(msgs)
    saveChatHistory([], s)
    expect(s.getItem(CHAT_STORAGE_KEY)).toBeNull()
  })

  it('tolera datos corruptos o con forma inválida', () => {
    const s = memoryStorage()
    s.setItem(CHAT_STORAGE_KEY, '{no json')
    expect(loadChatHistory(s)).toEqual([])
    s.setItem(CHAT_STORAGE_KEY, JSON.stringify([{ id: 'x', role: 'system', text: 'x' }, null, msgs[0]]))
    expect(loadChatHistory(s)).toEqual([msgs[0]])
    expect(loadChatHistory(undefined)).toEqual([])
  })

  it('descarta comparaciones guardadas con forma inválida (no rompe la app al recargar)', () => {
    const s = memoryStorage()
    s.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify([
        { id: '1', role: 'assistant', text: 'a', comparaciones: 'no-array' },
        { id: '2', role: 'assistant', text: 'b', comparaciones: [{ metrica: 'roas', creativeIds: ['x'] }, { metrica: 'ctr', creativeIds: 'x' }] },
        { id: '3', role: 'assistant', text: 'c', comparaciones: [{ metrica: 'ctr', creativeIds: ['a', 'b'] }] },
      ])
    )
    expect(loadChatHistory(s)).toEqual([
      { id: '1', role: 'assistant', text: 'a' },
      { id: '2', role: 'assistant', text: 'b' },
      { id: '3', role: 'assistant', text: 'c', comparaciones: [{ metrica: 'ctr', creativeIds: ['a', 'b'] }] },
    ])
  })

  it('al servidor solo va el texto, sin las comparaciones', () => {
    expect(toHistoryPayload(msgs)).toEqual([
      { role: 'user', text: 'hola' },
      { role: 'assistant', text: 'respuesta' },
    ])
  })
})

describe('chatCreatives', () => {
  it('manda primero los de más gasto y corta en el tope', () => {
    const list = Array.from({ length: CHAT_MAX_CREATIVES + 3 }, (_, i) => makeCreative({ id: `c${i}`, metrics: { spend: i } }))
    const out = chatCreatives(list)
    expect(out).toHaveLength(CHAT_MAX_CREATIVES)
    expect(out[0].id).toBe(`c${CHAT_MAX_CREATIVES + 2}`)
    expect(out.some((c) => c.id === 'c0')).toBe(false)
  })
})
