/**
 * Helpers puros de las piezas visuales del panel de análisis de IA y del chat
 * (barras contra objetivo, color del score y checklist de recomendaciones).
 */

export interface BarScale {
  /** Ancho de la barra rellena, 0-100 (% del ancho total). */
  fillPct: number
  /** Posición de la marca del objetivo, 0-100. */
  targetPct: number
}

/**
 * Escala de una barra. Sin `scaleMax`, cada barra usa su propia escala: el
 * tope es el doble del objetivo, así la marca queda al medio y se ve de un
 * vistazo si se está por encima o por debajo; si el valor supera ese tope, la
 * escala crece para que la barra no se salga. Con `scaleMax` (varias barras
 * comparadas entre sí) todas comparten el mismo tope; ver sharedScaleMax.
 */
export function barScale(value: number, target: number | null, scaleMax?: number): BarScale {
  const safeValue = Math.max(0, value)
  const safeTarget = target !== null && target > 0 ? target : null
  const max =
    scaleMax !== undefined && scaleMax > 0
      ? scaleMax
      : safeTarget !== null
        ? Math.max(safeTarget * 2, safeValue * 1.1)
        : 0
  if (max <= 0) return { fillPct: safeValue > 0 ? 100 : 0, targetPct: 0 }
  return {
    fillPct: Math.min(100, (safeValue / max) * 100),
    targetPct: safeTarget !== null ? Math.min(100, (safeTarget / max) * 100) : 0,
  }
}

/**
 * Tope común para comparar la misma métrica entre varios creativos: si cada
 * barra tuviera su escala, un 20 % y un 40 % se verían iguales. Misma regla
 * que barScale (doble del objetivo o valor + 10 %), tomada sobre todas.
 */
export function sharedScaleMax(points: { value: number | null; target: number | null }[]): number {
  let max = 0
  for (const p of points) {
    if (p.target !== null && p.target > 0) max = Math.max(max, p.target * 2)
    if (p.value !== null && p.value > 0) max = Math.max(max, p.value * 1.1)
  }
  return max > 0 ? max : 1
}

/** Mismas bandas que la categoría del scoring (ganador / potencial / regular / apagar). */
export function scoreColor(score: number): string {
  if (score >= 80) return 'var(--cat-ganador)'
  if (score >= 65) return 'var(--cat-potencial)'
  if (score >= 45) return 'var(--cat-regular)'
  return 'var(--cat-apagar)'
}

const CHECKLIST_PREFIX = 'tracker-metricas:ai-checklist:'

/**
 * Clave del checklist en localStorage. Incluye el timestamp del análisis, así
 * que al volver a analizar la clave cambia y el checklist arranca vacío.
 */
export function checklistKey(creativeId: string, analysisTimestamp: string): string {
  return `${checklistCreativePrefix(creativeId)}${analysisTimestamp}`
}

function checklistCreativePrefix(creativeId: string): string {
  return `${CHECKLIST_PREFIX}${creativeId}:`
}

/** localStorage, o undefined si no existe o el navegador bloquea el acceso (lanza SecurityError). */
function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** Índices de recomendaciones marcadas. Vacío si no hay nada o falla la lectura. */
export function loadChecklist(key: string, storage: Storage | undefined = browserStorage()): number[] {
  try {
    const raw = storage?.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((n): n is number => Number.isInteger(n) && n >= 0) : []
  } catch {
    return []
  }
}

/**
 * Guarda los índices marcados y borra los checklists de análisis anteriores
 * del mismo creativo, para no acumular claves muertas en localStorage.
 */
export function saveChecklist(
  creativeId: string,
  analysisTimestamp: string,
  checked: number[],
  storage: Storage | undefined = browserStorage()
): void {
  if (!storage) return
  const key = checklistKey(creativeId, analysisTimestamp)
  const creativePrefix = checklistCreativePrefix(creativeId)
  try {
    // Primero se juntan y luego se borran: borrar mientras se recorre por índice puede saltarse claves.
    const stale: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k && k !== key && k.startsWith(creativePrefix)) stale.push(k)
    }
    stale.forEach((k) => storage.removeItem(k))
    if (checked.length === 0) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(checked))
  } catch {
    // Sin localStorage (modo privado, cuota llena): el checklist solo vive en memoria.
  }
}
