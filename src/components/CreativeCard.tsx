import { useRef, useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { Creative } from '../types'
import { scoreCreative } from '../lib/scoring'
import { CATEGORY_STYLE, CATEGORY_WORD } from '../lib/category'
import { authenticateVideoUrl } from '../lib/meta'
import { DetailIcon } from './DetailIcon'

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

function TemperatureBar({ score, category }: { score: number; category: CreativeCategory }) {
  const style = CATEGORY_STYLE[category]
  return (
    <div className="db-health">
      <div className="db-health-track"><div style={{ width: `${score}%`, background: style.bar }} /></div>
      <span style={{ color: category === 'bueno' ? 'var(--ui-text-2)' : style.text }}><span className="db-category-dot" style={{ background: style.bar }} />{CATEGORY_WORD[category]}</span>
    </div>
  )
}

type CreativeCategory = keyof typeof CATEGORY_STYLE

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
  const reducedMotion = useReducedMotion()
  const score = scoreCreative(creative)
  const style = CATEGORY_STYLE[score.category]
  const hasVideo = !!creative.videoUrl
  const [isPlaying, setIsPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const { ref, handleMouseMove, handleMouseEnter, handleMouseLeave } = useTilt()
  
  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (onDelete && confirm(`¿Eliminar "${creative.name}"? Esta acción no se puede deshacer.`)) {
      onDelete(creative.id)
    }
  }

  function handleMediaClick(e: React.MouseEvent) {
    if (!hasVideo || !videoRef.current) return
    e.stopPropagation()

    if (isPlaying) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
      setIsPlaying(false)
    } else {
      videoRef.current.play().then(() => {
        setIsPlaying(true)
      }).catch((err) => {
        console.error('Error al reproducir video:', err)
      })
    }
  }
  
  return (
    <motion.div
      layout={!reducedMotion}
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? undefined : { opacity: 0, scale: 0.95 }}
      transition={{ duration: reducedMotion ? 0 : 0.3, ease: 'easeOut' }}
    >
      <div
        ref={ref}
        className="db-card card-tilt"
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={() => onOpen(creative.id)}
      >
        <div className="db-thumb" style={{ aspectRatio: ASPECT[creative.format] }} onClick={handleMediaClick}>
          {hasVideo ? (
            <video ref={videoRef} src={authenticateVideoUrl(creative.videoUrl || '') || undefined}
              poster={creative.thumbnailUrl || undefined} preload="metadata" muted loop playsInline />
          ) : creative.thumbnailUrl ? (
            <img src={creative.thumbnailUrl} alt={creative.name} />
          ) : (
            <DetailIcon name="play" size={22} />
          )}
          {hasVideo && !isPlaying && (
            <span className="db-play"><DetailIcon name="play" size={16} /></span>
          )}
          <span className="db-thumb-chip db-format">{FORMAT_LABEL[creative.format]}</span>
          <span className="db-thumb-chip db-score" style={{ background: style.bar, color: score.category === 'bueno' ? 'white' : 'var(--ui-bg)' }}>{score.composite}</span>
          {onDelete && (
            <button onClick={handleDelete} className="db-delete" title="Eliminar creativo" aria-label={`Eliminar ${creative.name}`}>
              <DetailIcon name="trash" size={14} />
            </button>
          )}
          {score.isFatigued && (
            <span className="db-status" style={{ color: CATEGORY_STYLE.malo.text }}><DetailIcon name="warning" size={12} />Fatiga</span>
          )}
          {score.trendingUp && !score.isFatigued && (
            <span className="db-status" style={{ color: CATEGORY_STYLE.ganador.text }}><DetailIcon name="trend" size={12} />{score.trendingMetric === 'ctr' ? 'CTR↑' : 'ROAS↑'}</span>
          )}
        </div>
        <div className="db-card-content">
          <p className="db-niche">{creative.niche}</p>
          <button className="db-card-name" onClick={(e) => { e.stopPropagation(); onOpen(creative.id) }}>{creative.name}</button>
          <p className="db-card-metrics">CTR {score.derived.ctr.toFixed(1)}% · ROAS {score.derived.roas.toFixed(1)}x</p>
          <TemperatureBar score={score.composite} category={score.category} />
        </div>
      </div>
    </motion.div>
  )
}
