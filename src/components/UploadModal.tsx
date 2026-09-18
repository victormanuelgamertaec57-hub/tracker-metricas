import { useState, useEffect } from 'react'
import type { Creative, Format, RawMetrics } from '../types'
import { fetchMetaLevel, syncCreativeWithMeta, APP_SECRET, authenticateVideoUrl, type MetaEntity, type MetaLevel } from '../lib/meta'

const NICHES = ['Berrinches', 'Método Hormonal', 'CalistenIA', 'Tai Chi']
const FORMATS: Format[] = ['9:16', '1:1', '4:5', '16:9']
const MAX_VIDEO_SIZE_MB = 100
const CHUNK_SIZE_MB = 4 // 4MB por chunk para caber en el límite de 6MB de Netlify
const MAX_RETRIES = 3

/**
 * Intenta inferir el nicho a partir del nombre de la campaña de Meta.
 */
function detectNicheFromName(campaignName: string): string | null {
  const lower = campaignName.toLowerCase()
  if (lower.includes('berrinch')) return 'Berrinches'
  if (lower.includes('hormonal')) return 'Método Hormonal'
  if (lower.includes('calisten')) return 'CalistenIA'
  if (lower.includes('tai chi') || lower.includes('taichi')) return 'Tai Chi'
  return null
}

type LoadingMap = Partial<Record<MetaLevel, boolean>>
type ErrorMap = Partial<Record<MetaLevel, string | null>>

/**
 * Genera un thumbnail (data URL) desde un archivo de video
 */
async function generateThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    
    video.onloadeddata = () => {
      // Seek to 0.1s para capturar el primer frame real
      video.currentTime = 0.1
    }
    
    video.onseeked = () => {
      if (!ctx) {
        reject(new Error('No se pudo obtener contexto del canvas'))
        return
      }
      
      // Ajustar canvas al tamaño del video (max 640px de ancho para thumbnails)
      const maxWidth = 640
      const ratio = Math.min(1, maxWidth / video.videoWidth)
      canvas.width = video.videoWidth * ratio
      canvas.height = video.videoHeight * ratio
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
      
      URL.revokeObjectURL(video.src)
      resolve(dataUrl)
    }
    
    video.onerror = () => {
      URL.revokeObjectURL(video.src)
      reject(new Error('Error al cargar el video para generar thumbnail'))
    }
    
    video.src = URL.createObjectURL(file)
  })
}

/**
 * Convierte un chunk (Blob) a base64
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Sube un chunk individual con reintentos
 * Devuelve { videoUrl } solo si es el último chunk
 */
async function uploadChunk(
  uploadId: string,
  chunk: Blob,
  chunkNumber: number,
  totalChunks: number,
  filename: string,
  contentType: string,
  retries = MAX_RETRIES
): Promise<{ videoUrl?: string; error?: string }> {
  const base64 = await blobToBase64(chunk)
  const isLastChunk = chunkNumber === totalChunks - 1
  
  let lastError: Error | null = null
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch('/.netlify/functions/upload-video-chunk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(APP_SECRET ? { 'x-app-secret': APP_SECRET } : {}),
        },
        body: JSON.stringify({
          uploadId,
          chunkNumber,
          totalChunks,
          chunk: base64,
          filename,
          contentType,
        }),
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || data.message || 'Error al subir chunk')
      }
      
      // Si es el último chunk, devuelve la URL del video reensamblado
      if (isLastChunk && data.videoUrl) {
        return { videoUrl: data.videoUrl }
      }
      
      return {} // Éxito (chunk regular o mensaje intermedio)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn(`Chunk ${chunkNumber + 1} - intento ${attempt} falló:`, lastError.message)
      
      if (attempt < retries) {
        // Esperar antes de reintentar (backoff exponencial)
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)))
      }
    }
  }
  
  throw lastError || new Error(`Falló la subida del chunk ${chunkNumber + 1} después de ${retries} intentos`)
}

/**
 * Sube un video en chunks a Netlify Blobs y devuelve la URL
 * Implementa retry automático para conexiones lentas
 */
async function uploadVideo(
  file: File,
  onProgress?: (progress: number, currentChunk: number, totalChunks: number) => void
): Promise<{ videoUrl: string }> {
  const chunkSizeBytes = CHUNK_SIZE_MB * 1024 * 1024
  const totalChunks = Math.ceil(file.size / chunkSizeBytes)
  const uploadId = crypto.randomUUID()
  
  // Generar chunks
  const chunks: { blob: Blob; start: number; end: number }[] = []
  let offset = 0
  
  while (offset < file.size) {
    const start = offset
    const end = Math.min(offset + chunkSizeBytes, file.size)
    chunks.push({
      blob: file.slice(start, end),
      start,
      end,
    })
    offset = end
  }
  
  console.log(`Iniciando subida de ${totalChunks} chunks (${CHUNK_SIZE_MB}MB c/u) para ${file.name}`)
  
  // Subir cada chunk secuencialmente
  let finalVideoUrl: string | null = null
  
  for (let i = 0; i < chunks.length; i++) {
    const progress = ((i + 1) / totalChunks) * 100
    onProgress?.(progress, i + 1, totalChunks)
    
    const result = await uploadChunk(
      uploadId,
      chunks[i].blob,
      i,
      totalChunks,
      file.name,
      file.type
    )
    
    // El último chunk devuelve la URL final
    if (result.videoUrl) {
      finalVideoUrl = result.videoUrl
    }
    
    console.log(`Chunk ${i + 1}/${totalChunks} subido`)
  }
  
  if (!finalVideoUrl) {
    throw new Error('No se recibió la URL del video después de subir todos los chunks')
  }
  
  onProgress?.(100, totalChunks, totalChunks)
  return { videoUrl: finalVideoUrl }
}

export function UploadModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (c: Creative) => void
}) {
  const [name, setName] = useState('')
  const [niche, setNiche] = useState(NICHES[0])
  const [nicheAutoDetected, setNicheAutoDetected] = useState(false)
  const [format, setFormat] = useState<Format>('9:16')
  const [spend, setSpend] = useState('')
  const [impressions, setImpressions] = useState('')
  const [linkClicks, setLinkClicks] = useState('')
  const [videoPlays, setVideoPlays] = useState('')
  const [hookViews, setHookViews] = useState('')
  const [holdViews, setHoldViews] = useState('')
  const [purchases, setPurchases] = useState('')
  const [revenue, setRevenue] = useState('')
  const [frequency, setFrequency] = useState('')

  // Cascade state
  const [accounts, setAccounts] = useState<MetaEntity[]>([])
  const [campaigns, setCampaigns] = useState<MetaEntity[]>([])
  const [adsets, setAdsets] = useState<MetaEntity[]>([])
  const [ads, setAds] = useState<MetaEntity[]>([])

  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const [selectedAdsetId, setSelectedAdsetId] = useState('')
  const [selectedAdId, setSelectedAdId] = useState('')

  const [loading, setLoading] = useState<LoadingMap>({})
  const [errors, setErrors] = useState<ErrorMap>({})

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  // Video upload state
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [uploadChunkInfo, setUploadChunkInfo] = useState<{ current: number; total: number } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // 1. Carga las cuentas al abrir el modal
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading((s) => ({ ...s, accounts: true }))
      setErrors((s) => ({ ...s, accounts: null }))
      try {
        const items = await fetchMetaLevel('accounts')
        if (!cancelled) setAccounts(items)
      } catch (err) {
        if (!cancelled) {
          setErrors((s) => ({
            ...s,
            accounts: err instanceof Error ? err.message : 'Error desconocido',
          }))
        }
      } finally {
        if (!cancelled) setLoading((s) => ({ ...s, accounts: false }))
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // 2. Cuando elige cuenta → carga campañas
  useEffect(() => {
    if (!selectedAccountId) {
      setCampaigns([])
      return
    }
    let cancelled = false
    async function load() {
      setLoading((s) => ({ ...s, campaigns: true }))
      setErrors((s) => ({ ...s, campaigns: null }))
      try {
        const items = await fetchMetaLevel('campaigns', selectedAccountId)
        if (!cancelled) setCampaigns(items)
      } catch (err) {
        if (!cancelled) {
          setErrors((s) => ({
            ...s,
            campaigns: err instanceof Error ? err.message : 'Error desconocido',
          }))
        }
      } finally {
        if (!cancelled) setLoading((s) => ({ ...s, campaigns: false }))
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  // 3. Cuando elige campaña → carga conjuntos
  useEffect(() => {
    if (!selectedCampaignId) {
      setAdsets([])
      return
    }
    let cancelled = false
    async function load() {
      setLoading((s) => ({ ...s, adsets: true }))
      setErrors((s) => ({ ...s, adsets: null }))
      try {
        const items = await fetchMetaLevel('adsets', selectedCampaignId)
        if (!cancelled) setAdsets(items)
      } catch (err) {
        if (!cancelled) {
          setErrors((s) => ({
            ...s,
            adsets: err instanceof Error ? err.message : 'Error desconocido',
          }))
        }
      } finally {
        if (!cancelled) setLoading((s) => ({ ...s, adsets: false }))
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedCampaignId])

  // 4. Cuando elige conjunto → carga anuncios
  useEffect(() => {
    if (!selectedAdsetId) {
      setAds([])
      return
    }
    let cancelled = false
    async function load() {
      setLoading((s) => ({ ...s, ads: true }))
      setErrors((s) => ({ ...s, ads: null }))
      try {
        const items = await fetchMetaLevel('ads', selectedAdsetId)
        if (!cancelled) setAds(items)
      } catch (err) {
        if (!cancelled) {
          setErrors((s) => ({
            ...s,
            ads: err instanceof Error ? err.message : 'Error desconocido',
          }))
        }
      } finally {
        if (!cancelled) setLoading((s) => ({ ...s, ads: false }))
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedAdsetId])

  function onSelectAccount(id: string) {
    setSelectedAccountId(id)
    setSelectedCampaignId('')
    setSelectedAdsetId('')
    setSelectedAdId('')
    setCampaigns([])
    setAdsets([])
    setAds([])
  }

  function onSelectCampaign(id: string) {
    setSelectedCampaignId(id)
    setSelectedAdsetId('')
    setSelectedAdId('')
    setAdsets([])
    setAds([])

    const campaign = campaigns.find((c) => c.id === id)
    if (campaign) {
      const detected = detectNicheFromName(campaign.name)
      if (detected) {
        setNiche(detected)
        setNicheAutoDetected(true)
      }
    }
  }

  function onSelectAdset(id: string) {
    setSelectedAdsetId(id)
    setSelectedAdId('')
    setAds([])
  }

  function onSelectAd(id: string) {
    setSelectedAdId(id)
    if (!name) {
      const ad = ads.find((a) => a.id === id)
      if (ad) setName(ad.name)
    }
  }

  // Procesar archivo de video (compartido entre click y drag-and-drop)
  async function processVideoFile(file: File) {
    // Validar tipo
    if (!file.type.startsWith('video/')) {
      setUploadError('Selecciona un archivo de video válido')
      return
    }
    
    // Validar tamaño
    const sizeMB = file.size / (1024 * 1024)
    if (sizeMB > MAX_VIDEO_SIZE_MB) {
      setUploadError(`El video es muy pesado (${sizeMB.toFixed(1)}MB). Máximo: ${MAX_VIDEO_SIZE_MB}MB.`)
      return
    }
    
    setVideoFile(file)
    setUploadError(null)
    setIsUploading(true)
    setUploadProgress(0)
    setUploadChunkInfo(null)
    
    try {
      // Generar thumbnail localmente
      const thumbnail = await generateThumbnail(file)
      setThumbnailUrl(thumbnail)
      setUploadProgress(10)
      
      // Subir video en chunks
      const { videoUrl: url } = await uploadVideo(file, (progress, currentChunk, totalChunks) => {
        // La subida va del 10% al 100%
        const uploadProgress = 10 + (progress * 0.9)
        setUploadProgress(uploadProgress)
        setUploadChunkInfo({ current: currentChunk, total: totalChunks })
      })
      
      setVideoUrl(authenticateVideoUrl(url))
      setUploadProgress(100)
      setUploadChunkInfo(null)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Error al procesar el video')
      setVideoFile(null)
      setUploadChunkInfo(null)
    } finally {
      setIsUploading(false)
    }
  }

  // Manejar selección de archivo de video por click
  function handleVideoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    processVideoFile(file)
    // Permite volver a seleccionar el mismo archivo si fue eliminado
    e.target.value = ''
  }

  // Handlers para drag-and-drop
  function handleDragOver(e: React.DragEvent<HTMLElement>) {
    e.preventDefault()
    e.stopPropagation()
    if (!isDragging) {
      setIsDragging(true)
    }
  }

  function handleDragLeave(e: React.DragEvent<HTMLElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent<HTMLElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    processVideoFile(file)
  }
  
  function removeVideo() {
    setVideoFile(null)
    setVideoUrl(null)
    setThumbnailUrl(null)
    setUploadProgress(0)
    setUploadChunkInfo(null)
    setUploadError(null)
  }

  const num = (v: string) => Number(v) || 0

  function fillFromMetrics(m: RawMetrics) {
    setSpend(String(Math.round(m.spend)))
    setImpressions(String(m.impressions))
    setLinkClicks(String(m.linkClicks))
    setVideoPlays(String(m.videoPlays))
    setHookViews(String(m.hookViews))
    setHoldViews(String(m.holdViews))
    setPurchases(String(m.purchases))
    setRevenue(String(Math.round(m.revenue)))
    setFrequency(String(m.frequency.toFixed(1)))
  }

  async function handleSync() {
    if (!selectedAdId) return
    setSyncing(true)
    setSyncMessage(null)
    try {
      const { metrics } = await syncCreativeWithMeta(selectedAdId)
      fillFromMetrics(metrics)
      setSyncMessage('✓ Métricas cargadas desde Meta Ads')
    } catch (err) {
      setSyncMessage(`✕ ${err instanceof Error ? err.message : 'Error al sincronizar'}`)
    } finally {
      setSyncing(false)
    }
  }

  function handleSave() {
    if (!name.trim()) return
    const creative: Creative = {
      id: crypto.randomUUID(),
      name: name.trim(),
      niche,
      format,
      launchDate: new Date().toISOString().slice(0, 10),
      metaAdId: selectedAdId || undefined,
      videoUrl: videoUrl || undefined,
      thumbnailUrl: thumbnailUrl || undefined,
      metrics: {
        spend: num(spend),
        impressions: num(impressions),
        clicks: num(linkClicks),
        linkClicks: num(linkClicks),
        videoPlays: num(videoPlays),
        hookViews: num(hookViews),
        holdViews: num(holdViews),
        purchases: num(purchases),
        revenue: num(revenue),
        avgWatchTime: 0,
        frequency: num(frequency),
        retention25: 0,
        retention50: 0,
        retention75: 0,
        retention95: 0,
        history: [],
      },
    }
    onSave(creative)
  }

  return (
    <div 
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl p-4 sm:p-6 w-full max-w-lg sm:max-w-md max-h-[90vh] overflow-y-auto"
        style={{ 
          background: 'var(--bg-surface)',
          border: '1px solid var(--divider-strong)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-[15px] font-medium m-0" style={{ color: 'var(--text-primary)' }}>Nuevo creativo</p>
          <button
            className="bg-transparent border-none cursor-pointer hover:opacity-70 transition-opacity"
            style={{ color: 'var(--text-secondary)' }}
            onClick={onClose}
            aria-label="Cerrar"
          >
            <i className="ti ti-x text-[18px]" />
          </button>
        </div>

        <div 
          className="rounded-lg p-3 mb-4 text-[11px] flex items-start gap-2"
          style={{ 
            background: 'var(--bg-base)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--divider-soft)'
          }}
        >
          <i className="ti ti-info-circle text-[14px] mt-0.5 shrink-0" />
          <span>
            Selecciona cuenta → campaña → conjunto → anuncio de Meta y sincroniza con un click.
            También puedes cargarlas a mano.
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Nombre del creativo">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hook-Culpa-04" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nicho">
              <select
                value={niche}
                onChange={(e) => {
                  setNiche(e.target.value)
                  setNicheAutoDetected(false)
                }}
              >
                {NICHES.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              {nicheAutoDetected && (
                <span className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--cat-ganador)' }}>
                  <i className="ti ti-sparkles text-[11px]" />
                  Autodetectado del nombre de campaña
                </span>
              )}
            </Field>
            <Field label="Formato">
              <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                {FORMATS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Video upload section */}
          <Field label="Video del creativo">
            {videoFile ? (
              <div className="relative rounded-lg overflow-hidden" style={{ background: 'var(--bg-base)' }}>
                {/* Thumbnail preview */}
                {thumbnailUrl && (
                  <div className="relative" style={{ aspectRatio: '16/9' }}>
                    <img 
                      src={thumbnailUrl} 
                      alt="Preview" 
                      className="w-full h-full object-cover"
                    />
                    {/* Play icon overlay */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <i className="ti ti-player-play text-white text-xl" />
                      </div>
                    </div>
                    {/* Upload progress overlay */}
                    {isUploading && (
                      <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
                        <div className="w-24 h-2 bg-white/20 rounded-full overflow-hidden">
                          <div 
                            className="h-full rounded-full transition-all duration-300"
                            style={{ 
                              width: `${uploadProgress}%`,
                              background: 'var(--accent)',
                            }}
                          />
                        </div>
                        {uploadChunkInfo ? (
                          <span className="text-white text-xs">
                            Subiendo... {uploadChunkInfo.current}/{uploadChunkInfo.total} partes
                          </span>
                        ) : (
                          <span className="text-white text-xs">Procesando...</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {/* Video info */}
                {!isUploading && (
                  <div className="p-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <i className="ti ti-video text-[var(--accent)]" />
                      <span className="text-[11px] truncate max-w-[150px]" style={{ color: 'var(--text-secondary)' }}>
                        {videoFile.name}
                      </span>
                    </div>
                    <button
                      onClick={removeVideo}
                      className="p-1 rounded hover:bg-white/10 transition-colors"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <i className="ti ti-x text-[14px]" />
                    </button>
                  </div>
                )}
                {uploadError && (
                  <p className="text-[10px] p-2" style={{ color: 'var(--cat-apagar)' }}>
                    {uploadError}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label 
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className="flex flex-col items-center justify-center gap-2 rounded-lg cursor-pointer py-6 transition-all duration-200"
                  style={{ 
                    background: isDragging ? 'rgba(56, 189, 248, 0.08)' : 'var(--bg-base)',
                    border: isDragging ? '1px dashed var(--accent)' : '1px dashed var(--divider-strong)',
                    boxShadow: isDragging ? '0 0 16px var(--accent-glow)' : 'none',
                  }}
                >
                  <i 
                    className="ti ti-upload text-[24px] transition-colors duration-200" 
                    style={{ color: isDragging ? 'var(--accent)' : 'var(--text-muted)' }} 
                  />
                  <span 
                    className="text-[11px] transition-colors duration-200" 
                    style={{ color: isDragging ? 'var(--accent)' : 'var(--text-muted)' }}
                  >
                    {isDragging ? 'Suelta el video aquí' : `Subir video (máx. ${MAX_VIDEO_SIZE_MB}MB, se sube en partes)`}
                  </span>
                  <input 
                    type="file" 
                    accept="video/*" 
                    className="hidden"
                    onChange={handleVideoSelect}
                  />
                </label>
                {uploadError && (
                  <p className="text-[10px] p-2 mt-1" style={{ color: 'var(--cat-apagar)' }}>
                    {uploadError}
                  </p>
                )}
              </div>
            )}
          </Field>

          {/* Cascada de selección Meta Ads */}
          <div 
            className="rounded-lg p-3"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--divider-soft)' }}
          >
            <p className="text-[11px] m-0 mb-3" style={{ color: 'var(--text-secondary)' }}>Vincular a anuncio de Meta Ads</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <CascadeSelect
                label="1. Cuenta"
                value={selectedAccountId}
                options={accounts}
                loading={!!loading.accounts}
                error={errors.accounts}
                onChange={onSelectAccount}
              />
              <CascadeSelect
                label="2. Campaña"
                value={selectedCampaignId}
                options={campaigns}
                loading={!!loading.campaigns}
                error={errors.campaigns}
                onChange={onSelectCampaign}
                disabled={!selectedAccountId}
                placeholder="— Elige cuenta primero —"
              />
              <CascadeSelect
                label="3. Conjunto"
                value={selectedAdsetId}
                options={adsets}
                loading={!!loading.adsets}
                error={errors.adsets}
                onChange={onSelectAdset}
                disabled={!selectedCampaignId}
                placeholder="— Elige campaña primero —"
              />
              <CascadeSelect
                label="4. Anuncio"
                value={selectedAdId}
                options={ads}
                loading={!!loading.ads}
                error={errors.ads}
                onChange={onSelectAd}
                disabled={!selectedAdsetId}
                placeholder="— Elige conjunto primero —"
              />
            </div>

            {selectedAdId && (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="w-full mt-3 text-white border-none py-1.5 rounded-md text-[12px] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--cat-potencial)' }}
              >
                <i className={`ti ${syncing ? 'ti-loader-2 animate-spin' : 'ti-refresh'}`} />
                {syncing ? 'Sincronizando…' : 'Sincronizar con Meta Ads'}
              </button>
            )}

            {syncMessage && (
              <p
                className="text-[11px] mt-2 m-0 break-words"
                style={{ color: syncMessage.startsWith('✓') ? 'var(--cat-ganador)' : 'var(--cat-apagar)' }}
              >
                {syncMessage}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Gasto ($)"><input value={spend} onChange={(e) => setSpend(e.target.value)} type="number" /></Field>
            <Field label="Impresiones"><input value={impressions} onChange={(e) => setImpressions(e.target.value)} type="number" /></Field>
            <Field label="Clics al link"><input value={linkClicks} onChange={(e) => setLinkClicks(e.target.value)} type="number" /></Field>
            <Field label="Reproducciones de video"><input value={videoPlays} onChange={(e) => setVideoPlays(e.target.value)} type="number" /></Field>
            <Field label="Vistas >3s (hook)"><input value={hookViews} onChange={(e) => setHookViews(e.target.value)} type="number" /></Field>
            <Field label="Vistas >50% (hold)"><input value={holdViews} onChange={(e) => setHoldViews(e.target.value)} type="number" /></Field>
            <Field label="Compras"><input value={purchases} onChange={(e) => setPurchases(e.target.value)} type="number" /></Field>
            <Field label="Ingresos ($)"><input value={revenue} onChange={(e) => setRevenue(e.target.value)} type="number" /></Field>
            <Field label="Frecuencia"><input value={frequency} onChange={(e) => setFrequency(e.target.value)} type="number" step="0.1" /></Field>
          </div>
        </div>

        <button
          className="w-full mt-5 border-none py-2.5 rounded-lg font-medium cursor-pointer transition-all hover:brightness-110"
          style={{ background: 'var(--accent)', color: 'var(--accent-dark)', boxShadow: '0 0 12px var(--accent-glow)' }}
          onClick={handleSave}
        >
          Guardar creativo
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  )
}

function CascadeSelect({
  label,
  value,
  options,
  loading,
  error,
  disabled,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  options: MetaEntity[]
  loading: boolean
  error: string | null | undefined
  disabled?: boolean
  placeholder?: string
  onChange: (id: string) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      {error ? (
        <div 
          className="rounded-md px-2 py-1.5 text-[11px] break-words"
          style={{ 
            background: 'var(--bg-surface)', 
            border: '1px solid rgba(196,99,107,0.3)',
            color: 'var(--cat-apagar)'
          }}
        >
          {error}
        </div>
      ) : loading ? (
        <div 
          className="rounded-md px-2 py-1.5 text-[12px] flex items-center gap-1.5"
          style={{ 
            background: 'var(--bg-base)', 
            border: '1px solid var(--divider-strong)',
            color: 'var(--text-secondary)'
          }}
        >
          <i className="ti ti-loader-2 animate-spin" />
          Cargando…
        </div>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full"
        >
          <option value="">{placeholder || '— Selecciona —'}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.status ? ` (${o.status})` : ''}
            </option>
          ))}
        </select>
      )}
    </label>
  )
}
