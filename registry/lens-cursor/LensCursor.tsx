"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./LensCursor.css";

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


export interface LensCursorProps {
  /** Contenido que la lupa amplía (se muestra dos veces: el real y el de la lente). */
  children?: ReactNode;
  /** Cuánto amplía la lupa. */
  zoom?: number;
  /** Diámetro de la lupa, en px. */
  size?: number;
  /** Fuerza de la refracción en el borde de la lente (0 = sin curvar la luz). */
  refraction?: number;
  /** Rigidez del resorte con el que la lupa persigue al cursor. */
  stiffness?: number;
  /** Oculta el cursor del sistema dentro del área. */
  hideCursor?: boolean;
  /** Pinta una lámina con texto diminuto y formas de color para ver la ampliación. */
  scene?: boolean;
  /** Texto de la lámina (con `scene`): se repite hasta llenarla. */
  sceneText?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const MICRO =
  "Glass is not a material so much as a state: a liquid that stopped flowing. Passing through it, light bends, and what seemed far away comes closer. A lens is just glass with curvature, and the curvature decides how close the world gets. This magnifier chases the cursor on a spring, enlarges what lies beneath with real text, never pixelating it, and bends light at its rim like true crystal.";

function Mundo({ scene, text, children }: { scene: boolean; text: string; children?: ReactNode }) {
  return (
    <div className="furin-lens-cursor__mundo-contenido">
      {scene ? (
        <>
          <div className="furin-lens-cursor__rejilla" />
          <div className="furin-lens-cursor__formas"><i /><i /><i /><i /></div>
          <div className="furin-lens-cursor__micro">{(text.trimEnd() + " ").repeat(14)}</div>
        </>
      ) : null}
      <div className="furin-lens-cursor__titulo">{children}</div>
    </div>
  );
}

/** Lupa de vidrio que persigue al cursor con un resorte y amplía el contenido de debajo con texto real y borde refractante. */
export function LensCursor({
  children,
  zoom = 2.2,
  size = 176,
  refraction = 1,
  stiffness = 420,
  hideCursor = true,
  scene = false,
  sceneText = MICRO,
  className = "",
  style,
}: LensCursorProps) {
  const root = useRef<HTMLDivElement>(null);
  const lente = useRef<HTMLDivElement>(null);
  const dentro = useRef<HTMLDivElement>(null);
  const cristal = useRef<HTMLSpanElement>(null);
  const fid = "furin-lens-cursor-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const mapa = useRefractionMap(cristal, size / 2, size * 0.14);
  const [caja, setCaja] = useState({ w: 0, h: 0 });

  // El mundo de la lente debe medir lo mismo que el área real para que la ampliación caiga exacta.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCaja({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    setCaja({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = root.current, len = lente.current, int = dentro.current;
    if (!el || !len || !int) return;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const R = size / 2;
    const s = { x: 0, y: 0, vx: 0, vy: 0, k: 0, vk: 0, tx: 0, ty: 0, dentro: false, init: false };
    let raf = 0, t0 = 0;
    const pinta = () => {
      len.style.transform = `translate(${(s.x - R).toFixed(2)}px, ${(s.y - R).toFixed(2)}px) scale(${Math.max(s.k, 0.001).toFixed(3)})`;
      len.style.opacity = String(Math.min(1, s.k * 1.6));
      int.style.transform = `translate(${(R - s.x * zoom).toFixed(2)}px, ${(R - s.y * zoom).toFixed(2)}px) scale(${zoom})`;
    };
    const tick = (t: number) => {
      const dt = Math.min(0.032, (t - t0) / 1000 || 0.016);
      t0 = t;
      const c = 2 * Math.sqrt(stiffness) * 0.85;
      for (let i = 0; i < 2; i++) {
        s.vx += (stiffness * (s.tx - s.x) - c * s.vx) * (dt / 2);
        s.vy += (stiffness * (s.ty - s.y) - c * s.vy) * (dt / 2);
        s.x += s.vx * (dt / 2);
        s.y += s.vy * (dt / 2);
        const ko = s.dentro ? 1 : 0;
        s.vk += (260 * (ko - s.k) - 19 * s.vk) * (dt / 2);
        s.k += s.vk * (dt / 2);
      }
      pinta();
      const ko = s.dentro ? 1 : 0;
      const quietoYa = Math.abs(s.tx - s.x) + Math.abs(s.ty - s.y) < 0.15 && Math.abs(s.vx) + Math.abs(s.vy) < 0.5 && Math.abs(ko - s.k) < 0.004 && Math.abs(s.vk) < 0.02;
      if (quietoYa && !s.dentro) { s.k = 0; pinta(); raf = 0; return; }
      raf = quietoYa ? 0 : requestAnimationFrame(tick);
    };
    const wake = () => { if (!raf) { t0 = performance.now(); raf = requestAnimationFrame(tick); } };
    const aim = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      s.tx = e.clientX - b.left;
      s.ty = e.clientY - b.top;
      if (!s.init || !s.dentro) { s.x = s.tx; s.y = s.ty; s.vx = s.vy = 0; s.init = true; }
      s.dentro = true;
      if (quieto) { s.x = s.tx; s.y = s.ty; s.k = 1; pinta(); } else wake();
    };
    const out = () => { s.dentro = false; if (quieto) { s.k = 0; pinta(); } else wake(); };
    el.addEventListener("pointermove", aim);
    el.addEventListener("pointerdown", aim);
    el.addEventListener("pointerleave", out);
    el.addEventListener("pointercancel", out);
    pinta();
    return () => {
      el.removeEventListener("pointermove", aim);
      el.removeEventListener("pointerdown", aim);
      el.removeEventListener("pointerleave", out);
      el.removeEventListener("pointercancel", out);
      cancelAnimationFrame(raf);
    };
  }, [size, zoom, stiffness]);

  const vars = { "--furin-lens-cursor-size": `${size}px` } as CSSProperties;
  const back = glassBackdrop(fid, mapa, 0.3, 1.3);
  return (
    <div ref={root} className={`furin-lens-cursor${hideCursor ? " is-sin-cursor" : ""} ${className}`} style={{ ...vars, ...style }}>
      {mapa ? <RefractionFilter id={fid} mapa={mapa} strength={refraction} blur={0.3} saturate={1.3} dispersion={0.05} /> : null}
      <Mundo scene={scene} text={sceneText}>{children}</Mundo>
      <div ref={lente} className="furin-lens-cursor__lente" aria-hidden="true">
        <div ref={dentro} className="furin-lens-cursor__mundo" style={{ width: caja.w, height: caja.h }} {...({ inert: true } as object)}>
          <Mundo scene={scene} text={sceneText}>{children}</Mundo>
        </div>
        <span ref={cristal} className="furin-lens-cursor__cristal" style={{ backdropFilter: back, WebkitBackdropFilter: back }} />
        <span className="furin-lens-cursor__brillo" />
        <span className="furin-lens-cursor__rim" />
      </div>
    </div>
  );
}

export default LensCursor;
