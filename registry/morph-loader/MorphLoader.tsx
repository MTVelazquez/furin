"use client";
import { useEffect, useId, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import "./MorphLoader.css";

export type MorphShape = "circle" | "square" | "triangle" | "pentagon" | "hexagon" | "diamond";

export interface MorphLoaderProps {
  /** Lado del loader, en px. */
  size?: number;
  /** Secuencia de figuras por las que muta, en orden. */
  shapes?: MorphShape[];
  /** Color del degradado en la parte de abajo de la figura. */
  from?: string;
  /** Color del degradado en la parte de arriba de la figura. */
  to?: string;
  /** Segundos que se queda quieta cada figura antes de mutar. */
  hold?: number;
  /** Segundos que dura la transición entre figuras. */
  duration?: number;
  /** Gira la figura mientras muta. */
  spin?: boolean;
  /** Texto oculto que leen los lectores de pantalla. */
  label?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const N = 144; // puntos del contorno: bastan para que el círculo se vea liso
// Escala de cada figura para que pesen parecido a la vista (el triángulo necesita más radio que el círculo).
const ESCALA: Record<MorphShape, number> = { circle: 1, square: 1.12, triangle: 1.34, pentagon: 1.06, hexagon: 1.04, diamond: 1.22 };
const LADOS: Record<MorphShape, number> = { circle: 0, square: 4, triangle: 3, pentagon: 5, hexagon: 6, diamond: 4 };
const ROT0: Record<MorphShape, number> = { circle: 0, square: Math.PI / 4, triangle: -Math.PI / 2, pentagon: -Math.PI / 2, hexagon: 0, diamond: -Math.PI / 2 };

// Radio del contorno en cada ángulo: círculo = constante; polígono = distancia al lado más cercano. Luego se suavizan las esquinas.
function contorno(f: MorphShape): number[] {
  const m = LADOS[f];
  const raw = Array.from({ length: N }, (_, i) => {
    if (!m) return 1;
    const a = (i / N) * Math.PI * 2 - ROT0[f];
    const sector = (Math.PI * 2) / m;
    const loc = ((a % sector) + sector) % sector - sector / 2;
    return Math.cos(Math.PI / m) / Math.cos(loc);
  });
  const suave = raw.slice();
  const r = m ? 4 : 0;
  for (let pasada = 0; pasada < 2; pasada++) {
    const base = suave.slice();
    for (let i = 0; i < N; i++) {
      let acc = 0, peso = 0;
      for (let k = -r; k <= r; k++) { const w = r + 1 - Math.abs(k); acc += base[(i + k + N) % N] * w; peso += w; }
      suave[i] = acc / peso;
    }
  }
  return suave.map((v) => v * ESCALA[f]);
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Loader que muta: una figura de degradado y brillo pasa suavemente de círculo a cuadrado y a triángulo (o las figuras que elijas), girando y aplastándose un poco en cada cambio. */
export function MorphLoader({
  size = 140,
  shapes = ["circle", "square", "triangle"],
  from = "#6a5cff",
  to = "#4de6d0",
  hold = 0.55,
  duration = 0.95,
  spin = true,
  label = "Loading",
  className = "",
  style,
}: MorphLoaderProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const secuencia = useMemo(() => (shapes.length ? shapes : (["circle"] as MorphShape[])), [shapes]);
  const raiz = useRef<HTMLDivElement>(null);
  const grupo = useRef<SVGGElement>(null);
  const trazo = useRef<SVGPathElement>(null);
  const brillo = useRef<SVGPathElement>(null);
  const sombra = useRef<SVGEllipseElement>(null);

  useEffect(() => {
    const el = raiz.current;
    const g = grupo.current;
    const camino = trazo.current;
    if (!el || !g || !camino) return;
    const formas = secuencia.map(contorno);
    const R = 50 * 0.62; // en el lienzo de 100: deja lugar al triángulo y a la sombra
    const construir = (rad: number[], giro: number) => {
      let d = "";
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 - Math.PI / 2 + giro;
        d += `${i ? "L" : "M"}${(Math.cos(a) * rad[i] * R).toFixed(2)} ${(Math.sin(a) * rad[i] * R).toFixed(2)}`;
      }
      return d + "Z";
    };
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const poner = (rad: number[], giro: number, aplast: number) => {
      const d = construir(rad, (giro * Math.PI) / 180);
      camino.setAttribute("d", d);
      brillo.current?.setAttribute("d", d);
      g.setAttribute("transform", `translate(50 46) scale(${(1 + 0.05 * aplast).toFixed(3)} ${(1 - 0.12 * aplast).toFixed(3)})`);
      sombra.current?.setAttribute("rx", (R * (0.85 - 0.12 * aplast)).toFixed(2));
      sombra.current?.setAttribute("opacity", (0.55 - 0.15 * aplast).toFixed(3));
    };
    if (quieto || formas.length < 2) { poner(formas[Math.min(1, formas.length - 1)], 0, 0); return; }

    let raf = 0;
    let visible = true;
    const t0 = performance.now();
    const ciclo = hold + duration;
    const paso = (ahora: number) => {
      // El primer cuadro puede traer una marca de tiempo anterior a t0: sin el tope, k saldría -1 y no habría figura.
      const t = Math.max(0, (ahora - t0) / 1000);
      const k = Math.floor(t / ciclo);
      const loc = t - k * ciclo;
      const a = formas[k % formas.length], b = formas[(k + 1) % formas.length];
      const p = loc < hold ? 0 : ease((loc - hold) / duration);
      const rad = a.map((v, i) => v + (b[i] - v) * p);
      // Aplasta un poco a la mitad del cambio, como si cediera y se recuperara.
      const aplast = Math.sin(Math.PI * p);
      poner(rad, spin ? (k + p) * 120 : 0, aplast);
      raf = visible ? requestAnimationFrame(paso) : 0;
    };
    raf = requestAnimationFrame(paso);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(paso);
    });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [secuencia, hold, duration, spin]);

  const vars = { "--furin-ml-size": `${size}px`, "--furin-ml-from": from, "--furin-ml-to": to } as CSSProperties;
  return (
    <div ref={raiz} className={`furin-morph-loader ${className}`} style={{ ...vars, ...style }} role="status">
      <svg viewBox="0 0 100 100" className="furin-morph-loader__svg" aria-hidden="true">
        <defs>
          <linearGradient id={`${uid}f`} x1="0" y1="1" x2="0.6" y2="0">
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
          <radialGradient id={`${uid}s`} cx="0.34" cy="0.22" r="0.7">
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0.08" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${uid}b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.05" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.25" />
          </linearGradient>
          <filter id={`${uid}g`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" /></filter>
        </defs>
        <ellipse ref={sombra} cx="50" cy="92" rx="26" ry="3.6" fill="#000" filter={`url(#${uid}g)`} opacity="0.55" />
        <g ref={grupo} transform="translate(50 46)">
          <path ref={trazo} d="" fill={`url(#${uid}f)`} stroke={`url(#${uid}b)`} strokeWidth="0.9" strokeLinejoin="round" />
          <path ref={brillo} d="" fill={`url(#${uid}s)`} />
        </g>
      </svg>
      <span className="furin-morph-loader__sr">{label}…</span>
    </div>
  );
}

export default MorphLoader;
