"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./ElectricBorder.css";

export interface ElectricBorderProps {
  /** Contenido de la tarjeta; si es texto se muestra como título. */
  children?: ReactNode;
  /** Texto de apoyo bajo el título (solo cuando children es texto). */
  caption?: string;
  /** Color de la electricidad. */
  color?: string;
  /** Cuánto se desvía el arco del borde (1 = normal). */
  chaos?: number;
  /** Rapidez del chisporroteo (1 = normal). */
  speed?: number;
  /** Cuántas chispas saltan por segundo. */
  sparks?: number;
  /** Intensidad del resplandor, de 0 a 1.5. */
  glow?: number;
  /** Grosor del arco, en px. */
  borderWidth?: number;
  /** Radio de las esquinas, en px. */
  radius?: number;
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

const PAD = 40;
const TAU = Math.PI * 2;

function parseColor(c: string): [number, number, number] {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const x = cv.getContext("2d", { willReadFrequently: true });
  if (!x) return [120, 200, 255];
  x.fillStyle = "#fff";
  x.fillStyle = c;
  x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

/** Rectángulo redondeado en puntos equiespaciados, con su normal hacia afuera. */
function buildPath(w: number, h: number, r: number, ds: number) {
  const sw = Math.max(0, w - 2 * r), sh = Math.max(0, h - 2 * r), arc = (Math.PI / 2) * r;
  const P = 2 * sw + 2 * sh + 4 * arc;
  const n = Math.max(24, Math.round(P / ds));
  const xs = new Float32Array(n), ys = new Float32Array(n), nx = new Float32Array(n), ny = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let d = (i / n) * P, x = 0, y = 0, a = 0, ax = 0, ay = 0;
    if (d < sw) { x = r + d; y = 0; ay = -1; }
    else if ((d -= sw) < arc) { a = -Math.PI / 2 + d / r; ax = Math.cos(a); ay = Math.sin(a); x = w - r + r * ax; y = r + r * ay; }
    else if ((d -= arc) < sh) { x = w; y = r + d; ax = 1; }
    else if ((d -= sh) < arc) { a = d / r; ax = Math.cos(a); ay = Math.sin(a); x = w - r + r * ax; y = h - r + r * ay; }
    else if ((d -= arc) < sw) { x = w - r - d; y = h; ay = 1; }
    else if ((d -= sw) < arc) { a = Math.PI / 2 + d / r; ax = Math.cos(a); ay = Math.sin(a); x = r + r * ax; y = h - r + r * ay; }
    else if ((d -= arc) < sh) { x = 0; y = h - r - d; ax = -1; }
    else { d -= sh; a = Math.PI + d / r; ax = Math.cos(a); ay = Math.sin(a); x = r + r * ax; y = r + r * ay; }
    xs[i] = x; ys[i] = y; nx[i] = ax; ny[i] = ay;
  }
  return { xs, ys, nx, ny, n, P };
}

interface Wave { k: number; a: number; ph: number; w: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number }

/** Mulberry32: determinista, para que el servidor y el cliente pinten lo mismo. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Borde de electricidad: arcos que serpentean alrededor del contenido, con descargas locales, chispas y parpadeo. */
export function ElectricBorder({
  children = "Electric Border",
  caption = "A live arc that crackles around the edge.",
  color = "#5cc8ff",
  chaos = 1,
  speed = 1,
  sparks = 26,
  glow = 1,
  borderWidth = 1.8,
  radius = 22,
  width = 360,
  minHeight = 0,
  background = "#0c0e13",
  className = "",
  style,
}: ElectricBorderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const cfg = useRef({ color, chaos, speed, sparks, glow, borderWidth, radius });
  cfg.current = { color, chaos, speed, sparks, glow, borderWidth, radius };
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    const root = rootRef.current, cv = cvRef.current;
    if (!root || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, raf = 0, visible = true, last = 0, time = 0;
    let path = buildPath(10, 10, 4, 3);
    let rgb: number[] = parseColor(cfg.current.color);
    const rnd = rng(7);
    // Tres arcos independientes: cada uno es una suma de ondas periódicas a lo largo del perímetro.
    const layers: Wave[][] = [0, 1, 2].map(() => [5, 9, 16, 27, 44, 71, 112].map((k) => ({
      k: k + Math.round(rnd() * 2), a: Math.pow(k, -0.62) * (0.8 + rnd() * 0.5), ph: rnd() * TAU, w: (rnd() < 0.5 ? -1 : 1) * (1.5 + k * 0.16 + rnd() * 2),
    })));
    let surgeAt = 0, surgeW = 60, surgeNext = 0, surgeAmp = 0;
    const sp: Spark[] = [];
    let sparkAcc = 0;

    const layout = () => {
      const c = cfg.current;
      const w = root.offsetWidth, h = root.offsetHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = w + PAD * 2; H = h + PAD * 2;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const r = Math.min(c.radius, w / 2, h / 2);
      path = buildPath(w - c.borderWidth, h - c.borderWidth, Math.max(0, r - c.borderWidth / 2), 3);
      rgb = parseColor(c.color);
    };

    const disp = new Float32Array(2048);
    const draw = (dt: number, animate: boolean) => {
      const c = cfg.current;
      const { xs, ys, nx, ny, n, P } = path;
      if (disp.length < n) return;
      const off = PAD + c.borderWidth / 2;
      const ds = P / n;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Parpadeo global: mezcla de senos irregulares con picos ocasionales.
      const fl = 0.82 + 0.1 * Math.sin(time * 23) * Math.sin(time * 7.3 + 1) + 0.08 * Math.sin(time * 41 + 2) + (Math.sin(time * 3.1) > 0.93 ? 0.22 : 0);
      root.style.setProperty("--furin-electric-border-f", fl.toFixed(3));

      // Descarga local: de vez en cuando una zona del borde se dispara y salta más lejos.
      if (animate && time > surgeNext) {
        surgeAt = Math.floor(Math.random() * n);
        surgeW = (30 + Math.random() * 60) / ds;
        surgeAmp = 1.4 + Math.random() * 1.6;
        surgeNext = time + 0.12 + Math.random() * 0.5;
        // Cada descarga suelta un racimo de chispas.
        const burst = Math.round(c.sparks * 0.18);
        for (let q = 0; q < burst && sp.length < 90; q++) {
          const j = (surgeAt + Math.round((Math.random() - 0.5) * surgeW)) % n;
          const jj = (j + n) % n;
          const a = Math.atan2(ny[jj], nx[jj]) + (Math.random() - 0.5) * 1.6;
          const v = 50 + Math.random() * 190;
          sp.push({ x: off + xs[jj], y: off + ys[jj], vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.2 + Math.random() * 0.45 });
        }
      }
      const decay = Math.max(0, 1 - (time - (surgeNext - 0.4)) * 2.2);

      const amp = 7 * c.chaos;
      const widths = [c.borderWidth * 1.15, c.borderWidth * 0.8, c.borderWidth * 0.6];
      for (let l = 0; l < 3; l++) {
        const waves = layers[l];
        const lamp = amp * (l === 0 ? 0.8 : l === 1 ? 1.1 : 1.6);
        for (let i = 0; i < n; i++) {
          const u = (i / n) * TAU;
          let d = 0;
          for (let q = 0; q < waves.length; q++) {
            const wv = waves[q];
            d += wv.a * Math.sin(u * wv.k + wv.ph + time * c.speed * wv.w);
          }
          // Más picuda que una senoide: da el aspecto de relámpago.
          d = Math.sign(d) * Math.pow(Math.abs(d), 1.5);
          let m = 1;
          if (surgeAmp > 0) {
            let dd = Math.abs(i - surgeAt); if (dd > n / 2) dd = n - dd;
            m += surgeAmp * decay * Math.exp(-(dd * dd) / (surgeW * surgeW));
          }
          disp[i] = d * lamp * m;
        }
        const build = () => {
          ctx.beginPath();
          for (let i = 0; i <= n; i++) {
            const j = i % n;
            const x = off + xs[j] + nx[j] * disp[j], y = off + ys[j] + ny[j] * disp[j];
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
        };
        // Resplandor
        ctx.shadowColor = `rgba(${rgb},${0.9 * fl})`;
        ctx.shadowBlur = 12 * c.glow;
        ctx.strokeStyle = `rgba(${rgb},${0.55 * fl * (l === 0 ? 1 : 0.7)})`;
        ctx.lineWidth = widths[l] * 1.9;
        build(); ctx.stroke();
        ctx.shadowBlur = 0;
        // Arco
        ctx.strokeStyle = `rgba(${rgb[0] * 0.55 + 115 | 0},${rgb[1] * 0.55 + 115 | 0},${rgb[2] * 0.55 + 115 | 0},${0.95 * fl})`;
        ctx.lineWidth = widths[l];
        build(); ctx.stroke();
        // Núcleo blanco
        if (l < 2) {
          ctx.strokeStyle = `rgba(255,255,255,${0.85 * fl})`;
          ctx.lineWidth = Math.max(0.6, widths[l] * 0.38);
          build(); ctx.stroke();
        }
      }

      // Chispas: nacen del borde y salen despedidas con un poco de gravedad.
      if (animate) {
        sparkAcc += dt * c.sparks;
        while (sparkAcc >= 1 && sp.length < 90) {
          sparkAcc -= 1;
          const j = Math.floor(Math.random() * n);
          const a = Math.atan2(ny[j], nx[j]) + (Math.random() - 0.5) * 1.2;
          const v = 30 + Math.random() * 120;
          sp.push({ x: off + xs[j], y: off + ys[j], vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.15 + Math.random() * 0.4 });
        }
        sparkAcc = Math.min(sparkAcc, 2);
        for (let i = sp.length - 1; i >= 0; i--) {
          const s = sp[i];
          s.life += dt;
          if (s.life >= s.max) { sp.splice(i, 1); continue; }
          s.vy += 160 * dt;
          s.vx *= 1 - 2.2 * dt; s.vy *= 1 - 2.2 * dt;
          const px = s.x, py = s.y;
          s.x += s.vx * dt; s.y += s.vy * dt;
          const f = 1 - s.life / s.max;
          ctx.strokeStyle = `rgba(${rgb[0] * 0.4 + 150 | 0},${rgb[1] * 0.4 + 150 | 0},${rgb[2] * 0.4 + 150 | 0},${f})`;
          ctx.lineWidth = 0.6 + f * 1.1;
          ctx.shadowColor = `rgba(${rgb},${f})`;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(s.x - s.vx * 0.012, s.y - s.vy * 0.012);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      time += dt;
      draw(dt, true);
      if (visible) raf = requestAnimationFrame(frame);
    };
    const start = () => { if (!raf && !reduced) { last = performance.now(); raf = requestAnimationFrame(frame); } };

    layout();
    time = 1.3;
    if (reduced) draw(0, false); else start();
    refresh.current = () => { layout(); if (reduced) draw(0, false); };

    const ro = new ResizeObserver(() => { layout(); if (reduced) draw(0, false); });
    ro.observe(root);
    const io = new IntersectionObserver((e) => {
      visible = e[0]?.isIntersecting ?? true;
      if (visible) start(); else { cancelAnimationFrame(raf); raf = 0; }
    });
    io.observe(root);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);

  useEffect(() => { refresh.current(); }, [color, borderWidth, radius]);

  const vars = {
    "--furin-electric-border-w": `${width}px`,
    "--furin-electric-border-r": `${radius}px`,
    "--furin-electric-border-bg": background,
    "--furin-electric-border-min": `${minHeight}px`,
    "--furin-electric-border-color": color,
    "--furin-electric-border-glow": glow,
    "--furin-electric-border-pad": `${PAD}px`,
  } as CSSProperties;

  return (
    <div ref={rootRef} className={`furin-electric-border ${className}`} style={{ ...vars, ...style }}>
      <div className="furin-electric-border__content">
        {typeof children === "string" ? (
          <>
            <h3 className="furin-electric-border__title">{children}</h3>
            {caption ? <p className="furin-electric-border__caption">{caption}</p> : null}
          </>
        ) : children}
      </div>
      <canvas ref={cvRef} className="furin-electric-border__canvas" aria-hidden="true" />
    </div>
  );
}

export default ElectricBorder;
