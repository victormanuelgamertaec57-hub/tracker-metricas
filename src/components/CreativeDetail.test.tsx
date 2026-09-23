import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreativeDetail } from './CreativeDetail'
import { AIAnalysisPanel } from './AIAnalysisPanel'
import { useCreativeAnalysis, type CreativeAnalysisState } from '../hooks/useCreativeAnalysis'
import { mockCreatives } from '../data/mockData'
import { checklistKey } from '../lib/analysisVisuals'
import type { Creative, CreativeAIAnalysis, Format } from '../types'

vi.mock('../hooks/useCreativeAnalysis', () => ({ useCreativeAnalysis: vi.fn() }))
vi.mock('../lib/meta', () => ({
  authenticateVideoUrl: (url: string) => url,
  syncCreativeWithMeta: vi.fn(),
  APP_SECRET: undefined,
  callFunction: vi.fn(),
}))

const creative: Creative = {
  ...mockCreatives[0],
  id: 'detail-test',
  videoUrl: '/video?key=creative-videos/test.mp4',
  videoDurationSec: 37.2,
}
const analysis: CreativeAIAnalysis = {
  status: 'done', creativeId: creative.id, timestamp: '2026-09-22T12:00:00Z',
  scoreCombinado: 72, rulesComposite: 64,
  claudeAnalysis: {
    scoreVisual: 80, analisisHook: 'Hook de prueba', analisisCopy: 'Copy de prueba',
    coherenciaVideoCopy: { coinciden: true, temaVideo: 'Crianza', temaCopy: 'Crianza', motivo: 'Mismo tema' },
    riesgoCumplimiento: { nivel: 'alto', frasesDeRiesgo: ['Frase de prueba'], motivo: 'Motivo de prueba' },
    razones: ['Razón de prueba'], recomendaciones: ['Recomendación de prueba'],
  },
  verificacionVideo: { duracionSubidaSeg: 37.2, duracionMetaSeg: 37.2, diferenciaSeg: 0, coincide: true },
}

let host: HTMLDivElement
let root: Root
let state: CreativeAnalysisState

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  state = { phase: 'idle', analysis: null, errorMessage: null, processingSince: null, analyze: vi.fn(), keepWaiting: vi.fn() }
  vi.mocked(useCreativeAnalysis).mockReturnValue(state)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

function button(text: string) {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
  if (!found) throw new Error(`Botón no encontrado: ${text}`)
  return found
}
function click(el: HTMLElement) { act(() => el.click()) }
function renderPanel(overrides: Partial<CreativeAnalysisState> = {}, item = creative) {
  state = { ...state, ...overrides }
  act(() => root.render(<AIAnalysisPanel creative={item} state={state} />))
}

describe('detalle: formato y datos preservados', () => {
  it.each<[Format, string]>([['9:16', '9/16'], ['1:1', '1/1'], ['4:5', '4/5'], ['16:9', '16/9']])(
    'mantiene la proporción %s y los controles del reproductor', (format, ratio) => {
      act(() => root.render(<CreativeDetail creative={{ ...creative, format }} onBack={vi.fn()} onSync={vi.fn()} />))
      const video = host.querySelector('video')!
      expect(video).not.toBeNull()
      expect(video.controls).toBe(true)
      expect(video.getAttribute('src')).toBe(creative.videoUrl)
      const ratioElement = video.closest('[style*="aspect-ratio"]') as HTMLElement | null
      expect(ratioElement?.style.aspectRatio.replaceAll(' ', '')).toBe(ratio)
      expect(host.textContent).toContain(format)
    }
  )

  it('conserva sin dato, demografía, diagnóstico y navegación sin video', () => {
    const onBack = vi.fn()
    const item = { ...creative, videoUrl: undefined, metrics: { ...creative.metrics, avgWatchTime: null, retention25: null } }
    act(() => root.render(<CreativeDetail creative={item} onBack={onBack} onSync={vi.fn()} />))
    expect(host.querySelector('video')).toBeNull()
    expect(host.textContent).toContain('sin dato')
    expect(host.textContent).toContain('Por edad')
    expect(host.textContent).toContain('Por ubicación')
    expect(host.textContent).toContain('Análisis a fondo')
    click(button('Volver'))
    expect(onBack).toHaveBeenCalledOnce()
  })
})

describe('acordeón: interacción y persistencia', () => {
  it('abre riesgo inicialmente y permite solo una sección abierta', () => {
    renderPanel({ phase: 'done', analysis })
    expect(button('Riesgo de cumplimiento').getAttribute('aria-expanded')).toBe('true')
    click(button('Resumen'))
    expect(host.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(1)
    expect(button('Riesgo de cumplimiento').getAttribute('aria-expanded')).toBe('false')
    expect(host.textContent).toContain('Razón de prueba')
    click(button('Resumen'))
    expect(host.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(0)
  })

  it('conserva el checklist al cerrar/abrir y lo reinicia con nuevo análisis', () => {
    renderPanel({ phase: 'done', analysis })
    click(button('Recomendaciones'))
    click(host.querySelector('input[type="checkbox"]')!)
    expect(localStorage.getItem(checklistKey(creative.id, analysis.timestamp))).toBe('[0]')
    click(button('Hook'))
    click(button('Recomendaciones'))
    expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true)
    renderPanel({ phase: 'done', analysis: { ...analysis, timestamp: '2026-09-22T13:00:00Z' } })
    expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false)
  })

  it('mantiene la alerta visible aunque verificación esté cerrada', () => {
    renderPanel({ phase: 'done', analysis: { ...analysis, alertaVideo: 'posible video equivocado',
      verificacionVideo: { duracionSubidaSeg: 37.2, duracionMetaSeg: 18.3, diferenciaSeg: 18.9, coincide: false } } })
    const alert = host.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('Posible video equivocado')
    expect(alert.closest('[hidden]')).toBeNull()
    expect(button('Verificación de video').getAttribute('aria-expanded')).toBe('false')
  })
})

describe('estados y acciones IA conservados', () => {
  it('sin análisis permite analizar y sin video deshabilita el inicio', () => {
    renderPanel()
    click(button('Analizar con IA'))
    expect(state.analyze).toHaveBeenCalledWith(false)
    renderPanel({}, { ...creative, videoUrl: undefined })
    expect(button('Analizar con IA').disabled).toBe(true)
  })

  it('muestra carga y procesamiento sin controles de inicio duplicados', () => {
    renderPanel({ phase: 'loading' })
    expect(host.textContent).toContain('Buscando análisis guardado')
    renderPanel({ phase: 'processing', processingSince: Date.now() - 2000 })
    expect(host.textContent).toContain('Analizando el creativo')
    expect(host.querySelector('[aria-live="polite"]')).not.toBeNull()
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Analizar con IA'))).toBe(false)
  })

  it('demora permite seguir esperando o reanálisis forzado', () => {
    renderPanel({ phase: 'stalled' })
    click(button('Seguir esperando'))
    click(button('Volver a analizar'))
    expect(state.keepWaiting).toHaveBeenCalledOnce()
    expect(state.analyze).toHaveBeenCalledWith(true)
  })

  it.each([null, { ...analysis, status: 'error' as const }])('reintenta error respetando existencia de análisis (%j)', (saved) => {
    renderPanel({ phase: 'error', analysis: saved, errorMessage: 'Error de prueba' })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Error de prueba')
    click(button('Reintentar'))
    expect(state.analyze).toHaveBeenCalledWith(saved !== null)
  })

  it('resultado conserva reanálisis forzado', () => {
    renderPanel({ phase: 'done', analysis })
    click(button('Volver a analizar'))
    expect(state.analyze).toHaveBeenCalledWith(true)
  })
})
