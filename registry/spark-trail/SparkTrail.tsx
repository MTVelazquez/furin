"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./SparkTrail.css";

export interface SparkTrailProps {
  /** Color de las chispas: nacen casi blancas y se apagan en brasa. */
  color?: string;
  /** Cuántas chispas suelta cada trazo (1 es discreto, 3 es lluvia). */
  density?: number;
  /** Grosor de las chispas, en px. */
  thickness?: number;
  /** Gravedad que las hace caer, en px/s². */
  gravity?: number;
  /** Segundos que dura cada chispa. */
  life?: number;
  /** Sigue al cursor en toda la ventana en vez de solo en el contenedor. */
  global?: boolean;
  /** Se pasea solo cuando nadie mueve el cursor. */
  autoplay?: boolean;
  /** Texto de pista de la escena de muestra (solo se ve si omites children). */
  hint?: string;
  /** Contenido que queda debajo de las chispas. */
  children?: ReactNode;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

let colorCtx: CanvasRenderingContext2D | null = null;
/** Convierte cualquier color CSS a [r, g, b] pintándolo en un lienzo de 1 px. */
function toRgb(color: string): [number, number, number] {
  if (typeof document === "undefined") return [255, 179, 71];
  colorCtx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = "#000";
  colorCtx.fillStyle = color;
  colorCtx.fillRect(0, 0, 1, 1);
  const d = colorCtx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

interface Spark {
  x: number; y: number; vx: number; vy: number;
  age: number; life: number; w: number;
  /** 0 = chispa con estela, 1 = brasa que titila. */
  kind: 0 | 1;
  seed: number;
}

const MAX = 420;

/** Estela de chispas: cada trazo del cursor suelta chispas con física (inercia, gravedad, rebote) y color de brasa. */
export function SparkTrail({
  color = "#FFA94D",
  density = 2,
  thickness = 2.1,
  gravity = 760,
  life = 0.9,
  global = false,
  autoplay = false,
  hint = "Move your cursor",
  children,
  className = "",
  style,
}: SparkTrailProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [activo, setActivo] = useState(true);
  const live = useRef({ color, density, thickness, gravity, life, autoplay });
  live.current = { color, density, thickness, gravity, life, autoplay };

  useEffect(() => {
    const el = host.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setActivo(false); return; }
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let W = 1, H = 1, dpr = 1, raf = 0, last = 0, visible = true;
    let lx = 0, ly = 0, lt = 0, has = false, inside = false, lastReal = -1e9;
    const sparks: Spark[] = [];
    let glow = 0;
    let col = toRgb(live.current.color);
    let colKey = live.current.color;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = global ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    };

    /** Mueve el "lápiz" y suelta chispas a lo largo del segmento recorrido. */
    const move = (x: number, y: number, tMs: number) => {
      if (!has) { lx = x; ly = y; lt = tMs; has = true; return; }
      const dx = x - lx, dy = y - ly;
      const dist = Math.hypot(dx, dy);
      if (dist < 1.5) return;
      const dt = Math.max(0.008, (tMs - lt) / 1000);
      const sp = Math.min(dist / dt, 3200);
      const n = Math.min(14, Math.max(1, Math.round((dist / 9) * live.current.density)));
      for (let i = 0; i < n; i++) {
        if (sparks.length >= MAX) sparks.shift();
        const f = (i + Math.random()) / n;
        const ang = Math.random() * Math.PI * 2;
        const burst = 30 + Math.random() * (60 + sp * 0.05);
        // La chispa hereda un poco del movimiento del cursor y sale en cualquier dirección.
        const vx = (dx / dist) * sp * 0.1 * (0.3 + Math.random()) + Math.cos(ang) * burst;
        const vy = (dy / dist) * sp * 0.1 * (0.3 + Math.random()) + Math.sin(ang) * burst - 45;
        const ember = Math.random() < 0.28;
        sparks.push({
          x: lx + dx * f, y: ly + dy * f, vx, vy, age: 0,
          life: live.current.life * (ember ? 1.15 : 0.55 + Math.random() * 0.6),
          w: live.current.thickness * (ember ? 0.75 : 0.6 + Math.random() * 0.7),
          kind: ember ? 1 : 0,
          seed: Math.random() * 6.28,
        });
      }
      lx = x; ly = y; lt = tMs;
      glow = Math.min(1, glow + n * 0.08);
    };

    const draw = () => {
      if (colKey !== live.current.color) { colKey = live.current.color; col = toRgb(colKey); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      const hot: [number, number, number] = [col[0] + (255 - col[0]) * 0.78, col[1] + (255 - col[1]) * 0.78, col[2] + (255 - col[2]) * 0.78];
      const dim: [number, number, number] = [col[0] * 0.55, col[1] * 0.22, col[2] * 0.1];
      if (glow > 0.02 && has) {
        const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 54);
        g.addColorStop(0, `rgba(${hot[0] | 0},${hot[1] | 0},${hot[2] | 0},${glow * 0.42})`);
        g.addColorStop(0.35, `rgba(${col[0]},${col[1]},${col[2]},${glow * 0.14})`);
        g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(lx - 54, ly - 54, 108, 108);
      }
      for (const s of sparks) {
        const k = s.age / s.life;
        const a = Math.pow(1 - k, 0.9);
        let c: [number, number, number];
        if (k < 0.22) { const t = k / 0.22; c = [hot[0] + (col[0] - hot[0]) * t, hot[1] + (col[1] - hot[1]) * t, hot[2] + (col[2] - hot[2]) * t]; }
        else { const t = (k - 0.22) / 0.78; c = [col[0] + (dim[0] - col[0]) * t, col[1] + (dim[1] - col[1]) * t, col[2] + (dim[2] - col[2]) * t]; }
        const rgb = `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
        if (s.kind === 0) {
          const sp = Math.hypot(s.vx, s.vy) || 1;
          const len = Math.min(sp * 0.03, 15);
          const ux = s.vx / sp, uy = s.vy / sp;
          const w = s.w * (1 - k * 0.55);
          const gr = w * 4.5;
          const gg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, gr);
          gg.addColorStop(0, `rgba(${rgb},${a * 0.38})`);
          gg.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = gg;
          ctx.fillRect(s.x - gr, s.y - gr, gr * 2, gr * 2);
          ctx.beginPath();
          ctx.moveTo(s.x - ux * len, s.y - uy * len);
          ctx.lineTo(s.x, s.y);
          ctx.strokeStyle = `rgba(${rgb},${a})`;
          ctx.lineWidth = w;
          ctx.stroke();
        } else {
          const tw = 0.6 + 0.4 * Math.sin(s.age * 26 + s.seed);
          const r = s.w * 0.85 * (1 - k * 0.4);
          const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 5);
          g.addColorStop(0, `rgba(${rgb},${a * tw * 0.55})`);
          g.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(s.x - r * 5, s.y - r * 5, r * 10, r * 10);
          ctx.fillStyle = `rgba(${rgb},${a * tw})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, 6.2832);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const step = (dt: number) => {
      glow *= Math.exp(-5 * dt);
      const g = live.current.gravity;
      const drag = Math.exp(-1.7 * dt);
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.age += dt;
        if (s.age >= s.life) { sparks[i] = sparks[sparks.length - 1]; sparks.pop(); continue; }
        s.vx *= drag;
        s.vy = s.vy * drag + g * (s.kind ? 0.25 : 1) * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        // Rebote en el piso del contenedor: pierde energía y casi no rueda.
        if (!global && s.y > H - 1 && s.vy > 0) { s.y = H - 1; s.vy *= -0.32; s.vx *= 0.72; }
      }
    };

    const frame = (nowMs: number) => {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0.001, (nowMs - last) / 1000));
      last = nowMs;
      const auto = live.current.autoplay && (!inside || nowMs - lastReal > 2500);
      if (auto) {
        // Paseo de Lissajous para que la demo se entienda sola.
        const t = nowMs / 1000;
        const sc = global ? { w: W, h: H } : { w: W, h: H };
        move(sc.w * (0.5 + 0.34 * Math.sin(t * 1.05)), sc.h * (0.46 + 0.26 * Math.sin(t * 1.7 + 0.6)), nowMs);
      }
      step(dt);
      draw();
      if ((sparks.length || auto || glow > 0.02) && visible) raf = requestAnimationFrame(frame);
      else if (!sparks.length) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); }
    };
    const wake = () => {
      if (raf || !visible) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const target: EventTarget = global ? window : el;
    const onMove = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType === "touch") return;
      const r = global ? { left: 0, top: 0 } : el.getBoundingClientRect();
      inside = true;
      lastReal = performance.now();
      move(pe.clientX - r.left, pe.clientY - r.top, performance.now());
      wake();
    };
    const onLeave = () => { inside = false; has = false; wake(); };
    target.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);

    const io = new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
      if (visible) wake();
      else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    });
    io.observe(el);
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    if (global) window.addEventListener("resize", resize);
    resize();
    wake();
    return () => {
      cancelAnimationFrame(raf);
      target.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (global) window.removeEventListener("resize", resize);
      io.disconnect();
      ro.disconnect();
    };
  }, [global]);

  return (
    <div ref={host} className={`furin-spark-trail ${className}`} style={style}>
      <div className="furin-spark-trail__contenido">
        {children ?? <span className="furin-spark-trail__pista">{hint}</span>}
      </div>
      {activo ? <canvas ref={canvas} aria-hidden="true" className={`furin-spark-trail__canvas${global ? " furin-spark-trail__canvas--global" : ""}`} /> : null}
    </div>
  );
}

export default SparkTrail;
