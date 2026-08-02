import { useState, useEffect } from 'react'
import type { NicheBenchmark } from '../types'
import {
  DEFAULT_BENCHMARKS,
  BENCHMARK_STORAGE_KEY,
  invalidateBenchmarkCache,
} from '../lib/scoring'

function loadBenchmarks(): Record<string, NicheBenchmark> {
  try {
    const raw = localStorage.getItem(BENCHMARK_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return { ...DEFAULT_BENCHMARKS }
}

function saveBenchmarks(benchmarks: Record<string, NicheBenchmark>) {
  localStorage.setItem(BENCHMARK_STORAGE_KEY, JSON.stringify(benchmarks))
}

const ALL_NICHES = Object.keys(DEFAULT_BENCHMARKS)

export function NicheSettings({ onClose }: { onClose: () => void }) {
  const [benchmarks, setBenchmarks] = useState<Record<string, NicheBenchmark>>(loadBenchmarks)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    saveBenchmarks(benchmarks)
    // Tras guardar en localStorage, invalidamos el cache de scoring.ts
    // para que el próximo scoreCreative() lea los valores nuevos.
    invalidateBenchmarkCache()
    setSaved(true)
    const t = setTimeout(() => setSaved(false), 1500)
    return () => clearTimeout(t)
  }, [benchmarks])

  function updateField(niche: string, field: keyof NicheBenchmark, value: number) {
    setBenchmarks((prev) => ({
      ...prev,
      [niche]: { ...prev[niche], [field]: value },
    }))
  }

  function updateWeight(niche: string, sub: 'engagement' | 'result' | 'efficiency', value: number) {
    const b = benchmarks[niche]
    const others = (Object.keys(b.weights) as Array<keyof typeof b.weights>).filter((k) => k !== sub)
    const otherSum = others.reduce((acc, k) => acc + b.weights[k], 0)
    const remaining = 1 - value

    let newWeights = { ...b.weights, [sub]: value }

    if (otherSum <= 0) {
      // Si los otros dos son 0, no podemos escalar proporcionalmente — distribuimos en partes iguales.
      const equalShare = remaining / others.length
      others.forEach((k) => {
        newWeights[k] = equalShare
      })
    } else {
      // Escalamos los otros dos proporcionalmente para que sumen (1 - value).
      const scale = remaining / otherSum
      others.forEach((k) => {
        newWeights[k] = b.weights[k] * scale
      })
    }

    // Snap final: corrige errores de punto flotante para que la suma sea exactamente 1.0.
    const actualSum = newWeights.engagement + newWeights.result + newWeights.efficiency
    const drift = 1 - actualSum
    // Aplicamos el drift al peso editado (es el que el usuario acaba de mover).
    newWeights = { ...newWeights, [sub]: newWeights[sub] + drift }

    setBenchmarks((prev) => ({
      ...prev,
      [niche]: { ...prev[niche], weights: newWeights },
    }))
  }

  return (
    <div className="min-h-screen py-8 px-4" style={{ background: 'var(--bg-base)' }}>
      <div className="max-w-2xl mx-auto">
        <div 
          className="flex items-center justify-between mb-6 pb-3"
          style={{ borderBottom: '1px solid var(--divider-strong)' }}
        >
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-[12px] bg-transparent border-none cursor-pointer hover:opacity-70 transition-opacity"
            style={{ color: 'var(--text-secondary)' }}
          >
            <i className="ti ti-arrow-left text-[14px]" />
            Volver al dashboard
          </button>
          <span
            className="text-[12px] px-3 py-1 rounded"
            style={{
              background: saved ? 'rgba(95,163,107,0.2)' : 'transparent',
              color: saved ? 'var(--cat-ganador)' : 'var(--text-secondary)',
            }}
          >
            {saved ? '✓ Guardado' : 'Guardando en localStorage'}
          </span>
        </div>

        <div className="flex items-center gap-2 mb-6">
          <div 
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--accent)', boxShadow: '0 0 10px var(--accent-glow)' }}
          >
            <i className="ti ti-settings text-[16px]" style={{ color: 'var(--bg-base)' }} />
          </div>
          <h1 className="text-[20px] font-medium m-0" style={{ color: 'var(--text-primary)' }}>Ajustes por nicho</h1>
        </div>

        <div 
          className="rounded-xl p-4 mb-5 text-[12px] flex items-start gap-2"
          style={{ 
            background: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--divider-soft)'
          }}
        >
          <i className="ti ti-info-circle text-[14px] mt-0.5 shrink-0" />
          <span>
            Estos benchmarks reemplazan los valores hardcodeados. Se guardan en localStorage y se
            usan en el algoritmo de scoring para cada nicho. Si no personalizas un nicho, se usan
            los valores por defecto.
          </span>
        </div>

        <div className="flex flex-col gap-5">
          {ALL_NICHES.map((niche) => {
            const b = benchmarks[niche]
            return (
              <div 
                key={niche} 
                className="rounded-xl p-5"
                style={{ 
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--divider-soft)'
                }}
              >
                <h2 className="text-[14px] font-medium m-0 mb-4" style={{ color: 'var(--text-primary)' }}>{niche}</h2>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
                  <NumberField
                    label="CTR objetivo (%)"
                    value={b.ctrTarget}
                    onChange={(v) => updateField(niche, 'ctrTarget', v)}
                    step={0.1}
                  />
                  <NumberField
                    label="Hook rate objetivo (%)"
                    value={b.hookRateTarget}
                    onChange={(v) => updateField(niche, 'hookRateTarget', v)}
                    step={1}
                  />
                  <NumberField
                    label="Hold rate objetivo (%)"
                    value={b.holdRateTarget}
                    onChange={(v) => updateField(niche, 'holdRateTarget', v)}
                    step={1}
                  />
                  <NumberField
                    label="ROAS objetivo"
                    value={b.roasTarget}
                    onChange={(v) => updateField(niche, 'roasTarget', v)}
                    step={0.1}
                  />
                  <NumberField
                    label="CPA objetivo ($)"
                    value={b.cpaTarget}
                    onChange={(v) => updateField(niche, 'cpaTarget', v)}
                    step={0.5}
                  />
                </div>

                <div>
                  <p className="text-[11px] m-0 mb-3" style={{ color: 'var(--text-secondary)' }}>Pesos de sub-scores (deben sumar ~1)</p>
                  <div className="grid grid-cols-3 sm:grid-cols-3 gap-4">
                    <WeightField
                      label="Engagement"
                      value={b.weights.engagement}
                      onChange={(v) => updateWeight(niche, 'engagement', v)}
                    />
                    <WeightField
                      label="Resultado"
                      value={b.weights.result}
                      onChange={(v) => updateWeight(niche, 'result', v)}
                    />
                    <WeightField
                      label="Eficiencia"
                      value={b.weights.efficiency}
                      onChange={(v) => updateWeight(niche, 'efficiency', v)}
                    />
                  </div>
                  <p className="text-[10px] mt-2 m-0" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
                    Suma: {(b.weights.engagement + b.weights.result + b.weights.efficiency).toFixed(2)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-6 flex gap-3 flex-wrap">
          <button
            onClick={() => {
              setBenchmarks({ ...DEFAULT_BENCHMARKS })
              invalidateBenchmarkCache()
            }}
            className="bg-transparent border text-[12px] rounded-lg px-4 py-2 cursor-pointer hover:opacity-70 transition-all"
            style={{ 
              borderColor: 'var(--divider-strong)',
              color: 'var(--text-secondary)'
            }}
          >
            Restablecer valores por defecto
          </button>
        </div>
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full"
      />
    </label>
  )
}

function WeightField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <input
        type="number"
        value={value}
        step={0.05}
        min={0}
        max={1}
        onChange={(e) => onChange(Math.max(0, Math.min(1, Number(e.target.value) || 0)))}
        className="w-full"
      />
    </label>
  )
}
