import type {
  ChatComparison,
  ChatCreativeSummary,
  ChatMetric,
  ChatResponse,
  ChatTurn,
  Creative,
} from '../types'
import { callFunction } from './meta'
import { getBenchmark, scoreCreative } from './scoring'
import { sharedScaleMax } from './analysisVisuals'

export const CHAT_STORAGE_KEY = 'tracker-metricas:chat'
/** Pares pregunta + respuesta que se mandan como contexto (el servidor aplica el mismo tope). */
export const CHAT_HISTORY_PAIRS = 10
/** Tope de mensajes guardados en el navegador, para no crecer sin fin. */
const MAX_STORED_MESSAGES = 200
// El servidor corta a los ~9 s; esto solo cubre que la red se cuelgue.
const CLIENT_TIMEOUT_MS = 15_000
/** Mismo tope que el servidor (MAX_CHAT_CREATIVES): se mandan los de más gasto. */
export const CHAT_MAX_CREATIVES = 100

const CHAT_METRICS: readonly ChatMetric[] = ['hookRate', 'holdRate', 'ctr', 'score']

export const SUGGESTED_QUESTIONS = [
  { label: 'Mejor creativo', text: '¿Cuál es mi mejor creativo ahora y por qué?' },
  { label: 'Comparar nichos', text: 'Compara el rendimiento de mis nichos contra sus objetivos.' },
  { label: 'Alertas activas', text: '¿Qué alertas activas tengo (video equivocado, fatiga, métricas bajo objetivo)?' },
] as const

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  comparaciones?: ChatComparison[]
}

// Datos viejos de localStorage pueden traer NaN/undefined: se mandan como 0 en
// vez de que el servidor descarte el creativo entero.
const finite = (n: number) => (Number.isFinite(n) ? n : 0)
const round = (n: number, decimals: number) => Math.round(finite(n) * 10 ** decimals) / 10 ** decimals

/**
 * Resumen compacto de cada creativo para el chat, con el mismo scoring que usa
 * la app (scoreCreative → computeDerivedMetrics / computeSubScores) y los
 * objetivos de su nicho.
 */
export function buildCreativeSummaries(creatives: Creative[]): ChatCreativeSummary[] {
  return creatives.map((c) => {
    const s = scoreCreative(c)
    const b = getBenchmark(c.niche)
    // Sin impresiones las tasas salen 0 por división protegida: es "sin dato".
    const has = c.metrics.impressions > 0
    return {
      id: c.id,
      nombre: c.name,
      nicho: c.niche,
      categoria: s.category,
      score: finite(s.composite),
      confianza: s.confidence,
      hookRate: has ? round(s.derived.hookRate, 1) : null,
      hookRateObjetivo: finite(b.hookRateTarget),
      holdRate: has ? round(s.derived.holdRate, 1) : null,
      holdRateObjetivo: finite(b.holdRateTarget),
      ctr: has ? round(s.derived.ctr, 2) : null,
      ctrObjetivo: finite(b.ctrTarget),
      gasto: round(c.metrics.spend, 2),
      compras: finite(c.metrics.purchases),
      roas: round(s.derived.roas, 2),
      fatiga: s.isFatigued,
    }
  })
}

/** Creativos que entran al chat: los de más gasto primero, hasta el tope del servidor. */
export function chatCreatives(creatives: Creative[]): Creative[] {
  return [...creatives]
    .sort((a, b) => finite(b.metrics.spend) - finite(a.metrics.spend))
    .slice(0, CHAT_MAX_CREATIVES)
}

/** Historial para el servidor: solo texto, sin las comparaciones ya dibujadas. */
export function toHistoryPayload(messages: ChatMessage[]): ChatTurn[] {
  // Margen de sobra: el servidor se queda con los últimos pares completos.
  return messages.slice(-(CHAT_HISTORY_PAIRS * 2 + 4)).map((m) => ({ role: m.role, text: m.text }))
}

// ---------------------------------------------------------------------------
// Historial en localStorage (una sola conversación)
// ---------------------------------------------------------------------------

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function parseComparisons(raw: unknown): ChatComparison[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const list = raw.filter(
    (c): c is ChatComparison =>
      !!c &&
      typeof c === 'object' &&
      CHAT_METRICS.includes((c as ChatComparison).metrica) &&
      Array.isArray((c as ChatComparison).creativeIds) &&
      (c as ChatComparison).creativeIds.every((id) => typeof id === 'string')
  )
  return list.length ? list : undefined
}

/**
 * Conversación guardada. Valida cada mensaje (incluidas las comparaciones):
 * un dato corrupto en localStorage no puede romper la app en cada recarga.
 */
export function loadChatHistory(storage: Storage | undefined = browserStorage()): ChatMessage[] {
  try {
    const raw = storage?.getItem(CHAT_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const messages: ChatMessage[] = []
    for (const m of parsed) {
      if (!m || typeof m !== 'object') continue
      const { id, role, text, comparaciones } = m as Record<string, unknown>
      if (typeof id !== 'string' || (role !== 'user' && role !== 'assistant') || typeof text !== 'string') continue
      const comps = role === 'assistant' ? parseComparisons(comparaciones) : undefined
      messages.push(comps ? { id, role, text, comparaciones: comps } : { id, role, text })
    }
    return messages
  } catch {
    return []
  }
}

export function saveChatHistory(messages: ChatMessage[], storage: Storage | undefined = browserStorage()): void {
  try {
    if (messages.length === 0) storage?.removeItem(CHAT_STORAGE_KEY)
    else storage?.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)))
  } catch {
    // Sin localStorage (modo privado, cuota llena): la conversación solo vive en memoria.
  }
}

// ---------------------------------------------------------------------------
// Comparaciones → barras con datos reales
// ---------------------------------------------------------------------------

export const METRIC_LABEL: Record<ChatMetric, string> = {
  hookRate: 'Hook rate',
  holdRate: 'Hold rate',
  ctr: 'CTR',
  score: 'Score',
}

export interface ComparisonRow {
  creativeId: string
  label: string
  value: number | null
  // null en el score: no tiene objetivo por nicho.
  target: number | null
}

export interface ComparisonView {
  metrica: ChatMetric
  titulo: string
  decimals: number
  unit: string
  scaleMax: number
  rows: ComparisonRow[]
}

/**
 * Arma las barras de una comparación con los valores y objetivos actuales de
 * cada creativo (no los que dijo el modelo). Todas las barras comparten
 * escala. Devuelve null si quedan menos de 2 creativos (p. ej. se borraron).
 */
export function buildComparisonView(comparison: ChatComparison, creatives: Creative[]): ComparisonView | null {
  const byId = new Map(creatives.map((c) => [c.id, c]))
  const selected = comparison.creativeIds.map((id) => byId.get(id)).filter((c): c is Creative => !!c)
  if (selected.length < 2) return null
  const multiNiche = new Set(selected.map((c) => c.niche)).size > 1
  const summaries = buildCreativeSummaries(selected)

  const rows: ComparisonRow[] = summaries.map((s) => {
    const label = multiNiche ? `${s.nombre} · ${s.nicho}` : s.nombre
    switch (comparison.metrica) {
      case 'hookRate':
        return { creativeId: s.id, label, value: s.hookRate, target: s.hookRateObjetivo }
      case 'holdRate':
        return { creativeId: s.id, label, value: s.holdRate, target: s.holdRateObjetivo }
      case 'ctr':
        return { creativeId: s.id, label, value: s.ctr, target: s.ctrObjetivo }
      case 'score':
        return { creativeId: s.id, label, value: s.score, target: null }
    }
  })

  const isScore = comparison.metrica === 'score'
  return {
    metrica: comparison.metrica,
    titulo: METRIC_LABEL[comparison.metrica],
    decimals: comparison.metrica === 'ctr' ? 1 : 0,
    unit: isScore ? '' : '%',
    scaleMax: isScore ? 100 : sharedScaleMax(rows),
    rows,
  }
}

// ---------------------------------------------------------------------------
// Llamada al servidor
// ---------------------------------------------------------------------------

const TIMEOUT_MESSAGE = 'La respuesta tardó demasiado. Intenta de nuevo.'

export async function sendChat(message: string, history: ChatMessage[], creatives: Creative[]): Promise<ChatResponse> {
  const signal = AbortSignal.timeout(CLIENT_TIMEOUT_MS)
  let result: ChatResponse | null
  try {
    result = await callFunction<ChatResponse>('/.netlify/functions/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: toHistoryPayload(history),
        creatives: buildCreativeSummaries(chatCreatives(creatives)),
      }),
      signal,
    })
  } catch (err) {
    // callFunction lo reporta como problema de conexión; en realidad es el tope de espera.
    if (signal.aborted) throw new Error(TIMEOUT_MESSAGE)
    // El servidor ya manda un mensaje pensado para el usuario: sin el prefijo técnico.
    const msg = err instanceof Error ? err.message.replace(/^Error de la función: /, '') : String(err)
    throw new Error(msg)
  }
  if (!result || typeof result.respuesta !== 'string') {
    throw new Error('Respuesta inválida del servidor.')
  }
  return { respuesta: result.respuesta, comparaciones: Array.isArray(result.comparaciones) ? result.comparaciones : [] }
}
