"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./BorderBeam.css";

export interface BorderBeamProps {
  /** Contenido de la tarjeta; si es texto se muestra como título. */
  children?: ReactNode;
  /** Texto de apoyo bajo el título (solo cuando children es texto). */
  caption?: string;
  /** Color de la cabeza del haz. */
  color?: string;
  /** Color de la cola del haz. */
  colorTo?: string;
  /** Segundos que tarda el haz en dar una vuelta. */
  duration?: number;
  /** Largo de la cola, en px. */
  size?: number;
  /** Grosor del borde iluminado, en px. */
  borderWidth?: number;
  /** Radio de las esquinas, en px. */
  radius?: number;
  /** Cuántos haces recorren el borde a la vez. */
  beams?: number;
  /** Intensidad del halo, de 0 a 1.5. */
  glow?: number;
  /** Ancho máximo de la tarjeta, en px. */
  width?: number;
  /** Alto mínimo de la tarjeta, en px. */
  minHeight?: number;
  /** Fondo de la tarjeta. */
  background?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const PAD = 28; // margen del canvas para el halo exterior

/** Lee cualquier color CSS como [r, g, b]. */
function parseColor(c: string): [number, number, number] {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const x = cv.getContext("2d", { willReadFrequently: true });
  if (!x) return [255, 255, 255];
  x.fillStyle = "#fff";
  x.fillStyle = c;
  x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}
const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Puntos equiespaciados (por longitud de arco) sobre un rectángulo redondeado: la velocidad del haz es constante hasta en las esquinas. */
function buildPath(w: number, h: number, r: number, ds: number) {
  const sw = Math.max(0, w - 2 * r), sh = Math.max(0, h - 2 * r), arc = (Math.PI / 2) * r;
  const P = 2 * sw + 2 * sh + 4 * arc;
  const n = Math.max(16, Math.round(P / ds));
  const xs = new Float32Array(n), ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let d = (i / n) * P, x = 0, y = 0, a = 0;
    if (d < sw) { x = r + d; y = 0; }
    else if ((d -= sw) < arc) { a = -Math.PI / 2 + d / r; x = w - r + r * Math.cos(a); y = r + r * Math.sin(a); }
    else if ((d -= arc) < sh) { x = w; y = r + d; }
    else if ((d -= sh) < arc) { a = d / r; x = w - r + r * Math.cos(a); y = h - r + r * Math.sin(a); }
    else if ((d -= arc) < sw) { x = w - r - d; y = h; }
    else if ((d -= sw) < arc) { a = Math.PI / 2 + d / r; x = r + r * Math.cos(a); y = h - r + r * Math.sin(a); }
    else if ((d -= arc) < sh) { x = 0; y = h - r - d; }
    else { d -= sh; a = Math.PI + d / r; x = r + r * Math.cos(a); y = r + r * Math.sin(a); }
    xs[i] = x; ys[i] = y;
  }
  return { xs, ys, n, P };
}

/** Haz de luz que recorre el contorno de cualquier contenido, con cola degradada, cabeza brillante y halo. */
export function BorderBeam({
  children = "A beam traces the border",
  caption = "Over any content, with a tail and a glow.",
  color = "#8fb4ff",
  colorTo = "#b46cff",
  duration = 6,
  size = 220,
  borderWidth = 1.6,
  radius = 22,
  beams = 1,
  glow = 1,
  width = 360,
  minHeight = 0,
  background = "#0f1116",
  className = "",
  style,
}: BorderBeamProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const cfg = useRef({ color, colorTo, duration, size, borderWidth, radius, beams, glow });
  cfg.current = { color, colorTo, duration, size, borderWidth, radius, beams, glow };
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    const root = rootRef.current, cv = cvRef.current;
    if (!root || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, raf = 0, visible = true, t0 = 0;
    let path = buildPath(10, 10, 4, 2);
    let ramp: HTMLCanvasElement[] = [];
    let rgbFrom: number[] = [255, 255, 255], rgbTo: number[] = [255, 255, 255];
    let key = "";

    /** Sprites de brillo: un punto difuso por cada paso del degradado de color, para estampar el halo sin filtros. */
    const makeSprites = () => {
      const c = cfg.current;
      rgbFrom = parseColor(c.color); rgbTo = parseColor(c.colorTo);
      ramp = Array.from({ length: 8 }, (_, i) => {
        const s = document.createElement("canvas");
        s.width = s.height = 64;
        const g = s.getContext("2d")!;
        const col = mix(rgbTo, rgbFrom, i / 7).map(Math.round);
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, `rgba(${col},1)`);
        gr.addColorStop(0.25, `rgba(${col},0.55)`);
        gr.addColorStop(0.6, `rgba(${col},0.13)`);
        gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
        return s;
      });
    };

    const layout = () => {
      const c = cfg.current;
      const w = root.offsetWidth, h = root.offsetHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = w + PAD * 2; H = h + PAD * 2;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const r = Math.min(c.radius, w / 2, h / 2);
      const inset = c.borderWidth / 2;
      path = buildPath(w - c.borderWidth, h - c.borderWidth, Math.max(0, r - inset), 2);
      const k = `${c.color}|${c.colorTo}`;
      if (k !== key) { key = k; makeSprites(); }
    };

    const draw = (t: number) => {
      const c = cfg.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      // Cabos planos: con cabos redondos cada tramo se solapa con el siguiente y se forman cuentas.
      ctx.lineCap = "butt";
      ctx.lineJoin = "round";
      const { xs, ys, n, P } = path;
      const ds = P / n;
      const m = Math.min(n - 2, Math.max(8, c.size / ds));
      const off = PAD + c.borderWidth / 2;
      const bw = c.borderWidth;
      for (let b = 0; b < Math.max(1, Math.round(c.beams)); b++) {
        const head = ((t / (c.duration * 1000) + b / Math.max(1, Math.round(c.beams))) % 1) * n;
        const at = (k: number) => { const i = (((Math.floor(head - k) % n) + n) % n); return i; };
        // Halo: puntos difusos que se encogen hacia la cola.
        for (let k = 0; k <= m; k += 5) {
          const f = 1 - k / m;
          const i = at(k);
          const rad = bw * (4 + 11 * f) * (0.6 + 0.4 * c.glow);
          ctx.globalAlpha = Math.min(1, f * f * 0.42 * c.glow);
          const sprite = ramp[Math.round(Math.min(1, f * 1.15) * 7)];
          ctx.drawImage(sprite, off + xs[i] - rad, off + ys[i] - rad, rad * 2, rad * 2);
        }
        // Núcleo: trazo cortito con ancho y opacidad que crecen hacia la cabeza.
        const seg = 3;
        for (let k = m; k > 0; k -= seg) {
          const f = 1 - k / m;
          const f2 = 1 - (k - seg) / m;
          const col = mix(rgbTo, rgbFrom, Math.min(1, f * f * 1.1));
          const wh = Math.max(0, (f - 0.9) / 0.1);
          const rgb = mix(col, [255, 255, 255], wh * 0.85);
          ctx.strokeStyle = `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
          ctx.globalAlpha = Math.min(1, Math.pow(f2, 1.15) * 1.1);
          ctx.lineWidth = bw * (0.55 + 0.75 * f2);
          ctx.beginPath();
          for (let q = 0; q <= seg; q++) {
            const i = at(k - q);
            if (q === 0) ctx.moveTo(off + xs[i], off + ys[i]); else ctx.lineTo(off + xs[i], off + ys[i]);
          }
          ctx.stroke();
        }
        // Cabeza
        const hi = at(0);
        const hs = ramp[7];
        ctx.globalAlpha = 0.9;
        ctx.drawImage(hs, off + xs[hi] - bw * 5, off + ys[hi] - bw * 5, bw * 10, bw * 10);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(off + xs[hi], off + ys[hi], bw * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const frame = (now: number) => {
      raf = 0;
      if (!t0) t0 = now;
      draw(now - t0);
      if (visible) raf = requestAnimationFrame(frame);
    };
    const start = () => { if (!raf && !reduced) raf = requestAnimationFrame(frame); };

    layout();
    if (reduced) draw(cfg.current.duration * 1000 * 0.1); else start();
    redraw.current = () => { layout(); if (reduced) draw(cfg.current.duration * 1000 * 0.1); };

    const ro = new ResizeObserver(() => { layout(); if (reduced) draw(cfg.current.duration * 1000 * 0.1); });
    ro.observe(root);
    const io = new IntersectionObserver((e) => {
      visible = e[0]?.isIntersecting ?? true;
      if (visible) start(); else { cancelAnimationFrame(raf); raf = 0; }
    });
    io.observe(root);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);

  // Si cambian las props visuales con el componente montado, se recalcula la geometría y los colores.
  useEffect(() => { redraw.current(); }, [color, colorTo, borderWidth, radius, size, beams]);

  const vars = {
    "--furin-border-beam-w": `${width}px`,
    "--furin-border-beam-r": `${radius}px`,
    "--furin-border-beam-bg": background,
    "--furin-border-beam-min": `${minHeight}px`,
    "--furin-border-beam-color": color,
    "--furin-border-beam-pad": `${PAD}px`,
  } as CSSProperties;

  return (
    <div ref={rootRef} className={`furin-border-beam ${className}`} style={{ ...vars, ...style }}>
      <div className="furin-border-beam__content">
        {typeof children === "string" ? (
          <>
            <h3 className="furin-border-beam__title">{children}</h3>
            {caption ? <p className="furin-border-beam__caption">{caption}</p> : null}
          </>
        ) : children}
      </div>
      <canvas ref={cvRef} className="furin-border-beam__canvas" aria-hidden="true" />
    </div>
  );
}

export default BorderBeam;
