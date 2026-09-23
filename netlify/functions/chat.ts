import type { Handler, HandlerEvent } from '@netlify/functions'
import { getStore, connectLambda } from '@netlify/blobs'
import { isAuthorized } from './_auth'
import {
  CHAT_MAX_TOKENS,
  CHAT_MODEL,
  CHAT_RESPONSE_SCHEMA,
  CHAT_SYSTEM_INSTRUCTIONS,
  ChatReplyError,
  analysisDigest,
  buildCreativesContext,
  parseChatReply,
  parseChatRequest,
  trimHistory,
  type AnalysisDigest,
} from './_chat'
import type { CreativeAIAnalysis } from '../../src/types'

const ANALYSIS_STORE = 'creative-ai-analysis'

// Función normal (no background): Netlify la corta a los 10 s. Todo el trabajo
// tiene que entrar en este presupuesto, contado desde que llega la petición.
const DEADLINE_MS = 9_000
// Leer los análisis es opcional: si el Blob store tarda, se responde sin ellos.
const BLOB_TIMEOUT_MS = 2_000
const MIN_CLAUDE_MS = 3_000

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/** Resumen de los análisis guardados de cada creativo. Nunca falla: sin análisis se sigue igual. */
async function readDigests(ids: string[]): Promise<Map<string, AnalysisDigest>> {
  const digests = new Map<string, AnalysisDigest>()
  if (ids.length === 0) return digests
  const store = getStore(ANALYSIS_STORE)
  const reads = Promise.all(
    ids.map(async (id) => {
      try {
        const a = (await store.get(id, { type: 'json' })) as CreativeAIAnalysis | null
        const d = analysisDigest(a)
        if (d) digests.set(id, d)
      } catch (err) {
        console.error(`chat: no se pudo leer el análisis de ${id}:`, err)
      }
    })
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn('chat: lectura de análisis excedió el tiempo; se responde con lo leído')
      resolve()
    }, BLOB_TIMEOUT_MS)
  })
  await Promise.race([reads, timeout])
  clearTimeout(timer)
  // Copia: lecturas que terminen después del corte no cambian el prompt ya armado.
  return new Map(digests)
}

const handler: Handler = async (event: HandlerEvent) => {
  const startedAt = Date.now()

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  if (!isAuthorized(event)) return json(401, { error: 'Unauthorized' })

  let rawBody: unknown
  try {
    rawBody = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  const parsed = parseChatRequest(rawBody)
  if (!parsed.ok) return json(400, { error: parsed.error })
  const { message, history, creatives } = parsed.value

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured on server' })

  let digests = new Map<string, AnalysisDigest>()
  try {
    connectLambda(event as any)
    digests = await readDigests(creatives.map((c) => c.id))
  } catch (err) {
    // Sin Blob store se responde igual, solo que sin los análisis de IA.
    console.error('chat: sin acceso al Blob store:', err)
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }
  if (process.env.ANTHROPIC_WORKSPACE_ID) {
    headers['anthropic-workspace-id'] = process.env.ANTHROPIC_WORKSPACE_ID
  }

  const remaining = Math.max(MIN_CLAUDE_MS, DEADLINE_MS - (Date.now() - startedAt))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), remaining)

  let data: unknown
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: CHAT_MODEL,
        max_tokens: CHAT_MAX_TOKENS,
        system: [
          { type: 'text', text: CHAT_SYSTEM_INSTRUCTIONS },
          // Instrucciones + creativos forman el prefijo cacheable. En Haiku 4.5
          // el mínimo es 4096 tokens: con pocos creativos no se cachea (sin
          // error) y empieza a cachearse solo cuando la lista crece.
          {
            type: 'text',
            text: buildCreativesContext(creatives, digests),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          ...trimHistory(history).map((t) => ({ role: t.role, content: t.text })),
          { role: 'user', content: message },
        ],
        output_config: {
          format: { type: 'json_schema', schema: CHAT_RESPONSE_SCHEMA },
        },
      }),
    })
    if (!response.ok) {
      console.error(`chat: Claude API error (${response.status}):`, (await response.text()).slice(0, 1000))
      const busy = response.status === 429 || response.status === 529
      return json(502, {
        error: busy
          ? 'Claude está saturado en este momento. Intenta de nuevo en unos segundos.'
          : `No se pudo consultar a Claude (HTTP ${response.status}). Intenta de nuevo.`,
      })
    }
    data = await response.json()
  } catch (err) {
    if (controller.signal.aborted) {
      return json(504, { error: 'La respuesta tardó demasiado. Intenta de nuevo.' })
    }
    console.error('chat: error de red con Claude:', err)
    return json(502, { error: 'No se pudo conectar con Claude. Intenta de nuevo.' })
  } finally {
    clearTimeout(timer)
  }

  const usage = (data as { usage?: Record<string, unknown> }).usage
  if (usage) {
    console.log(
      `chat usage: input=${usage.input_tokens} cache_write=${usage.cache_creation_input_tokens ?? 0} cache_read=${usage.cache_read_input_tokens ?? 0} output=${usage.output_tokens}`
    )
  }

  try {
    return json(200, parseChatReply(data as Parameters<typeof parseChatReply>[0], new Set(creatives.map((c) => c.id))))
  } catch (err) {
    if (err instanceof ChatReplyError) return json(502, { error: err.message })
    throw err
  }
}

export { handler }
