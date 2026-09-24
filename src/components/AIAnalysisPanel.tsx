import { useEffect, useId, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import type { ClaudeAnalysis, Creative, CreativeAIAnalysis } from '../types'
import type { CreativeAnalysisState } from '../hooks/useCreativeAnalysis'
import { fmtSec, videoKeyFromUrl } from '../lib/analysis'
import { checklistKey, loadChecklist, saveChecklist, scoreColor } from '../lib/analysisVisuals'
import { computeDerivedMetrics, getBenchmark } from '../lib/scoring'
import { TargetBar } from './TargetBar'
import { DetailIcon } from './DetailIcon'

export const AI_PANEL_ID = 'analisis-ia'

type RiskLevel = ClaudeAnalysis['riesgoCumplimiento']['nivel']

const RISK_LEVELS: { nivel: RiskLevel; label: string; color: string; bg: string }[] = [
  { nivel: 'bajo', label: 'Bajo', color: 'var(--detail-good)', bg: 'rgba(95,191,119,0.14)' },
  { nivel: 'medio', label: 'Medio', color: 'var(--detail-mid)', bg: 'rgba(224,164,88,0.14)' },
  { nivel: 'alto', label: 'Alto', color: 'var(--detail-bad)', bg: 'var(--detail-bad-soft)' },
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
    <div className="ai-score-card">
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
          className="ai-score-value absolute inset-0 flex items-center justify-center tabular-nums"
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
    <div className="rounded-lg p-3 text-center min-w-0 h-full flex flex-col justify-center" style={{ background: 'var(--bg-base)', border: '1px solid var(--detail-border)' }}>
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
  mismatch: { glyph: '✗', label: 'La duración no coincide', bg: 'var(--detail-bad-soft)', color: 'var(--cat-apagar)' },
  match: { glyph: '✓', label: 'La duración coincide', bg: 'rgba(95,191,119,0.14)', color: 'var(--cat-ganador)' },
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
      className="ai-mismatch"
    >
      <p className="text-[14px] font-semibold m-0 mb-3 flex items-center gap-2" style={{ color: 'var(--cat-apagar)' }}>
        <DetailIcon name="warning" size={18} />
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

/** Hook rate, hold rate y CTR del creativo contra el objetivo de su nicho, cada uno en su escala. */
function MetricsVsTarget({ creative }: { creative: Creative }) {
  const b = getBenchmark(creative.niche)
  const d = computeDerivedMetrics(creative)
  // Sin impresiones, las tasas salen 0 por división protegida: es "sin dato", no 0 %.
  const has = creative.metrics.impressions > 0
  return (
    <div className="ai-targets">
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
    <ul className="ai-checklist">
      {items.map((r, i) => {
        const done = checked.includes(i)
        return (
          <li key={i} className="ai-checklist-item">
            <label className="ai-checklist-label">
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

type SectionId = 'resumen' | 'hook' | 'copy' | 'riesgo' | 'reco' | 'video' | 'percepcion'

function AnalysisSection({ id, title, description, icon, open, onToggle, children }: {
  id: string
  title: string
  description: string
  icon: ComponentProps<typeof DetailIcon>['name']
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className={`ai-accordion-item${open ? ' ai-accordion-item-open' : ''}`}>
      <button
        type="button"
        className="ai-row-btn"
        id={`${id}-trigger`}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={onToggle}
      >
        <span className="ai-icon-chip"><DetailIcon name={icon} size={18} /></span>
        <span className="ai-row-copy">
          <span className="ai-row-title">{title}</span>
          <span className="ai-row-desc">{description}</span>
        </span>
        <DetailIcon name="chevron" size={18} className={`ai-chevron${open ? ' ai-chevron-open' : ''}`} />
      </button>
      <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-trigger`} className="ai-section-panel" hidden={!open}>
        {children}
      </div>
    </div>
  )
}

function Result({ a, creative }: { a: CreativeAIAnalysis; creative: Creative }) {
  const [openId, setOpenId] = useState<SectionId | null>('riesgo')
  const instanceId = useId()
  const c = a.claudeAnalysis
  if (!c) return null
  // Nivel desconocido: no se presenta como riesgo bajo.
  const current = RISK_LEVELS.find((l) => l.nivel === c.riesgoCumplimiento.nivel)
  const v = a.verificacionVideo
  const g = a.geminiPerception
  const sectionProps = (id: SectionId) => ({
    id: `${instanceId}-${id}`,
    open: openId === id,
    onToggle: () => setOpenId(openId === id ? null : id),
  })

  return (
    <div className="ai-result">
      {a.alertaVideo && <VideoMismatch a={a} fallbackDurationSec={creative.videoDurationSec} />}
      <div className="ai-accordion">
        <AnalysisSection {...sectionProps('resumen')} title="Resumen" description="Scores y veredicto general" icon="chart">
          <div className="ai-score-grid">
            <ScoreRing label="Score visual" value={c.scoreVisual} sub="calidad del creativo" />
            <ScoreRing label="Score combinado" value={a.scoreCombinado} sub={`reglas ${a.rulesComposite ?? '—'} + visual`} />
          </div>
          <MetricsVsTarget creative={creative} />
          <SectionLabel>Razones</SectionLabel>
          <ul className="ai-reasons">
            {c.razones.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </AnalysisSection>

        <AnalysisSection {...sectionProps('hook')} title="Hook" description="Por qué engancha o no" icon="hook">
          <p className="ai-prose">{c.analisisHook}</p>
        </AnalysisSection>

        <AnalysisSection {...sectionProps('copy')} title="Copy" description="Coherencia entre video y anuncio" icon="copy">
          <p className="ai-prose">{c.analisisCopy}</p>
        </AnalysisSection>

        <AnalysisSection {...sectionProps('riesgo')} title="Riesgo de cumplimiento" description="Frases y nivel de riesgo" icon="warning">
          <span className="ai-risk-level" style={{ background: current?.bg ?? 'var(--detail-surface-2)', color: current?.color ?? 'var(--detail-text-2)' }}>
            {current ? `Nivel ${current.label.toLowerCase()}` : 'Nivel sin dato'}
          </span>
          {c.riesgoCumplimiento.frasesDeRiesgo.length > 0 && (
            <div className="ai-risk-phrases">
              {c.riesgoCumplimiento.frasesDeRiesgo.map((f, i) => <span key={i}>“{f}”</span>)}
            </div>
          )}
          <p className="ai-risk-reason">{c.riesgoCumplimiento.motivo}</p>
        </AnalysisSection>

        <AnalysisSection {...sectionProps('reco')} title="Recomendaciones" description="Qué hacer con este creativo" icon="check">
          {/* Se mantiene montado al cerrar. El timestamp reinicia el checklist tras un nuevo análisis. */}
          <RecommendationsChecklist key={`${a.creativeId}:${a.timestamp}`} creativeId={a.creativeId} timestamp={a.timestamp} items={c.recomendaciones} />
        </AnalysisSection>

        <AnalysisSection {...sectionProps('video')} title="Verificación de video" description="Duración y tema vs. el anuncio real" icon="clock">
          <SectionLabel>Verificación de duración</SectionLabel>
          <p className="ai-prose ai-block-gap">
            {v && v.coincide !== null && v.duracionSubidaSeg !== null && v.duracionMetaSeg !== null
              ? `Video subido ${fmtSec(v.duracionSubidaSeg)} · anuncio en Meta ${fmtSec(v.duracionMetaSeg)} · ${v.coincide ? '✓ coincide' : '✗ no coincide'} (tolerancia ±1,5 s)`
              : `No se pudo comparar (subido: ${v?.duracionSubidaSeg != null ? fmtSec(v.duracionSubidaSeg) : 'sin dato'}, Meta: ${v?.duracionMetaSeg != null ? fmtSec(v.duracionMetaSeg) : 'sin dato'}).`}
          </p>
          <SectionLabel>Coherencia video / copy</SectionLabel>
          {c.coherenciaVideoCopy ? (
            <p className="ai-prose">
              {c.coherenciaVideoCopy.coinciden ? '✓ Coinciden' : '✗ No coinciden'} · Video: {c.coherenciaVideoCopy.temaVideo} · Copy: {c.coherenciaVideoCopy.temaCopy}
              <br />
              <span className="ai-muted">{c.coherenciaVideoCopy.motivo}</span>
            </p>
          ) : <p className="ai-prose ai-muted">Sin dato (análisis anterior a esta verificación).</p>}
        </AnalysisSection>

        {g && (
          <AnalysisSection {...sectionProps('percepcion')} title="Percepción del video" description="Formato, escenas y transcripción de Gemini" icon="film">
            <div className="ai-perception ai-prose">
              <p><b>Formato:</b> {g.formatoDetectado} · <b>Ritmo:</b> {g.notasDeRitmo}</p>
              <p><b>Primera frase:</b> “{g.hookLiteral.primeraFraseDicha}”</p>
              <p><b>Primer texto en pantalla:</b> “{g.hookLiteral.primerTextoEnPantalla}”</p>
              <p><b>Escenas:</b> {g.escenas}</p>
              {g.copyEnPantalla.length > 0 && (
                <ul className="ai-transcript ai-muted">
                  {g.copyEnPantalla.map((t, i) => <li key={i}><span className="tabular-nums">{t.segundoAproximado}s</span> · {t.texto}</li>)}
                </ul>
              )}
              <p className="ai-muted"><b>Copy hablado:</b> {g.copyHablado}</p>
            </div>
          </AnalysisSection>
        )}
      </div>
    </div>
  )
}

export function AIAnalysisPanel({ creative, state }: { creative: Creative; state: CreativeAnalysisState }) {
  const { phase, analysis, errorMessage, processingSince, analyze, keepWaiting } = state
  const hasVideoKey = !!videoKeyFromUrl(creative.videoUrl)
  const busy = phase === 'processing' || phase === 'loading'
  // Sin sync, hook/hold ya son correctos; solo faltan retención y tiempo visto.
  const needsSyncHint = !!creative.metaAdId && creative.metrics.retention25 === null

  return (
    <section id={AI_PANEL_ID} tabIndex={-1} className="ai-analysis-panel">
      <h2 className="ai-heading">Desglose detallado</h2>
      <p className="ai-intro">{phase === 'done' ? 'Toca una sección para expandirla' : 'Análisis del creativo con IA'}</p>

      {needsSyncHint && phase !== 'loading' && (
        <p className="ai-sync-hint"><DetailIcon name="info" size={13} />Sincroniza para incluir retención en el análisis.</p>
      )}

      {phase === 'loading' && (
        <div className="ai-status ai-status-line" aria-live="polite">
          <DetailIcon name="refresh" size={16} className="ai-spin" />Buscando análisis guardado…
        </div>
      )}

      {phase === 'idle' && (
        <div className="ai-status ai-idle">
          <p className="ai-prose ai-muted">
            {hasVideoKey ? 'Analiza el video, el copy del anuncio y las métricas con Gemini y Claude.' : 'Sube el video del anuncio a la app para poder analizarlo.'}
          </p>
          <button type="button" className="ai-button ai-button-primary" onClick={() => analyze(false)} disabled={!hasVideoKey}>
            <DetailIcon name="sparkles" size={15} />Analizar con IA
          </button>
        </div>
      )}

      {(phase === 'processing' || phase === 'stalled') && (
        <div className="ai-status" aria-live="polite">
          <p className="ai-status-title">
            <DetailIcon name={phase === 'processing' ? 'refresh' : 'clock'} size={16} className={phase === 'processing' ? 'ai-spin' : 'ai-warning'} />
            {phase === 'processing' ? 'Analizando el creativo…' : 'Está tardando más de lo normal'}
            {processingSince && <span className="ai-elapsed"><Elapsed since={processingSince} /></span>}
          </p>
          <p className="ai-prose ai-muted">Puede tardar hasta un par de minutos. Puedes salir del detalle y volver: el análisis sigue en el servidor.</p>
          {phase === 'stalled' && (
            <div className="ai-actions">
              <button type="button" className="ai-button" onClick={keepWaiting}>Seguir esperando</button>
              <button type="button" className="ai-button ai-button-primary" onClick={() => analyze(true)}><DetailIcon name="refresh" size={15} />Volver a analizar</button>
            </div>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div className="ai-status ai-error" role="alert">
          <p className="ai-status-title"><DetailIcon name="close" size={16} />No se pudo completar el análisis</p>
          <p className="ai-prose ai-block-gap">{errorMessage}</p>
          <button
            type="button"
            className="ai-button ai-button-primary"
            // El servidor solo sobrescribe un análisis existente con forceReanalyze.
            onClick={() => analyze(analysis !== null)}
            disabled={!hasVideoKey}
          ><DetailIcon name="refresh" size={15} />Reintentar</button>
        </div>
      )}

      {phase === 'done' && analysis && (
        <>
          <Result a={analysis} creative={creative} />
          <div className="ai-footer">
            <span>Analizado el{' '}{new Date(analysis.timestamp).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            <button type="button" className="ai-button" onClick={() => analyze(true)} disabled={busy || !hasVideoKey}>
              <DetailIcon name="refresh" size={15} />Volver a analizar
            </button>
          </div>
        </>
      )}
    </section>
  )
}
