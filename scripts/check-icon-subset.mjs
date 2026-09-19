/**
 * Falla el build si src/ usa un icono `ti-*` que no esta en el subset
 * generado. Sin esto, olvidarse de `npm run icons:build` tras añadir un icono
 * daria un hueco invisible en la interfaz en vez de un error.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { iconTable, usedIcons, OUT_CSS } from './icon-subset-common.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let css
try {
  css = await fs.readFile(path.join(root, OUT_CSS), 'utf8')
} catch {
  console.error(`\nFalta ${OUT_CSS}. Generalo con:  npm run icons:build\n`)
  process.exit(1)
}

const presentes = new Set([...css.matchAll(/\.ti-([a-z0-9-]+):before/g)].map((m) => m[1]))
const usados = await usedIcons(await iconTable())
const faltan = usados.filter((n) => !presentes.has(n))

if (faltan.length) {
  console.error(
    `\nEl subset de iconos esta desactualizado. Faltan ${faltan.length}: ${faltan.join(', ')}\n` +
    `Regeneralo con:  npm run icons:build\n`
  )
  process.exit(1)
}

const sobran = [...presentes].filter((n) => !usados.includes(n))
console.log(
  `iconos: ${usados.length} usados, todos en el subset` +
  (sobran.length ? ` (${sobran.length} de mas: ${sobran.join(', ')})` : '')
)
