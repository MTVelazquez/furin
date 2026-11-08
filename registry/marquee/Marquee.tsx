"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./Marquee.css";

export interface MarqueeProps {
  /** Elementos de la marquesina: textos o cualquier nodo. */
  items?: ReactNode[];
  /** Velocidad base, en px por segundo. */
  speed?: number;
  /** Dirección del movimiento de la primera fila. */
  direction?: "left" | "right";
  /** Filas apiladas; cada una va en dirección contraria a la anterior. */
  rows?: number;
  /** Espacio entre elementos, en px. */
  gap?: number;
  /** Velocidad al pasar el cursor, como fracción de la base (0 = frena del todo). */
  hoverSpeed?: number;
  /** Cuánto empuja el cursor al moverse sobre la fila (0 = nada). */
  push?: number;
  /** Desvanece los bordes. */
  fade?: boolean;
  /** Etiqueta accesible de la marquesina. */
  label?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const PALABRAS = ["Design", "Motion", "Detail", "Code", "Texture", "Rhythm"];

const fila = (items: ReactNode[], r: number) => {
  const k = items.length ? (r * 2) % items.length : 0;
  return [...items.slice(k), ...items.slice(0, k)];
};

/** Marquesina infinita sin saltos: el cursor la frena y la empuja, y el foco del teclado la pausa. */
export function Marquee({
  items = PALABRAS,
  speed = 70,
  direction = "left",
  rows = 2,
  gap = 36,
  hoverSpeed = 0.14,
  push = 0.6,
  fade = true,
  label = "Marquee",
  className = "",
  style,
}: MarqueeProps) {
  const host = useRef<HTMLDivElement>(null);
  const pistas = useRef<(HTMLDivElement | null)[]>([]);
  const sets = useRef<(HTMLUListElement | null)[]>([]);
  const nFilas = Math.max(1, Math.min(rows, 3));
  const [copias, setCopias] = useState<number[]>(() => Array(nFilas).fill(2));
  const [quieto, setQuieto] = useState(false);
  const live = useRef({ speed, direction, hoverSpeed, push, nFilas });
  live.current = { speed, direction, hoverSpeed, push, nFilas };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setQuieto(true); return; }
    setQuieto(false);
    // Estado por fila: desplazamiento, factor de velocidad (freno), empuje del cursor.
    const st = Array.from({ length: 3 }, () => ({ off: 0, mult: 1, boost: 0, boostT: 0, hover: false, lx: 0, lt: 0, W: 0 }));
    let foco = false, raf = 0, last = 0, visible = true, cw = 0;

    const medir = () => {
      cw = el.clientWidth;
      const next: number[] = [];
      for (let r = 0; r < live.current.nFilas; r++) {
        const s = sets.current[r];
        const w = s ? s.getBoundingClientRect().width : 0;
        st[r].W = w;
        next.push(w > 0 ? Math.max(2, Math.ceil(cw / w) + 1) : 2);
      }
      setCopias((p) => (p.length === next.length && p.every((v, i) => v === next[i]) ? p : next));
    };

    const frame = (nowMs: number) => {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0.001, (nowMs - last) / 1000));
      last = nowMs;
      const L = live.current;
      for (let r = 0; r < L.nFilas; r++) {
        const s = st[r];
        const pista = pistas.current[r];
        if (!pista || s.W <= 0) continue;
        const sign = (L.direction === "left" ? 1 : -1) * (r % 2 === 0 ? 1 : -1);
        const objetivo = foco ? 0 : s.hover ? L.hoverSpeed : 1;
        // Freno y aceleración suaves: el factor se acerca exponencialmente al objetivo.
        s.mult += (objetivo - s.mult) * (1 - Math.exp(-dt * (objetivo < s.mult ? 5 : 3.2)));
        s.boostT *= Math.exp(-dt * 5);
        s.boost += (s.boostT - s.boost) * (1 - Math.exp(-dt * 9));
        // El empuje se mide en px/s con signo de pantalla: positivo = hacia la derecha.
        s.off += (sign * L.speed * s.mult - s.boost) * dt;
        const x = -(((s.off % s.W) + s.W) % s.W);
        pista.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
      }
      if (visible) raf = requestAnimationFrame(frame);
    };
    const wake = () => { if (raf || !visible) return; last = performance.now(); raf = requestAnimationFrame(frame); };

    const hacia = (r: number) => ({
      enter: () => { st[r].hover = true; },
      leave: () => { st[r].hover = false; },
      move: (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        const s = st[r];
        const t = e.timeStamp;
        if (s.lt && t > s.lt) {
          const v = ((e.clientX - s.lx) / (t - s.lt)) * 1000;
          s.boostT = Math.max(-1800, Math.min(1800, s.boostT * 0.5 + v * live.current.push * 0.5));
        }
        s.lx = e.clientX; s.lt = t;
      },
    });
    const filas = Array.from(el.querySelectorAll<HTMLElement>(".furin-marquee__fila"));
    const hs = filas.map((f, r) => {
      const h = hacia(r);
      const pe = (e: Event) => { if ((e as PointerEvent).pointerType !== "touch") h.enter(); };
      f.addEventListener("pointerenter", pe);
      f.addEventListener("pointerleave", h.leave);
      f.addEventListener("pointermove", h.move as EventListener);
      return () => { f.removeEventListener("pointerenter", pe); f.removeEventListener("pointerleave", h.leave); f.removeEventListener("pointermove", h.move as EventListener); };
    });
    const onIn = () => { foco = true; };
    const onOut = (e: FocusEvent) => { if (!el.contains(e.relatedTarget as Node)) foco = false; };
    el.addEventListener("focusin", onIn);
    el.addEventListener("focusout", onOut);

    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } });
    io.observe(el);
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    sets.current.forEach((s) => s && ro.observe(s));
    const fnt = (document as Document & { fonts?: FontFaceSet }).fonts;
    void fnt?.ready.then(medir);
    medir();
    wake();
    return () => {
      cancelAnimationFrame(raf);
      hs.forEach((f) => f());
      el.removeEventListener("focusin", onIn);
      el.removeEventListener("focusout", onOut);
      io.disconnect();
      ro.disconnect();
    };
  }, [nFilas, items.length, gap]);

  const vars = { "--furin-marquee-gap": `${gap}px` } as CSSProperties;
  return (
    <div
      ref={host}
      className={`furin-marquee${fade ? " furin-marquee--fade" : ""}${quieto ? " furin-marquee--quieto" : ""} ${className}`}
      style={{ ...vars, ...style }}
      role="group"
      aria-roledescription="marquesina"
      aria-label={label}
      tabIndex={0}
    >
      {Array.from({ length: nFilas }, (_, r) => {
        const base = fila(items, r);
        const n = quieto ? 1 : copias[r] ?? 2;
        return (
          <div key={r} className={`furin-marquee__fila furin-marquee__fila--${r % 2 ? "b" : "a"}`}>
            <div ref={(el) => { pistas.current[r] = el; }} className="furin-marquee__pista">
              {Array.from({ length: n }, (_, c) => (
                // Solo la primera copia es accesible; el resto es relleno visual.
                <ul key={c} ref={c === 0 ? (el) => { sets.current[r] = el; } : undefined} className="furin-marquee__set" aria-hidden={c > 0 ? true : undefined} inert={c > 0}>
                  {base.map((it, i) => (
                    <li key={i} className="furin-marquee__item">
                      <span className="furin-marquee__contenido">{it}</span>
                      <i className="furin-marquee__sep" aria-hidden="true" />
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default Marquee;
