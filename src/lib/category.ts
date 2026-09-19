import type { Category } from '../types'

export const CATEGORY_LABEL: Record<Category, string> = {
  ganador: 'Ganador',
  potencial: 'Potencial',
  bueno: 'Bueno',
  regular: 'Regular',
  malo: 'Apagar',
}

// Tech Black palette with glows
export const CATEGORY_STYLE: Record<Category, { 
  bg: string; 
  text: string; 
  bar: string;
  border: string;
  glow: string;
}> = {
  ganador: { 
    bg: 'rgba(34,197,94,0.15)', 
    text: '#22C55E', 
    bar: '#22C55E',
    border: 'rgba(34,197,94,0.3)',
    glow: 'rgba(34,197,94,0.08)',
  },
  potencial: { 
    bg: 'rgba(56,189,248,0.15)', 
    text: '#38BDF8', 
    bar: '#38BDF8',
    border: 'rgba(56,189,248,0.3)',
    glow: 'rgba(56,189,248,0.08)',
  },
  bueno: { 
    bg: 'rgba(100,116,139,0.15)', 
    text: '#64748B', 
    bar: '#64748B',
    border: 'rgba(100,116,139,0.25)',
    glow: 'rgba(100,116,139,0.05)',
  },
  regular: { 
    bg: 'rgba(245,158,11,0.15)', 
    text: '#F59E0B', 
    bar: '#F59E0B',
    border: 'rgba(245,158,11,0.3)',
    glow: 'rgba(245,158,11,0.08)',
  },
  malo: { 
    bg: 'rgba(239,68,68,0.15)', 
    text: '#EF4444', 
    bar: '#EF4444',
    border: 'rgba(239,68,68,0.3)',
    glow: 'rgba(239,68,68,0.08)',
  },
}

// Category word for temperature bar (lowercase)
export const CATEGORY_WORD: Record<Category, string> = {
  ganador: 'ganador',
  potencial: 'potencial',
  bueno: 'bueno',
  regular: 'regular',
  malo: 'apagar',
}
