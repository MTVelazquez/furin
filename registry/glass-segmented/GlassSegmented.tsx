"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./GlassSegmented.css";

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


export interface GlassSegmentedProps {
  /** Textos de las opciones. */
  options?: string[];
  /** Opción elegida (modo controlado). */
  value?: string;
  /** Opción inicial (modo no controlado). */
  defaultValue?: string;
  /** Se llama al elegir otra opción. */
  onChange?: (value: string) => void;
  /** Etiqueta accesible del grupo. */
  label?: string;
  /** Cuánto amplía la lente lo que hay debajo (1 = nada). */
  zoom?: number;
  /** Desenfoque del fondo en el riel, en px. */
  blur?: number;
  /** Fuerza de la refracción de la lente (0 = sin curvar la luz). */
  refraction?: number;
  /** Rigidez del resorte de la lente: más alto es más seco. */
  stiffness?: number;
  /** Segundos entre cambios automáticos (0 = apagado; se detiene al interactuar). */
  autoplay?: number;
  /** Pinta una escena de color animada detrás (para verlo refractar). */
  scene?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const PAD = 5;
const HEIGHT = 56;

/** Control segmentado de vidrio: una lente que se desliza con resorte y amplía la opción elegida. */
export function GlassSegmented({
  options = ["Day", "Week", "Month", "Year"],
  value,
  defaultValue,
  onChange,
  label = "Options",
  zoom = 1.22,
  blur = 10,
  refraction = 1,
  stiffness = 320,
  autoplay = 0,
  scene = false,
  className = "",
  style,
}: GlassSegmentedProps) {
  const n = Math.max(options.length, 1);
  const [interno, setInterno] = useState(defaultValue ?? options[0]);
  const actual = value ?? interno;
  const idx = Math.max(options.indexOf(actual), 0);
  const lente = useRef<HTMLDivElement>(null);
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  const tocado = useRef(false);
  const fid = "furin-glass-segmented-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const mapa = useRefractionMap(lente, (HEIGHT - PAD * 2) / 2, 9, zoom);

  const elegir = useCallback(
    (op: string) => {
      if (value === undefined) setInterno(op);
      onChange?.(op);
    },
    [value, onChange],
  );

  // Resorte de la lente: posición en "segmentos", con velocidad; la lente se estira al correr.
  const fisica = useRef({ x: idx, v: 0, raf: 0, t: 0 });
  const objetivo = useRef(idx);
  objetivo.current = idx;
  useEffect(() => {
    const el = lente.current;
    if (!el) return;
    const f = fisica.current;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pinta = () => {
      const sx = 1 + Math.min(0.2, Math.abs(f.v) * 0.045);
      const sy = 1 - Math.min(0.1, Math.abs(f.v) * 0.02);
      el.style.transform = `translateX(${(f.x * 100).toFixed(3)}%) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
      el.style.setProperty("--furin-glass-segmented-lit", String(Math.min(1, Math.abs(f.v) * 0.25).toFixed(2)));
    };
    const tick = (t: number) => {
      const dt = Math.min(0.032, (t - f.t) / 1000 || 0.016);
      f.t = t;
      const k = stiffness, c = 2 * Math.sqrt(k) * 0.62;
      for (let i = 0; i < 2; i++) {
        const a = k * (objetivo.current - f.x) - c * f.v;
        f.v += a * (dt / 2);
        f.x += f.v * (dt / 2);
      }
      pinta();
      if (Math.abs(objetivo.current - f.x) < 0.0008 && Math.abs(f.v) < 0.004) {
        f.x = objetivo.current;
        f.v = 0;
        pinta();
        f.raf = 0;
        return;
      }
      f.raf = requestAnimationFrame(tick);
    };
    if (quieto) { f.x = objetivo.current; f.v = 0; pinta(); return; }
    f.t = performance.now();
    if (!f.raf) f.raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(f.raf); f.raf = 0; };
  }, [idx, stiffness]);

  // Cambio automático para la demo; deja de hacerlo en cuanto la persona toca el control.
  useEffect(() => {
    if (!autoplay || options.length < 2) return;
    const id = window.setInterval(() => {
      if (tocado.current || document.hidden) return;
      const i = (objetivo.current + 1) % options.length;
      if (value === undefined) setInterno(options[i]);
      onChange?.(options[i]);
    }, autoplay * 1000);
    return () => window.clearInterval(id);
  }, [autoplay, options, value, onChange]);

  const tecla = (e: React.KeyboardEvent, i: number) => {
    let j = i;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + n) % n;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = n - 1;
    else return;
    e.preventDefault();
    tocado.current = true;
    elegir(options[j]);
    botones.current[j]?.focus();
  };

  const vars = { "--furin-glass-segmented-n": n, "--furin-glass-segmented-pad": `${PAD}px`, "--furin-glass-segmented-h": `${HEIGHT}px` } as CSSProperties;
  const back = glassBackdrop(fid, mapa, 0.4, 1.4);
  return (
    <>
      {scene ? <Scene /> : null}
      {mapa ? <RefractionFilter id={fid} mapa={mapa} strength={refraction} blur={0.4} saturate={1.4} dispersion={0.03} /> : null}
      <div role="radiogroup" aria-label={label} className={`furin-glass-segmented ${className}`} style={{ ...vars, ...style }} onPointerDown={() => { tocado.current = true; }}>
        <span className="furin-glass-segmented__riel" style={{ backdropFilter: `blur(${blur}px) saturate(1.5)`, WebkitBackdropFilter: `blur(${blur}px) saturate(1.5)` }} />
        {options.map((op, i) => (
          <button
            key={op}
            ref={(el) => { botones.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={i === idx}
            tabIndex={i === idx ? 0 : -1}
            className={`furin-glass-segmented__op${i === idx ? " is-on" : ""}`}
            onClick={() => elegir(op)}
            onKeyDown={(e) => tecla(e, i)}
          >
            {op}
          </button>
        ))}
        <div ref={lente} className="furin-glass-segmented__lente" aria-hidden="true">
          <span className="furin-glass-segmented__cristal" style={{ backdropFilter: back, WebkitBackdropFilter: back }} />
          <span className="furin-glass-segmented__rim" />
        </div>
      </div>
    </>
  );
}

function Scene() {
  return (
    <div className="furin-glass-segmented-scene" aria-hidden="true">
      <i /><i /><i /><i /><b />
    </div>
  );
}

export default GlassSegmented;
