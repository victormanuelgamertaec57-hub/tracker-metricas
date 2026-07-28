import type { Handler, HandlerEvent } from '@netlify/functions'

interface MetaEntityRaw {
  id: string
  name: string
  status?: string
  creative?: { id?: string; name?: string; thumbnail_url?: string }
}

interface MetaListResponse {
  data: MetaEntityRaw[]
  paging?: { next?: string }
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  const accessToken = process.env.META_ACCESS_TOKEN
  if (!accessToken) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'META_ACCESS_TOKEN not configured on server',
        detail:
          'Configura la variable de entorno META_ACCESS_TOKEN (localmente en .env, o en Netlify Site settings → Environment variables) y reinicia `netlify dev`.',
      }),
    }
  }

  const params = event.queryStringParameters || {}
  const level = params.level
  const parentId = params.parentId

  let url: string

  switch (level) {
    case 'accounts':
      // Cuentas publicitarias a las que el token tiene acceso.
      // Para tokens de Business Manager con varias cuentas, también funciona.
      url = `https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,account_status&access_token=${accessToken}`
      break

    case 'campaigns': {
      if (!parentId) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'parentId (accountId) is required for level=campaigns' }),
        }
      }
      // Estados que el usuario puede vincular a un creativo:
      // ACTIVE, PAUSED, CAMPAIGN_PAUSED, IN_PROCESS
      // (excluimos ARCHIVED y los deleted)
      url = `https://graph.facebook.com/v19.0/${parentId}/campaigns?fields=id,name,status,effective_status&filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED","CAMPAIGN_PAUSED","IN_PROCESS"]}]&access_token=${accessToken}`
      break
    }

    case 'adsets': {
      if (!parentId) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'parentId (campaignId) is required for level=adsets' }),
        }
      }
      // Para adsets/ads el effective_status puede ser:
      // ACTIVE, PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED, IN_PROCESS
      // El parámetro filtering es la forma correcta de filtrar arrays en Meta
      const filter = encodeURIComponent('[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED","CAMPAIGN_PAUSED","ADSET_PAUSED","IN_PROCESS"]}]')
      url = `https://graph.facebook.com/v19.0/${parentId}/adsets?fields=id,name,status,effective_status&filtering=${filter}&access_token=${accessToken}`
      break
    }

    case 'ads': {
      if (!parentId) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'parentId (adsetId) is required for level=ads' }),
        }
      }
      const filter = encodeURIComponent('[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED","CAMPAIGN_PAUSED","ADSET_PAUSED","IN_PROCESS"]}]')
      url = `https://graph.facebook.com/v19.0/${parentId}/ads?fields=id,name,status,effective_status,creative{id,name,thumbnail_url}&filtering=${filter}&access_token=${accessToken}`
      break
    }

    default:
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Invalid level',
          detail: 'Use one of: accounts, campaigns, adsets, ads',
        }),
      }
  }

  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to reach Meta Graph API', detail: String(err) }),
    }
  }

  const json = (await response.json()) as MetaListResponse | { error?: { message: string; code?: number } }

  if (!response.ok || (json as { error?: unknown }).error) {
    const errObj = (json as { error?: { message: string; code?: number } }).error
    return {
      statusCode: response.ok ? 400 : response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Meta API error',
        detail: errObj?.message || response.statusText,
        code: errObj?.code,
      }),
    }
  }

  const list = json as MetaListResponse
  const items = (list.data || []).map((item) => ({
    id: item.id,
    name: item.name,
    status: item.status || (item as { effective_status?: string }).effective_status,
    thumbnail: item.creative?.thumbnail_url,
  }))

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  }
}

export { handler }
