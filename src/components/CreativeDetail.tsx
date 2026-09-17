import { useState } from 'react'
import type { Creative } from '../types'
import { scoreCreative } from '../lib/scoring'
import { getBenchmark } from '../lib/scoring'
import { classifyHealth } from '../lib/health'
import { MetricStat } from './MetricStat'
import { CATEGORY_LABEL, CATEGORY_STYLE } from '../lib/category'
import { syncCreativeWithMeta, authenticateVideoUrl } from '../lib/meta'

const FORMAT_LABEL: Record<Creative['format'], string> = {
  '9:16': 'Reel 9:16',
  '1:1': 'Feed 1:1',
  '4:5': 'Feed 4:5',
  '16:9': 'Feed 16:9',
}

function retentionHealth(pct: number, stage: 25 | 50 | 75 | 95) {
  const targets = { 25: 70, 50: 45, 75: 25, 95: 12 }
  return classifyHealth(pct, targets[stage], true, 0.15)
}

export function CreativeDetail({
  creative,
  onBack,
  onSync,
  onDelete,
}: {
  creative: Creative
  onBack: () => void
  onSync: (updated: Creative) => void
  onDelete?: () => void
}) {
  const score = scoreCreative(creative)
  const benchmark = getBenchmark(creative.niche)
  const style = CATEGORY_STYLE[score.category]
  const d = score.derived
  const m = creative.metrics
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const canSync = !!creative.metaAdId
  const hasVideo = !!creative.videoUrl
  const videoUnavailable = creative.videoUnavailable || false
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

  // Construir link a Meta Ads Manager
  const metaAdsManagerUrl = metaAdAccountId
    ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${metaAdAccountId}`
    : 'https://adsmanager.facebook.com/adsmanager/'

  return (
    <div>
      <div 
        className="flex items-center justify-between mb-4 flex-wrap gap-3 pb-3"
        style={{ borderBottom: '1px solid var(--divider-strong)' }}
      >
        <button
          className="flex items-center gap-2 text-[12px] bg-transparent border-none cursor-pointer hover:opacity-80 transition-opacity"
          style={{ color: 'var(--text-secondary)' }}
          onClick={onBack}
        >
          <i className="ti ti-arrow-left text-[14px]" />
          Volver
        </button>

        {canSync && (
          <div className="flex items-center gap-2">
            {syncError && (
              <span className="text-[11px]" style={{ color: 'var(--cat-apagar)' }}>{syncError}</span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 text-[12px] border-none rounded-md px-3 py-1.5 cursor-pointer"
              style={{ 
                background: 'var(--cat-potencial)',
                color: 'white',
              }}
              title="Sincronizar métricas desde Meta Ads"
            >
              <i className={`ti ${syncing ? 'ti-loader-2 text-[14px] animate-spin' : 'ti-refresh'}`} />
              {syncing ? 'Sincronizando...' : 'Sincronizar con Meta Ads'}
            </button>
            {onDelete && (
              <button
                onClick={() => {
                  if (confirm(`¿Eliminar "${creative.name}"? Esta acción no se puede deshacer.`)) {
                    onDelete()
                  }
                }}
                className="flex items-center gap-1.5 text-[12px] border-none rounded-md px-3 py-1.5 cursor-pointer transition-all"
                style={{ 
                  background: 'rgba(239,68,68,0.1)',
                  color: 'var(--cat-apagar)',
                }}
                title="Eliminar creativo"
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(239,68,68,0.2)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(239,68,68,0.1)'
                }}
              >
                <i className="ti ti-trash text-[14px]" />
                Eliminar
              </button>
            )}
          </div>
        )}
        
        {!canSync && onDelete && (
          <button
            onClick={() => {
              if (confirm(`¿Eliminar "${creative.name}"? Esta acción no se puede deshacer.`)) {
                onDelete()
              }
            }}
            className="flex items-center gap-1.5 text-[12px] border-none rounded-md px-3 py-1.5 cursor-pointer transition-all"
            style={{ 
              background: 'rgba(239,68,68,0.1)',
              color: 'var(--cat-apagar)',
            }}
            title="Eliminar creativo"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239,68,68,0.2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(239,68,68,0.1)'
            }}
          >
            <i className="ti ti-trash text-[14px]" />
            Eliminar
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between flex-wrap gap-3 mb-5">
        <div>
          <p className="text-[11px] m-0 mb-0.5" style={{ color: 'var(--text-secondary)' }}>
            Ventas generadas · {creative.niche} · {creative.name} · {FORMAT_LABEL[creative.format]}
          </p>
          <div 
            className="text-[46px] font-bold leading-none tabular-nums"
            style={{ 
              color: 'var(--cat-ganador)',
              textShadow: '0 0 20px rgba(34,197,94,0.3)',
            }}
          >
            {m.purchases}
          </div>
        </div>
        <div className="text-right">
          <span
            className="text-[11px] px-2.5 py-1 rounded"
            style={{ background: style.bg, color: style.text }}
          >
            {CATEGORY_LABEL[score.category]} · Score {score.composite}
          </span>
          <p className="text-[11px] mt-1.5 mb-0" style={{ color: 'var(--text-secondary)' }}>
            ${m.revenue.toLocaleString()} ingresos · ROAS {d.roas.toFixed(1)}x · confianza {score.confidence}
          </p>
        </div>
      </div>

      {/* Video Player Section */}
      <div className="mb-5">
        <p 
          className="text-[12px] uppercase tracking-wide mb-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          Vista previa del creativo
        </p>
        
        <div 
          className="rounded-xl overflow-hidden relative"
          style={{ 
            background: 'var(--bg-surface)',
            border: `1px solid ${style.border}`,
            boxShadow: `0 0 18px ${style.glow}`,
          }}
        >
          {hasVideo ? (
            <>
              <video
                className="w-full block"
                style={{ aspectRatio: creative.format === '9:16' ? '9/16' : creative.format === '1:1' ? '1/1' : creative.format === '4:5' ? '4/5' : '16/9' }}
                poster={creative.thumbnailUrl || undefined}
                controls
                preload="metadata"
                src={authenticateVideoUrl(creative.videoUrl || '') || undefined}
              >
                Tu navegador no soporta la reproducción de video.
              </video>
            </>
          ) : (
            <div 
              className="flex flex-col items-center justify-center py-12"
              style={{ aspectRatio: creative.format === '9:16' ? '9/16' : creative.format === '1:1' ? '1/1' : creative.format === '4:5' ? '4/5' : '16/9' }}
            >
              {creative.thumbnailUrl ? (
                <img 
                  src={creative.thumbnailUrl} 
                  alt={creative.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <>
                  <i className="ti ti-video-off text-[48px] mb-3" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Sin video disponible</p>
                </>
              )}
              
              {videoUnavailable && (
                <div className="absolute bottom-0 left-0 right-0 p-3" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.8))' }}>
                  <p className="text-[11px] mb-2" style={{ color: 'var(--text-secondary)' }}>
                    El video no está disponible por permisos de Meta
                  </p>
                  <a
                    href={metaAdsManagerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md transition-all"
                    style={{ 
                      background: 'var(--accent)',
                      color: 'var(--accent-dark)',
                    }}
                  >
                    <i className="ti ti-external-link text-[12px]" />
                    Ver en Meta Ads Manager
                  </a>
                </div>
              )}
              
              {!videoUnavailable && creative.metaAdId && !hasVideo && (
                <div className="absolute bottom-0 left-0 right-0 p-3" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.8))' }}>
                  <a
                    href={metaAdsManagerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md transition-all"
                    style={{ 
                      background: 'var(--accent)',
                      color: 'var(--accent-dark)',
                    }}
                  >
                    <i className="ti ti-external-link text-[12px]" />
                    Ver en Meta Ads Manager
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <p 
        className="text-[12px] uppercase tracking-wide mb-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        Métricas clave
      </p>
      <div 
        className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 rounded-xl p-3.5 mb-5"
        style={{ 
          background: 'var(--bg-surface)',
          border: '1px solid var(--divider-soft)'
        }}
      >
        <MetricStat label="CTR" value={`${d.ctr.toFixed(1)}%`} health={classifyHealth(d.ctr, benchmark.ctrTarget, true)} />
        <MetricStat label="Hook rate" value={`${d.hookRate.toFixed(0)}%`} health={classifyHealth(d.hookRate, benchmark.hookRateTarget, true)} />
        <MetricStat label="Hold rate" value={`${d.holdRate.toFixed(0)}%`} health={classifyHealth(d.holdRate, benchmark.holdRateTarget, true)} />
        <MetricStat label="Tiempo prom. viendo" value={`${m.avgWatchTime.toFixed(1)}s`} />
        <MetricStat label="Frecuencia" value={m.frequency.toFixed(1)} health={classifyHealth(m.frequency, 2.5, false)} />
        <MetricStat label="CPM" value={`$${d.cpm.toFixed(2)}`} health={classifyHealth(d.cpm, 10, false)} />
        <MetricStat label="CPC" value={`$${d.cpc.toFixed(2)}`} health={classifyHealth(d.cpc, 0.4, false)} />
        <MetricStat label="CPA" value={`$${d.cpa.toFixed(2)}`} health={classifyHealth(d.cpa, benchmark.cpaTarget, false)} />
      </div>

      <p 
        className="text-[12px] uppercase tracking-wide mb-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        Retención del video
      </p>
      <div 
        className="rounded-xl p-3.5 mb-5"
        style={{ 
          background: 'var(--bg-surface)',
          border: '1px solid var(--divider-soft)'
        }}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { label: '25%', v: m.retention25, stage: 25 as const },
            { label: '50%', v: m.retention50, stage: 50 as const },
            { label: '75%', v: m.retention75, stage: 75 as const },
            { label: '95%', v: m.retention95, stage: 95 as const },
          ].map((r) => {
            const h = retentionHealth(r.v, r.stage)
            const color = h === 'good' ? 'var(--cat-ganador)' : h === 'bad' ? 'var(--cat-apagar)' : 'var(--text-primary)'
            return (
              <div key={r.label}>
                <p className="text-[10px] m-0 mb-1" style={{ color: 'var(--text-secondary)' }}>{r.label}</p>
                <div className="rounded h-1.5" style={{ background: 'var(--bg-base)' }}>
                  <div
                    className="h-full rounded"
                    style={{ width: `${r.v}%`, background: color }}
                  />
                </div>
                <p className="text-[11px] m-0 mt-1" style={{ color }}>
                  {r.v}%
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Señales de salud */}
      {(score.isFatigued || score.trendingUp) && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {score.trendingUp && (
            <span className="text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-1.5" style={{ background: 'rgba(95,163,107,0.15)', color: 'var(--cat-ganador)' }}>
              <i className="ti ti-trending-up text-[13px]" />
              Mejorando en {score.trendingMetric === 'ctr' ? 'CTR' : 'ROAS'}
            </span>
          )}
          {score.isFatigued && (
            <span className="text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-1.5" style={{ background: 'rgba(201,161,95,0.15)', color: 'var(--cat-regular)' }}>
              <i className="ti ti-alert-triangle text-[13px]" />
              Fatiga detectada
            </span>
          )}
          <span className={`text-[11px] px-3 py-1.5 rounded-lg ${
            score.confidence === 'alta'
              ? ''
              : score.confidence === 'media'
              ? ''
              : ''
          }`} style={
            score.confidence === 'alta'
              ? { background: 'rgba(95,163,107,0.1)', color: 'var(--cat-ganador)' }
              : score.confidence === 'media'
              ? { background: 'rgba(107,147,201,0.15)', color: 'var(--cat-potencial)' }
              : { background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }
          }>
            <i className="ti ti-chart-bar text-[13px] inline mr-1" />
            Confianza {score.confidence}
          </span>
        </div>
      )}

      {m.demographics && (
        <>
          <p 
            className="text-[12px] uppercase tracking-wide mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            Demográficos
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5">
            <div 
              className="rounded-xl p-3.5"
              style={{ 
                background: 'var(--bg-surface)',
                border: '1px solid var(--divider-soft)'
              }}
            >
              <p className="text-[11px] m-0 mb-2" style={{ color: 'var(--text-secondary)' }}>Por edad</p>
              {m.demographics.ageBreakdown.map((a) => (
                <div key={a.range} className="flex justify-between text-[12px] mb-1">
                  <span style={{ color: 'var(--text-primary)' }}>{a.range}</span>
                  <span
                    style={{
                      color:
                        a.pct >= 30 ? 'var(--cat-ganador)' : a.pct <= 12 ? 'var(--cat-apagar)' : 'var(--text-primary)',
                    }}
                  >
                    {a.pct}%
                  </span>
                </div>
              ))}
            </div>
            <div 
              className="rounded-xl p-3.5"
              style={{ 
                background: 'var(--bg-surface)',
                border: '1px solid var(--divider-soft)'
              }}
            >
              <p className="text-[11px] m-0 mb-2" style={{ color: 'var(--text-secondary)' }}>Por ubicación del anuncio</p>
              {m.demographics.placementRoas.map((p) => (
                <div key={p.placement} className="flex justify-between text-[12px] mb-1">
                  <span style={{ color: 'var(--text-primary)' }}>{p.placement}</span>
                  <span style={{ color: p.roas >= 2 ? 'var(--cat-ganador)' : p.roas < 1 ? 'var(--cat-apagar)' : 'var(--text-primary)' }}>
                    ROAS {p.roas.toFixed(1)}x
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div
        className="rounded-r-xl p-4"
        style={{ 
          background: 'var(--bg-surface)',
          border: '1px solid var(--divider-soft)',
          borderLeft: `3px solid ${style.text}` 
        }}
      >
        <p className="text-[11px] m-0 mb-1.5 flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
          <i className="ti ti-bulb text-[13px]" />
          Análisis a fondo
        </p>
        {score.diagnosis.map((line, i) => (
          <p key={i} className="text-[12px] leading-relaxed m-0 mb-2 last:mb-0" style={{ color: 'var(--text-primary)' }}>
            {line}
          </p>
        ))}
      </div>
    </div>
  )
}
