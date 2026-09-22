/**
 * Helpers puros de las piezas visuales del panel de análisis de IA (barras
 * contra objetivo y checklist de recomendaciones).
 */

export interface BarScale {
  /** Ancho de la barra rellena, 0-100 (% del ancho total). */
  fillPct: number
  /** Posición de la marca del objetivo, 0-100. */
  targetPct: number
}

/**
 * Escala propia de cada barra: el tope es el doble del objetivo, así la marca
 * queda al medio y se ve de un vistazo si se está por encima o por debajo. Si
 * el valor supera ese tope, la escala crece para que la barra no se salga.
 */
export function barScale(value: number, target: number): BarScale {
  const safeValue = Math.max(0, value)
  if (target <= 0) return { fillPct: safeValue > 0 ? 100 : 0, targetPct: 0 }
  const max = Math.max(target * 2, safeValue * 1.1)
  return {
    fillPct: (safeValue / max) * 100,
    targetPct: (target / max) * 100,
  }
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
