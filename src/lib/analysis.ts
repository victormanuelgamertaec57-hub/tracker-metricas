import type { Creative, CreativeAIAnalysis } from '../types'
import { APP_SECRET, callFunction } from './meta'

/** Cada cuánto se consulta el estado del análisis. */
export const POLL_INTERVAL_MS = 4_000
/** Si en este tiempo no aparece un análisis nuevo, el servidor no lo arrancó. */
export const NOT_STARTED_TIMEOUT_MS = 30_000
/** Más allá de esto en 'processing' se avisa que está tardando de más. */
export const STALLED_TIMEOUT_MS = 5 * 60_000
/** Errores de red seguidos antes de rendirse durante el sondeo. */
const MAX_CONSECUTIVE_FETCH_ERRORS = 3

/**
 * Extrae la key del blob desde la videoUrl guardada
 * (`/.netlify/functions/get-video?key=creative-videos/<id>.mp4`).
 * Devuelve null si el video no se subió a la app (p. ej. una URL de Meta).
 */
export function videoKeyFromUrl(videoUrl: string | undefined): string | null {
  if (!videoUrl) return null
  try {
    return new URL(videoUrl, window.location.origin).searchParams.get('key')
  } catch {
    return null
  }
}

/** Análisis guardado del creativo, o null si nunca se analizó. */
export async function getAnalysis(creativeId: string): Promise<CreativeAIAnalysis | null> {
  return callFunction<CreativeAIAnalysis>(
    `/.netlify/functions/get-creative-analysis?creativeId=${encodeURIComponent(creativeId)}`,
    undefined,
    { allowNotFound: true, errorFieldIsData: true }
  )
}

/**
 * Lanza el análisis en segundo plano. La función de Netlify responde 202
 * siempre (incluso si rechaza la petición), así que el resultado real solo se
 * conoce sondeando getAnalysis.
 */
export async function startAnalysis(creative: Creative, force: boolean): Promise<void> {
  const videoKey = videoKeyFromUrl(creative.videoUrl)
  if (!videoKey) throw new Error('Este creativo no tiene un video subido a la app.')

  // history y demographics no los usa el análisis: no se envían.
  const { history: _history, demographics: _demographics, ...metrics } = creative.metrics

  let response: Response
  try {
    response = await fetch('/.netlify/functions/analyze-creative-background', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(APP_SECRET ? { 'x-app-secret': APP_SECRET } : {}),
      },
      body: JSON.stringify({
        creativeId: creative.id,
        videoKey,
        adId: creative.metaAdId,
        niche: creative.niche,
        metrics,
        forceReanalyze: force,
      }),
    })
  } catch (err) {
    throw new Error(
      `No se pudo conectar con el servidor (${err instanceof Error ? err.message : 'error de red'}).`
    )
  }
  if (response.status !== 202 && !response.ok) {
    throw new Error(`No se pudo iniciar el análisis (HTTP ${response.status}).`)
  }
}

export type WaitOutcome =
  | { kind: 'done' | 'error'; analysis: CreativeAIAnalysis }
  | { kind: 'not_started' }
  | { kind: 'stalled'; analysis: CreativeAIAnalysis }
  | { kind: 'fetch_error'; message: string }
  | { kind: 'aborted' }

export interface WaitOptions {
  creativeId: string
  // Timestamp del análisis que existía antes de lanzar uno nuevo. Solo se
  // aceptan respuestas más nuevas: evita mostrar el resultado viejo como si
  // fuera el nuevo mientras el servidor aún no escribe 'processing'.
  // null = no había análisis previo (o se retoma uno en curso).
  baselineTimestamp: string | null
  signal: AbortSignal
  onProcessing?: (analysis: CreativeAIAnalysis) => void
  // Inyectables para tests.
  fetchAnalysis?: (creativeId: string) => Promise<CreativeAIAnalysis | null>
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(id)
      resolve()
    }, { once: true })
  })
}

/**
 * Sondea get-creative-analysis hasta que el análisis termine ('done' o
 * 'error'), no arranque, se estanque o se cancele.
 */
export async function waitForAnalysis(opts: WaitOptions): Promise<WaitOutcome> {
  const fetchAnalysis = opts.fetchAnalysis ?? getAnalysis
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? Date.now
  const startedAt = now()
  let consecutiveErrors = 0

  while (!opts.signal.aborted) {
    let analysis: CreativeAIAnalysis | null
    try {
      analysis = await fetchAnalysis(opts.creativeId)
      consecutiveErrors = 0
    } catch (err) {
      consecutiveErrors++
      if (consecutiveErrors >= MAX_CONSECUTIVE_FETCH_ERRORS) {
        return { kind: 'fetch_error', message: err instanceof Error ? err.message : String(err) }
      }
      analysis = null
    }
    if (opts.signal.aborted) break

    const elapsed = now() - startedAt
    const fresh =
      analysis !== null &&
      (opts.baselineTimestamp === null || analysis.timestamp > opts.baselineTimestamp)

    if (fresh && analysis) {
      if (analysis.status === 'done' || analysis.status === 'error') {
        return { kind: analysis.status, analysis }
      }
      opts.onProcessing?.(analysis)
      if (elapsed >= STALLED_TIMEOUT_MS) return { kind: 'stalled', analysis }
    } else if (elapsed >= NOT_STARTED_TIMEOUT_MS) {
      return { kind: 'not_started' }
    }

    await sleep(POLL_INTERVAL_MS, opts.signal)
  }
  return { kind: 'aborted' }
}

const fmtSec = (s: number) =>
  `${s.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`

/**
 * Motivos del aviso "posible video equivocado", en texto. Vacío si no hay
 * alerta. Cada motivo sale de un dato concreto: duración distinta a la del
 * anuncio en Meta, o tema del video distinto al del copy.
 */
export function videoAlertReasons(a: CreativeAIAnalysis | null): string[] {
  if (!a?.alertaVideo) return []
  const reasons: string[] = []
  const v = a.verificacionVideo
  if (v?.coincide === false && v.duracionSubidaSeg !== null && v.duracionMetaSeg !== null) {
    reasons.push(
      `Duración: el video subido dura ${fmtSec(v.duracionSubidaSeg)} y el del anuncio en Meta ${fmtSec(v.duracionMetaSeg)} (diferencia de ${fmtSec(v.diferenciaSeg ?? Math.abs(v.duracionSubidaSeg - v.duracionMetaSeg))}).`
    )
  }
  const c = a.claudeAnalysis?.coherenciaVideoCopy // ausente en análisis viejos
  if (c && c.coinciden === false) {
    reasons.push(`Tema: el video trata de "${c.temaVideo}" y el copy del anuncio de "${c.temaCopy}". ${c.motivo}`)
  }
  // alertaVideo sin motivo reconocible: igual se avisa.
  if (reasons.length === 0) reasons.push('El video subido no coincide con el anuncio de Meta.')
  return reasons
}

export { fmtSec }
