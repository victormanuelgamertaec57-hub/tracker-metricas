import { getStore } from '@netlify/blobs'
import type { Context } from '@netlify/edge-functions'

const STORE_NAME = 'creative-videos'

/**
 * Sirve un video desde Netlify Blobs por streaming real.
 *
 * Reemplaza a netlify/functions/get-video.ts (Lambda compat), que devolvia
 * 502 `Function.ResponseSizeTooLarge` con cualquier video de mas de ~6 MB:
 * esa funcion cargaba el blob entero en memoria y lo codificaba en base64
 * dentro del cuerpo, chocando con el techo de 6.291.556 bytes de respuesta
 * de las funciones Lambda. Aqui el ReadableStream de Blobs se pasa directo
 * al Response, sin materializarlo.
 *
 * En edge functions getStore() se auto-configura (siteID/token); no se usa
 * connectLambda, que es exclusivo de las funciones Lambda compat.
 *
 * Las URLs guardadas en creativos existentes apuntan al path viejo
 * (/.netlify/functions/get-video); authenticateVideoUrl() en src/lib/meta.ts
 * reescribe el path al de esta edge function, por lo que no hace falta
 * migrar datos en localStorage.
 */
export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(405, { error: 'Method not allowed' })
  }

  const url = new URL(req.url)

  // --- Auth por token, mismo criterio que functions/_auth.ts ---
  const secret = Netlify.env.get('APP_SECRET')
  if (!secret) {
    console.error('APP_SECRET no esta configurado en las variables de entorno')
    return json(401, { error: 'Unauthorized' })
  }
  const provided = url.searchParams.get('token')
  if (provided !== secret) {
    return json(401, { error: 'Unauthorized' })
  }

  // --- Key ---
  const key = url.searchParams.get('key')
  if (!key) return json(400, { error: 'Missing key parameter' })

  const sanitizedKey = key.replace(/\.\./g, '').replace(/^\//, '')
  if (!sanitizedKey.startsWith('videos/') && !sanitizedKey.startsWith('creative-videos/')) {
    return json(403, { error: 'Invalid key format' })
  }

  try {
    const store = getStore(STORE_NAME)

    // `stream` devuelve un ReadableStream: nada se acumula en memoria.
    const res = await store.getWithMetadata(sanitizedKey, { type: 'stream' })
    if (!res?.data) return json(404, { error: 'Video not found' })
    const stream = res.data as ReadableStream<Uint8Array>

    // OJO: getMetadata() de Blobs NO expone el tamano del objeto (solo
    // { etag, metadata }). El size se guarda como metadata propia en
    // upload-video-chunk.ts. Los blobs subidos ANTES de ese cambio no lo
    // tienen: en ese caso se sirve sin Content-Length ni Range.
    const rawSize = (res.metadata as Record<string, unknown> | undefined)?.size
    const size = typeof rawSize === 'number' ? rawSize : undefined
    const rawType = (res.metadata as Record<string, unknown> | undefined)?.contentType
    const contentType = playableContentType(rawType)

    const range = req.headers.get('range')
    if (range && typeof size === 'number') {
      return rangeResponse(stream, range, size, contentType)
    }

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000',
    }
    // Solo anunciamos Accept-Ranges si realmente podemos servir rangos, es
    // decir si conocemos el tamano. Los blobs subidos antes de que se guardara
    // la metadata no lo tienen y se sirven completos.
    if (typeof size === 'number') {
      headers['Content-Length'] = String(size)
      headers['Accept-Ranges'] = 'bytes'
    }

    return new Response(stream, { status: 200, headers })
  } catch (err) {
    console.error('Get video edge error:', err)
    return json(500, { error: 'Failed to get video', detail: String(err) })
  }
}

/**
 * Solo devolvemos tipos que los navegadores saben reproducir.
 *
 * Los blobs subidos antes de que upload-video-chunk normalizara por magic
 * bytes guardaron el tipo que declaro el navegador: para un .mov eso es
 * "video/quicktime", que Chrome no reconoce (canPlayType da cadena vacia) y
 * deja el <video> cargando para siempre. Como el contenedor real es ISO-BMFF,
 * servirlo como video/mp4 es correcto y evita tener que resubir nada.
 */
const PLAYABLE_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg'])

function playableContentType(raw: unknown): string {
  return typeof raw === 'string' && PLAYABLE_TYPES.has(raw) ? raw : 'video/mp4'
}

/** Sirve un rango recortando el stream sin materializarlo en memoria. */
function rangeResponse(stream: ReadableStream<Uint8Array>, range: string, size: number, contentType: string): Response {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!match) return unsatisfiable(size)

  const rawStart = match[1]
  const rawEnd = match[2]

  // "bytes=-" no especifica nada.
  if (!rawStart && !rawEnd) return unsatisfiable(size)

  let start: number
  let end: number

  if (!rawStart) {
    // suffix-range (RFC 7233 §2.1): "bytes=-N" son los ULTIMOS N bytes, no
    // los primeros. Lo piden los reproductores con videos sin "fast start",
    // donde el moov atom va al final del archivo.
    const suffixLength = Number(rawEnd)
    if (suffixLength === 0) return unsatisfiable(size)
    start = Math.max(0, size - suffixLength) // si N > size, se sirve entero
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    return unsatisfiable(size)
  }

  let seen = 0
  const wanted = end - start + 1
  let emitted = 0

  const sliced = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (emitted >= wanted) return
        const chunkStart = seen
        seen += chunk.byteLength

        if (seen <= start) return // todavia antes del rango

        const from = Math.max(0, start - chunkStart)
        const to = Math.min(chunk.byteLength, from + (wanted - emitted))
        const piece = chunk.subarray(from, to)
        emitted += piece.byteLength
        controller.enqueue(piece)

        if (emitted >= wanted) controller.terminate()
      },
    })
  )

  return new Response(sliced, {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(wanted),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000',
    },
  })
}

/** 416 con Content-Range, como exige RFC 7233 para rangos no satisfacibles. */
function unsatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: { 'Content-Range': `bytes */${size}` },
  })
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = { path: '/video' }
