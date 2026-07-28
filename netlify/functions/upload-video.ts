import type { Handler, HandlerEvent } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const MAX_SIZE_MB = 50
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024
const STORE_NAME = 'creative-videos'

interface UploadResponse {
  videoUrl: string
  key: string
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  // Verificar Content-Type
  const contentType = event.headers['content-type'] || ''
  
  try {
    // Manejar multipart o body raw con base64
    if (contentType.includes('multipart/form-data') || event.isBase64Encoded) {
      // Si viene en base64 (desde el frontend)
      const bodyStr = event.isBase64Encoded 
        ? Buffer.from(event.body || '', 'base64').toString('binary')
        : event.body || ''
      
      // Extraer el video del body multipart (simplificado para Netlify)
      // El frontend envía: JSON con base64
      let parsed: { video?: string; filename?: string; contentType?: string }
      try {
        parsed = JSON.parse(bodyStr)
      } catch {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid request body' }),
        }
      }

      if (!parsed.video) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'No video data provided' }),
        }
      }

      // Validar tamaño
      const videoBuffer = Buffer.from(parsed.video, 'base64')
      if (videoBuffer.length > MAX_SIZE_BYTES) {
        return {
          statusCode: 413,
          body: JSON.stringify({ 
            error: 'FILE_TOO_LARGE',
            message: `El video es muy pesado (${MAX_SIZE_MB}MB máximo). Comprímelo o sube uno más liviano.`,
            maxSizeMB: MAX_SIZE_MB,
          }),
        }
      }

      // Generar key única
      const key = `videos/${Date.now()}-${parsed.filename || 'video.mp4'}`
      
      // Guardar en Netlify Blobs
      const store = getStore(STORE_NAME)
      await store.set(key, videoBuffer, {
        contentType: parsed.contentType || 'video/mp4',
      })

      // Generar URL pública (Netlify Blobs sirve archivos automáticamente)
      const videoUrl = `/.netlify/functions/get-video?key=${encodeURIComponent(key)}`
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          videoUrl,
          key,
        } as UploadResponse),
      }
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Unsupported content type. Use base64 JSON body.' }),
    }
  } catch (err) {
    console.error('Upload error:', err)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to upload video', detail: String(err) }),
    }
  }
}

export { handler }
