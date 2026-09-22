import { useEffect, useState } from 'react'
import type { ClaudeAnalysis, Creative, CreativeAIAnalysis } from '../types'
import type { CreativeAnalysisState } from '../hooks/useCreativeAnalysis'
import { fmtSec, videoKeyFromUrl } from '../lib/analysis'
import { barScale, checklistKey, loadChecklist, saveChecklist } from '../lib/analysisVisuals'
import { computeDerivedMetrics, getBenchmark } from '../lib/scoring'
import { classifyHealth } from '../lib/health'

export const AI_PANEL_ID = 'analisis-ia'

const card = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--divider-soft)',
}

/** Mismas bandas que la categoría del scoring (ganador / potencial / regular / apagar). */
function scoreColor(score: number): string {
  if (score >= 80) return 'var(--cat-ganador)'
  if (score >= 65) return 'var(--cat-potencial)'
  if (score >= 45) return 'var(--cat-regular)'
  return 'var(--cat-apagar)'
}

type RiskLevel = ClaudeAnalysis['riesgoCumplimiento']['nivel']

const RISK_LEVELS: { nivel: RiskLevel; label: string; color: string; bg: string }[] = [
  { nivel: 'bajo', label: 'Bajo', color: 'var(--cat-ganador)', bg: 'rgba(34,197,94,0.15)' },
  { nivel: 'medio', label: 'Medio', color: 'var(--cat-regular)', bg: 'rgba(245,158,11,0.15)' },
  { nivel: 'alto', label: 'Alto', color: 'var(--cat-apagar)', bg: 'rgba(239,68,68,0.15)' },
]

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-wide m-0 mb-1.5" style={{ color: 'var(--text-secondary)' }}>
      {children}
    </p>
  )
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const total = Math.max(0, Math.floor((now - since) / 1000))
  return (
    <span className="tabular-nums">
      {Math.floor(total / 60)}:{String(total % 60).padStart(2, '0')}
    </span>
  )
}

/** Anillo SVG con el score en el centro y la etiqueta debajo. */
function ScoreRing({ label, value, sub }: { label: string; value: number | undefined; sub: string }) {
  const size = 92
  const stroke = 8
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const pct = value === undefined ? 0 : Math.max(0, Math.min(100, value)) / 100
  const color = value === undefined ? 'var(--text-muted)' : scoreColor(value)
  return (
    <div className="rounded-xl p-3.5 flex flex-col items-center text-center" style={card}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--divider-strong)" strokeWidth={stroke} />
          {pct > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${pct * circumference} ${circumference}`}
            />
          )}
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-[26px] font-bold tabular-nums"
          style={{ color }}
        >
          <span aria-hidden="true">{value ?? '—'}</span>
          <span className="sr-only">{value === undefined ? 'sin dato' : `${value} de 100`}</span>
        </span>
      </div>
      <p className="text-[12px] font-medium m-0 mt-2" style={{ color: 'var(--text-primary)' }}>{label}</p>
      <p className="text-[10px] m-0" style={{ color: 'var(--text-muted)' }}>{sub}</p>
    </div>
  )
}

function DurationCard({ title, seconds }: { title: string; seconds: number | null | undefined }) {
  return (
    <div className="rounded-lg p-3 text-center min-w-0 h-full flex flex-col justify-center" style={{ background: 'var(--bg-base)', border: '1px solid var(--divider-soft)' }}>
      <p className="text-[11px] m-0 mb-1" style={{ color: 'var(--text-secondary)' }}>{title}</p>
      <p className="text-[16px] sm:text-[20px] font-bold m-0 tabular-nums" style={{ color: seconds == null ? 'var(--text-muted)' : 'var(--text-primary)' }}>
        {seconds == null ? 'sin dato' : fmtSec(seconds)}
      </p>
    </div>
  )
}

const DURATION_CHECK = {
  // coincide === null o sin verificación: no se pudo comparar, no se afirma nada.
  unknown: { glyph: '?', label: 'No se pudo comparar la duración', bg: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)' },
  mismatch: { glyph: '✗', label: 'La duración no coincide', bg: 'rgba(239,68,68,0.2)', color: 'var(--cat-apagar)' },
  match: { glyph: '✓', label: 'La duración coincide', bg: 'rgba(34,197,94,0.15)', color: 'var(--cat-ganador)' },
} as const

/** Aviso de "posible video equivocado": duración subida vs. Meta y tema de cada uno. */
function VideoMismatch({ a, fallbackDurationSec }: { a: CreativeAIAnalysis; fallbackDurationSec: number | null | undefined }) {
  const v = a.verificacionVideo
  const coh = a.claudeAnalysis?.coherenciaVideoCopy // ausente en análisis viejos
  const check = v?.coincide === false ? DURATION_CHECK.mismatch : v?.coincide === true ? DURATION_CHECK.match : DURATION_CHECK.unknown
  const topicMismatch = coh?.coinciden === false
  const diff =
    v?.coincide === false && v.duracionSubidaSeg !== null && v.duracionMetaSeg !== null
      ? v.diferenciaSeg ?? Math.abs(v.duracionSubidaSeg - v.duracionMetaSeg)
      : null
  return (
    <div
      role="alert"
      className="rounded-xl p-4 mb-4"
      style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.5)' }}
    >
      <p className="text-[14px] font-semibold m-0 mb-3 flex items-center gap-2" style={{ color: 'var(--cat-apagar)' }}>
        <i className="ti ti-alert-triangle text-[18px]" />
        Posible video equivocado
      </p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 mb-1.5">
        <DurationCard title="Video subido" seconds={v?.duracionSubidaSeg ?? fallbackDurationSec} />
        <span
          role="img"
          aria-label={check.label}
          className="self-center w-7 h-7 rounded-full flex items-center justify-center text-[14px] font-bold"
          style={{ background: check.bg, color: check.color }}
        >
          {check.glyph}
        </span>
        <DurationCard title="Anuncio en Meta" seconds={v?.duracionMetaSeg} />
      </div>
      <p className="text-[11px] text-center m-0 mb-3 tabular-nums" style={{ color: check.color }}>
        {diff !== null ? `Diferencia de ${fmtSec(diff)} (tolerancia ±1,5 s)` : check.label}
      </p>
      {coh && (
        <div className="text-[12px] leading-relaxed mb-2 break-words" style={{ color: 'var(--text-primary)' }}>
          <p className="m-0">
            <span style={{ color: 'var(--text-secondary)' }}>Tema del video:</span> {coh.temaVideo}
          </p>
          <p className="m-0">
            <span style={{ color: 'var(--text-secondary)' }}>Tema del copy:</span> {coh.temaCopy}
          </p>
          <p className="m-0 mt-1" style={{ color: topicMismatch ? 'var(--cat-apagar)' : 'var(--text-secondary)' }}>
            {topicMismatch ? `✗ No coinciden: ${coh.motivo}` : '✓ Los temas coinciden'}
          </p>
        </div>
      )}
      {/* alertaVideo sin motivo reconocible: igual se avisa. */}
      {v?.coincide !== false && !topicMismatch && (
        <p className="text-[12px] m-0 mb-2" style={{ color: 'var(--text-primary)' }}>
          El video subido no coincide con el anuncio de Meta.
        </p>
      )}
      <p className="text-[12px] m-0" style={{ color: 'var(--text-secondary)' }}>
        Las métricas de este anuncio no corresponden a este video. Sube el video correcto y vuelve a analizar.
      </p>
    </div>
  )
}

const HEALTH_BAR_COLOR = {
  good: 'var(--cat-ganador)',
  neutral: 'var(--cat-regular)',
  bad: 'var(--cat-apagar)',
} as const

function TargetBar({ label, value, target, decimals }: { label: string; value: number | null; target: number; decimals: number }) {
  const { fillPct, targetPct } = barScale(value ?? 0, target)
  const color = value === null ? 'var(--text-muted)' : HEALTH_BAR_COLOR[classifyHealth(value, target, true)]
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-baseline justify-between text-[12px] mb-1">
        <span style={{ color: 'var(--text-primary)' }}>{label}</span>
        <span className="tabular-nums">
          <b style={{ color }}>{value === null ? 'sin dato' : `${value.toFixed(decimals)}%`}</b>
          <span style={{ color: 'var(--text-muted)' }}> · objetivo {target.toFixed(decimals)}%</span>
        </span>
      </div>
      <div className="relative h-2.5 rounded-full" style={{ background: 'var(--divider-strong)' }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fillPct}%`, background: color }} />
        <div
          className="absolute -top-1 -bottom-1 w-0.5 rounded"
          style={{ left: `calc(${targetPct}% - 1px)`, background: 'var(--text-primary)' }}
          title={`Objetivo del nicho: ${target.toFixed(decimals)}%`}
        />
      </div>
    </div>
  )
}

/** Hook rate, hold rate y CTR del creativo contra el objetivo de su nicho, cada uno en su escala. */
function MetricsVsTarget({ creative }: { creative: Creative }) {
  const b = getBenchmark(creative.niche)
  const d = computeDerivedMetrics(creative)
  // Sin impresiones, las tasas salen 0 por división protegida: es "sin dato", no 0 %.
  const has = creative.metrics.impressions > 0
  return (
    <div className="rounded-xl p-3.5 mb-4" style={card}>
      <SectionLabel>Métricas contra objetivo · {creative.niche}</SectionLabel>
      <TargetBar label="Hook rate" value={has ? d.hookRate : null} target={b.hookRateTarget} decimals={0} />
      <TargetBar label="Hold rate" value={has ? d.holdRate : null} target={b.holdRateTarget} decimals={0} />
      <TargetBar label="CTR" value={has ? d.ctr : null} target={b.ctrTarget} decimals={1} />
    </div>
  )
}

function RecommendationsChecklist({ creativeId, timestamp, items }: { creativeId: string; timestamp: string; items: string[] }) {
  const [checked, setChecked] = useState<number[]>(() => loadChecklist(checklistKey(creativeId, timestamp)))
  const toggle = (i: number) => {
    const next = checked.includes(i) ? checked.filter((n) => n !== i) : [...checked, i].sort((x, y) => x - y)
    setChecked(next)
    saveChecklist(creativeId, timestamp, next)
  }
  return (
    <ul className="m-0 p-0 list-none text-[12px] leading-relaxed">
      {items.map((r, i) => {
        const done = checked.includes(i)
        return (
          <li key={i} className="mb-1.5">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-[3px] shrink-0 cursor-pointer"
                style={{ accentColor: 'var(--cat-ganador)' }}
                checked={done}
                onChange={() => toggle(i)}
              />
              <span style={{ color: done ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: done ? 'line-through' : 'none' }}>
                {r}
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

function Result({ a, creative }: { a: CreativeAIAnalysis; creative: Creative }) {
  const c = a.claudeAnalysis
  if (!c) return null
  // Nivel desconocido: ninguno resaltado (no se presenta como riesgo bajo).
  const current = RISK_LEVELS.find((l) => l.nivel === c.riesgoCumplimiento.nivel)
  const riskAccent = current && current.nivel !== 'bajo' ? current.color : null
  const v = a.verificacionVideo
  const g = a.geminiPerception

  return (
    <div>
      {a.alertaVideo && <VideoMismatch a={a} fallbackDurationSec={creative.videoDurationSec} />}

      <div className="grid grid-cols-2 gap-2.5 mb-4">
        <ScoreRing label="Score visual" value={c.scoreVisual} sub="calidad del creativo" />
        <ScoreRing label="Score combinado" value={a.scoreCombinado} sub={`reglas ${a.rulesComposite ?? '—'} + visual`} />
      </div>

      <MetricsVsTarget creative={creative} />

      <div className="rounded-xl p-3.5 mb-4" style={card}>
        <SectionLabel>Hook</SectionLabel>
        <p className="text-[12px] leading-relaxed m-0 mb-3" style={{ color: 'var(--text-primary)' }}>{c.analisisHook}</p>
        <SectionLabel>Copy</SectionLabel>
        <p className="text-[12px] leading-relaxed m-0" style={{ color: 'var(--text-primary)' }}>{c.analisisCopy}</p>
      </div>

      <div className="rounded-xl p-3.5 mb-4" style={{ background: 'var(--bg-surface)', border: `1px solid ${riskAccent ?? 'var(--divider-soft)'}` }}>
        <SectionLabel>Riesgo de cumplimiento</SectionLabel>
        <div className="grid grid-cols-3 gap-2 mb-2.5" role="img" aria-label={`Riesgo ${current?.label.toLowerCase() ?? 'sin dato'}`}>
          {RISK_LEVELS.map((l) => {
            const active = l.nivel === current?.nivel
            return (
              <div
                key={l.nivel}
                className="rounded-md py-1.5 text-center text-[12px] font-semibold flex items-center justify-center gap-1.5"
                style={
                  active
                    ? { background: l.bg, border: `1px solid ${l.color}`, color: l.color }
                    : { background: 'transparent', border: '1px solid var(--divider-soft)', color: 'var(--text-muted)', opacity: 0.55 }
                }
              >
                <span className="w-2 h-2 rounded-full" style={{ background: active ? l.color : 'var(--text-muted)' }} />
                {l.label}
              </div>
            )
          })}
        </div>
        <p className="text-[12px] leading-relaxed m-0 mb-2" style={{ color: 'var(--text-primary)' }}>{c.riesgoCumplimiento.motivo}</p>
        {c.riesgoCumplimiento.frasesDeRiesgo.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {c.riesgoCumplimiento.frasesDeRiesgo.map((f, i) => (
              <span
                key={i}
                className="rounded-full px-2.5 py-0.5 text-[11px]"
                style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${riskAccent ?? 'var(--divider-strong)'}`, color: 'var(--text-primary)' }}
              >
                “{f}”
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
        <div className="rounded-xl p-3.5" style={card}>
          <SectionLabel>Por qué</SectionLabel>
          <ul className="m-0 pl-5 text-[12px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            {c.razones.map((r, i) => (
              <li key={i} className="mb-1.5">{r}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl p-3.5" style={card}>
          <SectionLabel>Qué hacer</SectionLabel>
          {/* key: al volver a analizar cambia el timestamp y el checklist se reinicia. */}
          <RecommendationsChecklist
            key={`${a.creativeId}:${a.timestamp}`}
            creativeId={a.creativeId}
            timestamp={a.timestamp}
            items={c.recomendaciones}
          />
        </div>
      </div>

      <details className="rounded-xl p-3.5 mb-3" style={card}>
        <summary className="text-[12px] cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
          Detalles técnicos
        </summary>
        <div className="mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          <SectionLabel>Verificación de duración</SectionLabel>
          <p className="m-0 mb-3">
            {v && v.coincide !== null && v.duracionSubidaSeg !== null && v.duracionMetaSeg !== null
              ? `Video subido ${fmtSec(v.duracionSubidaSeg)} · anuncio en Meta ${fmtSec(v.duracionMetaSeg)} · ${v.coincide ? '✓ coincide' : '✗ no coincide'} (tolerancia ±1,5 s)`
              : `No se pudo comparar (subido: ${v?.duracionSubidaSeg != null ? fmtSec(v.duracionSubidaSeg) : 'sin dato'}, Meta: ${v?.duracionMetaSeg != null ? fmtSec(v.duracionMetaSeg) : 'sin dato'}).`}
          </p>

          <SectionLabel>Coherencia video / copy</SectionLabel>
          {/* Los análisis anteriores a esta verificación no traen el campo. */}
          {c.coherenciaVideoCopy ? (
            <p className="m-0 mb-3">
              {c.coherenciaVideoCopy.coinciden ? '✓ Coinciden' : '✗ No coinciden'} · Video: {c.coherenciaVideoCopy.temaVideo} · Copy: {c.coherenciaVideoCopy.temaCopy}
              <br />
              <span style={{ color: 'var(--text-secondary)' }}>{c.coherenciaVideoCopy.motivo}</span>
            </p>
          ) : (
            <p className="m-0 mb-3" style={{ color: 'var(--text-secondary)' }}>Sin dato (análisis anterior a esta verificación).</p>
          )}

          {g && (
            <>
              <SectionLabel>Percepción del video (Gemini)</SectionLabel>
              <p className="m-0 mb-1"><b>Formato:</b> {g.formatoDetectado} · <b>Ritmo:</b> {g.notasDeRitmo}</p>
              <p className="m-0 mb-1"><b>Primera frase:</b> “{g.hookLiteral.primeraFraseDicha}”</p>
              <p className="m-0 mb-1"><b>Primer texto en pantalla:</b> “{g.hookLiteral.primerTextoEnPantalla}”</p>
              <p className="m-0 mb-1"><b>Escenas:</b> {g.escenas}</p>
              {g.copyEnPantalla.length > 0 && (
                <ul className="m-0 mb-1 pl-5" style={{ color: 'var(--text-secondary)' }}>
                  {g.copyEnPantalla.map((t, i) => (
                    <li key={i}>
                      <span className="tabular-nums">{t.segundoAproximado}s</span> · {t.texto}
                    </li>
                  ))}
                </ul>
              )}
              <p className="m-0" style={{ color: 'var(--text-secondary)' }}><b>Copy hablado:</b> {g.copyHablado}</p>
            </>
          )}
        </div>
      </details>
    </div>
  )
}

export function AIAnalysisPanel({ creative, state }: { creative: Creative; state: CreativeAnalysisState }) {
  const { phase, analysis, errorMessage, processingSince, analyze, keepWaiting } = state
  const hasVideoKey = !!videoKeyFromUrl(creative.videoUrl)
  const busy = phase === 'processing' || phase === 'loading'
  // Sin sync, hook/hold ya son correctos; solo faltan retención y tiempo visto.
  const needsSyncHint = !!creative.metaAdId && creative.metrics.retention25 === null

  const primaryBtn =
    'flex items-center gap-1.5 text-[12px] border-none rounded-md px-3 py-1.5 cursor-pointer transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <section id={AI_PANEL_ID} tabIndex={-1} className="mt-5 scroll-mt-4 outline-none">
      <p className="text-[12px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
        Análisis con IA
      </p>

      {needsSyncHint && phase !== 'loading' && (
        <p className="text-[11px] m-0 mb-2 flex items-center gap-1.5" style={{ color: 'var(--cat-regular)' }}>
          <i className="ti ti-info-circle text-[13px]" />
          Sincroniza para incluir retención en el análisis.
        </p>
      )}

      {phase === 'loading' && (
        <div className="rounded-xl p-4 text-[12px]" style={{ ...card, color: 'var(--text-secondary)' }}>
          <i className="ti ti-loader-2 animate-spin mr-1.5" />
          Buscando análisis guardado…
        </div>
      )}

      {phase === 'idle' && (
        <div className="rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap" style={card}>
          <p className="text-[12px] m-0" style={{ color: 'var(--text-secondary)' }}>
            {hasVideoKey
              ? 'Analiza el video, el copy del anuncio y las métricas con Gemini y Claude.'
              : 'Sube el video del anuncio a la app para poder analizarlo.'}
          </p>
          <button
            className={primaryBtn}
            style={{ background: 'var(--accent)', color: 'var(--accent-dark)' }}
            onClick={() => analyze(false)}
            disabled={!hasVideoKey}
          >
            <i className="ti ti-sparkles" />
            Analizar con IA
          </button>
        </div>
      )}

      {(phase === 'processing' || phase === 'stalled') && (
        <div className="rounded-xl p-4" style={card} aria-live="polite">
          <p className="text-[13px] m-0 mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            {phase === 'processing' ? (
              <i className="ti ti-loader-2 animate-spin" />
            ) : (
              <i className="ti ti-clock-exclamation" style={{ color: 'var(--cat-regular)' }} />
            )}
            {phase === 'processing' ? 'Analizando el creativo…' : 'Está tardando más de lo normal'}
            {processingSince && (
              <span className="text-[11px] ml-auto" style={{ color: 'var(--text-muted)' }}>
                <Elapsed since={processingSince} />
              </span>
            )}
          </p>
          <p className="text-[12px] m-0" style={{ color: 'var(--text-secondary)' }}>
            Puede tardar hasta un par de minutos. Puedes salir del detalle y volver: el análisis sigue en el servidor.
          </p>
          {phase === 'stalled' && (
            <div className="flex gap-2 mt-3">
              <button className={primaryBtn} style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }} onClick={keepWaiting}>
                Seguir esperando
              </button>
              <button className={primaryBtn} style={{ background: 'var(--accent)', color: 'var(--accent-dark)' }} onClick={() => analyze(true)}>
                <i className="ti ti-refresh" />
                Volver a analizar
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div className="rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)' }} role="alert">
          <p className="text-[13px] m-0 mb-1 flex items-center gap-2" style={{ color: 'var(--cat-apagar)' }}>
            <i className="ti ti-circle-x" />
            No se pudo completar el análisis
          </p>
          <p className="text-[12px] m-0 mb-3 break-words" style={{ color: 'var(--text-primary)' }}>{errorMessage}</p>
          <button
            className={primaryBtn}
            style={{ background: 'var(--accent)', color: 'var(--accent-dark)' }}
            // El servidor solo sobrescribe un análisis existente con forceReanalyze.
            onClick={() => analyze(analysis !== null)}
            disabled={!hasVideoKey}
          >
            <i className="ti ti-refresh" />
            Reintentar
          </button>
        </div>
      )}

      {phase === 'done' && analysis && (
        <>
          <Result a={analysis} creative={creative} />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Analizado el{' '}
              {new Date(analysis.timestamp).toLocaleString('es', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <button
              className={primaryBtn}
              style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--divider-strong)' }}
              onClick={() => analyze(true)}
              disabled={busy || !hasVideoKey}
            >
              <i className="ti ti-refresh" />
              Volver a analizar
            </button>
          </div>
        </>
      )}
    </section>
  )
}
