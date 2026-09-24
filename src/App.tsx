import { useEffect, useState } from 'react'
import type { Creative } from './types'
import { mockCreatives } from './data/mockData'
import { Dashboard } from './components/Dashboard'
import { CreativeDetail } from './components/CreativeDetail'
import { UploadModal } from './components/UploadModal'
import { NicheSettings } from './components/NicheSettings'
import { ChatWidget } from './components/ChatWidget'
import { APP_SECRET } from './lib/meta'
import { videoKeyFromUrl } from './lib/analysis'

const STORAGE_KEY = 'tracker-metricas:creatives'

/**
 * Repara creativos guardados por versiones anteriores:
 * - `videoUrl` con `?token=` incrustado (el token se agrega al reproducir).
 * - `videoUrl` con esquema `blob:` (URL temporal, muerta tras recargar).
 */
function sanitizeCreative(raw: Creative): Creative {
  const c = legacyZerosToNull(raw)
  if (!c?.videoUrl) return c
  if (c.videoUrl.startsWith('blob:')) {
    const { videoUrl: _dropped, ...rest } = c
    return rest as Creative
  }
  if (c.videoUrl.includes('token=')) {
    try {
      const parsed = new URL(c.videoUrl, window.location.origin)
      parsed.searchParams.delete('token')
      return { ...c, videoUrl: `${parsed.pathname}${parsed.search}` }
    } catch {
      return c
    }
  }
  return c
}

/**
 * Versiones anteriores guardaban avgWatchTime y retención en 0 cuando no había
 * dato (el modal los fijaba en 0). Un 0 falso se lee como "nadie vio el video",
 * así que se convierte en null ("sin dato"). Retención con los cuatro cortes en
 * 0 no es un dato real.
 */
function legacyZerosToNull(c: Creative): Creative {
  const m = c?.metrics
  if (!m) return c
  const noRetention =
    m.retention25 === 0 && m.retention50 === 0 && m.retention75 === 0 && m.retention95 === 0
  if (m.avgWatchTime !== 0 && !noRetention) return c
  return {
    ...c,
    metrics: {
      ...m,
      avgWatchTime: m.avgWatchTime === 0 ? null : m.avgWatchTime,
      ...(noRetention
        ? { retention25: null, retention50: null, retention75: null, retention95: null }
        : {}),
    },
  }
}

function loadInitial(): Creative[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.map(sanitizeCreative)
    }
  } catch {
    // ignorar y usar mock
  }
  return mockCreatives
}

type View = 'dashboard' | 'detail' | 'settings'

export default function App() {
  const [creatives, setCreatives] = useState<Creative[]>(loadInitial)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [view, setView] = useState<View>('dashboard')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creatives))
  }, [creatives])

  const openCreative = creatives.find((c) => c.id === openId) ?? null

  async function handleDelete(id: string) {
    const creative = creatives.find((c) => c.id === id)
    
    // Si tiene video, eliminarlo de Netlify Blobs
    if (creative?.videoUrl) {
      try {
        const key = videoKeyFromUrl(creative.videoUrl)
        if (key) {
          await fetch('/.netlify/functions/delete-video', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(APP_SECRET ? { 'x-app-secret': APP_SECRET } : {}),
            },
            body: JSON.stringify({ key }),
          })
          console.log(`Video eliminado: ${key}`)
        }
      } catch (err) {
        console.error('Error eliminando video:', err)
      }
    }
    
    // Eliminar el creativo del estado
    setCreatives((prev) => prev.filter((c) => c.id !== id))
    
    // Si estamos viendo el detalle del creativo eliminado, volver al dashboard
    if (openId === id) {
      setOpenId(null)
      setView('dashboard')
    }
  }

  // ChatWidget va fuera del condicional: si cambiara de posición en el árbol,
  // React lo desmontaría al ir a Ajustes y se perdería la respuesta en curso.
  return (
    <>
      {view === 'settings' ? (
        <NicheSettings onClose={() => setView('dashboard')} />
      ) : (
        <div className={openCreative ? 'creative-detail-shell' : 'dashboard-shell'}>
          <div className={openCreative ? 'creative-detail-container' : 'dashboard-container'}>
            {openCreative ? (
              <CreativeDetail
                creative={openCreative}
                onBack={() => setOpenId(null)}
                onSync={(updated) => {
                  setCreatives((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
                }}
                onDelete={() => handleDelete(openCreative.id)}
              />
            ) : (
              <Dashboard
                creatives={creatives}
                onOpen={(id) => {
                  setOpenId(id)
                  setView('detail')
                }}
                onAddNew={() => setShowUpload(true)}
                onOpenSettings={() => setView('settings')}
                onDelete={handleDelete}
              />
            )}
          </div>

          {showUpload && (
            <UploadModal
              onClose={() => setShowUpload(false)}
              onSave={(c) => {
                setCreatives((prev) => [c, ...prev])
                setShowUpload(false)
              }}
            />
          )}
        </div>
      )}
      <ChatWidget creatives={creatives} />
    </>
  )
}
