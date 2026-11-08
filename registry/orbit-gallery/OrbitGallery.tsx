"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import "./OrbitGallery.css";

export interface OrbitGalleryItem {
  /** Título de la tarjeta. */
  title: string;
  /** Línea secundaria bajo el título. */
  subtitle?: string;
}

export interface OrbitGalleryProps {
  /** Tarjetas del carrusel (si no pasas ninguna se usan ocho de ejemplo). */
  items?: OrbitGalleryItem[];
  /** Ancho de cada tarjeta, en px. */
  cardWidth?: number;
  /** Alto de cada tarjeta, en px. */
  cardHeight?: number;
  /** Grados por segundo que gira solo cuando nadie lo toca (0 lo deja quieto). */
  autoRotate?: number;
  /** Inclinación de la vista, en grados. */
  tilt?: number;
  /** Cambia las escenas generadas de las tarjetas. */
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

const EJEMPLO: OrbitGalleryItem[] = ["Aurora", "Tide", "Amber", "Haze", "Cobalt", "Dune", "Aether", "Flare"].map((title, i) => ({ title, subtitle: `Collection ${String(i + 1).padStart(2, "0")}` }));
const limitar = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Carrusel circular 3D: tarjetas con escenas generadas sobre un anillo que se arrastra con inercia, gira solo con calma y se detiene cuando lo tocas; un clic trae la tarjeta al frente. */
export function OrbitGallery({
  items,
  cardWidth = 132,
  cardHeight = 184,
  autoRotate = 9,
  tilt = 8,
  seed = 0,
  className = "",
  style,
}: OrbitGalleryProps) {
  const lista = useMemo(() => (items && items.length >= 3 ? items : EJEMPLO), [items]);
  const n = lista.length;
  const paso = 360 / n;
  const radio = Math.round((cardWidth / 2) / Math.tan(Math.PI / n) + 30);
  const [frente, setFrente] = useState(0);

  const escena = useRef<HTMLDivElement>(null);
  const anillo = useRef<HTMLDivElement>(null);
  const tarjetas = useRef<(HTMLDivElement | null)[]>([]);
  const lienzos = useRef<(HTMLCanvasElement | null)[]>([]);
  const reversos = useRef<(HTMLCanvasElement | null)[]>([]);
  const fis = useRef({
    ang: 0, vel: 0, raf: 0, t: 0, visible: false, quieto: false,
    arrastre: false, x: 0, tx: 0, movido: 0, ultimo: 0, encima: false, pausa: 0,
    meta: null as number | null, frente: 0, id: -1,
  });
  const param = useRef({ n, paso, radio, tilt, autoRotate });
  param.current = { n, paso, radio, tilt, autoRotate };

  // Escenas de las tarjetas: se pintan una vez por tamaño/semilla; el reverso es el mismo cuadro en espejo.
  useEffect(() => {
    for (let i = 0; i < n; i++) {
      const c = lienzos.current[i];
      const b = reversos.current[i];
      if (!c) continue;
      pintarEscena(c, cardWidth, cardHeight, i + seed * 17 + 2);
      if (b) {
        b.width = c.width;
        b.height = c.height;
        const g = b.getContext("2d");
        if (g) { g.translate(b.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0); }
      }
    }
  }, [n, cardWidth, cardHeight, seed]);

  const pintar = () => {
    const s = fis.current;
    const p = param.current;
    anillo.current?.style.setProperty("transform", `translateZ(${-p.radio}px) rotateX(${-p.tilt}deg) rotateY(${s.ang.toFixed(3)}deg)`);
    let mejor = 0, mc = -2;
    for (let i = 0; i < p.n; i++) {
      const c = Math.cos(((s.ang + i * p.paso) * Math.PI) / 180);
      tarjetas.current[i]?.style.setProperty("--furin-og-dim", (0.78 * Math.pow(1 - (c + 1) / 2, 0.85)).toFixed(3));
      if (c > mc) { mc = c; mejor = i; }
    }
    if (mejor !== s.frente) { s.frente = mejor; setFrente(mejor); }
  };

  const correr = () => {
    const s = fis.current;
    if (s.raf || !s.visible) return;
    s.t = performance.now();
    const paso = (ahora: number) => {
      const dt = Math.min(0.05, Math.max(0, (ahora - s.t) / 1000));
      s.t = ahora;
      const p = param.current;
      if (!s.arrastre) {
        if (s.meta !== null) {
          // Resorte crítico hacia la tarjeta elegida.
          const w = 9;
          s.vel += (w * w * (s.meta - s.ang) - 2 * w * s.vel) * dt;
          if (Math.abs(s.meta - s.ang) < 0.04 && Math.abs(s.vel) < 0.6) { s.ang = s.meta; s.vel = 0; s.meta = null; s.pausa = ahora + 2200; }
        } else {
          const libre = !s.quieto && !s.encima && ahora > s.pausa;
          const objetivo = libre ? p.autoRotate : 0;
          // La inercia se apaga hacia la velocidad de reposo, sin cortes.
          s.vel += (objetivo - s.vel) * (1 - Math.exp(-dt * (Math.abs(s.vel) > 40 ? 1.9 : 2.6)));
        }
        s.ang += s.vel * dt;
      }
      pintar();
      const reposo = !s.arrastre && s.meta === null && Math.abs(s.vel) < 0.02 && (s.quieto || p.autoRotate === 0 || s.encima);
      if (reposo || !s.visible) { s.raf = 0; return; }
      s.raf = requestAnimationFrame(paso);
    };
    s.raf = requestAnimationFrame(paso);
  };

  useEffect(() => {
    const el = escena.current;
    if (!el) return;
    const s = fis.current;
    s.quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pintar();
    const io = new IntersectionObserver(([e]) => {
      s.visible = e.isIntersecting;
      if (e.isIntersecting) correr();
    });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(s.raf); s.raf = 0; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { pintar(); correr(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [n, radio, tilt, autoRotate]);

  // Trae la tarjeta i al frente por el camino más corto.
  const irA = (i: number) => {
    const s = fis.current;
    const base = -i * paso;
    s.meta = base + Math.round((s.ang - base) / 360) * 360;
    correr();
  };

  const alBajar = (e: PointerEvent<HTMLDivElement>) => {
    const s = fis.current;
    s.arrastre = true;
    s.meta = null;
    s.x = e.clientX;
    s.tx = e.clientX;
    s.movido = 0;
    s.ultimo = performance.now();
    s.vel = 0;
    s.id = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    s.raf || correr();
  };
  const alMover = (e: PointerEvent<HTMLDivElement>) => {
    const s = fis.current;
    if (!s.arrastre || e.pointerId !== s.id) return;
    const ahora = performance.now();
    const dx = e.clientX - s.x;
    s.x = e.clientX;
    s.movido += Math.abs(dx);
    const dAng = dx * 0.4;
    s.ang += dAng;
    const dt = Math.max(1, ahora - s.ultimo) / 1000;
    s.ultimo = ahora;
    // Velocidad suavizada para que el soltar conserve el gesto.
    s.vel = s.vel * 0.6 + (dAng / dt) * 0.4;
    pintar();
  };
  const alSoltar = (e: PointerEvent<HTMLDivElement>) => {
    const s = fis.current;
    if (!s.arrastre) return;
    s.arrastre = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (performance.now() - s.ultimo > 90) s.vel = 0;
    s.vel = limitar(s.vel, -900, 900);
    if (s.quieto) s.vel = 0;
    if (s.movido < 5) {
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("[data-i]") as HTMLElement | null;
      if (el) irA(Number(el.dataset.i));
    }
    correr();
  };
  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    irA((fis.current.frente + (e.key === "ArrowRight" ? -1 : 1) + n) % n);
  };

  const vars = { "--furin-og-w": `${cardWidth}px`, "--furin-og-h": `${cardHeight}px`, "--furin-og-r": `${radio}px` } as CSSProperties;
  const actual = lista[frente] ?? lista[0];

  return (
    <div className={`furin-orbit-gallery ${className}`} style={{ ...vars, ...style }}>
      <div
        ref={escena}
        className="furin-orbit-gallery__scene"
        role="group"
        aria-roledescription="carrusel"
        aria-label="Orbit gallery; drag or use the arrow keys to rotate"
        tabIndex={0}
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        onPointerEnter={() => { fis.current.encima = true; }}
        onPointerLeave={() => { fis.current.encima = false; correr(); }}
        onKeyDown={alTeclear}
      >
        <div className="furin-orbit-gallery__floor" aria-hidden="true" />
        <div ref={anillo} className="furin-orbit-gallery__ring">
          {lista.map((it, i) => (
            <div
              key={it.title + i}
              ref={(el) => { tarjetas.current[i] = el; }}
              data-i={i}
              className="furin-orbit-gallery__card"
              role="img"
              aria-label={`${it.title}${it.subtitle ? `, ${it.subtitle}` : ""}`}
              style={{ transform: `rotateY(${(i * paso).toFixed(3)}deg) translateZ(${radio}px)` }}
            >
              <div className="furin-orbit-gallery__face furin-orbit-gallery__front">
                <canvas ref={(el) => { lienzos.current[i] = el; }} className="furin-orbit-gallery__art" aria-hidden="true" />
                <i className="furin-orbit-gallery__gloss" />
                <i className="furin-orbit-gallery__shade" />
                <span className="furin-orbit-gallery__num">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="furin-orbit-gallery__face furin-orbit-gallery__back">
                <canvas ref={(el) => { reversos.current[i] = el; }} className="furin-orbit-gallery__art" aria-hidden="true" />
                <i className="furin-orbit-gallery__shade" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="furin-orbit-gallery__caption" aria-live="polite">
        <span key={frente} className="furin-orbit-gallery__title">{actual.title}</span>
        <span className="furin-orbit-gallery__sub">{actual.subtitle ?? ""}</span>
      </div>
    </div>
  );
}

export default OrbitGallery;
