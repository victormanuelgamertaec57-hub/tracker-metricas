import type { Handler, HandlerEvent } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

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
  message: string
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
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
        const chunkData = await chunkStore.get(key)
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
    
    await finalStore.set(finalKey, finalBuffer.buffer.slice(finalBuffer.byteOffset, finalBuffer.byteOffset + finalBuffer.byteLength))

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
