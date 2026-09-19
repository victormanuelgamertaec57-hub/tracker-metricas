/** Utilidades compartidas por los scripts de subset de iconos. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const PKG = 'node_modules/@tabler/icons-webfont'
export const OUT_DIR = 'src/generated'
export const OUT_FONT = 'tabler-icons-subset.woff2'
export const OUT_CSS = `${OUT_DIR}/tabler-icons-subset.css`

/** Mapa nombre de icono -> codepoint, leido del CSS completo del paquete. */
export async function iconTable() {
  const css = await fs.readFile(path.join(root, PKG, 'tabler-icons.min.css'), 'utf8')
  const table = new Map()
  for (const m of css.matchAll(/\.ti-([a-z0-9-]+):before\{content:"\\([0-9a-fA-F]+)"\}/g)) {
    table.set(m[1], parseInt(m[2], 16))
  }
  if (table.size === 0) throw new Error('No se pudo leer el CSS de @tabler/icons-webfont')
  return table
}

async function walk(dir) {
  const out = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name === 'generated') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else if (/\.(ts|tsx|js|jsx|html|css)$/.test(e.name)) out.push(p)
  }
  return out
}

/** Nombres de icono realmente referenciados en src/, ordenados. */
export async function usedIcons(table) {
  const used = new Set()
  const desconocidos = new Set()
  for (const file of await walk(path.join(root, 'src'))) {
    const text = await fs.readFile(file, 'utf8')
    for (const m of text.matchAll(/\bti-([a-z0-9-]+)\b/g)) {
      if (table.has(m[1])) used.add(m[1])
      else desconocidos.add(m[1])
    }
  }
  if (used.size === 0) throw new Error('No se encontro ninguna clase ti-* en src/')
  if (desconocidos.size) {
    console.warn(`aviso: clases ti-* que no existen en la fuente: ${[...desconocidos].sort().join(', ')}`)
  }
  return [...used].sort()
}
