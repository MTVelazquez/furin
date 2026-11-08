"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./MasonryReveal.css";

export interface MasonryItem {
  /** Título de la pieza. */
  title: string;
  /** Línea secundaria bajo el título. */
  subtitle?: string;
  /** Alto de la pieza respecto a su ancho (1 = cuadrada). */
  ratio?: number;
}

export interface MasonryRevealProps {
  /** Piezas del mosaico (si no pasas ninguna se usan siete de ejemplo). */
  items?: MasonryItem[];
  /** Cuántas columnas tiene el mosaico. */
  columns?: number;
  /** Separación entre piezas, en px. */
  gap?: number;
  /** Radio de las esquinas de cada pieza, en px. */
  radius?: number;
  /** Milisegundos entre la aparición de una pieza y la siguiente. */
  stagger?: number;
  /** Segundos entre reapariciones del mosaico (0 lo deja quieto). */
  replayEvery?: number;
  /** Cambia las escenas generadas de las piezas. */
  seed?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

// Escenas generadas por código (sin imágenes externas): degradados, formas y grano, deterministas por semilla.
const PALETAS = [
  ["#1b1340", "#6a3df0", "#ff7ab6", "#ffd6a5"],
  ["#06202f", "#0d5f7a", "#27c2b5", "#f4f1de"],
  ["#2a0e0e", "#b3341f", "#ff9d4d", "#ffe8b8"],
  ["#0e231a", "#2f6b4f", "#9ad1a0", "#f2f5d0"],
  ["#14162e", "#3a46a8", "#7aa2ff", "#e8f0ff"],
  ["#2d1b2e", "#9a3f6f", "#f2789f", "#ffe0e6"],
  ["#101216", "#4a4f5c", "#c8ccd6", "#ffffff"],
  ["#2b1a05", "#a8651b", "#f0b44c", "#fff3d1"],
];
const MODOS = ["orbes", "arcos", "sol", "cintas", "bauhaus", "anillos"] as const;
const hacerRnd = (semilla: number) => {
  let a = (semilla * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
let GRANO: HTMLCanvasElement | null = null;
function grano() {
  if (GRANO) return GRANO;
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d")!;
  const d = g.createImageData(96, 96);
  const r = hacerRnd(99);
  for (let i = 0; i < d.data.length; i += 4) { const v = r() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0);
  return (GRANO = c);
}
function pintarEscena(cv: HTMLCanvasElement, W: number, H: number, semilla: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  const g = cv.getContext("2d");
  if (!g) return;
  g.scale(dpr, dpr);
  const rnd = hacerRnd(semilla + 3);
  const pal = PALETAS[(semilla * 3 + 1) % PALETAS.length];
  const modo = MODOS[semilla % MODOS.length];
  const lin = (x0: number, y0: number, x1: number, y1: number, cols: string[]) => {
    const l = g.createLinearGradient(x0, y0, x1, y1);
    cols.forEach((c, i) => l.addColorStop(i / (cols.length - 1), c));
    return l;
  };
  const M = Math.max(W, H);
  g.fillStyle = lin(0, 0, W * 0.4, H, [pal[0], pal[1]]);
  g.fillRect(0, 0, W, H);

  if (modo === "orbes") {
    g.globalCompositeOperation = "screen";
    for (let i = 0; i < 4; i++) {
      const x = W * (0.15 + rnd() * 0.7), y = H * (0.15 + rnd() * 0.7), r = M * (0.35 + rnd() * 0.4);
      const c = pal[1 + (i % 3)];
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, c + "ee"); rg.addColorStop(0.5, c + "55"); rg.addColorStop(1, c + "00");
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    }
    g.globalCompositeOperation = "source-over";
    const x = W * (0.3 + rnd() * 0.4), y = H * (0.3 + rnd() * 0.3), r = M * 0.1;
    const rg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    rg.addColorStop(0, "#fff"); rg.addColorStop(0.5, pal[3]); rg.addColorStop(1, pal[2]);
    g.shadowColor = pal[3]; g.shadowBlur = r * 2.2; g.fillStyle = rg;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.shadowBlur = 0;
  } else if (modo === "arcos") {
    const cx = W * (0.4 + rnd() * 0.2), base = H * 1.02, n = 5;
    for (let k = 0; k < n; k++) {
      const r = (W * 0.52) * (1 - k / (n + 0.4));
      g.shadowColor = "rgba(0,0,0,0.35)"; g.shadowBlur = M * 0.05; g.shadowOffsetY = M * 0.012;
      g.fillStyle = lin(cx - r, base - r * 1.5, cx + r, base, [pal[(k + 1) % 4 === 0 ? 3 : (k + 1) % 4], pal[(k + 2) % 4]]);
      g.beginPath(); g.moveTo(cx - r, base); g.lineTo(cx - r, base - r); g.arc(cx, base - r, r, Math.PI, 0); g.lineTo(cx + r, base); g.closePath(); g.fill();
    }
    g.shadowBlur = 0; g.shadowOffsetY = 0;
  } else if (modo === "sol") {
    g.fillStyle = lin(0, 0, 0, H * 0.8, [pal[0], pal[1], pal[2], pal[3]]);
    g.fillRect(0, 0, W, H);
    const sx = W * (0.3 + rnd() * 0.4), sy = H * 0.42, sr = M * 0.1;
    const gl = g.createRadialGradient(sx, sy, sr * 0.3, sx, sy, sr * 6);
    gl.addColorStop(0, pal[3] + "dd"); gl.addColorStop(0.3, pal[2] + "55"); gl.addColorStop(1, pal[2] + "00");
    g.fillStyle = gl; g.fillRect(0, 0, W, H);
    g.fillStyle = "#fffaf0"; g.beginPath(); g.arc(sx, sy, sr, 0, 7); g.fill();
    for (let l = 0; l < 3; l++) {
      const by = H * (0.6 + l * 0.14), amp = H * (0.16 - l * 0.03), ph = rnd() * 9;
      g.fillStyle = lin(0, by - amp, 0, H, [pal[(l + 1) % 4], pal[0]]);
      g.globalAlpha = 0.55 + l * 0.2;
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 3) g.lineTo(x, by - amp * (0.5 + 0.5 * (Math.sin(x / W * 5 + ph) * 0.6 + Math.sin(x / W * 11 + ph * 2) * 0.4)));
      g.lineTo(W, H); g.fill();
    }
    g.globalAlpha = 1;
  } else if (modo === "cintas") {
    g.globalCompositeOperation = "screen";
    for (let k = 0; k < 7; k++) {
      const y0 = H * (0.1 + k * 0.14), a = H * (0.25 + rnd() * 0.3), th = H * (0.07 + rnd() * 0.09);
      g.fillStyle = lin(0, y0, W, y0 + a, [pal[1 + (k % 3)] + "cc", pal[3] + "55"]);
      g.beginPath(); g.moveTo(-10, y0);
      g.bezierCurveTo(W * 0.3, y0 - a, W * 0.65, y0 + a, W + 10, y0 + a * 0.2);
      g.lineTo(W + 10, y0 + a * 0.2 + th);
      g.bezierCurveTo(W * 0.65, y0 + a + th, W * 0.3, y0 - a + th, -10, y0 + th);
      g.closePath(); g.fill();
    }
    g.globalCompositeOperation = "source-over";
  } else if (modo === "bauhaus") {
    g.fillStyle = pal[3]; g.fillRect(0, 0, W, H);
    g.fillStyle = pal[1]; g.beginPath(); g.arc(W * 0.34, H * 0.34, M * 0.3, 0, 7); g.fill();
    g.fillStyle = pal[2]; g.beginPath(); g.arc(W * 0.78, H * 0.78, M * 0.26, Math.PI, 0, true); g.lineTo(W * 0.78 - M * 0.26, H * 0.78); g.fill();
    g.fillStyle = pal[0]; g.fillRect(W * 0.52, H * 0.12, W * 0.22, H * 0.46);
    g.fillStyle = pal[2]; g.beginPath(); g.moveTo(0, H); g.lineTo(0, H * 0.62); g.arc(0, H, H * 0.38, -Math.PI / 2, 0); g.closePath(); g.fill();
  } else {
    const cx = W * (0.35 + rnd() * 0.3), cy = H * (0.4 + rnd() * 0.2);
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, M * 0.8);
    rg.addColorStop(0, pal[2]); rg.addColorStop(0.6, pal[1]); rg.addColorStop(1, pal[0]);
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 7; k++) {
      const r = M * (0.1 + k * 0.1);
      g.strokeStyle = pal[(k % 2) ? 3 : 2] + (k % 2 ? "88" : "cc");
      g.lineWidth = M * (0.012 + 0.014 * rnd());
      g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
    }
    const gr = g.createRadialGradient(cx - M * 0.03, cy - M * 0.03, 0, cx, cy, M * 0.1);
    gr.addColorStop(0, "#fff"); gr.addColorStop(1, pal[3]);
    g.fillStyle = gr; g.shadowColor = pal[3]; g.shadowBlur = M * 0.12;
    g.beginPath(); g.arc(cx, cy, M * 0.075, 0, 7); g.fill(); g.shadowBlur = 0;
  }

  // Viñeta suave y grano fino para que se sienta fotográfico.
  const vg = g.createRadialGradient(W / 2, H / 2, M * 0.25, W / 2, H / 2, M * 0.8);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.34)");
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.06; g.globalCompositeOperation = "overlay";
  g.fillStyle = g.createPattern(grano(), "repeat")!;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
}

const EJEMPLO: MasonryItem[] = [
  { title: "Aurora", subtitle: "Series 01", ratio: 0.85 },
  { title: "Tide", subtitle: "Series 02", ratio: 1.1 },
  { title: "Amber", subtitle: "Series 03", ratio: 1.2 },
  { title: "Haze", subtitle: "Series 04", ratio: 0.78 },
  { title: "Cobalt", subtitle: "Series 05", ratio: 1.3 },
  { title: "Dune", subtitle: "Series 06", ratio: 1.2 },
  { title: "Aether", subtitle: "Series 07", ratio: 0.78 },
];

/** Mosaico de columnas: las piezas aparecen una por una, en orden de lectura, con un rebote suave y un destello; al pasar el cursor la pieza se acerca y muestra su título. */
export function MasonryReveal({
  items,
  columns = 3,
  gap = 10,
  radius = 14,
  stagger = 95,
  replayEvery = 0,
  seed = 0,
  className = "",
  style,
}: MasonryRevealProps) {
  const lista = useMemo(() => (items && items.length > 0 ? items : EJEMPLO), [items]);
  const cols = Math.max(1, Math.min(6, Math.round(columns)));
  const [visible, setVisible] = useState(false);
  const [vuelta, setVuelta] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const lienzos = useRef<(HTMLCanvasElement | null)[]>([]);

  // Reparto: cada pieza va a la columna más baja (como un mosaico real) y se calcula su orden de lectura.
  const modelo = useMemo(() => {
    const alturas = new Array(cols).fill(0);
    const col: number[][] = Array.from({ length: cols }, () => []);
    const arriba: number[] = [];
    lista.forEach((it, i) => {
      let c = 0;
      for (let k = 1; k < cols; k++) if (alturas[k] < alturas[c] - 1e-6) c = k;
      col[c].push(i);
      arriba[i] = alturas[c];
      alturas[c] += it.ratio ?? 1;
    });
    const orden = lista.map((_, i) => i).sort((a, b) => arriba[a] - arriba[b] || a - b);
    const rango: number[] = [];
    orden.forEach((i, r) => { rango[i] = r; });
    return { col, rango };
  }, [lista, cols]);

  useEffect(() => {
    lista.forEach((it, i) => {
      const c = lienzos.current[i];
      if (c) pintarEscena(c, 320, Math.round(320 * (it.ratio ?? 1)), i + seed * 13 + 1);
    });
  }, [lista, seed]);

  // Aparece al entrar en vista; con replayEvery se esconde y vuelve a aparecer cada cierto tiempo.
  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setVisible(true); return; }
    let timer = 0;
    let visto = false;
    let hecho = false;
    const ciclo = () => {
      window.clearTimeout(timer);
      if (replayEvery <= 0) return;
      timer = window.setTimeout(() => {
        if (visto) {
          setVisible(false);
          timer = window.setTimeout(() => { setVuelta((v) => v + 1); setVisible(true); ciclo(); }, 750);
        } else ciclo();
      }, (replayEvery + (lista.length * stagger) / 1000 + 0.8) * 1000);
    };
    const io = new IntersectionObserver(([e]) => {
      visto = e.isIntersecting;
      if (e.isIntersecting && !hecho) { hecho = true; setVisible(true); ciclo(); }
    }, { threshold: 0.2 });
    io.observe(el);
    return () => { io.disconnect(); window.clearTimeout(timer); };
  }, [replayEvery, stagger, lista.length]);

  const vars = { "--furin-mr-gap": `${gap}px`, "--furin-mr-radius": `${radius}px` } as CSSProperties;
  return (
    <div
      ref={raiz}
      className={`furin-masonry-reveal${visible ? " is-in" : ""} ${className}`}
      style={{ ...vars, ...style }}
      data-vuelta={vuelta}
      role="group"
      aria-label="Image mosaic"
    >
      {modelo.col.map((idx, c) => (
        <div key={c} className="furin-masonry-reveal__col">
          {idx.map((i) => {
            const it = lista[i];
            return (
              <figure
                key={it.title + i}
                className="furin-masonry-reveal__tile"
                style={{ aspectRatio: `1 / ${it.ratio ?? 1}`, "--furin-mr-d": `${modelo.rango[i] * stagger}ms` } as CSSProperties}
                role="img"
                aria-label={`${it.title}${it.subtitle ? `, ${it.subtitle}` : ""}`}
              >
                <canvas ref={(el) => { lienzos.current[i] = el; }} className="furin-masonry-reveal__art" aria-hidden="true" />
                <i className="furin-masonry-reveal__shine" />
                <figcaption className="furin-masonry-reveal__cap">
                  <b>{it.title}</b>
                  {it.subtitle ? <span>{it.subtitle}</span> : null}
                </figcaption>
              </figure>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default MasonryReveal;
