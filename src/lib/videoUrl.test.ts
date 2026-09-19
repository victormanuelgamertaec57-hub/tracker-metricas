import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const SECRET = 'secreto-de-prueba'

/**
 * authenticateVideoUrl lee APP_SECRET al cargar el modulo, asi que hay que
 * resetear modulos e importar en fresco con el env stubbeado.
 */
async function loadAuthenticateVideoUrl() {
  vi.resetModules()
  vi.stubEnv('VITE_APP_SECRET', SECRET)
  const mod = await import('./meta')
  return mod.authenticateVideoUrl
}

describe('authenticateVideoUrl', () => {
  let authenticateVideoUrl: (url: string) => string

  beforeEach(async () => {
    authenticateVideoUrl = await loadAuthenticateVideoUrl()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reescribe el path viejo de la funcion Lambda al de la edge function', () => {
    const out = authenticateVideoUrl('/.netlify/functions/get-video?key=creative-videos%2Fabc.mp4')
    const parsed = new URL(out, 'https://example.test')
    expect(parsed.pathname).toBe('/video')
    expect(parsed.searchParams.get('key')).toBe('creative-videos/abc.mp4')
    expect(parsed.searchParams.get('token')).toBe(SECRET)
  })

  it('no duplica el token cuando la URL guardada ya lo traia', () => {
    const out = authenticateVideoUrl(
      `/.netlify/functions/get-video?key=creative-videos%2Fabc.mp4&token=${SECRET}`
    )
    // Netlify une los parametros repetidos con coma, lo que provocaba 401.
    expect(out.match(/token=/g)).toHaveLength(1)
    const parsed = new URL(out, 'https://example.test')
    expect(parsed.searchParams.get('token')).toBe(SECRET)
    expect(parsed.pathname).toBe('/video')
  })

  it('reemplaza un token viejo/incorrecto por el actual', () => {
    const out = authenticateVideoUrl('/.netlify/functions/get-video?key=x&token=obsoleto')
    const parsed = new URL(out, 'https://example.test')
    expect(parsed.searchParams.get('token')).toBe(SECRET)
    expect(out).not.toContain('obsoleto')
  })

  it('deja intactos los paths que no son el de get-video', () => {
    const out = authenticateVideoUrl('/otra-cosa?key=x')
    expect(new URL(out, 'https://example.test').pathname).toBe('/otra-cosa')
  })

  it('devuelve la URL sin tocar si no hay APP_SECRET', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_APP_SECRET', '')
    const { authenticateVideoUrl: sinSecreto } = await import('./meta')
    const url = '/.netlify/functions/get-video?key=x'
    expect(sinSecreto(url)).toBe(url)
  })

  it('no rompe con cadena vacia', () => {
    expect(authenticateVideoUrl('')).toBe('')
  })
})
