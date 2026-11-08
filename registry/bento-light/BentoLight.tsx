"use client";
import { useCallback, useEffect, useRef } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import "./BentoLight.css";

export interface BentoLightItem {
  /** Título de la celda. */
  title: string;
  /** Texto de apoyo. */
  text?: string;
  /** Cifra grande (solo se muestra en la celda grande). */
  metric?: string;
  /** Icono propio; si falta se usa uno de la colección. */
  icon?: ReactNode;
}

export interface BentoLightProps {
  /** Las seis celdas: la primera es la grande (2×2). */
  items?: BentoLightItem[];
  /** Color de la luz. */
  color?: string;
  /** Radio de la luz, en px. */
  radius?: number;
  /** Cada cuántos segundos salta la luz sola cuando no hay cursor (0 = quieta). */
  autoplay?: number;
  /** Separación entre celdas, en px. */
  gap?: number;
  /** Ancho máximo de la rejilla, en px. */
  width?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const ICONS: ReactNode[] = [
  <path key="0" d="M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5z" />,
  <g key="1"><path d="M12 3 5 6v5.5c0 4.4 2.9 7.4 7 9 4.1-1.6 7-4.6 7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></g>,
  <g key="2"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.4-3.2 2.7-5 5.5-5s5.1 1.8 5.5 5" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14.2c2 .5 3.3 2.2 3.5 4.8" /></g>,
  <g key="3"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5.5l-3 13" /></g>,
  <g key="4"><path d="M5 20v-7M12 20V5M19 20v-10" /></g>,
  <g key="5"><path d="M4.5 5.5h15v10.5H10l-5.5 4z" /></g>,
];

const DEFAULT_ITEMS: BentoLightItem[] = [
  { title: "Faster, always", text: "Every screen loads before you can blink.", metric: "2.4×" },
  { title: "Secure", text: "End-to-end encryption." },
  { title: "Built for teams", text: "Invite without limits." },
  { title: "Integrations", text: "Connect your apps." },
  { title: "Analytics", text: "Live data." },
  { title: "Support", text: "Humans, around the clock." },
];

/** Rejilla bento con una sola luz que salta entre celdas siguiendo al cursor (o por su cuenta) y se derrama sobre las vecinas. */
export function BentoLight({
  items = DEFAULT_ITEMS,
  color = "#8ab4ff",
  radius = 230,
  autoplay = 2.2,
  gap = 10,
  width = 440,
  className = "",
  style,
}: BentoLightProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cells = useRef<(HTMLDivElement | null)[]>([]);
  const rects = useRef<{ x: number; y: number; w: number; h: number }[]>([]);
  const L = useRef({ x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, lit: 0, on: false });
  const raf = useRef(0);
  const last = useRef(0);
  const hover = useRef(false);
  const reduced = useRef(false);
  const hop = useRef(0);
  const auto = useRef(autoplay);
  auto.current = autoplay;
  const count = Math.min(6, items.length);

  const measure = useCallback(() => {
    rects.current = cells.current.map((el) => (el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : { x: 0, y: 0, w: 0, h: 0 }));
  }, []);

  const paint = useCallback(() => {
    const l = L.current;
    cells.current.forEach((el, i) => {
      const r = rects.current[i];
      if (!el || !r) return;
      el.style.setProperty("--furin-bento-light-lx", `${(l.x - r.x).toFixed(1)}px`);
      el.style.setProperty("--furin-bento-light-ly", `${(l.y - r.y).toFixed(1)}px`);
    });
  }, []);

  const setLit = useCallback((i: number) => {
    L.current.lit = i;
    cells.current.forEach((el, k) => { if (el) el.dataset.lit = k === i ? "true" : "false"; });
  }, []);

  const tick = useCallback((now: number) => {
    raf.current = 0;
    const dt = Math.min(0.033, (now - last.current) / 1000 || 0.016);
    last.current = now;
    const l = L.current;
    // Resorte con un poco de rebote: el salto entre celdas se nota pero no es brusco.
    const k = hover.current ? 170 : 95, c = hover.current ? 23 : 12.5;
    const sub = 2, h = dt / sub;
    for (let q = 0; q < sub; q++) {
      l.vx += (k * (l.tx - l.x) - c * l.vx) * h; l.x += l.vx * h;
      l.vy += (k * (l.ty - l.y) - c * l.vy) * h; l.y += l.vy * h;
    }
    paint();
    const moving = Math.abs(l.tx - l.x) + Math.abs(l.ty - l.y) > 0.3 || Math.abs(l.vx) + Math.abs(l.vy) > 1;
    if (moving) raf.current = requestAnimationFrame(tick);
  }, [paint]);

  const wake = useCallback(() => {
    if (reduced.current) { L.current.x = L.current.tx; L.current.y = L.current.ty; paint(); return; }
    if (!raf.current) { last.current = performance.now(); raf.current = requestAnimationFrame(tick); }
  }, [paint, tick]);

  /** Lleva la luz a una celda (hacia su centro, con un tirón opcional hacia el cursor). */
  const aim = useCallback((i: number, px?: number, py?: number) => {
    const r = rects.current[i];
    if (!r) return;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const pull = px === undefined || py === undefined ? 0 : 0.55;
    L.current.tx = cx + ((px ?? cx) - cx) * pull;
    L.current.ty = cy + ((py ?? cy) - cy) * pull;
    setLit(i);
    wake();
  }, [setLit, wake]);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const root = rootRef.current;
    if (!root) return;
    measure();
    // Arranca ya encendida en la celda grande, sin saltar desde la esquina.
    const r0 = rects.current[0];
    if (r0) { L.current.x = L.current.tx = r0.x + r0.w * 0.62; L.current.y = L.current.ty = r0.y + r0.h * 0.4; }
    setLit(0);
    paint();
    const ro = new ResizeObserver(() => { measure(); aim(L.current.lit); });
    ro.observe(root);
    let visible = true;
    const io = new IntersectionObserver((e) => { visible = e[0]?.isIntersecting ?? true; });
    io.observe(root);
    // Piloto automático: mientras nadie la guía, la luz recorre las celdas.
    const seq = [0, 1, 2, 5, 4, 3].filter((i) => i < count);
    const timer = window.setInterval(() => {
      if (hover.current || !visible || reduced.current || auto.current <= 0) return;
      hop.current = (hop.current + 1) % seq.length;
      aim(seq[hop.current]);
    }, Math.max(600, auto.current * 1000));
    return () => { ro.disconnect(); io.disconnect(); window.clearInterval(timer); cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [measure, aim, paint, setLit, count, autoplay]);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root) return;
    hover.current = true;
    const b = root.getBoundingClientRect();
    const px = e.clientX - b.left, py = e.clientY - b.top;
    // La celda bajo el cursor (o la más cercana, si está en una rendija).
    let best = L.current.lit, bd = Infinity;
    rects.current.forEach((r, i) => {
      if (i >= count) return;
      const dx = Math.max(r.x - px, 0, px - (r.x + r.w)), dy = Math.max(r.y - py, 0, py - (r.y + r.h));
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    });
    aim(best, px, py);
  };
  const onLeave = () => { hover.current = false; hop.current = Math.max(0, [0, 1, 2, 5, 4, 3].indexOf(L.current.lit)); wake(); };

  const vars = {
    "--furin-bento-light-w": `${width}px`,
    "--furin-bento-light-gap": `${gap}px`,
    "--furin-bento-light-color": color,
    "--furin-bento-light-r": `${radius}px`,
  } as CSSProperties;

  return (
    <div ref={rootRef} className={`furin-bento-light ${className}`} style={{ ...vars, ...style }} onPointerMove={onMove} onPointerLeave={onLeave}>
      {items.slice(0, 6).map((it, i) => (
        <div
          key={i}
          ref={(el) => { cells.current[i] = el; }}
          className={`furin-bento-light__cell furin-bento-light__cell--${i}`}
          data-lit={i === 0 ? "true" : "false"}
        >
          <i className="furin-bento-light__dots" />
          <span className="furin-bento-light__icon">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{it.icon ?? ICONS[i % ICONS.length]}</svg>
          </span>
          <div className="furin-bento-light__body">
            {i === 0 && it.metric ? <span className="furin-bento-light__metric">{it.metric}</span> : null}
            <strong>{it.title}</strong>
            {it.text ? <span>{it.text}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export default BentoLight;
