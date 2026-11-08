"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./RetroGrid.css";

export interface RetroGridProps {
  /** Contenido que va encima de la rejilla. */
  children?: ReactNode;
  /** Color de las líneas de la rejilla. */
  color?: string;
  /** Color del sol y del brillo del horizonte. */
  accent?: string;
  /** Color del fondo. */
  background?: string;
  /** Velocidad con la que avanza la rejilla. */
  speed?: number;
  /** Cuántas líneas verticales caben en el ancho. */
  columns?: number;
  /** Muestra el sol sobre el horizonte. */
  sun?: boolean;
  /** Qué tanto mueve el cursor el horizonte (paralaje). */
  parallax?: number;
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

/** Fondo de rejilla infinita: un suelo en perspectiva que avanza hacia un horizonte con un sol sobrio y estrellas lejanas. */
export function RetroGrid({
  children,
  color = "#8f9cd8",
  accent = "#f0b08a",
  background = "#0a0a12",
  speed = 1,
  columns = 16,
  sun = true,
  parallax = 1,
  className = "",
  style,
}: RetroGridProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const props = useRef({ color, accent, background, speed, columns, sun, parallax });
  props.current = { color, accent, background, speed, columns, sun, parallax };
  const wakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-retro-grid__lienzo";
    canvas.setAttribute("aria-hidden", "true");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    root.insertBefore(canvas, root.firstChild);

    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, muerto = false, ult = 0;
    let avance = reducido ? 0.35 : 0, t = 0;
    const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
    let impulso = 0, impulsoObj = 0;
    // Estrellas fijas en el cielo, con su propio parpadeo.
    const estrellas = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() ** 1.4, r: 0.4 + Math.random() * 0.9, f: Math.random() * 6.28, a: 0.25 + Math.random() * 0.6 }));

    const pintar = () => {
      const p = props.current;
      const [cr, cg, cb] = rgb(p.color, [143, 156, 216]);
      const [ar, ag, ab] = rgb(p.accent, [240, 176, 138]);
      const [br, bg, bb] = rgb(p.background, [10, 10, 18]);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Horizonte y punto de fuga con paralaje del cursor.
      const yh = h * 0.5 + ptr.y * h * 0.05 * p.parallax;
      const vx = w / 2 - ptr.x * w * 0.12 * p.parallax;
      const suelo = h - yh;

      // Cielo: del fondo hacia un resplandor cálido pegado al horizonte.
      const cielo = ctx.createLinearGradient(0, 0, 0, yh);
      cielo.addColorStop(0, `rgb(${br},${bg},${bb})`);
      cielo.addColorStop(0.62, `rgb(${br},${bg},${bb})`);
      cielo.addColorStop(1, `rgb(${Math.round(br + (ar - br) * 0.2)},${Math.round(bg + (ag - bg) * 0.2)},${Math.round(bb + (ab - bb) * 0.2)})`);
      ctx.fillStyle = cielo;
      ctx.fillRect(0, 0, w, yh);
      ctx.fillStyle = `rgb(${br},${bg},${bb})`;
      ctx.fillRect(0, yh, w, suelo);

      for (const e of estrellas) {
        const y = e.y * yh * 0.9;
        const a = e.a * (0.55 + 0.45 * Math.sin(t * 1.2 + e.f)) * (1 - y / yh);
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.fillRect(e.x * w, y, e.r, e.r);
      }

      // Sol: disco con degradé, cortado por rendijas horizontales que crecen hacia abajo y suben despacio.
      const R = Math.min(w, h) * 0.24;
      if (p.sun) {
        const cx = vx, cy = yh - R * 0.5;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, w, yh); ctx.clip();
        ctx.globalCompositeOperation = "lighter";
        const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 3);
        halo.addColorStop(0, `rgba(${ar},${ag},${ab},0.2)`);
        halo.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
        ctx.fillStyle = halo; ctx.fillRect(0, 0, w, yh);
        ctx.globalCompositeOperation = "source-over";
        const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
        g.addColorStop(0, `rgba(${Math.min(255, ar + 12)},${Math.min(255, ag + 40)},${Math.min(255, ab + 50)},0.9)`);
        g.addColorStop(1, `rgba(${ar},${Math.round(ag * 0.62)},${Math.round(ab * 0.85)},0.78)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();
        // Rendijas: se repinta el cielo dentro del disco, así parecen cortes que dejan ver lo de atrás.
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R + 0.5, 0, 6.2832); ctx.clip();
        ctx.fillStyle = cielo;
        const fase = (t * 0.05) % 1;
        const top = cy - R * 0.1;
        for (let k = 0; k < 6; k++) {
          const f = (k + fase) / 6;
          ctx.fillRect(cx - R - 2, top + (yh - top) * f, R * 2 + 4, 0.8 + f * 5.5);
        }
        ctx.restore();
        ctx.restore();
      }

      // Rejilla: horizontales que vienen hacia ti (z decreciente) y verticales que nacen del punto de fuga.
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "butt";
      const dz = 0.95;
      const zMax = 38;
      for (let k = 0; k < 42; k++) {
        const z = 1 + (k - avance) * dz;
        if (z < 1 || z > zMax) continue;
        const y = yh + suelo / z;
        const lejania = 1 - z / zMax;
        const a = Math.pow(lejania, 1.7);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(0.55 * a).toFixed(3)})`;
        ctx.lineWidth = 0.6 + 0.9 * Math.min(1, 2 / z);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(0.07 * a).toFixed(3)})`;
        ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      const sep = (w * 1.0) / Math.max(4, p.columns);
      const J = Math.ceil(p.columns * 1.5);
      ctx.beginPath();
      for (let j = -J; j <= J; j++) {
        const xb = vx + j * sep * 1.0;
        if (xb < -w * 1.2 || xb > w * 2.2) continue;
        ctx.moveTo(vx + (xb - vx) * 0.02, yh + suelo * 0.0);
        ctx.lineTo(xb + (xb - vx) * 0.0, h);
      }
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.42)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";

      // Niebla del horizonte: tapa la rejilla lejana con el color del fondo y deja un hilo de luz en el horizonte.
      const niebla = ctx.createLinearGradient(0, yh, 0, yh + suelo * 0.55);
      niebla.addColorStop(0, `rgba(${br},${bg},${bb},1)`);
      niebla.addColorStop(0.35, `rgba(${br},${bg},${bb},0.7)`);
      niebla.addColorStop(1, `rgba(${br},${bg},${bb},0)`);
      ctx.fillStyle = niebla;
      ctx.fillRect(0, yh, w, suelo * 0.55);
      ctx.globalCompositeOperation = "lighter";
      const hl = ctx.createLinearGradient(0, 0, w, 0);
      hl.addColorStop(0, `rgba(${ar},${ag},${ab},0)`);
      hl.addColorStop(0.5, `rgba(${ar},${ag},${ab},0.55)`);
      hl.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
      ctx.fillStyle = hl;
      ctx.fillRect(0, yh - 0.5, w, 1.2);
      const hg = ctx.createLinearGradient(0, yh - 24, 0, yh + 6);
      hg.addColorStop(0, `rgba(${ar},${ag},${ab},0)`);
      hg.addColorStop(1, `rgba(${ar},${ag},${ab},0.16)`);
      ctx.fillStyle = hg;
      ctx.fillRect(0, yh - 24, w, 30);
      ctx.globalCompositeOperation = "source-over";
    };

    const paso = (ts: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.05, ult ? (ts - ult) / 1000 : 0.016);
      ult = ts;
      t += dt;
      impulso += (impulsoObj - impulso) * (1 - Math.exp(-dt * 3));
      avance = (avance + dt * 0.55 * props.current.speed * (1 + impulso * 3)) % 1000;
      const k = 1 - Math.exp(-dt * 4);
      ptr.x += (ptr.tx - ptr.x) * k; ptr.y += (ptr.ty - ptr.y) * k;
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
      ptr.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptr.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    const onLeave = () => { ptr.tx = 0; ptr.ty = 0; impulsoObj = 0; };
    const onDown = (e: PointerEvent) => { onMove(e); impulsoObj = 1; };
    const onUp = () => { impulsoObj = 0; };
    if (!reducido) {
      root.addEventListener("pointermove", onMove, { passive: true });
      root.addEventListener("pointerdown", onDown, { passive: true });
      root.addEventListener("pointerup", onUp);
      root.addEventListener("pointercancel", onUp);
      root.addEventListener("pointerleave", onLeave);
    }
    medir();

    return () => {
      muerto = true;
      wakeRef.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("pointerleave", onLeave);
      canvas.remove();
    };
  }, []);

  useEffect(() => { wakeRef.current?.(); }, [color, accent, background, speed, columns, sun, parallax]);

  const vars = { "--furin-retro-grid-bg": background } as CSSProperties;
  return (
    <div ref={rootRef} className={`furin-retro-grid ${className}`} style={{ ...vars, ...style }}>
      <span className="furin-retro-grid__vineta" aria-hidden="true" />
      {children != null ? <div className="furin-retro-grid__contenido">{children}</div> : null}
    </div>
  );
}

export default RetroGrid;
