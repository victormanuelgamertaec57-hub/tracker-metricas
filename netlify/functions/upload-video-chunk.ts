import type { Handler, HandlerEvent } from '@netlify/functions'
import { getStore, connectLambda } from '@netlify/blobs'
import { faststart } from 'moov-faststart'
import { isAuthorized } from './_auth'
import { readMp4DurationSec } from './_mp4'

const CHUNK_STORE_NAME = 'video-chunks'
const FINAL_STORE_NAME = 'creative-videos'

interface ChunkUploadRequest {
  uploadId: string
  chunkNumber: number
  totalChunks: number
  chunk: string // base64 encoded
  filename: string
  contentType: string
}

interface ChunkUploadResponse {
  videoUrl?: string
  key?: string
  durationSec?: number | null
  message: string
}

/**
 * Determina el Content-Type real olfateando los magic bytes del archivo, en
 * vez de confiar en el que declara el navegador.
 *
 * Un .mov llega del navegador como "video/quicktime", que Chrome NO reconoce
 * (canPlayType devuelve cadena vacia) y deja el <video> sin cargar nunca.
 * QuickTime y MP4 comparten la estructura ISO-BMFF ("ftyp" en el offset 4),
 * asi que normalizar a video/mp4 es correcto y es lo que hacia la funcion
 * Lambda original al servir.
 */
function sniffVideoContentType(buf: Buffer): string {
  if (buf.length >= 12) {
    // "ftyp" en offset 4 -> contenedor ISO-BMFF (MP4, M4V, MOV/QuickTime)
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
      return 'video/mp4'
    }
    // EBML -> WebM / Matroska
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      return 'video/webm'
    }
  }
  return 'video/mp4'
}

/**
 * Limite de tamano para el remux. faststart necesita el buffer de entrada y el
 * de salida en memoria a la vez: medido, un archivo de 130 MB lleva el RSS a
 * ~706 MB y la funcion dispone de ~1,19 GB. Por encima de esto se guarda sin
 * optimizar en vez de arriesgar un OOM.
 */
const FASTSTART_MAX_BYTES = 150 * 1024 * 1024

/**
 * Mueve el atomo moov al inicio del archivo (lo que ffmpeg llama
 * `-movflags +faststart`), reescribiendo las tablas de offsets stco/co64.
 *
 * Es un remux puro: no recodifica nada, el contenido decodificado es
 * identico bit a bit y el tamano no cambia. Sin esto, un .mov de camara deja
 * el moov al final y el navegador tiene que arrastrar casi todo el archivo
 * antes de poder mostrar el primer frame.
 *
 * Nunca hace fallar la subida: ante cualquier problema se guarda el original.
 */
function tryFaststart(buf: Buffer<ArrayBuffer>, contentType: string): Buffer<ArrayBuffer> {
  if (contentType !== 'video/mp4') return buf
  if (buf.length > FASTSTART_MAX_BYTES) {
    console.log(`faststart omitido: ${buf.length} bytes supera el limite de memoria`)
    return buf
  }
  try {
    const t0 = Date.now()
    const out = faststart(buf)
    console.log(`faststart aplicado en ${Date.now() - t0} ms (${buf.length} bytes)`)
    return out
  } catch (err) {
    // Contenedor no soportado o ya invalido: se guarda tal cual.
    console.warn('faststart omitido:', err instanceof Error ? err.message : String(err))
    return buf
  }
}

const handler: Handler = async (event: HandlerEvent) => {
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

  // Netlify no configura el entorno de Blobs automáticamente en funciones V1
  // (Lambda compatibility mode), así que hay que inicializarlo desde el event.
  try {
    connectLambda(event as any)
  } catch (err) {
    console.error('Error connecting Lambda environment for Blobs:', err)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to initialize storage connection' }),
    }
  }

  try {
    // Parsear el body
    let body: ChunkUploadRequest
    try {
      let rawBody = event.body || '{}'
      
      // Si está codificado en base64, decodificar primero
      if (event.isBase64Encoded && rawBody) {
        rawBody = Buffer.from(rawBody, 'base64').toString('utf-8')
      }
      
      // Si ya es un objeto (Netlify puede parsear JSON automáticamente)
      if (typeof rawBody === 'object') {
        body = rawBody as ChunkUploadRequest
      } else {
        body = JSON.parse(rawBody)
      }
    } catch (e) {
      console.error('Body parsing error:', e, 'Raw body:', event.body?.substring?.(0, 200))
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid request body', detail: String(e) }),
      }
    }

    const { uploadId, chunkNumber, totalChunks, chunk, filename, contentType } = body

    // Validaciones básicas
    if (!uploadId || chunkNumber === undefined || !totalChunks || !chunk) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: uploadId, chunkNumber, totalChunks, chunk' }),
      }
    }

    if (chunkNumber < 0 || chunkNumber >= totalChunks) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid chunkNumber: must be between 0 and totalChunks-1' }),
      }
    }

    // Validar que el contentType sea un video
    if (contentType && !contentType.startsWith('video/')) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid contentType: must start with video/' }),
      }
    }

    // Guardar el chunk en el store temporal
    const chunkStore = getStore(CHUNK_STORE_NAME)
    const chunkKey = `chunks/${uploadId}/${chunkNumber}`
    
    const chunkBuffer = Buffer.from(chunk, 'base64')
    // Usar ArrayBuffer directamente para compatibilidad con BlobInput
    await chunkStore.set(chunkKey, chunkBuffer.buffer.slice(chunkBuffer.byteOffset, chunkBuffer.byteOffset + chunkBuffer.byteLength))

    console.log(`Chunk ${chunkNumber + 1}/${totalChunks} guardado para upload ${uploadId}`)

    // Si no es el último chunk, confirmar recepción
    const isLastChunk = chunkNumber === totalChunks - 1
    
    if (!isLastChunk) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Chunk ${chunkNumber + 1}/${totalChunks} recibido`,
          received: true,
        } as ChunkUploadResponse),
      }
    }

    // === ES EL ÚLTIMO CHUNK: Reensamblar todo ===
    console.log(`Iniciando reensamble de ${totalChunks} chunks para upload ${uploadId}`)

    // Recoger todos los chunks en orden
    const chunks: Buffer[] = []
    for (let i = 0; i < totalChunks; i++) {
      const key = `chunks/${uploadId}/${i}`
      try {
        const chunkData = await chunkStore.get(key, { type: 'arrayBuffer' })
        if (!chunkData) {
          throw new Error(`Chunk ${i} no encontrado`)
        }
        chunks.push(Buffer.from(chunkData))
        console.log(`Chunk ${i + 1}/${totalChunks} leído`)
      } catch (err) {
        console.error(`Error leyendo chunk ${i}:`, err)
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: 'CHUNK_MISSING',
            message: `Falta el chunk ${i}. La subida se canceló. Intenta de nuevo.`,
            missingChunk: i,
          }),
        }
      }
    }

    // Combinar todos los chunks
    const finalBuffer = Buffer.concat(chunks)
    console.log(`Video reensamblado: ${finalBuffer.length} bytes`)

    // Guardar el video final
    const finalStore = getStore(FINAL_STORE_NAME)
    const finalKey = `creative-videos/${uploadId}.mp4`
    
    // El Content-Type se determina por magic bytes, NO por lo que declaro el
    // cliente: los .mov llegan como video/quicktime y Chrome no los reproduce.
    const sniffedType = sniffVideoContentType(finalBuffer)
    if (sniffedType !== contentType) {
      console.log(`Content-Type normalizado: ${contentType} -> ${sniffedType}`)
    }

    // Remux para dejar el moov al inicio; devuelve el original si no aplica.
    const storedBuffer = tryFaststart(finalBuffer, sniffedType)

    // Duración para compararla luego con la del video del anuncio en Meta.
    // null si no se puede leer: nunca bloquea la subida.
    const durationSec = readMp4DurationSec(storedBuffer)

    // Guardamos size y contentType como metadata: Blobs NO expone el tamano
    // por si mismo (getMetadata solo devuelve { etag, metadata }), y sin el
    // tamano no se pueden servir Range requests ni Content-Length al hacer
    // streaming.
    await finalStore.set(
      finalKey,
      storedBuffer.buffer.slice(storedBuffer.byteOffset, storedBuffer.byteOffset + storedBuffer.byteLength),
      { metadata: { size: storedBuffer.length, contentType: sniffedType, filename, durationSec } }
    )

    console.log(`Video final guardado en ${finalKey}`)

    // Limpiar chunks temporales (sin await para no bloquear)
    cleanupChunks(uploadId, totalChunks, chunkStore).catch(err => {
      console.error('Error limpiando chunks:', err)
    })

    // Generar URL
    const videoUrl = `/.netlify/functions/get-video?key=${encodeURIComponent(finalKey)}`

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl,
        key: finalKey,
        message: 'Video completo subido y reensamblado',
        fileSize: finalBuffer.length,
        durationSec,
      } as ChunkUploadResponse),
    }
  } catch (err) {
    console.error('Upload chunk error:', err)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process chunk', detail: String(err) }),
    }
  }
}

/**
 * Limpia los chunks temporales después de un upload exitoso
 */
async function cleanupChunks(
  uploadId: string,
  totalChunks: number,
  store: ReturnType<typeof getStore>
): Promise<void> {
  console.log(`Limpiando ${totalChunks} chunks para upload ${uploadId}`)
  
  const errors: string[] = []
  
  for (let i = 0; i < totalChunks; i++) {
    const key = `chunks/${uploadId}/${i}`
    try {
      await store.delete(key)
    } catch (err) {
      errors.push(`No se pudo eliminar chunk ${i}: ${err}`)
    }
  }
  
  if (errors.length > 0) {
    console.warn('Errores en limpieza de chunks:', errors)
  } else {
    console.log(`Chunks limpiados exitosamente para upload ${uploadId}`)
  }
}

export { handler }
