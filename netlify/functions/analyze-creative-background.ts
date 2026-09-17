import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'
import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { isAuthorized } from './_auth'

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
// Benchmarks (réplica de los defaults de src/lib/scoring.ts)
// ---------------------------------------------------------------------------

interface NicheBenchmark {
  ctrTarget: number
  hookRateTarget: number
  holdRateTarget: number
  roasTarget: number
  cpaTarget: number
  weights: { engagement: number; result: number; efficiency: number }
}

const DEFAULT_BENCHMARKS: Record<string, NicheBenchmark> = {
  Berrinches: {
    ctrTarget: 2.2, hookRateTarget: 30, holdRateTarget: 20,
    roasTarget: 2.5, cpaTarget: 6,
    weights: { engagement: 0.4, result: 0.4, efficiency: 0.2 },
  },
  'Método Hormonal': {
    ctrTarget: 1.8, hookRateTarget: 26, holdRateTarget: 18,
    roasTarget: 2.2, cpaTarget: 7,
    weights: { engagement: 0.35, result: 0.45, efficiency: 0.2 },
  },
  CalistenIA: {
    ctrTarget: 2.0, hookRateTarget: 28, holdRateTarget: 19,
    roasTarget: 2.3, cpaTarget: 6.5,
    weights: { engagement: 0.4, result: 0.4, efficiency: 0.2 },
  },
  'Tai Chi': {
    ctrTarget: 1.5, hookRateTarget: 22, holdRateTarget: 16,
    roasTarget: 2.0, cpaTarget: 8,
    weights: { engagement: 0.3, result: 0.45, efficiency: 0.25 },
  },
}

const GENERIC_BENCHMARK: NicheBenchmark = {
  ctrTarget: 2.0, hookRateTarget: 28, holdRateTarget: 19,
  roasTarget: 2.3, cpaTarget: 6.5,
  weights: { engagement: 0.4, result: 0.4, efficiency: 0.2 },
}

// ---------------------------------------------------------------------------
// Scoring — lógica replicada de src/lib/scoring.ts (solo la fórmula pura)
// ---------------------------------------------------------------------------

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n))
}

function ratioScore(value: number, target: number) {
  if (target <= 0) return 0
  return clamp((value / target) * 100)
}

function inverseRatioScore(target: number, value: number) {
  if (value <= 0) return 100
  return clamp((target / value) * 100)
}

function computeRulesComposite(metrics: AnalysisRequest['metrics'], niche: string): number {
  const b = DEFAULT_BENCHMARKS[niche] ?? GENERIC_BENCHMARK

  const ctr = metrics.impressions > 0 ? (metrics.linkClicks / metrics.impressions) * 100 : 0
  const hookRate = metrics.videoPlays > 0 ? (metrics.hookViews / metrics.videoPlays) * 100 : 0
  const holdRate = metrics.videoPlays > 0 ? (metrics.holdViews / metrics.videoPlays) * 100 : 0
  const cpa = metrics.purchases > 0 ? metrics.spend / metrics.purchases : 0
  const roas = metrics.spend > 0 ? metrics.revenue / metrics.spend : 0
  const cpm = metrics.impressions > 0 ? (metrics.spend / metrics.impressions) * 1000 : 0

  const engagement =
    ratioScore(ctr, b.ctrTarget) * 0.4 +
    ratioScore(hookRate, b.hookRateTarget) * 0.35 +
    ratioScore(holdRate, b.holdRateTarget) * 0.25

  const roasScore = ratioScore(roas, b.roasTarget)
  const cpaScore = cpa > 0 ? inverseRatioScore(b.cpaTarget, cpa) : 50
  const result = roasScore * 0.6 + cpaScore * 0.4

  const freq = metrics.frequency
  const freqScore = freq > 2 ? clamp(100 - (freq - 2) * 25) : 100
  const cpmScore = clamp(100 - (cpm - 8) * 5)
  const efficiency = freqScore * 0.6 + cpmScore * 0.4

  const composite = Math.round(
    Math.round(engagement) * b.weights.engagement +
    Math.round(result) * b.weights.result +
    Math.round(efficiency) * b.weights.efficiency
  )
  return composite
}

// ---------------------------------------------------------------------------
// Gemini — percepción de video
// ---------------------------------------------------------------------------

async function uploadToGeminiFilesAPI(
  videoBuffer: Buffer,
  mimeType: string,
  apiKey: string
): Promise<string> {
  // Step 1: Initiate resumable upload
  const initResponse = await fetch(
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
    }
  )

  if (!initResponse.ok) {
    const text = await initResponse.text()
    throw new Error(`Gemini Files API init failed (${initResponse.status}): ${text}`)
  }

  const uploadUrl = initResponse.headers.get('X-Goog-Upload-URL')
  if (!uploadUrl) {
    throw new Error('Gemini Files API did not return an upload URL')
  }

  // Step 2: Upload the video data
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(videoBuffer.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: videoBuffer,
  })

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text()
    throw new Error(`Gemini Files API upload failed (${uploadResponse.status}): ${text}`)
  }

  const uploadResult = await uploadResponse.json()
  const fileName = uploadResult.file?.name
  if (!fileName) {
    throw new Error('Gemini Files API upload did not return a file name')
  }

  // Step 3: Poll until state is ACTIVE
  const maxPolls = 60 // 5 minutes with 5s intervals
  for (let i = 0; i < maxPolls; i++) {
    const statusResponse = await fetch(
      `${GEMINI_API_BASE}/v1beta/${fileName}?key=${apiKey}`
    )
    const statusData = await statusResponse.json()

    if (statusData.state === 'ACTIVE') {
      return statusData.uri
    }
    if (statusData.state === 'FAILED') {
      throw new Error(`Gemini file processing failed: ${statusData.error?.message || 'unknown'}`)
    }

    // Wait 5 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 5000))
  }

  throw new Error('Gemini file processing timed out (5 min)')
}

async function callGemini(
  videoBuffer: Buffer,
  mimeType: string,
  apiKey: string
): Promise<GeminiPerception> {
  const isLarge = videoBuffer.length > GEMINI_INLINE_LIMIT

  // Build the video part
  let videoPart: Record<string, unknown>

  if (isLarge) {
    console.log(`Video es ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB — usando Files API`)
    const fileUri = await uploadToGeminiFilesAPI(videoBuffer, mimeType, apiKey)
    videoPart = {
      fileData: { fileUri, mimeType },
    }
  } else {
    console.log(`Video es ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB — usando inline base64`)
    videoPart = {
      inlineData: {
        data: videoBuffer.toString('base64'),
        mimeType,
      },
    }
  }

  const prompt = `Analiza este video publicitario de Meta Ads. Devuelve SOLO un objeto JSON válido (sin markdown, sin backticks) con esta estructura exacta:

{
  "copyHablado": "transcript completo del audio, palabra por palabra, incluyendo todo lo que se dice",
  "copyEnPantalla": [
    { "texto": "texto exacto que aparece sobreimpreso", "segundoAproximado": 0 }
  ],
  "hookLiteral": {
    "primeraFraseDicha": "transcripción EXACTA de lo primero que se dice en los primeros 3 segundos",
    "primerTextoEnPantalla": "texto EXACTO sobreimpreso visible en los primeros 3 segundos"
  },
  "escenas": "descripción detallada escena por escena: qué se ve, quién aparece, qué hace, fondos, transiciones",
  "formatoDetectado": "testimonial | UGC | unboxing | talking-head | otro",
  "notasDeRitmo": "observaciones sobre ritmo de edición, cortes, música, velocidad, pausas"
}

REGLAS:
- copyHablado debe ser el transcript COMPLETO, no un resumen.
- copyEnPantalla incluye TODO texto visible: subtítulos, títulos, CTAs, precios, sellos, logos con texto.
- hookLiteral debe transcribir los primeros 3 segundos EXACTOS, no describir.
- Si no hay audio hablado, copyHablado = "" y hookLiteral.primeraFraseDicha = "".
- Si no hay texto en pantalla en los primeros 3s, hookLiteral.primerTextoEnPantalla = "".
- formatoDetectado: elige la categoría más cercana.`

  const requestBody = {
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
    },
  }

  const response = await fetch(
    `${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }
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

  // Parse JSON (Gemini with responseMimeType should return clean JSON)
  try {
    return JSON.parse(text) as GeminiPerception
  } catch {
    // Try to extract JSON from possible markdown wrapping
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

async function fetchMetaAdCopy(adId: string, accessToken: string): Promise<MetaAdCopy | null> {
  try {
    const fields = [
      'creative{body,title,object_story_spec,asset_feed_spec}',
    ].join(',')

    const url = `https://graph.facebook.com/v19.0/${adId}?fields=${fields}&access_token=${accessToken}`
    const response = await fetch(url)

    if (!response.ok) {
      console.warn(`Meta API error fetching ad copy (${response.status}), continuing without it`)
      return null
    }

    const data = await response.json()
    if (data.error) {
      console.warn(`Meta API error: ${data.error.message}, continuing without ad copy`)
      return null
    }

    const creative = data.creative
    if (!creative) {
      console.warn('No creative data returned from Meta API')
      return null
    }

    const result: MetaAdCopy = {}

    // Direct creative fields
    if (creative.body) result.body = creative.body
    if (creative.title) result.title = creative.title

    // From object_story_spec
    const oss = creative.object_story_spec
    if (oss) {
      const linkData = oss.link_data || oss.video_data
      if (linkData) {
        if (linkData.message && !result.body) result.body = linkData.message
        if (linkData.name && !result.title) result.title = linkData.name
        if (linkData.description) result.linkDescription = linkData.description
        if (linkData.link) result.linkUrl = linkData.link
      }
    }

    // Advantage+ Creative variations from asset_feed_spec
    const afs = creative.asset_feed_spec
    if (afs) {
      if (afs.bodies && Array.isArray(afs.bodies)) {
        result.advantagePlusBodies = afs.bodies
          .map((b: { text?: string }) => b.text)
          .filter(Boolean)
      }
      if (afs.titles && Array.isArray(afs.titles)) {
        result.advantagePlusTitles = afs.titles
          .map((t: { text?: string }) => t.text)
          .filter(Boolean)
      }
    }

    return result
  } catch (err) {
    console.warn('Error fetching Meta ad copy:', err)
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
  niche: string,
  benchmark: NicheBenchmark,
  apiKey: string
): Promise<ClaudeAnalysis> {
  // Compute derived metrics for context
  const ctr = metrics.impressions > 0 ? (metrics.linkClicks / metrics.impressions) * 100 : 0
  const hookRate = metrics.videoPlays > 0 ? (metrics.hookViews / metrics.videoPlays) * 100 : 0
  const holdRate = metrics.videoPlays > 0 ? (metrics.holdViews / metrics.videoPlays) * 100 : 0
  const roas = metrics.spend > 0 ? metrics.revenue / metrics.spend : 0
  const cpa = metrics.purchases > 0 ? metrics.spend / metrics.purchases : 0
  const cpm = metrics.impressions > 0 ? (metrics.spend / metrics.impressions) * 1000 : 0

  const context = {
    percepcionDelVideo: geminiPerception,
    copyDelAnuncioEnMeta: metaCopy || 'No disponible (permisos o configuración)',
    metricasReales: {
      ...metrics,
      derivadas: { ctr, hookRate, holdRate, roas, cpa, cpm },
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
    required: ['scoreVisual', 'analisisHook', 'analisisCopy', 'riesgoCumplimiento', 'razones', 'recomendaciones'],
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          json_schema: {
            name: 'creative_analysis',
            schema: claudeSchema,
          },
        },
      },
    }),
  })

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

  const { creativeId, videoKey, adId, niche, metrics } = body

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

  // Background function returns 202 immediately — all work below happens async.
  // Save initial 'processing' state so the frontend can poll for it.
  const initialState: CreativeAIAnalysis = {
    status: 'processing',
    creativeId,
    timestamp: new Date().toISOString(),
  }
  await analysisStore.set(videoKey, JSON.stringify(initialState))

  console.log(`[analyze] Starting analysis for creative ${creativeId}, videoKey=${videoKey}`)

  try {
    // 1. Read video from Blobs
    const videoStore = getStore(VIDEO_STORE)
    const videoData = await videoStore.get(videoKey, { type: 'arrayBuffer' })

    if (!videoData) {
      throw new Error(`Video not found in store: ${videoKey}`)
    }

    const videoBuffer = Buffer.from(videoData)
    console.log(`[analyze] Video loaded: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`)

    // Detect mime type from magic bytes (same logic as get-video.ts)
    let mimeType = 'video/mp4'
    if (videoBuffer.length >= 12) {
      if (videoBuffer[4] === 0x66 && videoBuffer[5] === 0x74 && videoBuffer[6] === 0x79 && videoBuffer[7] === 0x70) {
        mimeType = 'video/mp4'
      } else if (videoBuffer[0] === 0x1A && videoBuffer[1] === 0x45 && videoBuffer[2] === 0xDF && videoBuffer[3] === 0xA3) {
        mimeType = 'video/webm'
      }
    }

    // 2 & 3. Run Gemini + Meta copy fetch in parallel
    const [geminiPerception, metaCopy] = await Promise.all([
      callGemini(videoBuffer, mimeType, geminiApiKey),
      adId && metaAccessToken
        ? fetchMetaAdCopy(adId, metaAccessToken)
        : Promise.resolve(null),
    ])

    console.log(`[analyze] Gemini perception complete. Format: ${geminiPerception.formatoDetectado}`)
    console.log(`[analyze] Meta copy: ${metaCopy ? 'fetched' : 'not available'}`)

    // 4. Call Claude with everything
    const benchmark = DEFAULT_BENCHMARKS[niche] ?? GENERIC_BENCHMARK
    const claudeAnalysis = await callClaude(
      geminiPerception,
      metaCopy,
      metrics,
      niche,
      benchmark,
      anthropicApiKey
    )

    console.log(`[analyze] Claude analysis complete. scoreVisual: ${claudeAnalysis.scoreVisual}`)

    // 5. Calculate combined score
    const rulesComposite = computeRulesComposite(metrics, niche)
    const scoreCombinado = Math.round(
      rulesComposite * RULES_WEIGHT + claudeAnalysis.scoreVisual * VISUAL_WEIGHT
    )

    console.log(`[analyze] Scores — rules: ${rulesComposite}, visual: ${claudeAnalysis.scoreVisual}, combined: ${scoreCombinado}`)

    // 6. Save final result
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

  // Background functions return 202 automatically, but we still need a return
  return {
    statusCode: 202,
    body: JSON.stringify({ message: 'Analysis started', creativeId }),
  }
}

export { handler }

export const config: Config = {
  background: true,
}
