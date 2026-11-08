"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./WarpStars.css";

export interface WarpStarsProps {
  /** Contenido que va encima de las estrellas. */
  children?: ReactNode;
  /** Velocidad del salto (1 = crucero). */
  speed?: number;
  /** Cantidad de estrellas (1 = normal). */
  density?: number;
  /** Largo de las estelas. */
  trail?: number;
  /** Qué tanto el cursor dirige el punto de fuga. */
  steer?: number;
  /** Color de las estrellas (se mezcla con un tinte cálido y uno frío). */
  color?: string;
  /** Color del fondo del espacio. */
  background?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

interface Estrella { x: number; y: number; z: number; t: number; }

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

const NIVELES = 8;

/** Fondo de salto a warp: estrellas con estelas que salen del punto de fuga, y el cursor gira el rumbo. */
export function WarpStars({
  children,
  speed = 1,
  density = 1,
  trail = 1,
  steer = 1,
  color = "#d6e4ff",
  background = "#05060a",
  className = "",
  style,
}: WarpStarsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const props = useRef({ speed, density, trail, steer, color });
  props.current = { speed, density, trail, steer, color };
  const wakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-warp-stars__lienzo";
    canvas.setAttribute("aria-hidden", "true");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    root.insertBefore(canvas, root.firstChild);

    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, muerto = false, ult = 0;
    let estrellas: Estrella[] = [];
    // Punto de fuga: sigue al cursor con inercia; sin cursor se pasea despacio.
    const vp = { x: 0, y: 0, tx: 0, ty: 0, hay: false };
    let impulso = 0, impulsoObj = 0; // mantener presionado = salto hiperespacial
    let tiempo = 0;

    let tintes: string[][] = [];
    const armarTintes = () => {
      const [r, g, b] = rgb(props.current.color, [214, 228, 255]);
      const mezcla = (m: [number, number, number], k: number): [number, number, number] => [r + (m[0] - r) * k, g + (m[1] - g) * k, b + (m[2] - b) * k];
      const base: [number, number, number][] = [[r, g, b], mezcla([255, 214, 170], 0.55), mezcla([140, 175, 255], 0.55)];
      tintes = base.map(([R, G, B]) => Array.from({ length: NIVELES }, (_, i) => `rgba(${R | 0},${G | 0},${B | 0},${((i + 1) / NIVELES).toFixed(3)})`));
    };
    armarTintes();

    const nueva = (e: Estrella, alAzar: boolean) => {
      e.x = (Math.random() * 2 - 1) * 1.15;
      e.y = (Math.random() * 2 - 1) * 1.15;
      // Con alAzar la estrella nace en cualquier profundidad (pantalla llena desde el primer cuadro).
      e.z = alAzar ? 0.04 + Math.random() * 0.96 : 0.82 + Math.random() * 0.18;
      const q = Math.random();
      e.t = q < 0.62 ? 0 : q < 0.82 ? 1 : 2;
    };
    const ajustarCantidad = () => {
      const n = Math.max(120, Math.min(2800, Math.round(props.current.density * 0.0055 * w * h)));
      while (estrellas.length < n) { const e = { x: 0, y: 0, z: 1, t: 0 }; nueva(e, true); estrellas.push(e); }
      if (estrellas.length > n) estrellas.length = n;
    };

    const pintar = (dt: number) => {
      const p = props.current;
      const f = Math.max(w, h) * 0.5;
      // Cámara: con cursor se orienta hacia él; sin cursor traza una elipse lenta.
      const cx0 = w / 2, cy0 = h / 2;
      let tx = vp.tx, ty = vp.ty;
      if (!vp.hay) { tx = cx0 + Math.sin(tiempo * 0.23) * w * 0.07; ty = cy0 + Math.sin(tiempo * 0.17 + 1) * h * 0.06; }
      else { tx = cx0 + (vp.tx - cx0) * 0.75 * p.steer; ty = cy0 + (vp.ty - cy0) * 0.75 * p.steer; }
      const k = 1 - Math.exp(-dt * 3.2);
      vp.x += (tx - vp.x) * k; vp.y += (ty - vp.y) * k;
      impulso += (impulsoObj - impulso) * (1 - Math.exp(-dt * (impulsoObj > impulso ? 4 : 2.2)));

      const vel = p.speed * (0.5 + impulso * 1.6);
      // La estela es la distancia que recorre la estrella en una fracción de segundo: más rápido, más larga.
      const tau = (0.2 + 0.22 * impulso) * p.trail;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";

      // Resplandor en el punto de fuga, como la luz al final del túnel.
      const gr = ctx.createRadialGradient(vp.x, vp.y, 0, vp.x, vp.y, Math.max(w, h) * 0.5);
      gr.addColorStop(0, `rgba(150,180,255,${0.09 + 0.2 * impulso})`);
      gr.addColorStop(0.35, `rgba(110,140,230,${0.03 + 0.07 * impulso})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = "lighter";
      for (const e of estrellas) {
        const dz = vel * (0.22 + 0.55 * (1 - e.z));
        e.z -= dz * dt;
        const sx = vp.x + (e.x * f) / e.z, sy = vp.y + (e.y * f) / e.z;
        if (e.z < 0.02 || sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) { nueva(e, false); continue; }
        const zt = e.z + dz * tau;
        const px = vp.x + (e.x * f) / zt, py = vp.y + (e.y * f) / zt;
        const cerca = 1 - e.z;
        const alfa = Math.min(1, cerca * 3.2) * (0.5 + 0.5 * cerca);
        const nivel = Math.max(0, Math.min(NIVELES - 1, Math.round(alfa * NIVELES) - 1));
        const tinte = tintes[e.t][nivel];
        const lw = 0.7 + 2.6 * cerca * cerca;
        // Las más cercanas se ven desenfocadas y con aberración cromática: profundidad de campo.
        if (e.z < 0.2) {
          const dx = sx - vp.x, dy = sy - vp.y, d = Math.hypot(dx, dy) || 1;
          const ab = (0.2 - e.z) * 9;
          ctx.lineWidth = lw * 3.2;
          ctx.strokeStyle = `rgba(255,255,255,${(0.05 * (0.2 - e.z) * 5).toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();
          ctx.lineWidth = lw * 0.8;
          ctx.strokeStyle = `rgba(255,90,60,${(0.22 * alfa).toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(px + (dx / d) * ab, py + (dy / d) * ab); ctx.lineTo(sx + (dx / d) * ab, sy + (dy / d) * ab); ctx.stroke();
          ctx.strokeStyle = `rgba(70,130,255,${(0.28 * alfa).toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(px - (dx / d) * ab, py - (dy / d) * ab); ctx.lineTo(sx - (dx / d) * ab, sy - (dy / d) * ab); ctx.stroke();
        }
        // Estela: un trazo tenue entero y otro vivo en la cabeza, para que se afine hacia atrás.
        ctx.lineWidth = lw;
        ctx.strokeStyle = tintes[e.t][Math.max(0, nivel - 3)];
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();
        ctx.strokeStyle = tinte;
        ctx.beginPath(); ctx.moveTo(px + (sx - px) * 0.55, py + (sy - py) * 0.55); ctx.lineTo(sx, sy); ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const paso = (ts: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.05, ult ? (ts - ult) / 1000 : 0.016);
      ult = ts;
      tiempo += dt;
      pintar(dt);
      raf = requestAnimationFrame(paso);
    };
    const wake = () => { if (!raf && visible && !muerto) { ult = 0; raf = requestAnimationFrame(paso); } };
    wakeRef.current = () => { armarTintes(); ajustarCantidad(); if (reducido) pintar(0.016); else wake(); };

    const medir = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = root.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      if (!vp.x) { vp.x = w / 2; vp.y = h / 2; }
      ajustarCantidad();
      if (reducido) { for (const e of estrellas) nueva(e, true); pintar(0.016); } else wake();
    };
    const ro = new ResizeObserver(medir);
    ro.observe(root);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "80px" });
    io.observe(root);

    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      vp.tx = e.clientX - r.left; vp.ty = e.clientY - r.top; vp.hay = true;
    };
    const onLeave = () => { vp.hay = false; impulsoObj = 0; };
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

  useEffect(() => { wakeRef.current?.(); }, [speed, density, trail, steer, color]);

  const vars = { "--furin-warp-stars-bg": background } as CSSProperties;
  return (
    <div ref={rootRef} className={`furin-warp-stars ${className}`} style={{ ...vars, ...style }}>
      <span className="furin-warp-stars__vineta" aria-hidden="true" />
      {children != null ? <div className="furin-warp-stars__contenido">{children}</div> : null}
    </div>
  );
}

export default WarpStars;
