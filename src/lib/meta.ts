import type { RawMetrics } from '../types'

// El access token de Meta Ads NUNCA debe estar en el cliente.
// Se lee desde META_ACCESS_TOKEN en las env vars de Netlify.

// Secreto compartido para autenticar las llamadas a Netlify Functions.
export const APP_SECRET = import.meta.env.VITE_APP_SECRET as string | undefined

const META_TOKEN_KEY = 'tracker-metricas:meta-token' // legacy, para migrar

export interface MetaEntity {
  id: string
  name: string
  status?: string
  thumbnail?: string
  thumbnailUrl?: string
  videoUrl?: string
  videoId?: string
}

export interface MetaSyncResult {
  metrics: RawMetrics
  thumbnailUrl?: string
  videoUrl?: string
  videoUnavailable?: boolean
  adAccountId?: string
}

/**
 * Migra el token legacy que el usuario pudo haber guardado en localStorage
 * (versión anterior) y lo borra porque ya no se usa.
 */
export function migrateLegacyToken(): void {
  if (localStorage.getItem(META_TOKEN_KEY)) {
    localStorage.removeItem(META_TOKEN_KEY)
  }
}

migrateLegacyToken()

export type MetaLevel = 'accounts' | 'campaigns' | 'adsets' | 'ads'

/**
 * Llama a una Netlify Function con el x-app-secret. Distingue entre:
 * - 404 → la function no está desplegada (salvo `allowNotFound`, ver abajo)
 * - HTML → Vite devolvió index.html en vez de la function (falta netlify dev)
 * - 500/200 con error JSON → error de la function o de la API de Meta
 */
export async function callFunction<T>(
  url: string,
  init?: RequestInit,
  opts: {
    allowNotFound?: boolean
    // La respuesta 200 trae un campo `error` que es dato, no fallo de la
    // función (p. ej. un análisis guardado en estado 'error').
    errorFieldIsData?: boolean
  } = {}
): Promise<T | null> {
  let response: Response
  try {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string>),
    }
    if (APP_SECRET) {
      headers['x-app-secret'] = APP_SECRET
    }
    response = await fetch(url, { ...init, headers })
  } catch (err) {
    throw new Error(
      `No se pudo conectar con el servidor (${err instanceof Error ? err.message : 'error de red'}). Verifica tu conexión.`
    )
  }

  const text = await response.text()
  const trimmed = text.trim()

  // 0. Algunas funciones responden 404 { status: 'not_found' } cuando el
  //    recurso no existe todavía (p. ej. un creativo sin análisis). Con
  //    allowNotFound eso se devuelve como null en vez de error.
  if (response.status === 404 && opts.allowNotFound) {
    try {
      if (JSON.parse(trimmed)?.status === 'not_found') return null
    } catch {
      // no es JSON: sigue como 404 normal (función no desplegada)
    }
  }

  // 1. 404: Netlify Dev devuelve "Function not found..." (texto plano, no JSON ni HTML)
  if (response.status === 404) {
    throw new Error(
      `Función no desplegada (404). Verifica que el archivo exista en netlify/functions/ y que el nombre coincida con la URL.`
    )
  }

  // 2. Detectar HTML (Vite devolvió index.html en vez de la function)
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
    throw new Error(
      'Función no encontrada. Estás corriendo `npm run dev` (Vite) en vez de `netlify dev`. Mata el server actual y arranca con `netlify dev` para que las Netlify Functions estén disponibles.'
    )
  }

  // 3. Intentar parsear JSON (no confiar en Content-Type porque Netlify Dev a veces no lo envía)
  let json: { error?: string; detail?: string; [k: string]: unknown } | null = null
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(
      `Respuesta inválida del servidor (HTTP ${response.status}, no es JSON ni HTML): ${trimmed.slice(0, 200)}`
    )
  }

  // 4. Errores de la function o de Meta Ads
  if (!response.ok || (json?.error && !opts.errorFieldIsData)) {
    const metaDetail = json?.detail ? ` — ${json.detail}` : ''
    const errorType = json?.error?.toString().includes('Meta API')
      ? 'Error de Meta Ads'
      : 'Error de la función'
    throw new Error(`${errorType}: ${json?.error || `HTTP ${response.status}`}${metaDetail}`)
  }

  return json as T
}

/** callFunction para las funciones de Meta, que nunca devuelven "no encontrado". */
async function callMetaFunction<T>(url: string, init?: RequestInit): Promise<T> {
  return (await callFunction<T>(url, init)) as T
}

/**
 * Trae un nivel de la jerarquía de Meta Ads. El parentId es requerido
 * para todos los niveles excepto 'accounts'.
 */
export async function fetchMetaLevel(
  level: MetaLevel,
  parentId?: string
): Promise<MetaEntity[]> {
  const params = new URLSearchParams({ level })
  if (parentId) params.set('parentId', parentId)

  const data = await callMetaFunction<{ items: MetaEntity[] }>(
    `/.netlify/functions/meta-hierarchy?${params.toString()}`
  )
  return data.items || []
}

/**
 * Sincroniza un creativo con Meta Ads vía Netlify Function.
 * El token se lee del server (META_ACCESS_TOKEN env var).
 */
export async function syncCreativeWithMeta(adId: string): Promise<MetaSyncResult> {
  return callMetaFunction<MetaSyncResult>('/.netlify/functions/meta-insights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adId }),
  })
}

/**
 * Path de la funcion Lambda original. Los creativos ya guardados en
 * localStorage (y lo que devuelve upload-video-chunk) siguen usandolo.
 */
const LEGACY_VIDEO_PATH = '/.netlify/functions/get-video'

/** Path de la edge function que sirve el video por streaming. */
const EDGE_VIDEO_PATH = '/video'

/**
 * Añade el token de autenticación a una URL de get-video y reescribe el path
 * viejo al de la edge function.
 * El navegador no puede enviar headers custom en `<video src=...>`,
 * así que el token va como query param.
 */
export function authenticateVideoUrl(url: string): string {
  if (!APP_SECRET || !url) return url
  try {
    const parsed = new URL(url, window.location.origin)

    // La funcion Lambda devolvia 502 con videos de mas de ~6 MB (limite de
    // tamano de respuesta). Reescribimos el path a la edge function, que hace
    // streaming real. Se hace aqui, al reproducir, para que los creativos ya
    // guardados funcionen sin migrar nada en localStorage.
    if (parsed.pathname === LEGACY_VIDEO_PATH) {
      parsed.pathname = EDGE_VIDEO_PATH
    }

    // Idempotente: si la URL ya trae `token` (p. ej. un creativo guardado por
    // una version anterior), se reemplaza en vez de duplicarse. Netlify une los
    // parametros repetidos con coma ("a,a"), lo que rompia la comparacion en
    // isAuthorizedByToken y devolvia 401.
    parsed.searchParams.delete('token')
    parsed.searchParams.set('token', APP_SECRET)
    return url.startsWith('http') ? parsed.toString() : `${parsed.pathname}${parsed.search}`
  } catch {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}token=${encodeURIComponent(APP_SECRET)}`
  }
}
