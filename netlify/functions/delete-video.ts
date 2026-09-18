import type { Handler, HandlerEvent } from '@netlify/functions'
import { getStore, connectLambda } from '@netlify/blobs'
import { isAuthorized } from './_auth'

const STORE_NAME = 'creative-videos'

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'DELETE' && event.httpMethod !== 'POST') {
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to initialize storage connection' }),
    }
  }

  try {
    // El key del video viene como query param o en el body
    let key: string | undefined

    if (event.queryStringParameters?.key) {
      key = event.queryStringParameters.key
    } else {
      // Intentar parsear del body
      try {
        const body = event.body ? JSON.parse(event.body) : {}
        key = body.key
      } catch {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Missing video key' }),
        }
      }
    }

    if (!key) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing video key' }),
      }
    }

    const store = getStore(STORE_NAME)
    await store.delete(key)

    console.log(`Video eliminado: ${key}`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, key }),
    }
  } catch (err) {
    console.error('Delete video error:', err)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to delete video', detail: String(err) }),
    }
  }
}

export { handler }
