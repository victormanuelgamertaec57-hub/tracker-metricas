import { Suspense, lazy, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { Category, Creative } from '../types'
import { scoreCreative } from '../lib/scoring'
import { CreativeCard } from './CreativeCard'
import './Dashboard.css'
import { CATEGORY_LABEL, CATEGORY_STYLE } from '../lib/category'

// Lazy load the 3D header
const Header3D = lazy(() => import('./Header3D'))

// Loading skeleton for 3D header
function Header3DSkeleton() {
  return (
    <div className="w-10 h-10 flex items-center justify-center">
      <div className="w-6 h-6 rounded-full" 
        style={{ 
          border: '1px solid rgba(56,189,248,0.3)',
          boxShadow: '0 0 10px rgba(56,189,248,0.2)'
        }} 
      />
    </div>
  )
}

export function Dashboard({
  creatives,
  onOpen,
  onAddNew,
  onOpenSettings,
  onDelete,
}: {
  creatives: Creative[]
  onOpen: (id: string) => void
  onAddNew: () => void
  onOpenSettings: () => void
  onDelete?: (id: string) => void
}) {
  const reducedMotion = useReducedMotion()
  const [nicheFilter, setNicheFilter] = useState('todos')
  const [categoryFilter, setCategoryFilter] = useState('todos')

  const niches = useMemo(
    () => Array.from(new Set(creatives.map((c) => c.niche))),
    [creatives]
  )

  const scored = useMemo(
    () => creatives.map((c) => ({ creative: c, score: scoreCreative(c) })),
    [creatives]
  )

  const filtered = scored.filter(({ creative, score }) => {
    if (nicheFilter !== 'todos' && creative.niche !== nicheFilter) return false
    if (categoryFilter !== 'todos' && score.category !== categoryFilter) return false
    return true
  })

  const avgScore = scored.length
    ? Math.round(scored.reduce((a, s) => a + s.score.composite, 0) / scored.length)
    : 0
  const winners = scored.filter((s) => s.score.category === 'ganador').length
  const watching = scored.filter((s) => s.score.category === 'potencial').length
  const toKill = scored.filter((s) => s.score.category === 'malo').length
  const regular = scored.filter((s) => s.score.category === 'regular').length

  return (
    <div className="dashboard">
      <header className="db-header">
        <div className="db-brand">
          <Suspense fallback={<Header3DSkeleton />}><Header3D /></Suspense>
          <div>
            <h1>TRACKER-MÉTRICAS<span className="db-brand-dot" /></h1>
            <p>CREATIVE OS</p>
          </div>
        </div>
        <div className="db-controls">
          <select aria-label="Filtrar por nicho" value={nicheFilter} onChange={(e) => setNicheFilter(e.target.value)}>
            <option value="todos">Todos</option>
            {niches.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select aria-label="Filtrar por categoría" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="todos">Todos</option>
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
          <button className="db-button" onClick={onOpenSettings}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09c.36.16.68.4.95.7" /></svg>
            Ajustes
          </button>
          <button className="db-button db-button-primary" onClick={onAddNew}>+ Nuevo</button>
        </div>
      </header>
      <div className="db-summary">
        <SummaryCard label="Score prom." value={`${avgScore}`} suffix="/100" color="var(--ui-text)" />
        <SummaryCard label="Ganadores" value={`${winners}`} color={CATEGORY_STYLE.ganador.text} />
        <SummaryCard label="Potencial" value={`${watching}`} color={CATEGORY_STYLE.potencial.text} />
        <SummaryCard label="Regular" value={`${regular}`} color={CATEGORY_STYLE.regular.text} />
        <SummaryCard label="Apagar" value={`${toKill}`} color={CATEGORY_STYLE.malo.text} />
      </div>
      <motion.div className="db-grid" layout={!reducedMotion}>
        <AnimatePresence mode="popLayout">
          {filtered.map(({ creative }) => <CreativeCard key={creative.id} creative={creative} onOpen={onOpen} onDelete={onDelete} />)}
        </AnimatePresence>
        <motion.button layout={!reducedMotion} initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reducedMotion ? undefined : { opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.3 }} className="db-upload" onClick={onAddNew}>
          <span className="db-upload-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m0-12l4 4m-4-4l-4 4" /><path d="M20 17v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2" /></svg></span>
          <span>Subir creativo</span>
        </motion.button>
      </motion.div>
    </div>
  )
}

function SummaryCard({ label, value, suffix, color }: { label: string; value: string; suffix?: string; color: string }) {
  return (
    <div>
      <p className="db-stat-label">{label}</p>
      <p className="db-stat-value" style={{ color }}>{value}{suffix && <span>{suffix}</span>}</p>
    </div>
  )
}
