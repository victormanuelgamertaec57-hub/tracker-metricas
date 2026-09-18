import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'
import { getStore, connectLambda } from '@netlify/blobs'
import { isAuthorized } from './_auth'
import {
  DEFAULT_BENCHMARKS,
  GENERIC_BENCHMARK,
  computeDerivedMetrics,
  computeSubScores,
} from '../../src/lib/scoring'
import type { Creative, NicheBenchmark } from '../../src/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIDEO_STORE = 'creative-videos'
const ANALYSIS_STORE = 'creative-ai-analysis'

/** Umbral para decidir Files API vs inline base64 (bytes). */
const GEMINI_INLINE_LIMIT = 20 * 1024 * 1024 // 20 MB

/** Peso del score de reglas vs score visual de Claude en el combinado. */
const RULES_WEIGHT = 0.5
const VISUAL_WEIGHT = 0.5

// Model IDs — verificados Sep 2026
const GEMINI_MODEL = 'gemini-3.8-flash'
const CLAUDE_MODEL = 'claude-sonnet-5'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnalysisRequest {
  creativeId: string
  videoKey: string
  adId?: string
  niche: string
  metrics: {
    spend: number
    impressions: number
    clicks: number
    linkClicks: number
    videoPlays: number
    hookViews: number
    holdViews: number
    purchases: number
    revenue: number
    avgWatchTime: number
    frequency: number
    retention25: number
    retention50: number
    retention75: number
    retention95: number
  }
  forceReanalyze?: boolean
}

interface GeminiPerception {
  copyHablado: string
  copyEnPantalla: { texto: string; segundoAproximado: number }[]
  hookLiteral: {
    primeraFraseDicha: string
    primerTextoEnPantalla: string
  }
  escenas: string
  formatoDetectado: 'testimonial' | 'UGC' | 'unboxing' | 'talking-head' | 'otro'
  notasDeRitmo: string
}

interface MetaAdCopy {
  body?: string
  title?: string
  linkDescription?: string
  linkUrl?: string
  advantagePlusBodies?: string[]
  advantagePlusTitles?: string[]
}

interface ClaudeAnalysis {
  scoreVisual: number
  analisisHook: string
  analisisCopy: string
  riesgoCumplimiento: {
    nivel: 'bajo' | 'medio' | 'alto'
    frasesDeRiesgo: string[]
    motivo: string
  }
  razones: string[]
  recomendaciones: string[]
}

interface CreativeAIAnalysis {
  status: 'processing' | 'done' | 'error'
  creativeId: string
  timestamp: string
  geminiPerception?: GeminiPerception
  metaCopy?: MetaAdCopy | null
  claudeAnalysis?: ClaudeAnalysis
  scoreCombinado?: number
  rulesComposite?: number
  error?: string
}

// ---------------------------------------------------------------------------
// Fetch helper con AbortController y Timeout explícito
// ---------------------------------------------------------------------------

/**
 * Helper para realizar fetch con timeout explícito mediante AbortController.
 * Evita que llamadas colgadas agoten el tiempo límite de la plataforma sin capturar el error.
 */
async function fetchWithTimeout(
  url: string | URL,
  options: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Timeout tras ${timeoutMs}ms esperando respuesta de ${url.toString().split('?')[0]}`))
  }, timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

// ---------------------------------------------------------------------------
// Gemini — percepción de video
// ---------------------------------------------------------------------------

async function uploadToGeminiFilesAPI(
  videoBuffer: Buffer,
  mimeType: string,
  apiKey: string
): Promise<string> {
  // Step 1: Initiate resumable upload (timeout 30s)
  const initResponse = await fetchWithTimeout(
    `${GEMINI_API_BASE}/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(videoBuffer.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      },
      body: JSON.stringify({
        file: { displayName: 'creative-video-for-analysis' },
      }),
    },
    30_000
  )

  if (!initResponse.ok) {
    const text = await initResponse.text()
    throw new Error(`Gemini Files API init failed (${initResponse.status}): ${text}`)
  }

  const uploadUrl = initResponse.headers.get('X-Goog-Upload-URL')
  if (!uploadUrl) {
    throw new Error('Gemini Files API did not return an upload URL')
  }

  // Step 2: Upload the video data (timeout 120s)
  // Buffer no está incluido en la interfaz BodyInit del DOM en lib.dom.d.ts, pero en
  // runtime de Node.js 18+ (undici / fetch nativo) Buffer es completamente válido
  // y soportado como cuerpo binario para streams y peticiones HTTP.
  const uploadResponse = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'POST',
      headers: {
        'Content-Length': String(videoBuffer.length),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: videoBuffer as unknown as BodyInit,
    },
    120_000
  )

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text()
    throw new Error(`Gemini Files API upload failed (${uploadResponse.status}): ${text}`)
  }

  const uploadResult = await uploadResponse.json()
  const fileName = uploadResult.file?.name
  if (!fileName) {
    throw new Error('Gemini Files API upload did not return a file name')
  }

  // Step 3: Poll until state is ACTIVE (timeout 15s por intento)
  const maxPolls = 60 // 5 minutes with 5s intervals
  for (let i = 0; i < maxPolls; i++) {
    const statusResponse = await fetchWithTimeout(
      `${GEMINI_API_BASE}/v1beta/${fileName}?key=${apiKey}`,
      {},
      15_000
    )
    const statusData = await statusResponse.json()

    if (statusData.state === 'ACTIVE') {
      return statusData.uri
    }

    if (statusData.state === 'FAILED') {
      throw new Error(`Gemini Files API processing failed: ${JSON.stringify(statusData.error)}`)
    }

    // Wait 5 seconds before next poll
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  throw new Error('Gemini Files API timed out waiting for video to become ACTIVE')
}

function detectVideoMimeType(buffer: Buffer): string {
  if (buffer.length < 12) return 'video/mp4'

  // MP4: ftyp box
  if (
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return 'video/mp4'
  }

  // WebM: EBML header
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return 'video/webm'
  }

  // QuickTime MOV: moov or free or ftyp
  if (
    (buffer[4] === 0x6d && buffer[5] === 0x6f && buffer[6] === 0x6f && buffer[7] === 0x76) ||
    (buffer[4] === 0x66 && buffer[5] === 0x72 && buffer[6] === 0x65 && buffer[7] === 0x65)
  ) {
    return 'video/quicktime'
  }

  return 'video/mp4'
}

async function callGemini(
  videoPart: Record<string, any>,
  apiKey: string
): Promise<GeminiPerception> {
  const systemInstruction = `Eres un transcriptor y descriptor visual extremadamente preciso para videos publicitarios de Meta Ads (Facebook/Instagram Reels, TikTok style).

Tu ÚNICA tarea es transcribir y describir objetivamente lo que ves y oyes en el video. NO emitas opiniones, NO juzgues si el anuncio es bueno o malo, NO des recomendaciones. Solo percibe y documenta con exactitud.

El idioma del video es español. Presta especial atención al texto superpuesto en pantalla y a las primeras frases que se dicen (los primeros 3 segundos son críticos).`

  const prompt = `Analiza este video publicitario y devuelve un JSON con la transcripción y descripción visual exacta.

Devuelve un JSON con esta estructura exacta:
{
  "copyHablado": "<transcripción literal y completa de todo lo que se dice en el video>",
  "copyEnPantalla": [
    { "texto": "<texto que aparece>", "segundoAproximado": <segundo en que aparece> }
  ],
  "hookLiteral": {
    "primeraFraseDicha": "<la primera frase que se escucha en los primeros 3 segundos>",
    "primerTextoEnPantalla": "<el primer texto visible en pantalla en los primeros 3 segundos>"
  },
  "escenas": "<descripción breve de las escenas visuales principales>",
  "formatoDetectado": "<testimonial | UGC | unboxing | talking-head | otro>",
  "notasDeRitmo": "<ritmo del video: rápido, pausado, dinámico, monótono, etc.>"
}`

  const responseSchema = {
    type: 'object' as const,
    properties: {
      copyHablado: { type: 'string' as const, description: 'Transcripción literal completa' },
      copyEnPantalla: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            texto: { type: 'string' as const },
            segundoAproximado: { type: 'number' as const },
          },
          required: ['texto', 'segundoAproximado'],
        },
      },
      hookLiteral: {
        type: 'object' as const,
        properties: {
          primeraFraseDicha: { type: 'string' as const },
          primerTextoEnPantalla: { type: 'string' as const },
        },
        required: ['primeraFraseDicha', 'primerTextoEnPantalla'],
      },
      escenas: { type: 'string' as const },
      formatoDetectado: {
        type: 'string' as const,
        enum: ['testimonial', 'UGC', 'unboxing', 'talking-head', 'otro'],
      },
      notasDeRitmo: { type: 'string' as const },
    },
    required: [
      'copyHablado',
      'copyEnPantalla',
      'hookLiteral',
      'escenas',
      'formatoDetectado',
      'notasDeRitmo',
    ],
  }

  // Timeout 120s para procesamiento multimodal y generación de Gemini
  const response = await fetchWithTimeout(
    `${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: [
          {
            parts: [
              videoPart,
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
          temperature: 0.2,
        },
      }),
    },
    120_000
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()

  // Extract the text from the response
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error('Gemini returned empty response — no candidates or text')
  }

  // Parse JSON (Gemini con responseMimeType devuelve JSON, con fallback a bloque markdown)
  try {
    return JSON.parse(text) as GeminiPerception
  } catch {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]) as GeminiPerception
    }
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 500)}`)
  }
}

// ---------------------------------------------------------------------------
// Meta Graph API — copy del anuncio
// ---------------------------------------------------------------------------

async function fetchMetaAdCopy(
  adId: string,
  accessToken?: string
): Promise<MetaAdCopy | null> {
  if (!accessToken) return null

  try {
    const url = `https://graph.facebook.com/v21.0/${adId}?fields=creative{id,name,title,body,asset_feed_spec,object_story_spec}&access_token=${accessToken}`
    // Timeout 30s para Meta Graph API
    const response = await fetchWithTimeout(url, {}, 30_000)

    if (!response.ok) {
      console.warn(`[analyze] Meta API error (${response.status}) fetching ad ${adId}`)
      return null
    }

    const data = await response.json()
    const creative = data.creative
    if (!creative) return null

    const result: MetaAdCopy = {}

    if (creative.body) result.body = creative.body
    if (creative.title) result.title = creative.title

    const assetFeed = creative.asset_feed_spec
    if (assetFeed) {
      if (assetFeed.bodies && Array.isArray(assetFeed.bodies)) {
        result.advantagePlusBodies = assetFeed.bodies
          .map((b: { text?: string }) => b.text)
          .filter(Boolean)
      }
      if (assetFeed.titles && Array.isArray(assetFeed.titles)) {
        result.advantagePlusTitles = assetFeed.titles
          .map((t: { text?: string }) => t.text)
          .filter(Boolean)
      }
    }

    const linkData = creative.object_story_spec?.link_data
    if (linkData) {
      if (linkData.description && !result.body) {
        result.linkDescription = linkData.description
      }
      if (linkData.link) {
        result.linkUrl = linkData.link
      }
      if (linkData.name && !result.title) {
        result.title = linkData.name
      }
    }

    return Object.keys(result).length > 0 ? result : null
  } catch (err) {
    console.warn(`[analyze] Failed to fetch Meta ad copy for ad ${adId}:`, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Claude — análisis estratégico
// ---------------------------------------------------------------------------

async function callClaude(
  geminiPerception: GeminiPerception,
  metaCopy: MetaAdCopy | null,
  metrics: AnalysisRequest['metrics'],
  derived: ReturnType<typeof computeDerivedMetrics>,
  niche: string,
  benchmark: NicheBenchmark,
  apiKey: string
): Promise<ClaudeAnalysis> {
  const context = {
    percepcionDelVideo: geminiPerception,
    copyDelAnuncioEnMeta: metaCopy || 'No disponible (permisos o configuración)',
    metricasReales: {
      ...metrics,
      derivadas: derived,
    },
    nicho: niche,
    benchmarksDelNicho: {
      ctrTarget: benchmark.ctrTarget,
      hookRateTarget: benchmark.hookRateTarget,
      holdRateTarget: benchmark.holdRateTarget,
      roasTarget: benchmark.roasTarget,
      cpaTarget: benchmark.cpaTarget,
    },
  }

  const systemPrompt = `Eres un analista senior de performance marketing especializado en Meta Ads para nichos de salud, bienestar, crianza y fitness en mercados hispanohablantes. Analizas creativos de video combinando datos cuantitativos (métricas reales) con análisis cualitativo (percepción del video).

Tu público objetivo son emprendedores digitales que venden infoproductos (cursos, métodos) a audiencias hispanas, principalmente en México, Colombia, Argentina y España.

IMPORTANTE sobre riesgo de cumplimiento:
- Los nichos de salud/bienestar/crianza/fitness tienen alta tasa de rechazo en Meta.
- Marca como riesgo ALTO cualquier frase que "diagnostique" al lector (ej: "¿Tu hijo hace berrinches?", "¿Sufres de X?").
- Marca como riesgo MEDIO promesas de resultado cuantificado (ej: "baja 10 kilos en 30 días").
- Marca como riesgo MEDIO claims de transformación absoluta (ej: "elimina los berrinches para siempre").
- Esto aplica tanto al copy hablado en el video como al copy del anuncio en Meta.`

  const userPrompt = `Analiza este creativo de video publicitario y devuelve un JSON con tu evaluación.

CONTEXTO COMPLETO:
${JSON.stringify(context, null, 2)}

Devuelve un JSON con esta estructura:
{
  "scoreVisual": <número 0-100, qué tan bien ejecutado está el creativo visualmente y en su narrativa>,
  "analisisHook": "<por qué el hook engancha o no, CITA el hook literal del video>",
  "analisisCopy": "<evaluación del copy hablado en el video + copy en pantalla + copy del anuncio en Meta — ¿son coherentes? ¿refuerzan la misma idea?>",
  "riesgoCumplimiento": {
    "nivel": "bajo | medio | alto",
    "frasesDeRiesgo": ["frase exacta 1", "frase exacta 2"],
    "motivo": "<por qué estas frases son riesgosas para las políticas de Meta>"
  },
  "razones": ["razón 1 de por qué funciona o no", "razón 2"],
  "recomendaciones": ["acción concreta 1", "acción concreta 2"]
}

REGLAS:
- scoreVisual mide la calidad del creativo como pieza de comunicación, independiente de las métricas.
- En analisisHook, CITA textualmente el hook (primeras frases dichas y primer texto en pantalla).
- En riesgoCumplimiento, cita las frases EXACTAS que son problemáticas (del copy hablado, en pantalla o del anuncio).
- Las recomendaciones deben ser accionables y específicas, no genéricas.
- Compara las métricas reales contra los benchmarks del nicho para contextualizar.`

  const claudeSchema = {
    type: 'object' as const,
    properties: {
      scoreVisual: { type: 'number' as const, description: 'Score visual 0-100' },
      analisisHook: { type: 'string' as const },
      analisisCopy: { type: 'string' as const },
      riesgoCumplimiento: {
        type: 'object' as const,
        properties: {
          nivel: { type: 'string' as const, enum: ['bajo', 'medio', 'alto'] },
          frasesDeRiesgo: { type: 'array' as const, items: { type: 'string' as const } },
          motivo: { type: 'string' as const },
        },
        required: ['nivel', 'frasesDeRiesgo', 'motivo'],
      },
      razones: { type: 'array' as const, items: { type: 'string' as const } },
      recomendaciones: { type: 'array' as const, items: { type: 'string' as const } },
    },
    required: [
      'scoreVisual',
      'analisisHook',
      'analisisCopy',
      'riesgoCumplimiento',
      'razones',
      'recomendaciones',
    ],
  }

  // Timeout 120s para llamada a Claude Messages API
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }

  if (process.env.ANTHROPIC_WORKSPACE_ID) {
    headers['anthropic-workspace-id'] = process.env.ANTHROPIC_WORKSPACE_ID
  }

  const response = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        output_format: {
          type: 'json_schema',
          schema: claudeSchema,
        },
      }),
    },
    120_000
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Claude API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()

  // Extract text from Claude's response
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text')
  if (!textBlock?.text) {
    throw new Error('Claude returned empty response')
  }

  try {
    return JSON.parse(textBlock.text) as ClaudeAnalysis
  } catch {
    // Fallback: extraer JSON de posibles bloques markdown ```json ... ```
    const jsonMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]) as ClaudeAnalysis
    }
    throw new Error(`Claude returned invalid JSON: ${textBlock.text.slice(0, 500)}`)
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  if (!isAuthorized(event)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
    }
  }

  try {
    connectLambda(event as any)
  } catch (err) {
    console.error('Error connecting Lambda environment for Blobs:', err)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to initialize storage connection' }),
    }
  }

  // Parse request body
  let body: AnalysisRequest
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    }
  }

  const { creativeId, videoKey, adId, niche, metrics, forceReanalyze } = body

  if (!creativeId || !videoKey || !niche || !metrics) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: creativeId, videoKey, niche, metrics' }),
    }
  }

  // Check API keys
  const geminiApiKey = process.env.GEMINI_API_KEY
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
  const metaAccessToken = process.env.META_ACCESS_TOKEN

  if (!geminiApiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GEMINI_API_KEY not configured on server' }),
    }
  }

  if (!anthropicApiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured on server' }),
    }
  }

  const analysisStore = getStore(ANALYSIS_STORE)

  // 2. DUPLICADOS: Verificar si ya existe un análisis en 'processing' o 'done'
  try {
    const existing = (await analysisStore.get(videoKey, { type: 'json' })) as CreativeAIAnalysis | null
    if (existing) {
      if (existing.status === 'processing') {
        return {
          statusCode: 409,
          body: JSON.stringify({
            error: 'Ya hay un análisis en curso para este creativo',
            status: 'processing',
            creativeId: existing.creativeId,
          }),
        }
      }
      if (existing.status === 'done' && !forceReanalyze) {
        return {
          statusCode: 409,
          body: JSON.stringify({
            error: 'El creativo ya fue analizado previamente. Envía forceReanalyze: true para sobreescribir.',
            status: 'done',
            creativeId: existing.creativeId,
          }),
        }
      }
    }
  } catch (checkErr) {
    console.warn('[analyze] Error verificando estado previo del análisis:', checkErr)
  }

  // Background function: guardamos estado inicial 'processing' para polling del frontend.
  // Usamos onlyIfNew: true para cerrar la condición de carrera: si dos peticiones
  // concurrentes intentan analizar el mismo video a la vez, solo la primera modificará
  // el store y la segunda recibirá modified: false, retornando 409.
  const initialState: CreativeAIAnalysis = {
    status: 'processing',
    creativeId,
    timestamp: new Date().toISOString(),
  }

  if (!forceReanalyze) {
    const writeResult = await analysisStore.set(videoKey, JSON.stringify(initialState), {
      onlyIfNew: true,
    })

    if (!writeResult.modified) {
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: 'Ya hay un análisis en curso o completado para este video',
          status: 'processing',
          creativeId,
        }),
      }
    }
  } else {
    await analysisStore.set(videoKey, JSON.stringify(initialState))
  }

  console.log(`[analyze] Starting analysis for creative ${creativeId}, videoKey=${videoKey}`)

  try {
    // 1. Read video from Blobs
    const videoStore = getStore(VIDEO_STORE)
    const videoData = await videoStore.get(videoKey, { type: 'arrayBuffer' })

    if (!videoData) {
      throw new Error(`Video not found in store: ${videoKey}`)
    }

    const videoBuffer = Buffer.from(videoData)
    const mimeType = detectVideoMimeType(videoBuffer)
    console.log(`[analyze] Video size: ${videoBuffer.length} bytes, detected mime: ${mimeType}`)

    // 2. Prepare video for Gemini (Files API vs inline)
    let videoPart: Record<string, any>
    if (videoBuffer.length > GEMINI_INLINE_LIMIT) {
      console.log(`[analyze] Video > 20MB (${videoBuffer.length} bytes), using Gemini Files API...`)
      const fileUri = await uploadToGeminiFilesAPI(videoBuffer, mimeType, geminiApiKey)
      console.log(`[analyze] Uploaded to Files API: ${fileUri}`)
      videoPart = {
        fileData: {
          mimeType,
          fileUri,
        },
      }
    } else {
      console.log(`[analyze] Video <= 20MB, using inline base64...`)
      videoPart = {
        inlineData: {
          mimeType,
          data: videoBuffer.toString('base64'),
        },
      }
    }

    // 3. Call Gemini (video perception) and fetch Meta copy in parallel
    const [geminiPerception, metaCopy] = await Promise.all([
      callGemini(videoPart, geminiApiKey),
      adId
        ? fetchMetaAdCopy(adId, metaAccessToken)
        : Promise.resolve(null),
    ])

    console.log(`[analyze] Gemini perception complete. Format: ${geminiPerception.formatoDetectado}`)
    console.log(`[analyze] Meta copy: ${metaCopy ? 'fetched' : 'not available'}`)

    // 4. Scoring de reglas importado desde src/lib/scoring.ts
    const dummyCreative: Creative = {
      id: creativeId,
      name: creativeId,
      niche,
      format: '9:16',
      launchDate: new Date().toISOString().slice(0, 10),
      metrics: {
        ...metrics,
        history: [],
      },
    }

    const benchmark = DEFAULT_BENCHMARKS[niche] ?? { ...GENERIC_BENCHMARK, niche }
    const derived = computeDerivedMetrics(dummyCreative)
    const subScores = computeSubScores(dummyCreative, benchmark)
    const rulesComposite = Math.round(
      subScores.engagement * benchmark.weights.engagement +
        subScores.result * benchmark.weights.result +
        subScores.efficiency * benchmark.weights.efficiency
    )

    // 5. Call Claude with everything
    const claudeAnalysis = await callClaude(
      geminiPerception,
      metaCopy,
      metrics,
      derived,
      niche,
      benchmark,
      anthropicApiKey
    )

    console.log(`[analyze] Claude analysis complete. scoreVisual: ${claudeAnalysis.scoreVisual}`)

    // 6. Calculate combined score
    const scoreCombinado = Math.round(
      rulesComposite * RULES_WEIGHT + claudeAnalysis.scoreVisual * VISUAL_WEIGHT
    )

    console.log(`[analyze] Scores — rules: ${rulesComposite}, visual: ${claudeAnalysis.scoreVisual}, combined: ${scoreCombinado}`)

    // 7. Save final result
    const finalResult: CreativeAIAnalysis = {
      status: 'done',
      creativeId,
      timestamp: new Date().toISOString(),
      geminiPerception,
      metaCopy,
      claudeAnalysis,
      scoreCombinado,
      rulesComposite,
    }

    await analysisStore.set(videoKey, JSON.stringify(finalResult))
    console.log(`[analyze] Analysis saved for creative ${creativeId}`)

  } catch (err) {
    // Save error state so frontend can show it
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[analyze] Error analyzing creative ${creativeId}:`, errorMessage)

    const errorResult: CreativeAIAnalysis = {
      status: 'error',
      creativeId,
      timestamp: new Date().toISOString(),
      error: errorMessage,
    }

    try {
      await analysisStore.set(videoKey, JSON.stringify(errorResult))
    } catch (saveErr) {
      console.error('[analyze] Failed to save error state:', saveErr)
    }
  }

  // Background functions return 202 automatically
  return {
    statusCode: 202,
    body: JSON.stringify({ message: 'Analysis started', creativeId }),
  }
}

export { handler }
