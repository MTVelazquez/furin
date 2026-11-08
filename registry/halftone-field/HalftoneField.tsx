"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./HalftoneField.css";

export interface HalftoneFieldProps {
  /** Contenido que va encima del semitono. */
  children?: ReactNode;
  /** Color de la tinta principal. */
  ink?: string;
  /** Color de la segunda tinta (se sobreimprime con otro ángulo). */
  accent?: string;
  /** Color del fondo (el papel). */
  background?: string;
  /** Separación entre puntos de la trama, en px. */
  spacing?: number;
  /** Qué tan rápido se mueve el campo. */
  speed?: number;
  /** Radio de influencia del cursor, en px. */
  cursorRadius?: number;
  /** Cuánto pesa la segunda tinta (0 la apaga). */
  accentAmount?: number;
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

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Fondo de semitono de imprenta: dos tramas giradas que crecen y se encogen con un campo que fluye y con el cursor. */
export function HalftoneField({
  children,
  ink = "#e9e4d8",
  accent = "#d9573a",
  background = "#0b0c0f",
  spacing = 11,
  speed = 1,
  cursorRadius = 150,
  accentAmount = 1,
  className = "",
  style,
}: HalftoneFieldProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const props = useRef({ ink, accent, spacing, speed, cursorRadius, accentAmount });
  props.current = { ink, accent, spacing, speed, cursorRadius, accentAmount };
  const wakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-halftone-field__lienzo";
    canvas.setAttribute("aria-hidden", "true");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    root.insertBefore(canvas, root.firstChild);

    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, muerto = false, ult = 0;
    let t = reducido ? 3.4 : 2;
    const ptr = { x: -999, y: -999, tx: -999, ty: -999, k: 0, kObj: 0, hay: false };

    // Una trama: ángulo, separación relativa, fase del campo y tinta.
    const trama = (ang: number, sep: number, fase: number, rgbT: [number, number, number], alfa: number, peso: number) => {
      const p = props.current;
      const s = p.spacing * sep;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const R = Math.hypot(w, h) / 2 + s;
      const n = Math.ceil(R / s);
      const cx = w / 2, cy = h / 2;
      const rMax = s * 0.54;
      const rad = p.cursorRadius;
      const inv2 = 1 / (2 * rad * rad);
      ctx.beginPath();
      for (let j = -n; j <= n; j++) {
        for (let i = -n; i <= n; i++) {
          const x = cx + (i * ca - j * sa) * s, y = cy + (i * sa + j * ca) * s;
          if (x < -s || x > w + s || y < -s || y > h + s) continue;
          const u = x / 330, v = y / 330;
          // Campo: dos ondas deformadas que se multiplican; da manchas grandes y suaves de tono.
          const f = Math.sin(u * 1.35 + Math.sin(v * 1.15 + t * 0.55 + fase) * 1.25 + t * 0.4 + fase) * Math.sin(v * 1.75 + Math.sin(u * 0.95 - t * 0.5) * 1.4 - t * 0.3 - fase);
          let tono = smooth(-0.32, 0.95, f) * peso;
          // Atenúa el centro para que un titular respire sobre la trama.
          const dx0 = (x - cx) / w, dy0 = (y - cy) / h;
          tono *= 0.45 + 0.55 * smooth(0.02, 0.2, dx0 * dx0 + dy0 * dy0);
          if (ptr.k > 0.01) {
            const dx = x - ptr.x, dy = y - ptr.y, d2 = dx * dx + dy * dy;
            const g = Math.exp(-d2 * inv2);
            // El cursor infla los puntos cercanos, con un anillo que respira alrededor.
            tono += ptr.k * (0.5 * g + 0.12 * g * Math.cos(Math.sqrt(d2) * 0.09 - t * 6));
          }
          if (tono < 0.03) continue;
          const r = rMax * Math.sqrt(Math.min(0.95, tono));
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, 6.2832);
        }
      }
      ctx.fillStyle = `rgba(${rgbT[0]},${rgbT[1]},${rgbT[2]},${alfa})`;
      ctx.fill();
    };

    const pintar = () => {
      const p = props.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const a = rgb(p.accent, [217, 87, 58]);
      const b = rgb(p.ink, [233, 228, 216]);
      if (p.accentAmount > 0.01) trama((75 * Math.PI) / 180, 1.32, 2.1, a, 0.9, 0.78 * Math.min(1, p.accentAmount));
      trama((15 * Math.PI) / 180, 1, 0, b, 0.9, 0.85);
    };

    const paso = (ts: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.05, ult ? (ts - ult) / 1000 : 0.016);
      ult = ts;
      t += dt * 0.22 * props.current.speed;
      ptr.x += (ptr.tx - ptr.x) * (1 - Math.exp(-dt * 10)); ptr.y += (ptr.ty - ptr.y) * (1 - Math.exp(-dt * 10));
      ptr.k += (ptr.kObj - ptr.k) * (1 - Math.exp(-dt * 5));
      pintar();
      raf = requestAnimationFrame(paso);
    };
    const wake = () => { if (reducido) return; if (!raf && visible && !muerto) { ult = 0; raf = requestAnimationFrame(paso); } };
    wakeRef.current = () => { if (reducido) pintar(); else wake(); };

    const medir = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = root.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      pintar();
      wake();
    };
    const ro = new ResizeObserver(medir);
    ro.observe(root);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "80px" });
    io.observe(root);

    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      ptr.tx = e.clientX - r.left; ptr.ty = e.clientY - r.top;
      if (!ptr.hay) { ptr.x = ptr.tx; ptr.y = ptr.ty; ptr.hay = true; }
      ptr.kObj = 1;
    };
    const onLeave = () => { ptr.kObj = 0; ptr.hay = false; };
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

  useEffect(() => { wakeRef.current?.(); }, [ink, accent, spacing, speed, cursorRadius, accentAmount]);

  const vars = { "--furin-halftone-field-bg": background } as CSSProperties;
  return (
    <div ref={rootRef} className={`furin-halftone-field ${className}`} style={{ ...vars, ...style }}>
      {children != null ? <div className="furin-halftone-field__contenido">{children}</div> : null}
    </div>
  );
}

export default HalftoneField;
