import { useCallback, useEffect, useRef, useState } from 'react'
import type { Creative, CreativeAIAnalysis } from '../types'
import { getAnalysis, startAnalysis, waitForAnalysis } from '../lib/analysis'

export type AnalysisPhase =
  | 'loading' // primer GET al abrir el detalle
  | 'idle' // nunca se analizó
  | 'processing'
  | 'done'
  | 'error' // el análisis terminó en error o no se pudo lanzar/consultar
  | 'stalled' // sigue en 'processing' más de lo normal

export interface CreativeAnalysisState {
  phase: AnalysisPhase
  analysis: CreativeAIAnalysis | null
  errorMessage: string | null
  processingSince: number | null // ms del navegador, para el cronómetro
  analyze: (force: boolean) => void
  keepWaiting: () => void
}

/**
 * Estado del análisis de IA de un creativo. Al montar consulta si ya hay un
 * análisis guardado (y retoma el sondeo si está en curso). El sondeo se
 * cancela al desmontar o al cambiar de creativo.
 */
export function useCreativeAnalysis(creative: Creative): CreativeAnalysisState {
  const [phase, setPhase] = useState<AnalysisPhase>('loading')
  const [analysis, setAnalysis] = useState<CreativeAIAnalysis | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [processingSince, setProcessingSince] = useState<number | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const creativeRef = useRef(creative)
  creativeRef.current = creative
  const analysisRef = useRef<CreativeAIAnalysis | null>(null)
  analysisRef.current = analysis
  // Evita lanzar dos análisis con un doble clic antes de que se re-renderice.
  const launchingRef = useRef(false)

  const poll = useCallback(async (baselineTimestamp: string | null) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setPhase('processing')
    setErrorMessage(null)
    setProcessingSince((prev) => prev ?? Date.now())

    const outcome = await waitForAnalysis({
      creativeId: creativeRef.current.id,
      baselineTimestamp,
      signal: controller.signal,
    })
    if (controller.signal.aborted) return

    switch (outcome.kind) {
      case 'done':
        setAnalysis(outcome.analysis)
        setPhase('done')
        setProcessingSince(null)
        break
      case 'error':
        setAnalysis(outcome.analysis)
        setErrorMessage(outcome.analysis.error || 'El análisis terminó con un error sin detalle.')
        setPhase('error')
        setProcessingSince(null)
        break
      case 'stalled':
        setAnalysis(outcome.analysis)
        setPhase('stalled')
        break
      case 'not_started':
        setErrorMessage(
          'El análisis no arrancó en el servidor. Revisa que el creativo tenga video, nicho y métricas, e inténtalo de nuevo.'
        )
        setPhase('error')
        setProcessingSince(null)
        break
      case 'fetch_error':
        setErrorMessage(`No se pudo consultar el estado del análisis: ${outcome.message}`)
        setPhase('error')
        setProcessingSince(null)
        break
      case 'aborted':
        break
    }
  }, [])

  // Al abrir el detalle (o cambiar de creativo): análisis guardado, si existe.
  useEffect(() => {
    let cancelled = false
    abortRef.current?.abort()
    setPhase('loading')
    setAnalysis(null)
    setErrorMessage(null)
    setProcessingSince(null)

    getAnalysis(creative.id)
      .then((saved) => {
        if (cancelled) return
        setAnalysis(saved)
        if (!saved) {
          setPhase('idle')
        } else if (saved.status === 'processing') {
          // Se retoma un análisis en curso (lanzado antes de salir del detalle).
          void poll(null)
        } else if (saved.status === 'error') {
          setErrorMessage(saved.error || 'El análisis terminó con un error sin detalle.')
          setPhase('error')
        } else {
          setPhase('done')
        }
      })
      .catch((err) => {
        if (cancelled) return
        setErrorMessage(err instanceof Error ? err.message : String(err))
        setPhase('error')
      })

    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [creative.id, poll])

  const analyze = useCallback(
    (force: boolean) => {
      if (launchingRef.current) return
      launchingRef.current = true
      setProcessingSince(Date.now())
      setPhase('processing')
      setErrorMessage(null)

      const run = async () => {
        const creativeNow = creativeRef.current
        let baseline = analysisRef.current?.timestamp ?? null
        if (!force) {
          // Si ya hay un análisis guardado (p. ej. lanzado desde otra pestaña),
          // se muestra ese en vez de lanzar otro: sin force el servidor lo
          // rechazaría en silencio y el sondeo tomaría el viejo como nuevo.
          const saved = await getAnalysis(creativeNow.id)
          if (creativeRef.current.id !== creativeNow.id) return
          if (saved) {
            setAnalysis(saved)
            if (saved.status === 'processing') return poll(null)
            if (saved.status === 'error') {
              setErrorMessage(saved.error || 'El análisis terminó con un error sin detalle.')
              setPhase('error')
            } else {
              setPhase('done')
            }
            setProcessingSince(null)
            return
          }
          baseline = null
        }
        await startAnalysis(creativeNow, force)
        if (creativeRef.current.id !== creativeNow.id) return
        await poll(baseline)
      }

      run()
        .catch((err) => {
          setErrorMessage(err instanceof Error ? err.message : String(err))
          setPhase('error')
          setProcessingSince(null)
        })
        .finally(() => {
          launchingRef.current = false
        })
    },
    [poll]
  )

  const keepWaiting = useCallback(() => {
    void poll(null)
  }, [poll])

  return { phase, analysis, errorMessage, processingSince, analyze, keepWaiting }
}
