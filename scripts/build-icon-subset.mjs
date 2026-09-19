/**
 * Regenera el subset de la fuente Tabler Icons con solo los glifos que usa la
 * app, y el CSS minimo para servirlos.
 *
 * La fuente completa son 4908 glifos (753 KB woff2) y la app usa unos 17.
 * La salida (src/generated/) esta versionada, asi que este script NO corre en
 * cada build: ejecutalo a mano cuando cambien los iconos.
 *
 *   npm run icons:build
 *
 * scripts/check-icon-subset.mjs corre en cada build y falla si algun icono
 * usado no esta en el subset, de modo que olvidarse de regenerar da un error
 * claro en vez de un icono invisible.
 *
 * Requiere pyftsubset (fonttools). Se probo subset-font (harfbuzz/WASM) para
 * evitar la dependencia de python, pero harfbuzz rechaza esta fuente en
 * concreto ("hb_subset_or_fail returned zero") aunque funciona con otras.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { iconTable, usedIcons, OUT_DIR, OUT_FONT, OUT_CSS, PKG } from './icon-subset-common.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pyftsubset = process.env.PYFTSUBSET ?? 'pyftsubset'

const table = await iconTable()
const names = await usedIcons(table)

const unicodes = names.map((n) => `U+${table.get(n).toString(16).toUpperCase().padStart(4, '0')}`).join(',')
const fullFont = path.join(root, PKG, 'fonts/tabler-icons.woff2')
await fs.mkdir(path.join(root, OUT_DIR), { recursive: true })
const fontOut = path.join(root, OUT_DIR, OUT_FONT)

try {
  execFileSync(pyftsubset, [
    fullFont, `--unicodes=${unicodes}`, '--flavor=woff2',
    `--output-file=${fontOut}`, '--layout-features=', '--no-hinting', '--desubroutinize',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
} catch (err) {
  console.error(
    `\nNo se pudo ejecutar pyftsubset.\n` +
    `Instalalo con:  python3 -m pip install fonttools brotli\n` +
    `o apunta a uno existente:  PYFTSUBSET=/ruta/a/pyftsubset npm run icons:build\n`
  )
  throw err
}

const css = await fs.readFile(path.join(root, PKG, 'tabler-icons.min.css'), 'utf8')
const baseRule = css.match(/\.ti\{[^}]*\}/)?.[0]
if (!baseRule) throw new Error('No se pudo extraer la regla base .ti del CSS original')

const rules = names.map((n) => `.ti-${n}:before{content:"\\${table.get(n).toString(16)}"}`).join('\n')
await fs.writeFile(path.join(root, OUT_CSS), `/* GENERADO por scripts/build-icon-subset.mjs. No editar a mano.
   Regenerar con: npm run icons:build
   ${names.length} de ${table.size} iconos de Tabler Icons. */
@font-face{font-family:"tabler-icons";font-style:normal;font-weight:400;src:url("./${OUT_FONT}") format("woff2")}
${baseRule}
${rules}
`)

const before = (await fs.stat(fullFont)).size
const after = (await fs.stat(fontOut)).size
console.log(
  `iconos: ${names.length}/${table.size} glifos | ` +
  `${(before / 1024).toFixed(1)} KB -> ${(after / 1024).toFixed(1)} KB ` +
  `(-${((1 - after / before) * 100).toFixed(1)}%)`
)
