import { Suspense, lazy, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Category, Creative } from '../types'
import { scoreCreative } from '../lib/scoring'
import { CreativeCard } from './CreativeCard'
import { CATEGORY_LABEL } from '../lib/category'

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
    <div>
      {/* Header bar */}
      <div 
        className="flex items-center justify-between mb-6 pb-4"
        style={{ borderBottom: '1px solid var(--divider-soft)' }}
      >
        <div className="flex items-center gap-3">
          <Suspense fallback={<Header3DSkeleton />}>
            <Header3D />
          </Suspense>
          <div className="flex items-center gap-2">
            {/* Glowing dot */}
            <span 
              className="w-2 h-2 rounded-full"
              style={{ 
                background: 'var(--accent)',
                boxShadow: '0 0 8px var(--accent)',
              }}
            />
            <div>
              <h1 
                className="text-[16px] font-bold m-0 tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                RESET VAGAL
              </h1>
              <p 
                className="text-[11px] m-0 mt-0.5"
                style={{ 
                  color: 'var(--accent)',
                  letterSpacing: '0.05em',
                }}
              >
                CREATIVE OS
              </p>
            </div>
          </div>
        </div>
        
        <div className="flex gap-2 flex-wrap sm:flex-nowrap">
          <select 
            value={nicheFilter} 
            onChange={(e) => setNicheFilter(e.target.value)} 
            className="text-[12px] min-w-[120px]"
          >
            <option value="todos">Todos</option>
            {niches.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          
          <select 
            value={categoryFilter} 
            onChange={(e) => setCategoryFilter(e.target.value)} 
            className="text-[12px] min-w-[120px]"
          >
            <option value="todos">Todos</option>
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
          
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 text-[12px] cursor-pointer transition-colors"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--divider-soft)',
              color: 'var(--text-secondary)',
              borderRadius: '6px',
              padding: '6px 10px',
            }}
          >
            <i className="ti ti-settings text-[14px]" />
            <span className="hidden sm:inline">Ajustes</span>
          </button>
          
          <button
            className="flex items-center gap-1.5 text-[12px] font-medium cursor-pointer transition-all"
            style={{
              background: 'var(--accent)',
              color: 'var(--accent-dark)',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 12px',
              boxShadow: '0 0 12px var(--accent-glow)',
            }}
            onClick={onAddNew}
          >
            <i className="ti ti-plus text-[14px]" />
            Nuevo
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div 
        className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-6"
        style={{
          padding: '16px',
          background: 'var(--bg-surface)',
          borderRadius: '12px',
          border: '1px solid var(--divider-soft)'
        }}
      >
        <SummaryCard 
          label="Score prom." 
          value={`${avgScore}`} 
          suffix="/100" 
          color="var(--text-primary)" 
        />
        <SummaryCard 
          label="Ganadores" 
          value={`${winners}`} 
          color="var(--cat-ganador)" 
          glow="var(--glow-ganador)"
        />
        <SummaryCard 
          label="Potencial" 
          value={`${watching}`} 
          color="var(--cat-potencial)" 
          glow="var(--glow-potencial)"
        />
        <SummaryCard 
          label="Regular" 
          value={`${regular}`} 
          color="var(--cat-regular)" 
          glow="var(--glow-regular)"
        />
        <SummaryCard 
          label="Apagar" 
          value={`${toKill}`} 
          color="var(--cat-apagar)" 
          glow="var(--glow-apagar)"
        />
      </div>

      {/* Creative grid with layout animations */}
      <motion.div 
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
        layout
      >
        <AnimatePresence mode="popLayout">
          {filtered.map(({ creative }) => (
            <CreativeCard key={creative.id} creative={creative} onOpen={onOpen} onDelete={onDelete} />
          ))}
        </AnimatePresence>
        
        <motion.button
          layout
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex flex-col items-center justify-center gap-2 cursor-pointer min-h-[200px]"
          style={{
            background: 'var(--bg-surface)',
            border: '1px dashed var(--divider-strong)',
            borderRadius: '12px',
            color: 'var(--text-secondary)',
          }}
          onClick={onAddNew}
        >
          <div 
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: 'var(--bg-base)' }}
          >
            <i className="ti ti-upload text-[20px]" />
          </div>
          <span className="text-[12px]">Subir creativo</span>
        </motion.button>
      </motion.div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  suffix,
  color,
  glow,
}: {
  label: string
  value: string
  suffix?: string
  color: string
  glow?: string
}) {
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: '8px',
        border: `1px solid ${glow ? color.replace(')', ',0.3)').replace('var(--cat', 'rgba(') : 'transparent'}`,
        boxShadow: glow ? `0 0 12px ${glow}` : 'none',
      }}
    >
      <p 
        className="text-[10px] m-0 mb-1 uppercase tracking-wide"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </p>
      <p 
        className="text-[22px] font-bold m-0 tabular-nums"
        style={{ 
          color,
          textShadow: glow ? `0 0 10px ${color}50` : 'none',
        }}
      >
        {value}
        {suffix && <span className="text-[12px] ml-0.5" style={{ color: 'var(--text-muted)' }}>{suffix}</span>}
      </p>
    </div>
  )
}
