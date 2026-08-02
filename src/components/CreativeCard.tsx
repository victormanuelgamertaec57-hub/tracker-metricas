import { useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import type { Creative } from '../types'
import { scoreCreative } from '../lib/scoring'
import { CATEGORY_STYLE, CATEGORY_WORD } from '../lib/category'

const ASPECT: Record<Creative['format'], string> = {
  '9:16': '9/16',
  '1:1': '1/1',
  '4:5': '4/5',
  '16:9': '16/9',
}

const FORMAT_LABEL: Record<Creative['format'], string> = {
  '9:16': 'Reel 9:16',
  '1:1': 'Feed 1:1',
  '4:5': 'Feed 4:5',
  '16:9': 'Feed 16:9',
}

// Temperature bar component - 3px high
function TemperatureBar({ score, category }: { score: number; category: string }) {
  const style = CATEGORY_STYLE[category as keyof typeof CATEGORY_STYLE]
  const barColor = style?.bar || '#64748B'
  const word = CATEGORY_WORD[category as keyof typeof CATEGORY_WORD] || category
  
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-[3px] bg-white/[0.08] rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ 
            backgroundColor: barColor,
            boxShadow: `0 0 8px ${barColor}60`,
          }}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 500, ease: 'easeOut' }}
        />
      </div>
      <span 
        className="text-[10px] lowercase tracking-wide flex items-center gap-1"
        style={{ color: barColor }}
      >
        <span>●</span>
        {word}
      </span>
    </div>
  )
}

// 3D tilt effect on hover.
// Performance: writes CSS custom properties directly to the DOM via ref instead of
// setState. With 10+ cards and 60fps mousemove, the old setState approach caused
// hundreds of re-renders per second, each recalculating scoreCreative() and
// computeDerivedMetrics(). The new approach: zero re-renders during hover.
function useTilt() {
  const ref = useRef<HTMLDivElement>(null)
  const reducedMotionRef = useRef(false)

  // Cache prefers-reduced-motion to avoid running matchMedia on every mousemove.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotionRef.current = mq.matches
    const handler = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current || reducedMotionRef.current) return

    const rect = ref.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    // --x drives rotateY, --y drives rotateX (sign inverted via CSS calc).
    // Range: -3 to 3, same as the previous implementation.
    const tx = ((x - centerX) / centerX) * 3
    const ty = ((y - centerY) / centerY) * 3

    ref.current.style.setProperty('--x', String(tx))
    ref.current.style.setProperty('--y', String(ty))
  }

  const handleMouseEnter = () => {
    if (!ref.current || reducedMotionRef.current) return
    ref.current.style.setProperty('--lift', '-2px')
  }

  const handleMouseLeave = () => {
    if (!ref.current) return
    ref.current.style.setProperty('--x', '0')
    ref.current.style.setProperty('--y', '0')
    ref.current.style.setProperty('--lift', '0px')
  }

  return { ref, handleMouseMove, handleMouseEnter, handleMouseLeave }
}

export function CreativeCard({
  creative,
  onOpen,
  onDelete,
}: {
  creative: Creative
  onOpen: (id: string) => void
  onDelete?: (id: string) => void
}) {
  const score = scoreCreative(creative)
  const style = CATEGORY_STYLE[score.category]
  const hasVideo = !!creative.videoUrl
  const { ref, handleMouseMove, handleMouseEnter, handleMouseLeave } = useTilt()
  
  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (onDelete && confirm(`¿Eliminar "${creative.name}"? Esta acción no se puede deshacer.`)) {
      onDelete(creative.id)
    }
  }
  
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <div
        ref={ref}
        className="rounded-xl overflow-hidden cursor-pointer card-tilt"
        style={{
          background: 'var(--bg-surface)',
          border: `1px solid ${style.border}`,
          boxShadow: `0 0 18px ${style.glow}`,
          transition: 'box-shadow 0.3s ease, border-color 0.3s ease',
        }}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={() => onOpen(creative.id)}
      >
        {/* Thumbnail area */}
        <div
          className="flex items-center justify-center relative"
          style={{ 
            aspectRatio: ASPECT[creative.format],
            background: creative.thumbnailUrl ? 'transparent' : 'var(--bg-thumb)',
          }}
        >
          {creative.thumbnailUrl ? (
            <img 
              src={creative.thumbnailUrl} 
              alt={creative.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <i className="ti ti-player-play text-[22px]" style={{ color: 'var(--text-muted)' }} />
          )}
          
          {/* Play icon overlay if video exists */}
          {hasVideo && (
            <div 
              className="absolute inset-0 flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.3)' }}
            >
              <div 
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ 
                  background: 'rgba(255,255,255,0.2)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <i className="ti ti-player-play text-white text-xl" style={{ marginLeft: '2px' }} />
              </div>
            </div>
          )}
          
          {/* Format badge */}
          <span 
            className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded"
            style={{ 
              background: 'rgba(0,0,0,0.6)',
              color: 'var(--text-muted)',
            }}
          >
            {FORMAT_LABEL[creative.format]}
          </span>
          
          {/* Score badge - top right corner with glow */}
          <span 
            className="absolute top-2 right-2 text-[11px] px-1.5 py-0.5 rounded font-medium tabular-nums flex items-center gap-1"
            style={{ 
              background: style.bg,
              color: style.text,
              textShadow: `0 0 8px ${style.text}40`,
            }}
          >
            {score.composite}
          </span>
          
          {/* Delete button */}
          {onDelete && (
            <button
              onClick={handleDelete}
              className="absolute top-2 right-2 w-6 h-6 rounded flex items-center justify-center transition-all"
              style={{
                background: 'rgba(0,0,0,0.6)',
                color: 'var(--text-muted)',
                marginRight: '32px',
              }}
              title="Eliminar creativo"
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--cat-apagar)'
                e.currentTarget.style.background = 'rgba(239,68,68,0.2)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)'
                e.currentTarget.style.background = 'rgba(0,0,0,0.6)'
              }}
            >
              <i className="ti ti-trash text-[12px]" />
            </button>
          )}
          
          {/* Fatigue indicator */}
          {score.isFatigued && (
            <span 
              className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"
              style={{ 
                background: 'rgba(239,68,68,0.2)',
                color: 'var(--cat-apagar)',
              }}
            >
              <i className="ti ti-alert-triangle text-[11px]" />
              Fatiga
            </span>
          )}
          
          {/* Trending indicator */}
          {score.trendingUp && !score.isFatigued && (
            <span 
              className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"
              style={{ 
                background: 'rgba(34,197,94,0.2)',
                color: 'var(--cat-ganador)',
              }}
            >
              <i className="ti ti-trending-up text-[11px]" />
              {score.trendingMetric === 'ctr' ? 'CTR↑' : 'ROAS↑'}
            </span>
          )}
        </div>
        
        {/* Content area */}
        <div className="p-3">
          {/* Niche (muted, 10px) */}
          <p 
            className="m-0 mb-0.5"
            style={{ 
              fontSize: '10px',
              color: 'var(--text-muted)',
            }}
          >
            {creative.niche}
          </p>
          
          {/* Name (white, 13px) */}
          <p 
            className="m-0 mb-2"
            style={{ 
              fontSize: '13px',
              fontWeight: 500,
              color: 'var(--text-primary)',
            }}
          >
            {creative.name}
          </p>
          
          {/* CTR/ROAS (secondary, tabular) */}
          <div 
            className="text-[11px] tabular-nums mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            CTR {score.derived.ctr.toFixed(1)}% · ROAS {score.derived.roas.toFixed(1)}x
          </div>
          
          {/* Temperature bar */}
          <TemperatureBar score={score.composite} category={score.category} />
        </div>
      </div>
    </motion.div>
  )
}
