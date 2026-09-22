import { describe, it, expect } from 'vitest'
import { barScale, checklistKey, loadChecklist, saveChecklist } from './analysisVisuals'

/** Storage en memoria con la misma interfaz que localStorage. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  }
}

describe('barScale', () => {
  it('pone el objetivo al medio mientras el valor no pase del doble', () => {
    expect(barScale(15, 30)).toEqual({ fillPct: 25, targetPct: 50 })
    expect(barScale(1.1, 2.2).targetPct).toBe(50)
  })

  it('agranda la escala si el valor supera el doble del objetivo', () => {
    const s = barScale(100, 20)
    expect(s.fillPct).toBeLessThan(100)
    expect(s.targetPct).toBeCloseTo((20 / 110) * 100)
  })

  it('cada barra usa su propia escala: CTR 2 % contra 2,2 % se ve igual que hook 27 % contra 30 %', () => {
    expect(barScale(2, 2.2).fillPct).toBeCloseTo(barScale(27.27, 30).fillPct, 0)
  })

  it('valores negativos o nulos no dibujan barra', () => {
    expect(barScale(-5, 20).fillPct).toBe(0)
    expect(barScale(0, 20).fillPct).toBe(0)
  })
})

describe('checklist de recomendaciones', () => {
  const TS1 = '2026-09-21T23:10:00.000Z'
  const TS2 = '2026-09-22T10:00:00.000Z'

  it('guarda y lee por creativo + timestamp del análisis', () => {
    const s = memoryStorage()
    saveChecklist('c1', TS1, [0, 2], s)
    expect(loadChecklist(checklistKey('c1', TS1), s)).toEqual([0, 2])
    expect(loadChecklist(checklistKey('c1', TS2), s)).toEqual([])
    expect(loadChecklist(checklistKey('c2', TS1), s)).toEqual([])
  })

  it('al guardar un análisis nuevo borra el checklist del anterior del mismo creativo, no el de otros', () => {
    const s = memoryStorage()
    saveChecklist('c1', TS1, [1], s)
    saveChecklist('c10', TS1, [0], s)
    saveChecklist('c1', TS2, [3], s)
    expect(s.getItem(checklistKey('c1', TS1))).toBeNull()
    expect(loadChecklist(checklistKey('c1', TS2), s)).toEqual([3])
    expect(loadChecklist(checklistKey('c10', TS1), s)).toEqual([0])
  })

  it('desmarcar todo borra la clave', () => {
    const s = memoryStorage()
    saveChecklist('c1', TS1, [0], s)
    saveChecklist('c1', TS1, [], s)
    expect(s.length).toBe(0)
  })

  it('tolera datos corruptos y storage que lanza', () => {
    const s = memoryStorage({ [checklistKey('c1', TS1)]: '{no es json' })
    expect(loadChecklist(checklistKey('c1', TS1), s)).toEqual([])
    const bad = memoryStorage({ [checklistKey('c1', TS1)]: '[1,"x",-1,2.5,3]' })
    expect(loadChecklist(checklistKey('c1', TS1), bad)).toEqual([1, 3])
    const throwing = { ...memoryStorage(), getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('cuota') } } as Storage
    expect(loadChecklist('k', throwing)).toEqual([])
    expect(() => saveChecklist('c1', TS1, [0], throwing)).not.toThrow()
    expect(loadChecklist('k', undefined)).toEqual([])
  })
})
