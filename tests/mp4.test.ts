import { describe, it, expect } from 'vitest'
import { readMp4DurationSec } from '../netlify/functions/_mp4'

function atom(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length)
  new DataView(out.buffer).setUint32(0, out.length)
  out.set([...type].map((c) => c.charCodeAt(0)), 4)
  out.set(body, 8)
  return out
}

function mvhdV0(timescale: number, duration: number): Uint8Array {
  const body = new Uint8Array(100)
  const v = new DataView(body.buffer)
  body[0] = 0 // version
  v.setUint32(12, timescale) // version(1)+flags(3)+creation(4)+modification(4)
  v.setUint32(16, duration)
  return atom('mvhd', body)
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

describe('readMp4DurationSec', () => {
  it('lee la duración con el moov al final (archivo de cámara)', () => {
    // mdat contiene la cadena "mvhd" para verificar que no se confunde.
    const mdat = atom('mdat', new TextEncoder().encode('xxmvhdxxxxxxxxxxxxxxxxxxxx'))
    const file = concat(atom('ftyp', new Uint8Array(12)), mdat, atom('moov', mvhdV0(600, 22320)))
    expect(readMp4DurationSec(file)).toBeCloseTo(37.2, 5)
  })

  it('lee la duración con el moov al inicio (faststart)', () => {
    const file = concat(atom('ftyp', new Uint8Array(12)), atom('moov', mvhdV0(1000, 18300)), atom('mdat', new Uint8Array(40)))
    expect(readMp4DurationSec(file)).toBeCloseTo(18.3, 5)
  })

  it('salta átomos de 64 bits (largesize) antes del mvhd dentro del moov', () => {
    // Átomo "free" con size=1 y largesize de 16 bytes, antes del mvhd.
    const large = new Uint8Array(16)
    const v = new DataView(large.buffer)
    v.setUint32(0, 1)
    large.set([...'free'].map((c) => c.charCodeAt(0)), 4)
    v.setBigUint64(8, 16n)
    const file = concat(atom('ftyp', new Uint8Array(12)), atom('moov', concat(large, mvhdV0(600, 22320))))
    expect(readMp4DurationSec(file)).toBeCloseTo(37.2, 5)
  })

  it('devuelve null con un mvhd truncado', () => {
    const file = concat(atom('ftyp', new Uint8Array(12)), atom('moov', atom('mvhd', new Uint8Array(6))))
    expect(readMp4DurationSec(file)).toBeNull()
  })

  it('devuelve null si no hay moov o el archivo no es MP4', () => {
    expect(readMp4DurationSec(atom('mdat', new Uint8Array(20)))).toBeNull()
    expect(readMp4DurationSec(new TextEncoder().encode('no soy un video'))).toBeNull()
    expect(readMp4DurationSec(new Uint8Array(0))).toBeNull()
  })
})
