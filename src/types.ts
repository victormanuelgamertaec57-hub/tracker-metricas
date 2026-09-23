export type Format = '9:16' | '1:1' | '4:5' | '16:9'

export type Category = 'ganador' | 'potencial' | 'bueno' | 'regular' | 'malo'

export type Confidence = 'baja' | 'media' | 'alta'

export interface DailyPoint {
  date: string // ISO date
  ctr: number
  frequency: number
  roas: number
}

export interface Demographics {
  ageBreakdown: { range: string; pct: number }[]
  placementRoas: { placement: string; roas: number }[]
}

export interface RawMetrics {
  spend: number
  impressions: number
  clicks: number
  linkClicks: number
  videoPlays: number // reproducciones iniciadas (video_play_actions)
  hookViews: number // reproducciones de >=3s (actions[video_view])
  holdViews: number // ThruPlays: >=15s o completo (video_thruplay_watched_actions)
  purchases: number
  revenue: number
  // null = "sin dato": Meta no lo devolvió o el creativo no se sincronizó.
  // Nunca usar 0 como sustituto: un 0 falso se lee como "nadie vio el video".
  avgWatchTime: number | null // segundos
  frequency: number
  retention25: number | null // % de reproducciones que llegaron al 25%
  retention50: number | null
  retention75: number | null
  retention95: number | null
  history: DailyPoint[]
  demographics?: Demographics
}

export interface Creative {
  id: string
  name: string
  niche: string
  format: Format
  thumbnailUrl?: string
  videoUrl?: string
  videoUnavailable?: boolean // true cuando Meta API no devolvió video por permisos
  videoDurationSec?: number | null // duración del video subido; null si no se pudo leer
  launchDate: string
  metaAdId?: string
  metaAdAccountId?: string // para link a Meta Ads Manager
  metrics: RawMetrics
}

export interface SubScores {
  engagement: number // 0-100
  result: number // 0-100
  efficiency: number // 0-100
}

export interface ScoreResult {
  composite: number // 0-100
  category: Category
  confidence: Confidence
  subScores: SubScores
  isFatigued: boolean
  fatigueReason?: string
  trendingUp: boolean
  trendingMetric?: 'ctr' | 'roas'
  diagnosis: string[]
  derived: {
    ctr: number
    hookRate: number
    holdRate: number
    cpc: number
    cpm: number
    cpa: number
    roas: number
  }
}

export interface NicheBenchmark {
  niche: string
  ctrTarget: number
  hookRateTarget: number
  holdRateTarget: number
  roasTarget: number
  cpaTarget: number
  weights: {
    engagement: number
    result: number
    efficiency: number
  }
}

// ---------------------------------------------------------------------------
// Análisis de IA (analyze-creative-background / get-creative-analysis)
// Compartido entre la función y la interfaz.
// ---------------------------------------------------------------------------

export interface GeminiPerception {
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

export interface MetaAdCopy {
  body?: string
  title?: string
  linkDescription?: string
  linkUrl?: string
  advantagePlusBodies?: string[]
  advantagePlusTitles?: string[]
}

export interface ClaudeAnalysis {
  coherenciaVideoCopy: {
    coinciden: boolean
    temaVideo: string
    temaCopy: string
    motivo: string
  }
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

/**
 * Comparación de la duración del video subido con la del video del anuncio en
 * Meta. Si alguna de las dos no se pudo leer, no se compara (coincide = null).
 */
export interface VerificacionVideo {
  duracionSubidaSeg: number | null
  duracionMetaSeg: number | null
  diferenciaSeg: number | null
  coincide: boolean | null
}

export interface CreativeAIAnalysis {
  status: 'processing' | 'done' | 'error'
  creativeId: string
  videoKey?: string
  timestamp: string
  // "posible video equivocado" cuando la duración o el tema no coinciden con
  // el anuncio de Meta. null = sin alerta.
  alertaVideo?: string | null
  verificacionVideo?: VerificacionVideo
  geminiPerception?: GeminiPerception
  metaCopy?: MetaAdCopy | null
  claudeAnalysis?: ClaudeAnalysis
  scoreCombinado?: number
  rulesComposite?: number
  error?: string
}

// ---------------------------------------------------------------------------
// Chat del tracker (netlify/functions/chat.ts)
// Compartido entre la función y la interfaz.
// ---------------------------------------------------------------------------

export type ChatMetric = 'hookRate' | 'holdRate' | 'ctr' | 'score'

/**
 * Comparación que elige Claude: qué métrica y qué creativos. Los valores y
 * objetivos los pone la interfaz con los datos reales, así ninguna barra
 * muestra un número inventado por el modelo.
 */
export interface ChatComparison {
  metrica: ChatMetric
  creativeIds: string[]
}

/** Resumen compacto de un creativo que el frontend manda al chat. */
export interface ChatCreativeSummary {
  id: string
  nombre: string
  nicho: string
  categoria: Category
  score: number
  confianza: Confidence
  // null = sin impresiones, no hay dato (no es 0 %).
  hookRate: number | null
  hookRateObjetivo: number
  holdRate: number | null
  holdRateObjetivo: number
  ctr: number | null
  ctrObjetivo: number
  gasto: number
  compras: number
  roas: number
  fatiga: boolean
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface ChatRequest {
  message: string
  history: ChatTurn[]
  creatives: ChatCreativeSummary[]
}

export interface ChatResponse {
  respuesta: string
  comparaciones: ChatComparison[]
}
