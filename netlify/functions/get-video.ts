import type { Handler, HandlerEvent } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { isAuthorizedByToken } from './_auth'

const STORE_NAME = 'creative-videos'

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  if (!isAuthorizedByToken(event)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
    }
  }

  const key = event.queryStringParameters?.key

  if (!key) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing key parameter' }),
    }
  }

  // Sanitizar key para prevenir path traversal
  const sanitizedKey = key.replace(/\.\./g, '').replace(/^\//, '')
  
  // Aceptar tanto 'videos/' como 'creative-videos/'
  if (!sanitizedKey.startsWith('videos/') && !sanitizedKey.startsWith('creative-videos/')) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Invalid key format' }),
    }
  }

  try {
    const store = getStore(STORE_NAME)
    const result = await store.get(sanitizedKey, { type: 'buffer' })

    if (!result) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Video not found' }),
      }
    }

    // Detectar content-type desde los primeros bytes
    let contentType = 'video/mp4'
    if (result instanceof Uint8Array && result.length >= 12) {
      // Check for common video formats by magic bytes
      if (result[4] === 0x66 && result[5] === 0x74 && result[6] === 0x79 && result[7] === 0x70) {
        // ftyp -> MP4
        contentType = 'video/mp4'
      } else if (result[0] === 0x1A && result[1] === 0x45 && result[2] === 0xDF && result[3] === 0xA3) {
        // WebM
        contentType = 'video/webm'
      } else if (result[0] === 0x00 && result[1] === 0x00 && result[2] === 0x00 && result[3] === 0x00) {
        contentType = 'video/3gpp'
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': result.length.toString(),
        'Cache-Control': 'public, max-age=31536000', // Cache por 1 año
      },
      body: result.toString('base64'),
      isBase64Encoded: true,
    }
  } catch (err) {
    console.error('Get video error:', err)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to get video', detail: String(err) }),
    }
  }
}

export { handler }
