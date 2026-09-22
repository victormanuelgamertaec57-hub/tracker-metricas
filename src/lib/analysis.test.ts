import { describe, it, expect } from 'vitest'
import type { CreativeAIAnalysis } from '../types'
import {
  waitForAnalysis,
  videoAlertReasons,
  videoKeyFromUrl,
  NOT_STARTED_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  STALLED_TIMEOUT_MS,
} from './analysis'

const OLD = '2026-09-21T21:57:50.050Z'
const NEW = '2026-09-21T23:10:00.000Z'

const processing = (timestamp: string): CreativeAIAnalysis => ({ status: 'processing', creativeId: 'c1', timestamp })
const done = (timestamp: string): CreativeAIAnalysis => ({ status: 'done', creativeId: 'c1', timestamp })

/**
 * Reloj falso: sleep avanza el tiempo en vez de esperar. fetchAnalysis
 * devuelve las respuestas en orden (la última se repite).
 */
function harness(responses: Array<CreativeAIAnalysis | null | Error>) {
  let t = 0
  let i = 0
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
    fetchAnalysis: async () => {
      const r = responses[Math.min(i++, responses.length - 1)]
      if (r instanceof Error) throw r
      return r
    },
    calls: () => i,
  }
}

const signal = () => new AbortController().signal

describe('waitForAnalysis', () => {
  it('ignora el análisis viejo mientras el servidor aún no escribe el nuevo', async () => {
    // Tras "Volver a analizar", el GET sigue devolviendo el done viejo un rato.
    const h = harness([done(OLD), done(OLD), processing(NEW), done(NEW)])
    const out = await waitForAnalysis({ creativeId: 'c1', baselineTimestamp: OLD, signal: signal(), ...h })
    expect(out).toEqual({ kind: 'done', analysis: done(NEW) })
  })

  it('sin análisis previo acepta el primero que llegue', async () => {
    const h = harness([null, processing(NEW), done(NEW)])
    const out = await waitForAnalysis({ creativeId: 'c1', baselineTimestamp: null, signal: signal(), ...h })
    expect(out.kind).toBe('done')
  })

  it('devuelve el estado error del análisis', async () => {
    const err: CreativeAIAnalysis = { status: 'error', creativeId: 'c1', timestamp: NEW, error: 'Claude API error (400)' }
    const h = harness([processing(NEW), err])
    const out = await waitForAnalysis({ creativeId: 'c1', baselineTimestamp: null, signal: signal(), ...h })
    expect(out).toEqual({ kind: 'error', analysis: err })
  })

  it('si nunca aparece un análisis nuevo, avisa que no arrancó', async () => {
    // El POST siempre da 202: un 400/409 del servidor solo se nota así.
    const h = harness([null])
    const out = await waitForAnalysis({ creativeId: 'c1', baselineTimestamp: null, signal: signal(), ...h })
    expect(out.kind).toBe('not_started')
    expect(h.now()).toBeGreaterThanOrEqual(NOT_STARTED_TIMEOUT_MS)
  })

  it('en processing por más de 5 minutos queda como stalled', async () => {
    const h = harness([processing(NEW)])
    const out = await waitForAnalysis({ creativeId: 'c1', baselineTimestamp: null, signal: signal(), ...h })
    expect(out.kind).toBe('stalled')
    expect(h.now()).toBeGreaterThanOrEqual(STALLED_TIMEOUT_MS)
  })

  it('tolera errores de red aislados y se rinde tras 3 seguidos', async () => {
    const tolera = harness([new Error('red'), processing(NEW), done(NEW)])
    expect((await waitForAnalysis({ creativeId: 'c1', baselineTimestamp: null, signal: signal(), ...tolera })).kind).toBe('done')

    const cae = harness([new Error('red')])
    const out = await waitForAnalysis({ creativeId: 'c1', baselineTimestamp: null, signal: signal(), ...cae })
    expect(out).toEqual({ kind: 'fetch_error', message: 'red' })
    expect(cae.calls()).toBe(3)
  })

  it('se detiene al cancelar (salir del detalle)', async () => {
    const controller = new AbortController()
    const h = harness([processing(NEW)])
    const sleep = async (ms: number) => {
      await h.sleep(ms)
      if (h.now() >= POLL_INTERVAL_MS * 2) controller.abort()
    }
    const out = await waitForAnalysis({ creativeId: 'c1', baselineTimestamp: null, signal: controller.signal, ...h, sleep })
    expect(out.kind).toBe('aborted')
  })
})

describe('videoAlertReasons', () => {
  const base: CreativeAIAnalysis = {
    status: 'done',
    creativeId: 'c1',
    timestamp: NEW,
    alertaVideo: 'posible video equivocado',
    verificacionVideo: { duracionSubidaSeg: 37.2, duracionMetaSeg: 18.3, diferenciaSeg: 18.9, coincide: false },
    claudeAnalysis: {
      coherenciaVideoCopy: { coinciden: false, temaVideo: 'crianza', temaCopy: 'hormonas', motivo: 'Temas distintos.' },
      scoreVisual: 70,
      analisisHook: '',
      analisisCopy: '',
      riesgoCumplimiento: { nivel: 'alto', frasesDeRiesgo: [], motivo: '' },
      razones: [],
      recomendaciones: [],
    },
  }

  it('sin alertaVideo no hay motivos', () => {
    expect(videoAlertReasons({ ...base, alertaVideo: null })).toEqual([])
    expect(videoAlertReasons(null)).toEqual([])
  })

  it('lista la duración y el tema cuando ambos fallan', () => {
    const r = videoAlertReasons(base)
    expect(r).toHaveLength(2)
    expect(r[0]).toContain('37,2 s')
    expect(r[0]).toContain('18,3 s')
    expect(r[1]).toContain('crianza')
    expect(r[1]).toContain('hormonas')
  })

  it('solo el motivo de tema si la duración no se pudo comparar', () => {
    const r = videoAlertReasons({
      ...base,
      verificacionVideo: { duracionSubidaSeg: 37.2, duracionMetaSeg: null, diferenciaSeg: null, coincide: null },
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatch(/^Tema:/)
  })
})

describe('videoKeyFromUrl', () => {
  it('extrae la key de la URL de get-video', () => {
    expect(videoKeyFromUrl('/.netlify/functions/get-video?key=creative-videos%2Fabc.mp4')).toBe('creative-videos/abc.mp4')
  })
  it('null si no hay video o no es un video subido a la app', () => {
    expect(videoKeyFromUrl(undefined)).toBeNull()
    expect(videoKeyFromUrl('https://video.xx.fbcdn.net/v/abc.mp4')).toBeNull()
  })
})
