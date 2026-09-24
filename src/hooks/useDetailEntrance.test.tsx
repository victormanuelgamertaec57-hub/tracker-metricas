import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDetailEntrance } from './useDetailEntrance'

let host: HTMLDivElement
let root: Root | undefined
let frames: Map<number, FrameRequestCallback>
let nextFrameId: number
let preference: MediaQueryList
let preferenceEvents: EventTarget
let renders: { id: string; progress: number }[]

function Probe({ id }: { id: string }) {
  const progress = useDetailEntrance(id)
  renders.push({ id, progress })
  return <output>{progress}</output>
}

function render(id = 'creative-a') {
  act(() => root!.render(<Probe id={id} />))
}

function advanceFrame(timestamp: number) {
  // New requests belong to the next browser frame, never this snapshot.
  const pending = [...frames.entries()]
  frames.clear()
  act(() => pending.forEach(([, callback]) => callback(timestamp)))
}

function progress() {
  return Number(host.querySelector('output')!.textContent)
}

function setReducedMotion(matches: boolean) {
  Object.defineProperty(preference, 'matches', { configurable: true, value: matches })
  act(() => preferenceEvents.dispatchEvent(new Event('change')))
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  frames = new Map()
  nextFrameId = 0
  renders = []
  preferenceEvents = new EventTarget()
  preference = {
    matches: false,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(preferenceEvents.addEventListener.bind(preferenceEvents)),
    removeEventListener: vi.fn(preferenceEvents.removeEventListener.bind(preferenceEvents)),
    dispatchEvent: preferenceEvents.dispatchEvent.bind(preferenceEvents),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  } as MediaQueryList
  vi.stubGlobal('matchMedia', vi.fn(() => preference))
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextFrameId
    frames.set(id, callback)
    return id
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root?.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('useDetailEntrance', () => {
  it('uses one pending frame and cubic ease-out over 1200 ms, then stops scheduling', () => {
    render()
    expect(progress()).toBe(0)
    expect(frames.size).toBe(1)

    advanceFrame(100)
    expect(progress()).toBe(0)
    expect(frames.size).toBe(1)
    advanceFrame(400)
    expect(progress()).toBeCloseTo(0.578125)
    expect(frames.size).toBe(1)
    advanceFrame(700)
    expect(progress()).toBeCloseTo(0.875)
    expect(frames.size).toBe(1)
    advanceFrame(1300)
    expect(progress()).toBe(1)
    expect(frames.size).toBe(0)

    const requestsAtCompletion = vi.mocked(requestAnimationFrame).mock.calls.length
    advanceFrame(2500)
    render()
    expect(progress()).toBe(1)
    expect(frames.size).toBe(0)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(requestsAtCompletion)
  })

  it('cancels the pending frame and removes the preference listener on unmount', () => {
    render()
    advanceFrame(0)
    const pendingId = [...frames.keys()][0]
    const listener = vi.mocked(preference.addEventListener).mock.calls[0][1]

    act(() => root!.unmount())
    root = undefined
    expect(cancelAnimationFrame).toHaveBeenCalledWith(pendingId)
    expect(frames.size).toBe(0)
    expect(preference.removeEventListener).toHaveBeenCalledWith('change', listener)
    const renderCount = renders.length
    advanceFrame(1200)
    setReducedMotion(true)
    expect(renders).toHaveLength(renderCount)
  })

  it('cancels the previous creative and starts the next at zero with a fresh clock', () => {
    render()
    advanceFrame(0)
    advanceFrame(600)
    expect(progress()).toBeCloseTo(0.875)
    const previousFrameId = [...frames.keys()][0]
    const previousListener = vi.mocked(preference.addEventListener).mock.calls[0][1]

    render('creative-b')
    expect(cancelAnimationFrame).toHaveBeenCalledWith(previousFrameId)
    expect(preference.removeEventListener).toHaveBeenCalledWith('change', previousListener)
    expect(frames.has(previousFrameId)).toBe(false)
    expect(frames.size).toBe(1)
    expect(progress()).toBe(0)
    expect(renders.filter(({ id }) => id === 'creative-b').every(({ progress: value }) => value === 0)).toBe(true)

    advanceFrame(2000)
    expect(progress()).toBe(0)
    advanceFrame(2600)
    expect(progress()).toBeCloseTo(0.875)
    advanceFrame(3200)
    expect(progress()).toBe(1)
    expect(frames.size).toBe(0)
  })

  it('renders the final value immediately and requests no frames for reduced motion', () => {
    setReducedMotion(true)
    render()
    expect(renders.every(({ progress: value }) => value === 1)).toBe(true)
    expect(progress()).toBe(1)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })

  it('finishes and cancels when reduced motion is enabled during the entrance', () => {
    render()
    advanceFrame(0)
    advanceFrame(300)
    expect(progress()).toBeCloseTo(0.578125)
    const pendingId = [...frames.keys()][0]

    setReducedMotion(true)
    expect(progress()).toBe(1)
    expect(cancelAnimationFrame).toHaveBeenCalledWith(pendingId)
    expect(frames.size).toBe(0)
    const requestCount = vi.mocked(requestAnimationFrame).mock.calls.length
    advanceFrame(1500)
    setReducedMotion(false)
    expect(progress()).toBe(1)
    expect(frames.size).toBe(0)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(requestCount)
  })
})
