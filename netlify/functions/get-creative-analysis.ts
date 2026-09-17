import type { Handler, HandlerEvent } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { isAuthorized } from './_auth'

const ANALYSIS_STORE = 'creative-ai-analysis'

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  if (!isAuthorized(event)) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    }
  }

  const key = event.queryStringParameters?.key

  if (!key) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing required query param: key' }),
    }
  }

  try {
    const store = getStore(ANALYSIS_STORE)
    const raw = await store.get(key, { type: 'text' })

    if (!raw) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'not_found' }),
      }
    }

    // Parse to validate, then return as-is
    const analysis = JSON.parse(raw)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analysis),
    }
  } catch (err) {
    console.error('Error reading analysis:', err)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: `Error reading analysis: ${err instanceof Error ? err.message : String(err)}`,
      }),
    }
  }
}

export { handler }
