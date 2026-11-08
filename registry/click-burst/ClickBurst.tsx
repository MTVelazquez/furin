"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./ClickBurst.css";

export interface ClickBurstProps {
  /** Color de los rayos. */
  color?: string;
  /** Cuántos rayos salen en cada ráfaga. */
  rays?: number;
  /** Alcance de los rayos, en px. */
  radius?: number;
  /** Duración de cada ráfaga, en milisegundos. */
  duration?: number;
  /** Grosor de los rayos, en px. */
  thickness?: number;
  /** Dibuja el anillo y el destello central. */
  ring?: boolean;
  /** Estalla en toda la ventana en vez de solo en el contenedor. */
  global?: boolean;
  /** Estalla solo, en puntos al azar, cuando nadie hace clic. */
  autoplay?: boolean;
  /** Texto de pista que se muestra cuando no hay children. */
  hint?: string;
  /** Contenido que queda debajo de las ráfagas. */
  children?: ReactNode;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

let colorCtx: CanvasRenderingContext2D | null = null;
function toRgb(color: string): [number, number, number] {
  if (typeof document === "undefined") return [142, 162, 255];
  colorCtx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = "#000";
  colorCtx.fillStyle = color;
  colorCtx.fillRect(0, 0, 1, 1);
  const d = colorCtx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

interface Ray { a: number; len: number; w: number; delay: number; tint: number }
interface Burst { x: number; y: number; t0: number; rays: Ray[]; dots: { a: number; d: number; r: number; delay: number }[]; spin: number }

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Ráfaga al clic: rayos finos que viajan hacia afuera y se despegan de su origen, con anillo y destello. */
export function ClickBurst({
  color = "#8EA2FF",
  rays = 12,
  radius = 64,
  duration = 720,
  thickness = 2.4,
  ring = true,
  global = false,
  autoplay = false,
  hint = "Click anywhere",
  children,
  className = "",
  style,
}: ClickBurstProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [activo, setActivo] = useState(true);
  const live = useRef({ color, rays, radius, duration, thickness, ring, autoplay });
  live.current = { color, rays, radius, duration, thickness, ring, autoplay };

  useEffect(() => {
    const el = host.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setActivo(false); return; }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let W = 1, H = 1, dpr = 1, raf = 0, visible = true, lastReal = -1e9, nextAuto = 0, inside = false;
    const bursts: Burst[] = [];
    let colKey = live.current.color;
    let col = toRgb(colKey);

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = global ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    };

    const spawn = (x: number, y: number, now: number) => {
      const n = Math.max(3, Math.round(live.current.rays));
      const off = Math.random() * Math.PI;
      const list: Ray[] = [];
      for (let i = 0; i < n; i++) {
        const long = i % 2 === 0;
        list.push({
          a: off + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.12,
          len: live.current.radius * (long ? 0.92 + Math.random() * 0.2 : 0.55 + Math.random() * 0.15),
          w: live.current.thickness * (long ? 1 : 0.75),
          delay: Math.random() * 0.06,
          tint: long ? 0 : 1,
        });
      }
      const dots = Array.from({ length: Math.max(4, Math.round(n / 2)) }, () => ({ a: Math.random() * 6.283, d: 0.85 + Math.random() * 0.5, r: 1 + Math.random() * 1.2, delay: Math.random() * 0.1 }));
      bursts.push({ x, y, t0: now, rays: list, dots, spin: (Math.random() - 0.5) * 0.35 });
      if (bursts.length > 24) bursts.shift();
    };

    const draw = (now: number) => {
      if (colKey !== live.current.color) { colKey = live.current.color; col = toRgb(colKey); }
      const D = Math.max(200, live.current.duration);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      const R = live.current.radius;
      const light = `${Math.round(col[0] + (255 - col[0]) * 0.65)},${Math.round(col[1] + (255 - col[1]) * 0.65)},${Math.round(col[2] + (255 - col[2]) * 0.65)}`;
      const base = `${col[0]},${col[1]},${col[2]}`;
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        const t = Math.max(0, (now - b.t0) / D);
        if (t >= 1) { bursts.splice(i, 1); continue; }
        if (live.current.ring) {
          // Destello central: una luz breve que se encoge.
          if (t < 0.3) {
            const f = 1 - t / 0.3;
            const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, R * 0.55);
            g.addColorStop(0, `rgba(${light},${0.8 * f})`);
            g.addColorStop(0.4, `rgba(${base},${0.3 * f})`);
            g.addColorStop(1, `rgba(${base},0)`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(b.x, b.y, R * 0.55, 0, 6.2832);
            ctx.fill();
          }
          // Anillo que se expande y se afina.
          const rr = R * 0.78 * easeOutExpo(Math.min(1, t * 1.4));
          ctx.beginPath();
          ctx.arc(b.x, b.y, rr, 0, 6.2832);
          ctx.strokeStyle = `rgba(${light},${0.8 * Math.pow(1 - t, 1.6)})`;
          ctx.lineWidth = Math.max(0.5, 2 * (1 - t));
          ctx.stroke();
        }
        // Rayos: la punta sale rápido y la cola la alcanza, así el rayo viaja y se despega del origen.
        for (const ry of b.rays) {
          const tt = Math.min(1, Math.max(0, (t - ry.delay) / (1 - ry.delay)));
          const head = ry.len * easeOut(Math.min(1, tt / 0.62));
          const tail = ry.len * 0.96 * easeInOut(Math.min(1, Math.max(0, (tt - 0.18) / 0.82)));
          if (head - tail < 0.5) continue;
          const a = ry.a + b.spin * tt;
          const ca = Math.cos(a), sa = Math.sin(a);
          const x0 = b.x + ca * (R * 0.16 + tail), y0 = b.y + sa * (R * 0.16 + tail);
          const x1 = b.x + ca * (R * 0.16 + head), y1 = b.y + sa * (R * 0.16 + head);
          const alpha = Math.pow(1 - tt, 0.55);
          const grad = ctx.createLinearGradient(x0, y0, x1, y1);
          const c = ry.tint ? base : light;
          grad.addColorStop(0, `rgba(${base},0)`);
          grad.addColorStop(0.55, `rgba(${base},${alpha * 0.7})`);
          grad.addColorStop(1, `rgba(${c},${alpha})`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = ry.w * (1 - tt * 0.4);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
        // Chispitas que siguen de largo, más lejos que los rayos.
        for (const d of b.dots) {
          const tt = Math.min(1, Math.max(0, (t - d.delay) / (1 - d.delay)));
          const dist = R * (0.3 + d.d * easeOut(tt));
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(d.a) * dist, b.y + Math.sin(d.a) * dist, d.r * (1 - tt * 0.7), 0, 6.2832);
          ctx.fillStyle = `rgba(${light},${0.8 * Math.pow(1 - tt, 1.4)})`;
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const frame = (now: number) => {
      raf = 0;
      const auto = live.current.autoplay && (!inside || now - lastReal > 3000);
      if (auto && now > nextAuto) {
        spawn(W * (0.18 + Math.random() * 0.64), H * (0.2 + Math.random() * 0.6), now);
        nextAuto = now + 1100 + Math.random() * 500;
      }
      draw(now);
      if ((bursts.length || auto) && visible) raf = requestAnimationFrame(frame);
      else if (!bursts.length) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); }
    };
    const wake = () => { if (raf || !visible) return; raf = requestAnimationFrame(frame); };

    const target: EventTarget = global ? window : el;
    const onDown = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType === "touch" || pe.button !== 0) return;
      const r = global ? { left: 0, top: 0 } : el.getBoundingClientRect();
      lastReal = performance.now();
      spawn(pe.clientX - r.left, pe.clientY - r.top, performance.now());
      wake();
    };
    const onEnter = () => { inside = true; };
    const onMove = () => { inside = true; lastReal = Math.max(lastReal, performance.now() - 2400); };
    const onLeave = () => { inside = false; wake(); };
    target.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } });
    io.observe(el);
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    if (global) window.addEventListener("resize", resize);
    resize();
    const poll = window.setInterval(wake, 700);
    wake();
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(poll);
      target.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (global) window.removeEventListener("resize", resize);
      io.disconnect();
      ro.disconnect();
    };
  }, [global]);

  return (
    <div ref={host} className={`furin-click-burst ${className}`} style={style}>
      <div className="furin-click-burst__contenido">
        {children ?? <span className="furin-click-burst__pista">{hint}</span>}
      </div>
      {activo ? <canvas ref={canvas} aria-hidden="true" className={`furin-click-burst__canvas${global ? " furin-click-burst__canvas--global" : ""}`} /> : null}
    </div>
  );
}

export default ClickBurst;
