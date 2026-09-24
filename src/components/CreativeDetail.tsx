import { useRef, useState } from 'react'
import type { Creative } from '../types'
import { scoreCreative, getBenchmark } from '../lib/scoring'
import { classifyHealth } from '../lib/health'
import type { Health } from '../lib/health'
import { CATEGORY_LABEL, CATEGORY_STYLE } from '../lib/category'
import { syncCreativeWithMeta, authenticateVideoUrl } from '../lib/meta'
import { useCreativeAnalysis } from '../hooks/useCreativeAnalysis'
import { videoAlertReasons } from '../lib/analysis'
import { AIAnalysisPanel, AI_PANEL_ID } from './AIAnalysisPanel'
import { DetailIcon } from './DetailIcon'
import { useDetailEntrance } from '../hooks/useDetailEntrance'
import './CreativeDetail.css'

const FORMAT_LABEL: Record<Creative['format'], string> = {
  '9:16': 'Reel 9:16',
  '1:1': 'Feed 1:1',
  '4:5': 'Feed 4:5',
  '16:9': 'Feed 16:9',
}

const FORMAT_RATIO: Record<Creative['format'], string> = {
  '9:16': '9 / 16',
  '1:1': '1 / 1',
  '4:5': '4 / 5',
  '16:9': '16 / 9',
}

const DETAIL_HEALTH_COLOR: Record<Health, string> = {
  good: 'var(--detail-good)',
  neutral: 'var(--detail-mid)',
  bad: 'var(--detail-bad)',
}

function retentionHealth(pct: number, stage: 25 | 50 | 75 | 95) {
  const targets = { 25: 70, 50: 45, 75: 25, 95: 12 }
  return classifyHealth(pct, targets[stage], true, 0.15)
}

function MetricDonut({ label, value, target, decimals, progress }: {
  label: string
  value: number
  target: number
  decimals: number
  progress: number
}) {
  const circumference = 2 * Math.PI * 26
  const color = DETAIL_HEALTH_COLOR[classifyHealth(value, target, true)]
  return (
    <div className="cd-metric cd-metric-donut">
      <div className="cd-donut">
        <svg width="60" height="60" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--detail-surface-2)" strokeWidth="6" />
          <circle cx="32" cy="32" r="26" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.max(0, Math.min(100, value)) * progress / 100)} />
        </svg>
        <span style={{ color }}>{(value * progress).toFixed(decimals)}%</span>
      </div>
      <span className="cd-metric-label">{label}<br />obj. {target}%</span>
    </div>
  )
}

function FlatMetric({ label, value, health, noData = false, tall = false }: {
  label: string
  value: string
  health?: Health
  noData?: boolean
  tall?: boolean
}) {
  return (
    <div className={`cd-metric${tall ? ' cd-metric-tall' : ''}`}>
      <span className="cd-metric-label">{label}</span>
      <span className="cd-metric-value" style={{ color: noData ? 'var(--detail-text-2)' : health ? DETAIL_HEALTH_COLOR[health] : 'var(--detail-text)' }}>{value}</span>
    </div>
  )
}

function VideoPreview({ creative, metaAdsManagerUrl }: { creative: Creative; metaAdsManagerUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [loadedDuration, setLoadedDuration] = useState<number | null>(null)
  const hasVideo = !!creative.videoUrl
  const videoUnavailable = creative.videoUnavailable || false
  const duration = creative.videoDurationSec ?? loadedDuration

  return (
    <div className="cd-video-column">
      <div className="cd-video-frame" style={{ aspectRatio: FORMAT_RATIO[creative.format] }}>
        {hasVideo ? (
          <>
            <video
              ref={videoRef}
              className="cd-video"
              style={{ aspectRatio: FORMAT_RATIO[creative.format] }}
              poster={creative.thumbnailUrl || undefined}
              controls
              preload="metadata"
              src={authenticateVideoUrl(creative.videoUrl || '') || undefined}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onLoadedMetadata={(event) => {
                const seconds = event.currentTarget.duration
                setLoadedDuration(Number.isFinite(seconds) ? seconds : null)
              }}
            >
              Tu navegador no soporta la reproducción de video.
            </video>
            {!playing && (
              <button type="button" className="cd-video-play" aria-label="Reproducir video"
                onClick={() => { void videoRef.current?.play().catch(() => setPlaying(false)) }}>
                <DetailIcon name="play" size={20} />
              </button>
            )}
          </>
        ) : (
          <div className="cd-video-fallback">
            {creative.thumbnailUrl ? (
              <img src={creative.thumbnailUrl} alt={creative.name} />
            ) : (
              <div className="cd-video-empty">
                <DetailIcon name="video-off" size={48} />
                <p>Sin video disponible</p>
              </div>
            )}
          </div>
        )}
        <span className="cd-video-chip cd-video-format">{creative.format}</span>
        {duration != null && Number.isFinite(duration) && (
          <span className={`cd-video-chip cd-video-duration${hasVideo ? ' cd-video-duration-controls' : ''}`}>
            {duration.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s
          </span>
        )}
      </div>
      {!hasVideo && (videoUnavailable || creative.metaAdId) && (
        <div className="cd-video-unavailable">
          {videoUnavailable && <p>El video no está disponible por permisos de Meta</p>}
          <a href={metaAdsManagerUrl} target="_blank" rel="noopener noreferrer" className="cd-meta-link">
            <DetailIcon name="external" size={12} />
            Ver en Meta Ads Manager
          </a>
        </div>
      )}
    </div>
  )
}

export function CreativeDetail({ creative, onBack, onSync, onDelete }: {
  creative: Creative
  onBack: () => void
  onSync: (updated: Creative) => void
  onDelete?: () => void
}) {
  const progress = useDetailEntrance(creative.id)
  const score = scoreCreative(creative)
  const animatedScore = Math.round(score.composite * progress)
  const scoreColor = `color-mix(in srgb, var(--detail-text-2), ${CATEGORY_STYLE[score.category].text} ${progress * 100}%)`
  const benchmark = getBenchmark(creative.niche)
  const d = score.derived
  const m = creative.metrics
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const aiAnalysis = useCreativeAnalysis(creative)
  const alertReasons = aiAnalysis.phase === 'done' ? videoAlertReasons(aiAnalysis.analysis) : []
  const canSync = !!creative.metaAdId
  const metaAdAccountId = creative.metaAdAccountId

  async function handleSync() {
    if (!creative.metaAdId) return
    setSyncing(true)
    setSyncError(null)
    try {
      const result = await syncCreativeWithMeta(creative.metaAdId)
      const updatedCreative: Creative = {
        ...creative,
        metrics: result.metrics,
        thumbnailUrl: result.thumbnailUrl || creative.thumbnailUrl,
        videoUrl: result.videoUrl || creative.videoUrl,
        videoUnavailable: result.videoUnavailable || false,
        metaAdAccountId: result.adAccountId || creative.metaAdAccountId,
      }
      onSync(updatedCreative)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setSyncing(false)
    }
  }

  const metaAdsManagerUrl = metaAdAccountId
    ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${metaAdAccountId}`
    : 'https://adsmanager.facebook.com/adsmanager/'

  return (
    <div className="creative-detail">
      <div className="cd-toolbar">
        <button type="button" className="cd-back" onClick={onBack}>
          <DetailIcon name="back" size={18} />Volver
        </button>
        <div className="cd-actions">
          {canSync && syncError && <span className="cd-sync-error" role="alert">{syncError}</span>}
          {canSync && (
            <button type="button" onClick={handleSync} disabled={syncing} className="cd-button" title="Sincronizar métricas desde Meta Ads">
              <DetailIcon name="refresh" size={15} className={syncing ? 'cd-spinning' : undefined} />
              {syncing ? 'Sincronizando...' : 'Sincronizar con Meta Ads'}
            </button>
          )}
          {onDelete && (
            <button type="button" className="cd-button cd-button-danger" title="Eliminar creativo" onClick={() => {
              if (confirm(`¿Eliminar "${creative.name}"? Esta acción no se puede deshacer.`)) onDelete()
            }}>
              <DetailIcon name="trash" size={15} />Eliminar
            </button>
          )}
        </div>
      </div>

      {alertReasons.length > 0 && (
        <div role="alert" className="cd-video-alert">
          <div className="cd-video-alert-message">
            <DetailIcon name="warning" size={20} />
            <div>
              <p className="cd-alert-title">Posible video equivocado</p>
              <p className="cd-alert-description">
                {alertReasons[0]}{alertReasons.length > 1 ? ` (+${alertReasons.length - 1} motivo más)` : ''}
              </p>
            </div>
          </div>
          <button type="button" className="cd-text-button" onClick={() => {
            const panel = document.getElementById(AI_PANEL_ID)
            panel?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
            panel?.focus({ preventScroll: true })
          }}>Ver detalles →</button>
        </div>
      )}

      <div className="cd-summary">
        <div className="cd-sales">
          <p>Score · {creative.niche} · {creative.name} · {FORMAT_LABEL[creative.format]}</p>
          {/* El número animado se oculta al lector de pantalla; el valor final va en sr-only
              (aria-label en un div/span genérico lo ignoran NVDA/JAWS). */}
          <div className="cd-sales-value" style={{ color: scoreColor }}><span aria-hidden="true">{animatedScore}</span><span className="sr-only">Score {score.composite} de 100</span></div>
        </div>
        <div className="cd-score-summary">
          <span className="cd-chip" style={{ borderColor: scoreColor }}><i className="cd-category-dot" style={{ color: scoreColor }} aria-hidden="true" /><span aria-hidden="true">{CATEGORY_LABEL[score.category]} · Score {animatedScore}</span><span className="sr-only">Categoría {CATEGORY_LABEL[score.category]}</span></span>
          <p>{m.purchases.toLocaleString()} ventas · ${m.revenue.toLocaleString()} ingresos · ROAS {d.roas.toFixed(1)}x · confianza {score.confidence}</p>
        </div>
      </div>

      <div className="cd-main-grid">
        <VideoPreview key={`${creative.id}:${creative.videoUrl ?? ''}`} creative={creative} metaAdsManagerUrl={metaAdsManagerUrl} />
        <div className="cd-metrics-column">
          <div className="cd-legend" aria-label="Color según desempeño">
            <span>Color según desempeño:</span>
            <span><i className="cd-dot cd-dot-good" />Bueno</span>
            <span><i className="cd-dot cd-dot-mid" />Regular</span>
            <span><i className="cd-dot cd-dot-bad" />Malo</span>
          </div>
          <div className="cd-metrics-grid">
            <MetricDonut label="Hook rate" value={d.hookRate} target={benchmark.hookRateTarget} decimals={0} progress={progress} />
            <MetricDonut label="Hold rate" value={d.holdRate} target={benchmark.holdRateTarget} decimals={0} progress={progress} />
            <MetricDonut label="CTR" value={d.ctr} target={benchmark.ctrTarget} decimals={1} progress={progress} />
            <FlatMetric label="Tiempo prom." value={m.avgWatchTime === null ? 'sin dato' : `${m.avgWatchTime.toFixed(1)}s`} noData={m.avgWatchTime === null} tall />
          </div>
          <div className="cd-metrics-grid">
            <FlatMetric label="Frecuencia" value={m.frequency.toFixed(1)} health={classifyHealth(m.frequency, 2.5, false)} />
            <FlatMetric label="CPM" value={`$${d.cpm.toFixed(2)}`} health={classifyHealth(d.cpm, 10, false)} />
            <FlatMetric label="CPC" value={`$${d.cpc.toFixed(2)}`} health={classifyHealth(d.cpc, 0.4, false)} />
            <FlatMetric label="CPA" value={`$${d.cpa.toFixed(2)}`} health={classifyHealth(d.cpa, benchmark.cpaTarget, false)} />
          </div>
          <div className="cd-retention cd-surface">
            <p className="cd-section-label">Retención del video</p>
            <div className="cd-retention-grid">
              {[
                { label: '25%', v: m.retention25, stage: 25 as const },
                { label: '50%', v: m.retention50, stage: 50 as const },
                { label: '75%', v: m.retention75, stage: 75 as const },
                { label: '95%', v: m.retention95, stage: 95 as const },
              ].map((r) => {
                const color = r.v === null ? 'var(--detail-text-2)' : DETAIL_HEALTH_COLOR[retentionHealth(r.v, r.stage)]
                return (
                  <div key={r.label}>
                    <p className="cd-retention-label">{r.label}</p>
                    <div className="cd-retention-track">
                      <div style={{ width: `${r.v ?? 0}%`, background: color }} />
                    </div>
                    <p className="cd-retention-value" style={{ color }}>{r.v === null ? 'sin dato' : `${r.v.toFixed(0)}%`}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {(score.isFatigued || score.trendingUp) && (
        <div className="cd-health-signals">
          {score.trendingUp && <span className="cd-chip cd-signal-good"><DetailIcon name="trend" size={13} />Mejorando en {score.trendingMetric === 'ctr' ? 'CTR' : 'ROAS'}</span>}
          {score.isFatigued && <span className="cd-chip cd-signal-mid"><DetailIcon name="warning" size={13} />Fatiga detectada</span>}
          <span className={`cd-chip cd-confidence-${score.confidence}`}><DetailIcon name="chart" size={13} />Confianza {score.confidence}</span>
        </div>
      )}

      {m.demographics && (
        <section className="cd-demographics">
          <h2 className="cd-section-label">Demográficos</h2>
          <div className="cd-demographics-grid">
            <div className="cd-surface">
              <p className="cd-section-label">Por edad</p>
              {m.demographics.ageBreakdown.map((a) => (
                <div key={a.range} className="cd-demographic-row">
                  <span>{a.range}</span>
                  <span style={{ color: a.pct >= 30 ? 'var(--detail-good)' : a.pct <= 12 ? 'var(--detail-bad)' : 'var(--detail-mid)' }}>{a.pct}%</span>
                </div>
              ))}
            </div>
            <div className="cd-surface">
              <p className="cd-section-label">Por ubicación del anuncio</p>
              {m.demographics.placementRoas.map((p) => (
                <div key={p.placement} className="cd-demographic-row">
                  <span>{p.placement}</span>
                  <span style={{ color: p.roas >= 2 ? 'var(--detail-good)' : p.roas < 1 ? 'var(--detail-bad)' : 'var(--detail-mid)' }}>ROAS {p.roas.toFixed(1)}x</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="cd-surface cd-diagnosis">
        <p className="cd-section-label"><DetailIcon name="bulb" size={13} />Análisis a fondo</p>
        {score.diagnosis.map((line, i) => <p key={i} className="cd-diagnosis-text">{line}</p>)}
      </div>
      <AIAnalysisPanel creative={creative} state={aiAnalysis} />
    </div>
  )
}
