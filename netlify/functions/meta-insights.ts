import type { Handler, HandlerEvent } from '@netlify/functions'

interface MetaAction {
  action_type: string
  value: string
}

interface MetaDayInsight {
  date_start: string
  date_stop: string
  spend: string
  impressions: string
  clicks: string
  inline_link_clicks: string
  reach: string
  frequency: string
  actions?: MetaAction[]
  action_values?: MetaAction[]
  cost_per_action_type?: MetaAction[]
  video_play_actions?: string
  video_p25_watched_actions?: MetaAction[]
  video_p50_watched_actions?: MetaAction[]
  video_p75_watched_actions?: MetaAction[]
  video_p95_watched_actions?: MetaAction[]
  video_avg_time_watched_actions?: MetaAction[]
  // breakdowns
  age?: string
  gender?: string
  publisher_platform?: string
}

interface NormalizedDemographics {
  ageBreakdown: { range: string; pct: number }[]
  placementRoas: { placement: string; roas: number }[]
}

interface NormalizedMetrics {
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
  history: Array<{ date: string; ctr: number; frequency: number; roas: number }>
  demographics: NormalizedDemographics
}

const PURCHASE_TYPES = ['purchase', 'omni_purchase']

function getActionValue(actions: MetaAction[] | undefined, type: string): number {
  if (!actions) return 0
  const found = actions.find((a) => a.action_type === type)
  return found ? parseFloat(found.value) || 0 : 0
}

function sumActionValues(actions: MetaAction[] | undefined, types: string[]): number {
  if (!actions) return 0
  let total = 0
  for (const a of actions) {
    if (types.includes(a.action_type)) {
      total += parseFloat(a.value) || 0
    }
  }
  return total
}

/**
 * Normaliza los totales agregados (sin breakdowns).
 */
function normalizeAggregate(rows: MetaDayInsight[]): Omit<NormalizedMetrics, 'demographics'> & { rawRowsForHistory: MetaDayInsight[] } {
  let spend = 0
  let impressions = 0
  let clicks = 0
  let inlineLinkClicks = 0
  let videoPlayActions = 0
  let videoP25 = 0
  let videoP50 = 0
  let videoP75 = 0
  let videoP95 = 0
  let videoAvgTimeWeighted = 0
  let frequencySum = 0
  let frequencyCount = 0
  let purchases = 0
  let revenue = 0

  for (const day of rows) {
    spend += parseFloat(day.spend) || 0
    impressions += parseInt(day.impressions, 10) || 0
    clicks += parseInt(day.clicks, 10) || 0
    inlineLinkClicks += parseInt(day.inline_link_clicks, 10) || 0
    const directPlays = parseInt(day.video_play_actions || '0', 10) || 0
    const p25 = getActionValue(day.video_p25_watched_actions, 'video_view')
    const p50 = getActionValue(day.video_p50_watched_actions, 'video_view')
    const p75 = getActionValue(day.video_p75_watched_actions, 'video_view')
    const p95 = getActionValue(day.video_p95_watched_actions, 'video_view')
    // Bug conocido: Meta a veces devuelve video_play_actions=0 aunque el video
    // sí se reprodujo (lo cuenta bajo "video_view" en p25_watched_actions).
    // Fallback: usar el mayor entre video_play_actions y video_p25_watched.
    // Quien vio el 25% del video, forzosamente lo reprodujo.
    const dayPlays = Math.max(directPlays, p25)
    videoPlayActions += dayPlays
    videoP25 += p25
    videoP50 += p50
    videoP75 += p75
    videoP95 += p95

    const avgTime = getActionValue(day.video_avg_time_watched_actions, 'video_view')
    if (avgTime > 0) videoAvgTimeWeighted += avgTime

    frequencySum += parseFloat(day.frequency) || 0
    frequencyCount++

    purchases += sumActionValues(day.actions, PURCHASE_TYPES)
    revenue += sumActionValues(day.action_values, PURCHASE_TYPES)
  }

  const frequency = frequencyCount > 0 ? frequencySum / frequencyCount : 0
  const avgWatchTime = videoPlayActions > 0 ? videoAvgTimeWeighted / rows.length : 0

  // Ticket promedio real del creativo (revenue total / purchases total).
  // Si no hay compras, ticket = 0 (y el ROAS diario también será 0).
  const realAvgTicket = purchases > 0 ? revenue / purchases : 0

  const history = rows
    .map((day) => {
      const dayImpressions = parseInt(day.impressions, 10) || 0
      const dayLinkClicks = parseInt(day.inline_link_clicks, 10) || 0
      const ctr = dayImpressions > 0 ? (dayLinkClicks / dayImpressions) * 100 : 0
      const daySpend = parseFloat(day.spend) || 0
      const dayPurchases = sumActionValues(day.actions, PURCHASE_TYPES)
      // 1) Intentar con action_values del día (revenue real por día)
      const dayRevenueFromActionValues = sumActionValues(day.action_values, PURCHASE_TYPES)
      // 2) Fallback: si no hay action_values para ese día, usar el ticket
      //    promedio real del creativo completo (mejor que $50 hardcodeado)
      const dayRevenue = dayRevenueFromActionValues > 0
        ? dayRevenueFromActionValues
        : dayPurchases * realAvgTicket
      const roas = daySpend > 0 ? dayRevenue / daySpend : 0
      return {
        date: day.date_start,
        ctr,
        frequency: parseFloat(day.frequency) || 0,
        roas,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    spend,
    impressions,
    clicks,
    linkClicks: inlineLinkClicks || clicks,
    videoPlays: videoPlayActions,
    hookViews: videoP25,
    holdViews: videoP50,
    purchases,
    revenue,
    avgWatchTime,
    frequency,
    retention25: videoPlayActions > 0 ? (videoP25 / videoPlayActions) * 100 : 0,
    retention50: videoPlayActions > 0 ? (videoP50 / videoPlayActions) * 100 : 0,
    retention75: videoPlayActions > 0 ? (videoP75 / videoPlayActions) * 100 : 0,
    retention95: videoPlayActions > 0 ? (videoP95 / videoPlayActions) * 100 : 0,
    history,
    rawRowsForHistory: rows,
  }
}

/**
 * Normaliza demographics desde filas con breakdown.
 * Como el breakdown NO es compatible con action_type, usamos solo spend/
 * impressions/inline_link_clicks (y derivamos age/placement desde esos).
 * El "roas" por placement se aproxima con CPM (más bajo = más eficiente),
 * ya que no tenemos purchases por plataforma. Se devuelve también
 * spendShare como información adicional.
 */
function normalizeDemographics(rows: MetaDayInsight[]): NormalizedDemographics {
  const ageTotals: Record<string, number> = {}
  const placementSpend: Record<string, number> = {}
  const placementImpressions: Record<string, number> = {}
  let totalImpressionsForAge = 0

  for (const day of rows) {
    const dayImpressions = parseInt(day.impressions, 10) || 0
    const daySpend = parseFloat(day.spend) || 0
    totalImpressionsForAge += dayImpressions

    if (day.age) {
      ageTotals[day.age] = (ageTotals[day.age] || 0) + dayImpressions
    }

    if (day.publisher_platform) {
      placementSpend[day.publisher_platform] = (placementSpend[day.publisher_platform] || 0) + daySpend
      placementImpressions[day.publisher_platform] = (placementImpressions[day.publisher_platform] || 0) + dayImpressions
    }
  }

  const ageBreakdown = Object.entries(ageTotals)
    .map(([range, imps]) => ({
      range,
      pct: totalImpressionsForAge > 0 ? (imps / totalImpressionsForAge) * 100 : 0,
    }))
    .sort((a, b) => b.pct - a.pct)

  // Para placementRoas: como no tenemos purchases por plataforma, usamos
  // un proxy de CTR por plataforma (clicks/spend) como "eficiencia relativa".
  // El usuario puede complementar con datos de revenue por placement desde
  // el admin de Meta. Aquí solo devolvemos un ratio de eficiencia.
  const totalSpend = Object.values(placementSpend).reduce((a, b) => a + b, 0)
  const placementRoas = Object.keys(placementSpend)
    .map((placement) => {
      const platSpend = placementSpend[placement]
      const platImps = placementImpressions[placement]
      // CPM por plataforma: más bajo = más eficiente
      const cpm = platImps > 0 ? (platSpend / platImps) * 1000 : 0
      // Ratio de share of spend (qué % del gasto se fue a esta plataforma)
      const spendShare = totalSpend > 0 ? platSpend / totalSpend : 0
      return {
        placement: humanizePlacement(placement),
        roas: cpm, // usamos CPM como proxy (mientras no tengamos purchases por plataforma)
        // y guardamos también spend share como info adicional
        spendShare,
      } as { placement: string; roas: number; spendShare: number }
    })
    .sort((a, b) => a.roas - b.roas) // CPM más bajo primero = más eficiente

  return {
    ageBreakdown,
    placementRoas: placementRoas.map((p) => ({ placement: p.placement, roas: p.roas })),
  }
}

function humanizePlacement(platform: string): string {
  const map: Record<string, string> = {
    facebook: 'Facebook',
    instagram: 'Instagram',
    messenger: 'Messenger',
    audience_network: 'Audience Network',
  }
  return map[platform.toLowerCase()] || platform
}

async function callMeta(url: string): Promise<{ data?: MetaDayInsight[]; error?: { message: string; code?: number } }> {
  const response = await fetch(url)
  return response.json()
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  let body: { adId?: string }
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    }
  }

  const { adId } = body
  if (!adId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'adId is required' }),
    }
  }

  const accessToken = process.env.META_ACCESS_TOKEN
  if (!accessToken) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'META_ACCESS_TOKEN not configured on server' }),
    }
  }

  // Campos sin action_type (compatibles con breakdowns de age,gender,publisher_platform)
  const breakdownCompatibleFields = [
    'spend',
    'impressions',
    'inline_link_clicks',
    'clicks',
    'reach',
  ].join(',')

  // Campos completos con actions (NO compatibles con esos breakdowns)
  const aggregateFields = [
    'spend',
    'impressions',
    'clicks',
    'inline_link_clicks',
    'frequency',
    'actions',
    'action_values',
    'cost_per_action_type',
    'video_play_actions',
    'video_p25_watched_actions',
    'video_p50_watched_actions',
    'video_p75_watched_actions',
    'video_p95_watched_actions',
    'video_avg_time_watched_actions',
  ].join(',')

  // Llamada 1: agregados sin breakdowns (para actions, video metrics, etc.)
  // date_preset=maximum trae TODO el histórico disponible del ad
  const aggregateUrl = `https://graph.facebook.com/v19.0/${adId}/insights?fields=${aggregateFields}&date_preset=maximum&access_token=${accessToken}`
  // Llamada 2: con breakdowns (solo para age breakdown y placement data)
  const breakdowns = 'age,gender,publisher_platform'
  const breakdownUrl = `https://graph.facebook.com/v19.0/${adId}/insights?fields=${breakdownCompatibleFields}&breakdowns=${breakdowns}&date_preset=maximum&access_token=${accessToken}`

  let aggregateJson: { data?: MetaDayInsight[]; error?: { message: string; code?: number } }
  let breakdownJson: { data?: MetaDayInsight[]; error?: { message: string; code?: number } }

  try {
    ;[aggregateJson, breakdownJson] = await Promise.all([callMeta(aggregateUrl), callMeta(breakdownUrl)])
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Failed to reach Meta Graph API', detail: String(err) }),
    }
  }

  if (aggregateJson.error) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Meta API error',
        detail: aggregateJson.error.message,
        code: aggregateJson.error.code,
      }),
    }
  }

  if (!aggregateJson.data || aggregateJson.data.length === 0) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'No insights data found for this ad' }),
    }
  }

  const aggregate = normalizeAggregate(aggregateJson.data)
  const demographics = breakdownJson.data
    ? normalizeDemographics(breakdownJson.data)
    : { ageBreakdown: [], placementRoas: [] }

  const metrics: NormalizedMetrics = {
    spend: aggregate.spend,
    impressions: aggregate.impressions,
    clicks: aggregate.clicks,
    linkClicks: aggregate.linkClicks,
    videoPlays: aggregate.videoPlays,
    hookViews: aggregate.hookViews,
    holdViews: aggregate.holdViews,
    purchases: aggregate.purchases,
    revenue: aggregate.revenue,
    avgWatchTime: aggregate.avgWatchTime,
    frequency: aggregate.frequency,
    retention25: aggregate.retention25,
    retention50: aggregate.retention50,
    retention75: aggregate.retention75,
    retention95: aggregate.retention95,
    history: aggregate.history,
    demographics,
  }

  // Obtener info de video (opcional, no falla si no se puede)
  const videoInfo = await getVideoInfo(adId, accessToken)

  return {
    statusCode: 200,
    body: JSON.stringify({ metrics, ...videoInfo }),
  }
}

/**
 * Obtiene info de video desde Meta API
 * Intenta obtener:
 * 1. videoUrl (URL directa del mp4) - requiere permisos
 * 2. thumbnailUrl (URL de la miniatura) - casi siempre disponible
 */
async function getVideoInfo(adId: string, accessToken: string): Promise<{
  videoUrl?: string
  thumbnailUrl?: string
  videoUnavailable?: boolean
  adAccountId?: string
}> {
  const result: {
    videoUrl?: string
    thumbnailUrl?: string
    videoUnavailable?: boolean
    adAccountId?: string
  } = {}
  
  try {
    // Primero, obtener la info del ad para encontrar el video_id y ad_account_id
    const adUrl = `https://graph.facebook.com/v19.0/${adId}?fields=object_story_spec,account_id&access_token=${accessToken}`
    const adResponse = await fetch(adUrl)
    const adData = await adResponse.json()
    
    if (adData.account_id) {
      result.adAccountId = adData.account_id
    }
    
    // Extraer video_id del object_story_spec
    let videoId: string | undefined
    try {
      const objectStorySpec = adData.object_story_spec
      if (objectStorySpec?.video_data?.video_id) {
        videoId = objectStorySpec.video_data.video_id
      }
    } catch {
      // No se pudo extraer video_id
    }
    
    if (!videoId) {
      // No hay video_id asociado, intentar thumbnail desde thumbnails.data
      try {
        const thumbsUrl = `https://graph.facebook.com/v19.0/${adId}?fields=thumbnailurls&access_token=${accessToken}`
        const thumbsResponse = await fetch(thumbsUrl)
        const thumbsData = await thumbsResponse.json()
        if (thumbsData.thumbnailurls?.data?.[0]?.uri) {
          result.thumbnailUrl = thumbsData.thumbnailurls.data[0].uri
        }
      } catch {
        // Thumbnail tampoco disponible
      }
      result.videoUnavailable = true
      return result
    }
    
    // Intentar obtener el video completo
    try {
      const videoUrl = `https://graph.facebook.com/v19.0/${videoId}?fields=source,thumbnails&access_token=${accessToken}`
      const videoResponse = await fetch(videoUrl)
      const videoData = await videoResponse.json()
      
      // Guardar URL directa del video si está disponible
      if (videoData.source) {
        result.videoUrl = videoData.source
      }
      
      // Intentar thumbnail de thumbnails.data o de picture
      if (videoData.thumbnails?.data?.[0]?.uri) {
        result.thumbnailUrl = videoData.thumbnails.data[0].uri
      } else if (videoData.picture) {
        result.thumbnailUrl = videoData.picture
      }
      
      // Si no tenemos videoUrl pero tenemos thumbnail, marcar como no disponible
      if (!result.videoUrl) {
        result.videoUnavailable = true
      }
    } catch {
      // Error al obtener video, marcar como no disponible
      result.videoUnavailable = true
    }
    
  } catch (err) {
    console.error('Error getting video info:', err)
    result.videoUnavailable = true
  }
  
  return result
}

export { handler }
