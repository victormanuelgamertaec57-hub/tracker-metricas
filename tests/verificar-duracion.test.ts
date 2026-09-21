import { describe, it, expect } from 'vitest'
import { verificarDuracion } from '../netlify/functions/analyze-creative-background'

describe('verificarDuracion (video subido vs. anuncio en Meta)', () => {
  it('caso Anuncio 2: 37,2 s vs 18,3 s -> no coincide', () => {
    const v = verificarDuracion(37.2, 18.3)
    expect(v.coincide).toBe(false)
    expect(v.diferenciaSeg).toBeCloseTo(18.9, 5)
  })

  it('dentro de la tolerancia de ±1,5 s -> coincide', () => {
    expect(verificarDuracion(18.3, 19.8).coincide).toBe(true)
    expect(verificarDuracion(19.8, 18.3).coincide).toBe(true)
  })

  it('justo fuera de la tolerancia -> no coincide', () => {
    expect(verificarDuracion(18.3, 19.9).coincide).toBe(false)
  })

  it('si falta una duración no compara (coincide null, sin aviso)', () => {
    expect(verificarDuracion(null, 18.3).coincide).toBeNull()
    expect(verificarDuracion(37.2, null).coincide).toBeNull()
    expect(verificarDuracion(null, null).diferenciaSeg).toBeNull()
  })
})
