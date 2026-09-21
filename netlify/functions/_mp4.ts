/**
 * Lee la duración (en segundos) de un contenedor ISO-BMFF (MP4 / MOV)
 * desde el átomo moov > mvhd.
 *
 * Recorre la estructura de átomos: buscar la cadena "mvhd" en todo el buffer
 * da falsos positivos dentro de los datos de video (mdat), y en archivos de
 * cámara el moov suele ir al final.
 *
 * Devuelve null si no puede leerla. Nunca lanza: la duración es informativa y
 * no debe bloquear una subida ni un análisis.
 */
export function readMp4DurationSec(buf: Uint8Array): number | null {
  try {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

    const moov = findBox(buf, view, 'moov', 0, buf.length)
    if (!moov) return null
    const mvhd = findBox(buf, view, 'mvhd', moov.bodyStart, moov.end)
    if (!mvhd) return null

    const version = buf[mvhd.bodyStart]
    // v0: version+flags(4) creation(4) modification(4) timescale(4) duration(4)
    // v1: version+flags(4) creation(8) modification(8) timescale(4) duration(8)
    const needed = version === 1 ? 32 : 20
    if (mvhd.bodyStart + needed > mvhd.end) return null
    const timescale = view.getUint32(mvhd.bodyStart + (version === 1 ? 20 : 12))
    const duration =
      version === 1
        ? Number(view.getBigUint64(mvhd.bodyStart + 24))
        : view.getUint32(mvhd.bodyStart + 16)
    if (!timescale || !Number.isFinite(duration)) return null
    return duration / timescale
  } catch {
    return null
  }
}

interface Box {
  bodyStart: number
  end: number
}

/**
 * Busca un átomo por tipo entre start y end (sin entrar en hijos). Maneja
 * tamaño 1 (64 bits, "largesize") y tamaño 0 ("hasta el final del padre").
 */
function findBox(buf: Uint8Array, view: DataView, wanted: string, start: number, end: number): Box | null {
  let offset = start
  while (offset + 8 <= end) {
    let size = view.getUint32(offset)
    let header = 8
    if (size === 1) {
      if (offset + 16 > end) return null
      size = Number(view.getBigUint64(offset + 8))
      header = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < header || offset + size > end) return null

    const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7])
    if (type === wanted) return { bodyStart: offset + header, end: offset + size }
    offset += size
  }
  return null
}

/** Tolerancia para comparar la duración subida con la del video en Meta. */
export const DURATION_TOLERANCE_SEC = 1.5
