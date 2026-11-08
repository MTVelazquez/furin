"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import "./SpringAccordion.css";

export interface AccordionItem {
  /** Identificador del ítem (por defecto, su posición). */
  id?: string;
  /** Título del botón. */
  title: string;
  /** Contenido que se despliega. */
  content: ReactNode;
}

export interface SpringAccordionProps {
  /** Ítems del acordeón. */
  items?: AccordionItem[];
  /** "single" abre uno a la vez; "multiple" deja varios abiertos. */
  type?: "single" | "multiple";
  /** Ítems abiertos (modo controlado). */
  value?: string[];
  /** Ítems abiertos al inicio (modo libre). */
  defaultValue?: string[];
  /** Se llama al abrir o cerrar. */
  onChange?: (value: string[]) => void;
  /** Rigidez del resorte: más alto abre más seco. */
  stiffness?: number;
  /** Rebote del resorte: 0.4 rebota, 1 llega sin rebotar. */
  damping?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const ITEMS: AccordionItem[] = [
  { title: "What does the free version include?", content: "Every component in the base collection, with its full TypeScript code. Copy it, paste it and it's yours." },
  { title: "Do I need to install dependencies?", content: "Just React. No GSAP, Three or animation libraries: every effect lives in a file you can read and change." },
  { title: "Does it work with Next.js and Vite?", content: "Yes. The components are safe to render on the server and only start their effects in the browser." },
  { title: "Can I use it in commercial projects?", content: "Yes, no attribution needed. The code you copy becomes part of your project." },
];

/** Región que se abre con un resorte de verdad: la altura rebota un poco al llegar y el contenido entra desenfocado hacia la nitidez. */
function Panel({ abierto, id, labelledBy, stiffness, damping, children }: { abierto: boolean; id: string; labelledBy: string; stiffness: number; damping: number; children: ReactNode }) {
  const caja = useRef<HTMLDivElement>(null);
  const dentro = useRef<HTMLDivElement>(null);
  const fis = useRef({ h: 0, v: 0, raf: 0, last: 0, listo: false });
  const [asentado, setAsentado] = useState(!abierto);
  const live = useRef({ abierto, stiffness, damping });
  live.current = { abierto, stiffness, damping };

  const medida = () => (dentro.current ? dentro.current.offsetHeight : 0);

  const tick = useCallback((t: number) => {
    const f = fis.current, el = caja.current;
    f.raf = 0;
    if (!el) return;
    const dt = Math.min(0.032, Math.max(0.001, (t - f.last) / 1000));
    f.last = t;
    const to = live.current.abierto ? medida() : 0;
    const k = live.current.stiffness, c = 2 * Math.sqrt(k) * live.current.damping;
    const steps = 3, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      f.v += (k * (to - f.h) - c * f.v) * h;
      f.h += f.v * h;
    }
    el.style.height = `${Math.max(f.h, 0).toFixed(2)}px`;
    if (Math.abs(to - f.h) < 0.15 && Math.abs(f.v) < 0.5) {
      f.h = to; f.v = 0;
      // Abierto queda en "auto" para que el contenido pueda crecer solo; cerrado, en 0.
      el.style.height = live.current.abierto ? "" : "0px";
      if (!live.current.abierto) setAsentado(true);
      return;
    }
    f.raf = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const f = fis.current;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!f.listo) {
      // Primer pintado: sin animar, directo al estado inicial.
      f.listo = true;
      f.h = abierto ? medida() : 0;
      el.style.height = abierto ? "" : "0px";
      return;
    }
    if (abierto) setAsentado(false);
    if (quieto) {
      f.h = abierto ? medida() : 0; f.v = 0;
      el.style.height = abierto ? "" : "0px";
      if (!abierto) setAsentado(true);
      return;
    }
    // Arranca desde la altura que tenga ahora mismo, incluso a medio camino.
    f.h = el.getBoundingClientRect().height;
    el.style.height = `${f.h}px`;
    if (!f.raf) { f.last = performance.now(); f.raf = requestAnimationFrame(tick); }
  }, [abierto, tick]);

  useEffect(() => () => cancelAnimationFrame(fis.current.raf), []);

  return (
    <div
      ref={caja}
      id={id}
      role="region"
      aria-labelledby={labelledBy}
      className={`furin-spring-accordion__panel${abierto ? " is-abierto" : ""}${asentado && !abierto ? " is-cerrado" : ""}`}
      inert={asentado && !abierto}
    >
      <div ref={dentro} className="furin-spring-accordion__dentro">
        <div className="furin-spring-accordion__contenido">{children}</div>
      </div>
    </div>
  );
}

/** Acordeón accesible (botones con aria-expanded, regiones, flechas y Inicio/Fin) cuyas regiones se abren con resorte. */
export function SpringAccordion({
  items = ITEMS,
  type = "single",
  value,
  defaultValue,
  onChange,
  stiffness = 260,
  damping = 0.58,
  className = "",
  style,
}: SpringAccordionProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ids = items.map((it, i) => it.id ?? String(i));
  const [interno, setInterno] = useState<string[]>(defaultValue ?? [ids[0]]);
  const abiertos = value ?? interno;
  const botones = useRef<(HTMLButtonElement | null)[]>([]);

  const alternar = (id: string) => {
    const esta = abiertos.includes(id);
    const sig = type === "single" ? (esta ? [] : [id]) : esta ? abiertos.filter((x) => x !== id) : [...abiertos, id];
    if (value === undefined) setInterno(sig);
    onChange?.(sig);
  };

  const tecla = (e: KeyboardEvent, i: number) => {
    const n = items.length;
    let j = i;
    if (e.key === "ArrowDown") j = (i + 1) % n;
    else if (e.key === "ArrowUp") j = (i - 1 + n) % n;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = n - 1;
    else return;
    e.preventDefault();
    botones.current[j]?.focus();
  };

  return (
    <div className={`furin-spring-accordion ${className}`} style={style}>
      {items.map((it, i) => {
        const id = ids[i];
        const abierto = abiertos.includes(id);
        const bid = `${uid}-b-${i}`, pid = `${uid}-p-${i}`;
        return (
          <div key={id} className={`furin-spring-accordion__item${abierto ? " is-abierto" : ""}`}>
            <h3 className="furin-spring-accordion__cab">
              <button
                ref={(el) => { botones.current[i] = el; }}
                id={bid}
                type="button"
                className="furin-spring-accordion__boton"
                aria-expanded={abierto}
                aria-controls={pid}
                onClick={() => alternar(id)}
                onKeyDown={(e) => tecla(e, i)}
              >
                <span className="furin-spring-accordion__num" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                <span className="furin-spring-accordion__titulo">{it.title}</span>
                <span className="furin-spring-accordion__mas" aria-hidden="true">
                  <svg viewBox="0 0 16 16"><path d="M3.5 8h9" /><path className="furin-spring-accordion__vert" d="M8 3.5v9" /></svg>
                </span>
              </button>
            </h3>
            <Panel abierto={abierto} id={pid} labelledBy={bid} stiffness={stiffness} damping={damping}>
              {it.content}
            </Panel>
          </div>
        );
      })}
    </div>
  );
}

export default SpringAccordion;
