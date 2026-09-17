import type { HandlerEvent } from '@netlify/functions'

/**
 * Verifica que la petición incluya el secreto correcto en el header `x-app-secret`.
 * Devuelve `true` si el header coincide con `process.env.APP_SECRET`.
 */
export function isAuthorized(event: HandlerEvent): boolean {
  const secret = process.env.APP_SECRET
  if (!secret) {
    console.error('APP_SECRET no está configurado en las variables de entorno')
    return false
  }
  const provided = event.headers['x-app-secret']
  return provided === secret
}

/**
 * Variante para `get-video`: como el navegador carga el video con `<video src=...>`
 * y no puede enviar headers custom, acepta el secreto como query param `?token=`.
 */
export function isAuthorizedByToken(event: HandlerEvent): boolean {
  const secret = process.env.APP_SECRET
  if (!secret) {
    console.error('APP_SECRET no está configurado en las variables de entorno')
    return false
  }
  const provided = event.queryStringParameters?.token
  return provided === secret
}
