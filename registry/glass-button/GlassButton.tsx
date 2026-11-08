"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./GlassButton.css";

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


export interface GlassButtonProps {
  /** Texto del botón. */
  children?: ReactNode;
  /** Alto del botón: pequeño, mediano o grande. */
  size?: "sm" | "md" | "lg";
  /** Muestra una flecha al final del texto. */
  arrow?: boolean;
  /** Desenfoque del fondo detrás del vidrio, en px. */
  blur?: number;
  /** Fuerza de la refracción en el borde (0 = sin curvar la luz). */
  refraction?: number;
  /** Color del tinte del vidrio. */
  tint?: string;
  /** Color del texto. */
  color?: string;
  /** Pinta una escena de color animada detrás (para verlo refractar). */
  scene?: boolean;
  /** Desactiva el botón. */
  disabled?: boolean;
  /** Se llama al hacer clic. */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Clase extra para el botón. */
  className?: string;
  /** Estilos extra para el botón. */
  style?: CSSProperties;
}

const HEIGHT = { sm: 40, md: 54, lg: 68 } as const;

/** Botón de vidrio líquido: refracta el fondo, brilla donde lo toca la luz y se aplasta como una gota al pulsar. */
export function GlassButton({
  children,
  size = "md",
  arrow = true,
  blur = 1.2,
  refraction = 1,
  tint = "rgba(255,255,255,0.12)",
  color = "#fff",
  scene = false,
  disabled = false,
  onClick,
  className = "",
  style,
}: GlassButtonProps) {
  const btn = useRef<HTMLButtonElement>(null);
  const glass = useRef<HTMLSpanElement>(null);
  const fid = "furin-glass-button-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const h = HEIGHT[size];
  const mapa = useRefractionMap(glass, h / 2, h * 0.3);
  const [onda, setOnda] = useState(0);

  // La luz sigue al cursor sobre el botón (sin resorte: es un destello, no una masa).
  useEffect(() => {
    const el = btn.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      el.style.setProperty("--furin-glass-button-mx", `${e.clientX - b.left}px`);
      el.style.setProperty("--furin-glass-button-my", `${e.clientY - b.top}px`);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", move);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", move);
    };
  }, []);

  const vars = { "--furin-glass-button-h": `${h}px`, "--furin-glass-button-tint": tint, color } as CSSProperties;
  const back = glassBackdrop(fid, mapa, blur);
  return (
    <>
      {scene ? <Scene /> : null}
      {mapa ? <RefractionFilter id={fid} mapa={mapa} strength={refraction} blur={blur} dispersion={0.14} /> : null}
      <button
        ref={btn}
        type="button"
        disabled={disabled}
        className={`furin-glass-button furin-glass-button--${size} ${className}`}
        style={{ ...vars, ...style }}
        onPointerDown={() => setOnda((n) => n + 1)}
        onClick={onClick}
      >
        <span ref={glass} className="furin-glass-button__glass" style={{ backdropFilter: back, WebkitBackdropFilter: back }} />
        <span className="furin-glass-button__sheen" aria-hidden="true" />
        <span key={onda} className={`furin-glass-button__onda${onda ? " is-on" : ""}`} aria-hidden="true" />
        <span className="furin-glass-button__rim" aria-hidden="true" />
        <span className="furin-glass-button__label">
          {children}
          {arrow ? (
            <svg className="furin-glass-button__arrow" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 10h11M11 5l5 5-5 5" />
            </svg>
          ) : null}
        </span>
      </button>
    </>
  );
}

function Scene() {
  return (
    <div className="furin-glass-button-scene" aria-hidden="true">
      <i /><i /><i /><i /><b />
    </div>
  );
}

export default GlassButton;
