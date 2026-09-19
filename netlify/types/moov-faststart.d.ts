/**
 * moov-faststart no publica tipos, y sus .ts de origen no compilan bajo
 * nuestra configuracion (skipLibCheck solo cubre .d.ts). El tsconfig de
 * functions mapea el modulo a este archivo via `paths`.
 *
 * Solo usamos `faststart`: recibe el buffer de un MP4/MOV y devuelve otro con
 * el atomo moov al inicio. Lanza si el buffer no es un contenedor
 * QuickTime/ISO-BMFF valido.
 *
 * El genérico `Buffer<ArrayBuffer>` es necesario: `Buffer` a secas resuelve a
 * `Buffer<ArrayBufferLike>` y su `.buffer` incluye SharedArrayBuffer, que
 * Netlify Blobs no acepta.
 */
declare module 'moov-faststart' {
  export function faststart(buffer: Buffer<ArrayBuffer>): Buffer<ArrayBuffer>
}
