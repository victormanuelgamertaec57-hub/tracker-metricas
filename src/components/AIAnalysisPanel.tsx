import { useEffect, useState } from 'react'
import type { Creative, CreativeAIAnalysis } from '../types'
import type { CreativeAnalysisState } from '../hooks/useCreativeAnalysis'
import { fmtSec, videoAlertReasons, videoKeyFromUrl } from '../lib/analysis'

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

const RISK_STYLE = {
  alto: { bg: 'rgba(239,68,68,0.15)', text: 'var(--cat-apagar)', border: 'rgba(239,68,68,0.45)' },
  medio: { bg: 'rgba(245,158,11,0.15)', text: 'var(--cat-regular)', border: 'rgba(245,158,11,0.35)' },
  bajo: { bg: 'rgba(255,255,255,0.05)', text: 'var(--text-secondary)', border: 'var(--divider-soft)' },
} as const

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

/** Aviso grande de "posible video equivocado", con cada motivo. */
export function VideoAlert({ reasons }: { reasons: string[] }) {
  return (
    <div
      role="alert"
      className="rounded-xl p-4 mb-4"
      style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.5)' }}
    >
      <p className="text-[14px] font-semibold m-0 mb-2 flex items-center gap-2" style={{ color: 'var(--cat-apagar)' }}>
        <i className="ti ti-alert-triangle text-[18px]" />
        Posible video equivocado
      </p>
      <ul className="m-0 mb-2 pl-5 text-[12px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
        {reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      <p className="text-[12px] m-0" style={{ color: 'var(--text-secondary)' }}>
        Las métricas de este anuncio no corresponden a este video. Sube el video correcto y vuelve a analizar.
      </p>
    </div>
  )
}

function Result({ a }: { a: CreativeAIAnalysis }) {
  const c = a.claudeAnalysis
  if (!c) return null
  const risk = RISK_STYLE[c.riesgoCumplimiento.nivel] ?? RISK_STYLE.bajo
  const v = a.verificacionVideo
  const g = a.geminiPerception
  const reasons = videoAlertReasons(a)

  return (
    <div>
      {reasons.length > 0 && <VideoAlert reasons={reasons} />}

      <div className="grid grid-cols-2 gap-2.5 mb-4">
        {[
          { label: 'Score visual', value: c.scoreVisual, sub: 'calidad del creativo' },
          { label: 'Score combinado', value: a.scoreCombinado, sub: `reglas ${a.rulesComposite ?? '—'} + visual` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl p-3.5" style={card}>
            <p className="text-[11px] m-0" style={{ color: 'var(--text-secondary)' }}>{s.label}</p>
            <p className="text-[28px] font-bold leading-tight m-0 tabular-nums" style={{ color: s.value === undefined ? 'var(--text-muted)' : scoreColor(s.value) }}>
              {s.value ?? '—'}
              <span className="text-[12px] font-normal" style={{ color: 'var(--text-muted)' }}>/100</span>
            </p>
            <p className="text-[10px] m-0" style={{ color: 'var(--text-muted)' }}>{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl p-3.5 mb-4" style={card}>
        <SectionLabel>Hook</SectionLabel>
        <p className="text-[12px] leading-relaxed m-0 mb-3" style={{ color: 'var(--text-primary)' }}>{c.analisisHook}</p>
        <SectionLabel>Copy</SectionLabel>
        <p className="text-[12px] leading-relaxed m-0" style={{ color: 'var(--text-primary)' }}>{c.analisisCopy}</p>
      </div>

      <div className="rounded-xl p-3.5 mb-4" style={{ background: 'var(--bg-surface)', border: `1px solid ${risk.border}` }}>
        <div className="flex items-center gap-2 mb-2">
          <SectionLabel>Riesgo de cumplimiento</SectionLabel>
          <span
            className={`rounded px-2 py-0.5 font-semibold uppercase mb-1.5 ${c.riesgoCumplimiento.nivel === 'alto' ? 'text-[13px]' : 'text-[11px]'}`}
            style={{ background: risk.bg, color: risk.text }}
          >
            {c.riesgoCumplimiento.nivel}
          </span>
        </div>
        <p className="text-[12px] leading-relaxed m-0 mb-2" style={{ color: 'var(--text-primary)' }}>{c.riesgoCumplimiento.motivo}</p>
        {c.riesgoCumplimiento.frasesDeRiesgo.length > 0 && (
          <ul className="m-0 pl-5 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {c.riesgoCumplimiento.frasesDeRiesgo.map((f, i) => (
              <li key={i}>“{f}”</li>
            ))}
          </ul>
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
          <ol className="m-0 pl-5 text-[12px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            {c.recomendaciones.map((r, i) => (
              <li key={i} className="mb-1.5">{r}</li>
            ))}
          </ol>
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
          <Result a={analysis} />
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
