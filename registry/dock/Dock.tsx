"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./Dock.css";

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


export type DockIconName = "home" | "search" | "mail" | "music" | "camera" | "sliders" | "chat" | "compass";

export interface DockItem {
  /** Nombre del ícono (también su etiqueta accesible y su globo). */
  label: string;
  /** Ícono propio o un nodo SVG tuyo. */
  icon: DockIconName | ReactNode;
  /** Colores del degradado del ícono: arriba y abajo. */
  colors?: [string, string];
  /** Muestra el puntito de "abierto" debajo. */
  active?: boolean;
}

export interface DockProps {
  /** Íconos del dock. */
  items?: DockItem[];
  /** Tamaño base de cada ícono, en px. */
  size?: number;
  /** Cuánto crece el ícono bajo el cursor (1 = no crece). */
  magnify?: number;
  /** Distancia, en px, a la que el cursor todavía agranda íconos. */
  reach?: number;
  /** Desenfoque del fondo detrás del vidrio, en px. */
  blur?: number;
  /** Fuerza de la refracción en el borde del dock (0 = sin curvar la luz). */
  refraction?: number;
  /** Pinta una escena de color animada detrás (para verlo refractar). */
  scene?: boolean;
  /** Se llama al pulsar un ícono. */
  onSelect?: (label: string) => void;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const PALETA: [string, string][] = [
  ["#8fc2ff", "#3d63ff"],
  ["#ffa6cd", "#f0408d"],
  ["#7ae8ff", "#1f86f0"],
  ["#ffb48f", "#ff3f6c"],
  ["#c3a6ff", "#6a3df0"],
  ["#c8d2e4", "#5d6b86"],
];

const ITEMS: DockItem[] = [
  { label: "Home", icon: "home", active: true },
  { label: "Search", icon: "search" },
  { label: "Mail", icon: "mail", active: true },
  { label: "Music", icon: "music" },
  { label: "Camera", icon: "camera" },
  { label: "Settings", icon: "sliders" },
];

/** Glifos propios, trazo blanco de 1.8 en una cuadrícula de 24. */
function Glifo({ name }: { name: DockIconName }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {name === "home" ? <path {...p} d="M4 11.2 12 4.5l8 6.7V19a1 1 0 0 1-1 1h-4.2v-5.6H9.2V20H5a1 1 0 0 1-1-1z" /> : null}
      {name === "search" ? (<><circle {...p} cx="10.8" cy="10.8" r="6" /><path {...p} d="m15.3 15.3 4.7 4.7" /></>) : null}
      {name === "mail" ? (<><rect {...p} x="3.5" y="5.8" width="17" height="12.4" rx="2.6" /><path {...p} d="m4.4 7.6 7.6 5.6 7.6-5.6" /></>) : null}
      {name === "music" ? (<><path {...p} d="M9.2 17.6V6.4l9.6-2v11.2" /><circle {...p} cx="7" cy="17.8" r="2.2" /><circle {...p} cx="16.6" cy="15.8" r="2.2" /></>) : null}
      {name === "camera" ? (<><path {...p} d="M4.5 8h2.6l1.4-2.2h7l1.4 2.2h2.6a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle {...p} cx="12" cy="13" r="3.3" /></>) : null}
      {name === "sliders" ? (<><path {...p} d="M4 7h7M15 7h5M4 12h3M11 12h9M4 17h9M17 17h3" /><circle {...p} cx="13" cy="7" r="2" /><circle {...p} cx="9" cy="12" r="2" /><circle {...p} cx="15" cy="17" r="2" /></>) : null}
      {name === "chat" ? <path {...p} d="M4.5 6.6A2.6 2.6 0 0 1 7.1 4h9.8a2.6 2.6 0 0 1 2.6 2.6v6.8a2.6 2.6 0 0 1-2.6 2.6H11l-4.6 3.6V16h-.3a1.6 1.6 0 0 1-1.6-1.6z" /> : null}
      {name === "compass" ? (<><circle {...p} cx="12" cy="12" r="8.2" /><path {...p} d="m15.6 8.4-2 5.2-5.2 2 2-5.2z" /></>) : null}
    </svg>
  );
}

/** Dock de vidrio: los íconos crecen bajo el cursor con un resorte y el panel curva la luz en sus bordes. */
export function Dock({
  items = ITEMS,
  size = 46,
  magnify = 1.75,
  reach = 110,
  blur = 1.5,
  refraction = 1,
  scene = false,
  onSelect,
  className = "",
  style,
}: DockProps) {
  const panel = useRef<HTMLDivElement>(null);
  const celdas = useRef<(HTMLButtonElement | null)[]>([]);
  const filtro = useRef<SVGFilterElement>(null);
  const imagen = useRef<SVGFEImageElement>(null);
  const fid = "furin-dock-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [ajuste, setAjuste] = useState(1);
  const tam = Math.round(size * ajuste);
  const gap = Math.round(tam * 0.22);
  const mapa = useRefractionMap(panel, 30, 22);

  // En contenedores angostos los íconos se achican para que el dock siga cabiendo aun con la ampliación.
  useEffect(() => {
    const padre = panel.current?.parentElement?.parentElement;
    if (!padre) return;
    const mide = () => {
      const libre = padre.clientWidth;
      if (!libre) return;
      const n = items.length;
      const reposo = n * size + (n - 1) * Math.round(size * 0.22) + 24;
      const extra = size * (magnify - 1) * 2.2;
      const sig = Math.max(0.55, Math.min(1, (libre - 12) / (reposo + extra)));
      setAjuste((a) => (Math.abs(sig - a) > 0.01 ? sig : a));
    };
    const ro = new ResizeObserver(mide);
    ro.observe(padre);
    mide();
    return () => ro.disconnect();
  }, [items.length, size, magnify]);
  const [rebota, setRebota] = useState(-1);

  // Física: cada ícono es un resorte hacia su escala objetivo; el bucle duerme cuando el cursor se va y todo se asienta.
  useEffect(() => {
    const root = panel.current;
    if (!root) return;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const n = items.length;
    const st = Array.from({ length: n }, () => ({ s: 1, v: 0 }));
    const sigma = reach / 2.1;
    let px: number | null = null;
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      const dt = Math.min(0.032, (t - t0) / 1000 || 0.016);
      t0 = t;
      const b = root.getBoundingClientRect();
      const centro = b.left + b.width / 2;
      let activo = px !== null;
      let mejor = -1, mejorS = 1.35;
      for (let i = 0; i < n; i++) {
        const el = celdas.current[i];
        if (!el) continue;
        const reposo = (i - (n - 1) / 2) * (tam + gap);
        const d = px === null ? 1e4 : Math.abs(px - centro - reposo);
        const objetivo = 1 + (magnify - 1) * Math.exp(-(d * d) / (2 * sigma * sigma));
        const o = st[i];
        if (quieto) { o.s = objetivo; o.v = 0; }
        else {
          for (let k = 0; k < 2; k++) {
            const a = 260 * (objetivo - o.s) - 21 * o.v;
            o.v += a * (dt / 2);
            o.s += o.v * (dt / 2);
          }
        }
        if (Math.abs(objetivo - o.s) > 0.002 || Math.abs(o.v) > 0.01) activo = true;
        const px2 = tam * o.s;
        el.style.width = el.style.height = `${px2.toFixed(2)}px`;
        if (o.s > mejorS) { mejor = i; mejorS = o.s; }
      }
      for (let i = 0; i < n; i++) celdas.current[i]?.classList.toggle("is-hot", i === mejor);
      // El filtro de refracción sigue el ancho vivo del panel; el mapa se estira, no se regenera.
      const w = root.offsetWidth, h = root.offsetHeight;
      const f = filtro.current, im = imagen.current;
      if (f && im && w) {
        f.setAttribute("width", String(w));
        f.setAttribute("height", String(h));
        im.setAttribute("width", String(w));
        im.setAttribute("height", String(h));
      }
      raf = activo ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => { if (!raf) { t0 = performance.now(); raf = requestAnimationFrame(tick); } };
    const move = (e: PointerEvent) => { px = e.clientX; wake(); };
    const leave = () => { px = null; wake(); };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerdown", move);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("pointercancel", leave);
    wake();
    return () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerdown", move);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("pointercancel", leave);
      cancelAnimationFrame(raf);
    };
  }, [items.length, tam, gap, magnify, reach]);

  const vars = { "--furin-dock-size": `${tam}px`, "--furin-dock-gap": `${gap}px` } as CSSProperties;
  const back = glassBackdrop(fid, mapa, blur, 1.5);
  return (
    <>
      {scene ? <Scene /> : null}
      {mapa ? <RefractionFilter id={fid} mapa={mapa} strength={refraction} blur={blur} saturate={1.5} dispersion={0.1} /> : null}
      <div className={`furin-dock ${className}`} style={{ ...vars, ...style }} role="toolbar" aria-label="Dock">
        <div ref={panel} className="furin-dock__panel">
          <span className="furin-dock__cristal" style={{ backdropFilter: back, WebkitBackdropFilter: back }} />
          <span className="furin-dock__rim" />
          <div className="furin-dock__fila">
            {items.map((it, i) => {
              const [c1, c2] = it.colors ?? PALETA[i % PALETA.length];
              return (
                <button
                  key={it.label}
                  ref={(el) => { celdas.current[i] = el; }}
                  type="button"
                  className={`furin-dock__item${rebota === i ? " is-bounce" : ""}`}
                  aria-label={it.label}
                  style={{ width: tam, height: tam, "--furin-dock-c1": c1, "--furin-dock-c2": c2 } as CSSProperties}
                  onClick={() => { setRebota(i); onSelect?.(it.label); }}
                  onAnimationEnd={() => setRebota(-1)}
                >
                  <span className="furin-dock__icono">{typeof it.icon === "string" ? <Glifo name={it.icon as DockIconName} /> : it.icon}</span>
                  <span className="furin-dock__tip" aria-hidden="true">{it.label}</span>
                  {it.active ? <span className="furin-dock__punto" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function Scene() {
  return (
    <div className="furin-dock-scene" aria-hidden="true">
      <i /><i /><i /><i /><b />
    </div>
  );
}

export default Dock;
