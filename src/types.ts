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
  videoPlays: number
  hookViews: number // vieron >3s
  holdViews: number // vieron >50%
  purchases: number
  revenue: number
  avgWatchTime: number // segundos
  frequency: number
  retention25: number
  retention50: number
  retention75: number
  retention95: number
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
