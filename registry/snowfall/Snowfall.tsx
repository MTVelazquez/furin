"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./Snowfall.css";

export interface SnowfallProps {
  /** Contenido que va encima de la nieve. */
  children?: ReactNode;
  /** Color de los copos. */
  color?: string;
  /** Color del fondo de la noche. */
  background?: string;
  /** Cuántos copos caen (1 = normal). */
  density?: number;
  /** Velocidad de caída (1 = normal). */
  speed?: number;
  /** Fuerza del viento que levanta el cursor. */
  wind?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

let colorCtx: CanvasRenderingContext2D | null = null;
const RGB_CACHE = new Map<string, [number, number, number]>();
function rgb(css: string, def: [number, number, number]): [number, number, number] {
  const hit = RGB_CACHE.get(css);
  if (hit) return hit;
  try {
    colorCtx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    colorCtx.clearRect(0, 0, 1, 1);
    colorCtx.fillStyle = "#010203";
    colorCtx.fillStyle = css;
    colorCtx.fillRect(0, 0, 1, 1);
    const d = colorCtx.getImageData(0, 0, 1, 1).data;
    const out: [number, number, number] = [d[0], d[1], d[2]];
    if (RGB_CACHE.size > 64) RGB_CACHE.clear();
    RGB_CACHE.set(css, out);
    return out;
  } catch {
    return def;
  }
}

interface Copo { x: number; y: number; r: number; vy: number; fase: number; freq: number; amp: number; a: number; }
interface Capa { copos: Copo[]; viento: number; velMul: number; sprite: number; }

/** Fondo de nevada: tres planos de profundidad (lejano, medio y un bokeh cercano) y un viento que sopla hacia donde está el cursor. */
export function Snowfall({
  children,
  color = "#e6eeff",
  background = "#070a10",
  density = 1,
  speed = 1,
  wind = 1,
  className = "",
  style,
}: SnowfallProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const props = useRef({ color, density, speed, wind });
  props.current = { color, density, speed, wind };
  const wakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-snowfall__lienzo";
    canvas.setAttribute("aria-hidden", "true");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    root.insertBefore(canvas, root.firstChild);

    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, muerto = false, ult = 0, t = 0;
    let capas: Capa[] = [];
    let sprites: HTMLCanvasElement[] = [];
    let vientoActual = 0;
    const ptr = { x: 0.5, lx: 0, lt: 0, racha: 0, hay: false };
    let densClave = -1;

    // Tres sprites: copo nítido, copo suave y disco de bokeh (más claro en el borde, como un lente desenfocado).
    const armarSprites = () => {
      const [r, g, b] = rgb(props.current.color, [230, 238, 255]);
      const mk = (pinta: (c: CanvasRenderingContext2D) => void) => {
        const cv = document.createElement("canvas"); cv.width = cv.height = 64;
        pinta(cv.getContext("2d")!); return cv;
      };
      sprites = [
        mk((c) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(0.35, `rgba(${r},${g},${b},0.75)`); gr.addColorStop(0.7, `rgba(${r},${g},${b},0.12)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); }),
        mk((c) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, `rgba(${r},${g},${b},0.9)`); gr.addColorStop(0.5, `rgba(${r},${g},${b},0.35)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); }),
        mk((c) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 31); gr.addColorStop(0, `rgba(${r},${g},${b},0.5)`); gr.addColorStop(0.55, `rgba(${r},${g},${b},0.6)`); gr.addColorStop(0.8, `rgba(${r},${g},${b},0.4)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); }),
      ];
    };

    const nuevo = (c: Copo, tipo: number, anywhere: boolean) => {
      c.x = Math.random() * w;
      c.y = anywhere ? Math.random() * h : -10 - Math.random() * 30;
      c.fase = Math.random() * 6.28;
      if (tipo === 0) { c.r = 0.9 + Math.random() * 1.1; c.vy = 18 + Math.random() * 14; c.a = 0.35 + Math.random() * 0.35; c.amp = 6; c.freq = 0.5 + Math.random() * 0.8; }
      else if (tipo === 1) { c.r = 2.2 + Math.random() * 2.4; c.vy = 40 + Math.random() * 28; c.a = 0.5 + Math.random() * 0.4; c.amp = 12; c.freq = 0.6 + Math.random() * 1; }
      else { c.r = 9 + Math.random() * 12; c.vy = 95 + Math.random() * 60; c.a = 0.09 + Math.random() * 0.13; c.amp = 22; c.freq = 0.4 + Math.random() * 0.6; }
    };

    const armar = () => {
      const p = props.current;
      densClave = p.density;
      const total = Math.max(40, Math.round(((w * h) / 850) * p.density));
      const reparto = [0.52, 0.42, 0.06];
      capas = reparto.map((f, tipo) => {
        const copos: Copo[] = Array.from({ length: Math.max(3, Math.round(total * f)) }, () => { const c = { x: 0, y: 0, r: 1, vy: 1, fase: 0, freq: 1, amp: 1, a: 1 }; nuevo(c, tipo, true); return c; });
        return { copos, viento: [0.3, 0.75, 1.5][tipo], velMul: 1, sprite: [1, 0, 2][tipo] };
      });
    };

    const pintar = (dt: number) => {
      const p = props.current;
      // Viento: una brisa lenta que respira + el empuje del cursor (a la derecha si está a la derecha) + rachas al moverlo.
      const brisa = Math.sin(t * 0.37) * 10 + Math.sin(t * 0.91 + 1) * 5;
      const objetivo = brisa + (ptr.hay ? (ptr.x - 0.5) * 2 * 170 * p.wind : 0) + ptr.racha * p.wind;
      vientoActual += (objetivo - vientoActual) * (1 - Math.exp(-dt * 1.6));
      ptr.racha *= Math.exp(-dt * 1.8);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      for (const capa of capas) {
        const sp = sprites[capa.sprite];
        if (!sp) continue;
        const sw = capa.sprite === 2;
        for (const c of capa.copos) {
          const turb = 1 + 0.18 * Math.sin(t * 0.8 + c.fase + c.y * 0.01);
          c.y += c.vy * p.speed * turb * dt;
          c.x += (vientoActual * capa.viento + Math.sin(t * c.freq + c.fase) * c.amp) * dt;
          // La caída se inclina con el viento: copos que se arrastran un poco hacia abajo menos.
          if (c.y > h + c.r * 2) { nuevo(c, capa.sprite === 1 ? 0 : capa.sprite === 0 ? 1 : 2, false); if (Math.abs(vientoActual) > 40) c.x = vientoActual > 0 ? Math.random() * w - w * 0.2 : Math.random() * w * 1.2; }
          if (c.x < -c.r * 2) c.x += w + c.r * 4;
          else if (c.x > w + c.r * 2) c.x -= w + c.r * 4;
          // Los de bokeh se ven "respirar" un poco al enfocar.
          const rr = sw ? c.r * (1 + 0.06 * Math.sin(t * 0.9 + c.fase)) : c.r;
          ctx.globalAlpha = c.a * (c.y < 30 ? Math.max(0, c.y / 30) : 1);
          ctx.drawImage(sp, c.x - rr * 2, c.y - rr * 2, rr * 4, rr * 4);
        }
      }
      ctx.globalAlpha = 1;
    };

    const paso = (ts: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.05, ult ? (ts - ult) / 1000 : 0.016);
      ult = ts;
      t += dt;
      pintar(dt);
      raf = requestAnimationFrame(paso);
    };
    const wake = () => { if (reducido) return; if (!raf && visible && !muerto) { ult = 0; raf = requestAnimationFrame(paso); } };
    wakeRef.current = () => {
      armarSprites();
      if (densClave !== props.current.density) armar();
      if (reducido) pintar(0.016); else wake();
    };

    const medir = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = root.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      armarSprites();
      armar();
      if (reducido) pintar(0.016); else { pintar(0.016); wake(); }
    };
    const ro = new ResizeObserver(medir);
    ro.observe(root);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "80px" });
    io.observe(root);

    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      const x = e.clientX - r.left;
      const ahora = performance.now();
      if (ptr.hay && ahora - ptr.lt > 0 && ahora - ptr.lt < 120) ptr.racha = Math.max(-260, Math.min(260, ptr.racha + ((x - ptr.lx) / Math.max(1, ahora - ptr.lt)) * 18));
      ptr.lx = x; ptr.lt = ahora; ptr.x = x / Math.max(1, r.width); ptr.hay = true;
    };
    const onLeave = () => { ptr.hay = false; };
    if (!reducido) {
      root.addEventListener("pointermove", onMove, { passive: true });
      root.addEventListener("pointerdown", onMove, { passive: true });
      root.addEventListener("pointerleave", onLeave);
    }
    medir();

    return () => {
      muerto = true;
      wakeRef.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onMove);
      root.removeEventListener("pointerleave", onLeave);
      canvas.remove();
    };
  }, []);

  useEffect(() => { wakeRef.current?.(); }, [color, density, speed, wind]);

  const vars = { "--furin-snowfall-bg": background, "--furin-snowfall-bg2": `color-mix(in srgb, ${background} 82%, #4d6a9c)` } as CSSProperties;
  return (
    <div ref={rootRef} className={`furin-snowfall ${className}`} style={{ ...vars, ...style }}>
      <span className="furin-snowfall__bruma" aria-hidden="true" />
      {children != null ? <div className="furin-snowfall__contenido">{children}</div> : null}
    </div>
  );
}

export default Snowfall;
