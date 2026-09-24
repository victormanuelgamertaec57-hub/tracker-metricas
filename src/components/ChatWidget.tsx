import { useEffect, useRef, useState } from 'react'
import type { ChatComparison, Creative } from '../types'
import {
  SUGGESTED_QUESTIONS,
  buildComparisonView,
  loadChatHistory,
  saveChatHistory,
  sendChat,
  type ChatMessage,
} from '../lib/chat'
import { scoreColor } from '../lib/analysisVisuals'
import { TargetBar } from './TargetBar'

const PANEL_ID = 'chat-tracker'

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function Comparison({ comparison, creatives }: { comparison: ChatComparison; creatives: Creative[] }) {
  const view = buildComparisonView(comparison, creatives)
  if (!view) return null
  return (
    <div className="rounded-lg p-3 mt-2" style={{ background: 'var(--bg-base)', border: '1px solid var(--divider-soft)' }}>
      <p className="text-[11px] uppercase tracking-wide m-0 mb-2" style={{ color: 'var(--text-secondary)' }}>
        {view.titulo}
      </p>
      {view.rows.map((r) => (
        <TargetBar
          key={r.creativeId}
          label={r.label}
          value={r.value}
          target={r.target}
          decimals={view.decimals}
          unit={view.unit}
          scaleMax={view.scaleMax}
          stackLabel
          color={view.metrica === 'score' && r.value !== null ? scoreColor(r.value) : undefined}
        />
      ))}
    </div>
  )
}

function Bubble({ m, creatives }: { m: ChatMessage; creatives: Creative[] }) {
  const mine = m.role === 'user'
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} mb-2.5`}>
      <div
        className="rounded-xl px-3 py-2 text-[12px] leading-relaxed max-w-[88%] min-w-0 break-words whitespace-pre-wrap"
        style={
          mine
            ? { background: 'var(--accent)', color: 'var(--accent-dark)' }
            : { background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--divider-soft)' }
        }
      >
        {m.text}
        {!mine && m.comparaciones?.map((c, i) => <Comparison key={i} comparison={c} creatives={creatives} />)}
      </div>
    </div>
  )
}

/** Chat flotante en la esquina inferior derecha, disponible en todas las pantallas. */
export function ChatWidget({ creatives }: { creatives: Creative[] }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(loadChatHistory)
  const [input, setInput] = useState('')
  // Pregunta en curso (se muestra mientras llega la respuesta).
  const [pendingText, setPendingText] = useState<string | null>(null)
  const pending = pendingText !== null
  // Pregunta que falló: se muestra con "Reintentar" y no se guarda en el historial.
  const [failed, setFailed] = useState<{ text: string; error: string } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Evita dos envíos si se hace doble clic antes de que React repinte.
  const sendingRef = useRef(false)

  useEffect(() => {
    saveChatHistory(messages)
  }, [messages])

  useEffect(() => {
    if (!open) return
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [open, messages, pending, failed])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function ask(text: string) {
    const question = text.trim()
    if (!question || sendingRef.current) return
    sendingRef.current = true
    setPendingText(question)
    setFailed(null)
    setInput('')
    // El historial que ve el servidor es el guardado; la pregunta nueva va aparte.
    const history = messages
    try {
      const reply = await sendChat(question, history, creatives)
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: 'user', text: question },
        { id: newId(), role: 'assistant', text: reply.respuesta, comparaciones: reply.comparaciones },
      ])
    } catch (err) {
      setFailed({ text: question, error: err instanceof Error ? err.message : 'No se pudo obtener respuesta.' })
    } finally {
      sendingRef.current = false
      setPendingText(null)
    }
  }

  function clearConversation() {
    setMessages([])
    setFailed(null)
  }

  const showSuggestions = messages.length === 0 && !pending && !failed

  return (
    <>
      {open && (
        <div
          id={PANEL_ID}
          role="dialog"
          aria-label="Chat del tracker"
          // dvh sigue a la barra del navegador y al teclado en iOS; vh queda de respaldo.
          className="fixed z-40 right-4 left-4 bottom-20 sm:left-auto sm:w-[380px] flex flex-col rounded-2xl overflow-hidden shadow-2xl max-h-[min(560px,calc(100vh-7rem))] supports-[height:100dvh]:max-h-[min(560px,calc(100dvh-7rem))]"
          style={{
            background: 'var(--bg-base)',
            border: '1px solid var(--divider-strong)',
          }}
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--divider-soft)' }}>
            <p className="text-[13px] font-semibold m-0 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <i className="ti ti-sparkles" style={{ color: 'var(--accent)' }} />
              Pregúntale al tracker
            </p>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  className="bg-transparent border-none cursor-pointer rounded p-1.5 hover:opacity-80"
                  style={{ color: 'var(--text-secondary)' }}
                  onClick={clearConversation}
                  disabled={pending}
                  aria-label="Borrar conversación"
                  title="Borrar conversación"
                >
                  <i className="ti ti-trash text-[15px]" />
                </button>
              )}
              <button
                className="bg-transparent border-none cursor-pointer rounded p-1.5 hover:opacity-80"
                style={{ color: 'var(--text-secondary)' }}
                onClick={() => {
                  setOpen(false)
                  buttonRef.current?.focus()
                }}
                aria-label="Cerrar chat"
              >
                <i className="ti ti-x text-[15px]" />
              </button>
            </div>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 min-h-[160px]" aria-live="polite">
            {messages.length === 0 && (
              <p className="text-[12px] m-0 mb-3 px-1" style={{ color: 'var(--text-secondary)' }}>
                Pregunta sobre tus creativos: cuál rinde mejor, cómo van contra el objetivo de su nicho o qué alertas hay.
              </p>
            )}
            {messages.map((m) => (
              <Bubble key={m.id} m={m} creatives={creatives} />
            ))}
            {(pending || failed) && (
              <div className="flex justify-end mb-2.5">
                <div
                  className="rounded-xl px-3 py-2 text-[12px] leading-relaxed max-w-[88%] break-words whitespace-pre-wrap"
                  style={{ background: 'var(--accent)', color: 'var(--accent-dark)', opacity: 0.75 }}
                >
                  {pendingText ?? failed?.text}
                </div>
              </div>
            )}
            {pending && (
              <p className="text-[12px] m-0 px-1 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                <i className="ti ti-loader-2 animate-spin" />
                Pensando…
              </p>
            )}
            {failed && !pending && (
              <div
                role="alert"
                className="rounded-xl p-3 text-[12px]"
                style={{
                  background: 'color-mix(in srgb, var(--cat-apagar) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--cat-apagar) 35%, transparent)',
                  color: 'var(--text-primary)',
                }}
              >
                <p className="m-0 mb-2 flex items-start gap-1.5">
                  <i className="ti ti-circle-x mt-[2px]" style={{ color: 'var(--cat-apagar)' }} />
                  <span className="break-words min-w-0">{failed.error}</span>
                </p>
                <button
                  className="flex items-center gap-1.5 text-[12px] border-none rounded-md px-3 py-1.5 cursor-pointer hover:brightness-110"
                  style={{ background: 'var(--accent)', color: 'var(--accent-dark)' }}
                  onClick={() => ask(failed.text)}
                >
                  <i className="ti ti-refresh" />
                  Reintentar
                </button>
              </div>
            )}
          </div>

          {showSuggestions && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q.label}
                  className="rounded-full px-3 py-1 text-[11px] cursor-pointer hover:brightness-125"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--divider-strong)', color: 'var(--text-primary)' }}
                  onClick={() => ask(q.text)}
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}

          <form
            className="flex items-end gap-2 px-3 py-3"
            style={{ borderTop: '1px solid var(--divider-soft)' }}
            onSubmit={(e) => {
              e.preventDefault()
              void ask(input)
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              maxLength={1000}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void ask(input)
                }
              }}
              placeholder="Escribe tu pregunta…"
              aria-label="Pregunta"
              disabled={pending}
              className="flex-1 min-w-0 resize-none rounded-lg px-3 py-2 text-[12px] outline-none max-h-24"
              style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--divider-strong)' }}
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              className="text-[12px] font-medium border-none rounded-lg px-3 py-2 cursor-pointer hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--accent)', color: 'var(--accent-dark)' }}
            >
              Enviar
            </button>
          </form>
        </div>
      )}

      <button
        ref={buttonRef}
        className="fixed z-40 bottom-4 right-4 w-12 h-12 rounded-full border-none cursor-pointer flex items-center justify-center shadow-lg hover:brightness-110"
        style={{ background: 'var(--accent)', color: 'var(--accent-dark)' }}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Cerrar chat' : 'Abrir chat del tracker'}
        aria-expanded={open}
        aria-controls={PANEL_ID}
      >
        <i className={`ti ${open ? 'ti-x' : 'ti-sparkles'} text-[22px]`} />
      </button>
    </>
  )
}
