"use client";
import { useEffect, useId, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import "./GlassCard.css";

/* ---------- Refracción real (solo Chromium): mapa de desplazamiento generado en canvas ---------- */

/** Solo Chromium acepta url(#filtro) dentro de backdrop-filter; el resto cae al desenfoque simple. */
function canRefract(): boolean {
  if (typeof CSS === "undefined" || typeof navigator === "undefined") return false;
  return /Chrome\//.test(navigator.userAgent) && CSS.supports("backdrop-filter", "url(#a)");
}

interface RefractionMap { url: string; scale: number; w: number; h: number }

/** Mapa de desplazamiento: en el bisel la luz se curva hacia adentro y, con zoom > 1, el centro también amplía. */
function buildRefractionMap(w: number, h: number, radius: number, bezel: number, zoom = 1): RefractionMap | null {
  if (w < 4 || h < 4) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const vx = new Float32Array(w * h);
  const vy = new Float32Array(w * h);
  const hw = w / 2, hh = h / 2, r = Math.min(radius, hw, hh);
  const k = 1 - 1 / zoom;
  let max = 0.001;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw, py = y + 0.5 - hh;
      const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
      const sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      if (sdf > 0) continue;
      let nx: number, ny: number;
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = (Math.sign(px) * qx) / l; ny = (Math.sign(py) * qy) / l; }
      else if (qx > qy) { nx = Math.sign(px); ny = 0; }
      else { nx = 0; ny = Math.sign(py); }
      const t = Math.min(1, -sdf / bezel);
      const m = Math.pow(1 - t, 2.2) * bezel;
      const dx = -nx * m - px * k, dy = -ny * m - py * k;
      const i = y * w + x;
      vx[i] = dx;
      vy[i] = dy;
      max = Math.max(max, Math.abs(dx), Math.abs(dy));
    }
  }
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = Math.round(127.5 + (127.5 * vx[i]) / max);
    d[i * 4 + 1] = Math.round(127.5 + (127.5 * vy[i]) / max);
    d[i * 4 + 2] = 128;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { url: c.toDataURL("image/png"), scale: max * 2, w, h };
}

/** Mide el elemento y mantiene su mapa de refracción al día (solo si el navegador lo soporta). */
function useRefractionMap(ref: React.RefObject<HTMLElement | null>, radius: number, bezel: number, zoom = 1): RefractionMap | null {
  const [mapa, setMapa] = useState<RefractionMap | null>(null);
  useEffect(() => {
    if (!canRefract()) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const run = () => {
      const m = buildRefractionMap(el.offsetWidth, el.offsetHeight, radius, bezel, zoom);
      if (m) setMapa((p) => (p && p.w === m.w && p.h === m.h ? p : m));
    };
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); });
    ro.observe(el);
    run();
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [ref, radius, bezel, zoom]);
  return mapa;
}

/** Filtro SVG: desenfoque, desplazamiento por el mapa y saturación; con dispersión separa los canales RGB como un cristal real. */
function RefractionFilter({ id, mapa, strength, blur = 0, saturate = 1.6, dispersion = 0 }: { id: string; mapa: RefractionMap; strength: number; blur?: number; saturate?: number; dispersion?: number }) {
  const s = mapa.scale * strength;
  const disp = (scale: number, result: string) => (
    <feDisplacementMap in="src" in2="mapa" scale={scale} xChannelSelector="R" yChannelSelector="G" result={result} />
  );
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <filter id={id} x="0" y="0" width={mapa.w} height={mapa.h} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feImage href={mapa.url} x="0" y="0" width={mapa.w} height={mapa.h} preserveAspectRatio="none" result="mapa" />
        <feGaussianBlur in="SourceGraphic" stdDeviation={Math.max(blur, 0.01)} result="src" />
        {dispersion > 0 ? (
          <>
            {disp(s * (1 + dispersion), "dr")}
            <feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            {disp(s, "dg")}
            <feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            {disp(s * (1 - dispersion), "db")}
            <feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
            <feBlend in="r" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="b" mode="screen" result="rgb" />
          </>
        ) : (
          disp(s, "rgb")
        )}
        <feColorMatrix in="rgb" type="saturate" values={String(saturate)} />
      </filter>
    </svg>
  );
}

/** Valor de backdrop-filter: el filtro SVG si hay refracción; desenfoque + saturación si no. */
function glassBackdrop(id: string, mapa: RefractionMap | null, blur: number, saturate = 1.6): string {
  return mapa ? `url(#${id})` : `blur(${blur}px) saturate(${saturate}) brightness(1.06)`;
}

export interface GlassCardProps {
  /** Título de la tarjeta. */
  children?: ReactNode;
  /** Texto pequeño debajo del título. */
  caption?: string;
  /** Radio de las esquinas, en px. */
  radius?: number;
  /** Desenfoque del fondo detrás del vidrio, en px. */
  blur?: number;
  /** Fuerza de la refracción en el borde (0 = sin curvar la luz). */
  refraction?: number;
  /** Separación de colores (aberración cromática) en el borde, de 0 a 0.5. */
  dispersion?: number;
  /** Color del tinte del vidrio. */
  tint?: string;
  /** Intensidad del reflejo que sigue al cursor, de 0 a 1. */
  glare?: number;
  /** Inclinación máxima de la tarjeta bajo el cursor, en grados. */
  tilt?: number;
  /** Pinta una escena de color animada detrás (para verla refractar). */
  scene?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

/** Tarjeta de vidrio líquido: refracta lo que hay detrás, borde especular y un reflejo que persigue al cursor. */
export function GlassCard({
  children,
  caption = "",
  radius = 30,
  blur = 1.2,
  refraction = 1,
  dispersion = 0.12,
  tint = "rgba(255,255,255,0.10)",
  glare = 0.55,
  tilt = 6,
  scene = false,
  className = "",
  style,
}: GlassCardProps) {
  const root = useRef<HTMLDivElement>(null);
  const glass = useRef<HTMLDivElement>(null);
  const fid = "furin-glass-card-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const mapa = useRefractionMap(glass, radius, Math.min(22, radius * 0.75), 1);

  // Luz y inclinación: un resorte suave persigue al cursor y duerme cuando llega.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const quiet = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cur = { u: 0.2, v: 0.04, h: 0 };
    const tar = { u: 0.2, v: 0.04, h: 0 };
    let raf = 0;
    const paint = () => {
      el.style.setProperty("--furin-glass-card-mx", `${(cur.u * 100).toFixed(2)}%`);
      el.style.setProperty("--furin-glass-card-my", `${(cur.v * 100).toFixed(2)}%`);
      el.style.setProperty("--furin-glass-card-h", cur.h.toFixed(3));
      el.style.setProperty("--furin-glass-card-rx", `${(-(cur.v - 0.5) * 2 * tilt * cur.h).toFixed(2)}deg`);
      el.style.setProperty("--furin-glass-card-ry", `${((cur.u - 0.5) * 2 * tilt * cur.h).toFixed(2)}deg`);
    };
    const tick = () => {
      const k = 0.16;
      cur.u += (tar.u - cur.u) * k;
      cur.v += (tar.v - cur.v) * k;
      cur.h += (tar.h - cur.h) * 0.1;
      paint();
      const done = Math.abs(tar.u - cur.u) + Math.abs(tar.v - cur.v) + Math.abs(tar.h - cur.h) < 0.002;
      raf = done ? 0 : requestAnimationFrame(tick);
    };
    const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const move = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      tar.u = (e.clientX - b.left) / b.width;
      tar.v = (e.clientY - b.top) / b.height;
      tar.h = 1;
      if (quiet) { Object.assign(cur, tar); cur.h = 0.6; paint(); } else wake();
    };
    const leave = () => { tar.u = 0.2; tar.v = 0.04; tar.h = 0; if (quiet) { Object.assign(cur, tar); paint(); } else wake(); };
    paint();
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", move);
      el.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(raf);
    };
  }, [tilt]);

  const vars = {
    "--furin-glass-card-radius": `${radius}px`,
    "--furin-glass-card-tint": tint,
    "--furin-glass-card-glare": glare,
  } as CSSProperties;

  return (
    <>
      {scene ? <Scene /> : null}
      {mapa ? <RefractionFilter id={fid} mapa={mapa} strength={refraction} blur={blur} dispersion={dispersion} /> : null}
      <div ref={root} className={`furin-glass-card ${className}`} style={{ ...vars, ...style }}>
        <div ref={glass} className="furin-glass-card__glass" style={{ backdropFilter: glassBackdrop(fid, mapa, blur), WebkitBackdropFilter: glassBackdrop(fid, mapa, blur) }} />
        <div className="furin-glass-card__glare" />
        <div className="furin-glass-card__rim" />
        <div className="furin-glass-card__content">
          <span className="furin-glass-card__chip" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3.5 20 8v8l-8 4.5L4 16V8z" />
              <path d="M4 8l8 4.5L20 8M12 12.5v8" />
            </svg>
          </span>
          <div className="furin-glass-card__title">{children}</div>
          {caption ? <div className="furin-glass-card__caption">{caption}</div> : null}
        </div>
      </div>
    </>
  );
}

function Scene() {
  return (
    <div className="furin-glass-card-scene" aria-hidden="true">
      <i /><i /><i /><i /><b />
    </div>
  );
}

export default GlassCard;
