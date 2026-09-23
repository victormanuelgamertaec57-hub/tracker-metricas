import type { ReactNode } from 'react'

// Paths shared by the two approved HTML references. Kept local to the detail UI.
const paths = {
  back: <path d="M15 18l-6-6 6-6" />,
  refresh: <><path d="M21 12a9 9 0 10-3.5 7.1" /><path d="M21 4v6h-6" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" /></>,
  warning: <path d="M12 9v4M12 17h.01M10.29 3.86l-8.18 14.18A2 2 0 004 21h16a2 2 0 001.89-2.96L13.71 3.86a2 2 0 00-3.42 0z" />,
  play: <path d="M8 5v14l11-7z" />,
  chart: <path d="M18 20V10M12 20V4M6 20v-6" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  hook: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  copy: <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />,
  check: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  external: <><path d="M15 3h6v6M10 14 21 3" /><path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5" /></>,
  'video-off': <><path d="m3 3 18 18M10 5h3a2 2 0 012 2v3l6-4v12l-6-4v3a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2" /></>,
  trend: <><path d="m3 17 6-6 4 4 8-10M15 5h6v6" /></>,
  bulb: <><path d="M9 18h6M9 21h6M8.1 14a6 6 0 117.8 0c-.6.5-.9 1.1-.9 2H9c0-.9-.3-1.5-.9-2z" /></>,
  sparkles: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3zM20 2v4M18 4h4" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 11v6M12 7h.01" /></>,
  close: <><circle cx="12" cy="12" r="10" /><path d="m9 9 6 6m0-6-6 6" /></>,
  film: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" /></>,
} satisfies Record<string, ReactNode>

export type DetailIconName = keyof typeof paths

export function DetailIcon({ name, size = 18, className }: { name: DetailIconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={name === 'play' ? 'currentColor' : 'none'}
      stroke={name === 'play' ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" className={className}>
      {paths[name]}
    </svg>
  )
}
