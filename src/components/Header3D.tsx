import { useRef, useMemo, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Wireframe signal/signal-tower abstract object - Electric blue
function SignalMesh({ paused }: { paused: boolean }) {
  const groupRef = useRef<THREE.Group>(null)

  // Pre-compute THREE.Line instances (geometry + material + mesh) once.
  // We use native three.js <primitive> instead of @react-three/drei's <Line>,
  // which historically dragged a lot of bundle weight for what is a thin wrapper.
  const lines = useMemo(() => {
    const lineData: THREE.Vector3[][] = []
    const segments = 24
    const height = 1.2
    const baseRadius = 0.4

    // Main vertical tower
    lineData.push([
      new THREE.Vector3(0, -height/2, 0),
      new THREE.Vector3(0, height/2, 0)
    ])

    // Signal rings (ellipses at different heights)
    for (let i = 0; i < 3; i++) {
      const y = -height/4 + (i * height/3)
      const radius = baseRadius * (1 - i * 0.2)
      const ellipsePoints: THREE.Vector3[] = []

      for (let j = 0; j <= segments; j++) {
        const angle = (j / segments) * Math.PI * 2
        ellipsePoints.push(new THREE.Vector3(
          Math.cos(angle) * radius,
          y + Math.sin(angle) * radius * 0.3,
          Math.sin(angle) * radius
        ))
      }
      lineData.push(ellipsePoints)
    }

    // Diagonal support lines
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI/4
      lineData.push([
        new THREE.Vector3(0, height/2 - 0.1, 0),
        new THREE.Vector3(
          Math.cos(angle) * baseRadius * 0.8,
          -height/4,
          Math.sin(angle) * baseRadius * 0.8
        )
      ])
    }

    // Base cross
    lineData.push([
      new THREE.Vector3(-baseRadius * 0.6, -height/2, 0),
      new THREE.Vector3(baseRadius * 0.6, -height/2, 0)
    ])
    lineData.push([
      new THREE.Vector3(0, -height/2, -baseRadius * 0.6),
      new THREE.Vector3(0, -height/2, baseRadius * 0.6)
    ])

    return lineData.map((points, i) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const material = new THREE.LineBasicMaterial({
        color: '#38BDF8',
        transparent: true,
        opacity: 0.5 - i * 0.015,
      })
      return new THREE.Line(geometry, material)
    })
  }, [])

  // Dispose GPU resources on unmount to avoid leaks.
  useEffect(() => {
    return () => {
      lines.forEach((line) => {
        line.geometry.dispose()
        line.material.dispose()
      })
    }
  }, [lines])

  useFrame((state) => {
    if (paused || !groupRef.current) return
    const t = state.clock.getElapsedTime()
    // Very slow rotation
    groupRef.current.rotation.y = t * 0.15
    // Subtle floating
    groupRef.current.position.y = Math.sin(t * 0.3) * 0.05
  })

  return (
    <group ref={groupRef}>
      {lines.map((line, i) => (
        <primitive key={i} object={line} />
      ))}
    </group>
  )
}

// Particle nodes around the signal
function ParticleNodes({ paused }: { paused: boolean }) {
  const pointsRef = useRef<THREE.Points>(null)
  const count = 20
  
  const { positions } = useMemo(() => {
    const pos = new Float32Array(count * 3)
    
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI
      const radius = 0.6 + Math.random() * 0.4
      
      pos[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = radius * Math.cos(phi)
      pos[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
    }
    
    return { positions: pos }
  }, [])
  
  useFrame((state) => {
    if (paused || !pointsRef.current) return
    const t = state.clock.getElapsedTime()
    pointsRef.current.rotation.y = t * 0.08
    pointsRef.current.rotation.x = Math.sin(t * 0.2) * 0.1
  })
  
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geo
  }, [positions])

  const material = useMemo(() =>
    new THREE.PointsMaterial({
      color: '#38BDF8',
      size: 0.025,
      transparent: true,
      opacity: 0.4,
      sizeAttenuation: true,
    }),
  [])

  // Dispose GPU resources on unmount to avoid leaks (same pattern as SignalMesh lines).
  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  return <points ref={pointsRef} geometry={geometry} material={material} />
}

// Scene setup
function Scene({ paused }: { paused: boolean }) {
  return (
    <>
      <ambientLight intensity={0.2} />
      <SignalMesh paused={paused} />
      <ParticleNodes paused={paused} />
    </>
  )
}

// Static fallback for reduced motion
function StaticFallback() {
  return (
    <div className="w-10 h-10 relative">
      <svg viewBox="0 0 40 40" className="w-full h-full">
        <line x1="20" y1="8" x2="20" y2="32" stroke="#38BDF8" strokeWidth="1.5" opacity="0.6" />
        <ellipse cx="20" cy="20" rx="10" ry="6" fill="none" stroke="#38BDF8" strokeWidth="1" opacity="0.5" />
        <ellipse cx="20" cy="14" rx="7" ry="4" fill="none" stroke="#38BDF8" strokeWidth="1" opacity="0.4" />
        <ellipse cx="20" cy="26" rx="7" ry="4" fill="none" stroke="#38BDF8" strokeWidth="1" opacity="0.4" />
      </svg>
    </div>
  )
}

// Main export component
export function Header3D() {
  const [isReduced, setIsReduced] = useState(false)
  
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setIsReduced(mq.matches)
    
    const handler = (e: MediaQueryListEvent) => setIsReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  
  if (isReduced) {
    return <StaticFallback />
  }
  
  return (
    <div className="w-10 h-10">
      <Canvas
        camera={{ position: [0, 0, 2], fov: 45 }}
        dpr={[1, 1.5]}
        gl={{ 
          antialias: true,
          alpha: true,
          powerPreference: 'low-power',
        }}
        style={{ background: 'transparent' }}
      >
        <Scene paused={false} />
      </Canvas>
    </div>
  )
}

export default Header3D
