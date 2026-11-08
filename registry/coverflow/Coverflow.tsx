"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import "./Coverflow.css";

export interface CoverflowItem {
  /** Título de la portada. */
  title: string;
  /** Línea secundaria bajo el título. */
  subtitle?: string;
}

export interface CoverflowProps {
  /** Portadas (si no pasas ninguna se usan nueve de ejemplo). */
  items?: CoverflowItem[];
  /** Lado de cada portada cuadrada, en px. */
  coverSize?: number;
  /** Portada que empieza al centro (desde 0). */
  startIndex?: number;
  /** Segundos entre avances automáticos (0 los desactiva). */
  autoplay?: number;
  /** Muestra el reflejo bajo cada portada. */
  reflection?: boolean;
  /** Cambia las escenas generadas de las portadas. */
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

const EJEMPLO: CoverflowItem[] = ["Aurora", "Tide", "Amber", "Mist", "Cobalt", "Dune", "Ether", "Flare", "Grotto"].map((title, i) => ({ title, subtitle: `Album ${String(i + 1).padStart(2, "0")}` }));
const limitar = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
// Pinta antes del primer fotograma (en el servidor no hay efectos, así que da igual cuál sea).
const useEfectoTemprano = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Coverflow: portadas en perspectiva con reflejo; la del centro mira de frente y las demás se abren en abanico. Se navega con flechas, arrastre con inercia, clic en una portada o el teclado. */
export function Coverflow({
  items,
  coverSize = 156,
  startIndex = 0,
  autoplay = 0,
  reflection = true,
  seed = 0,
  className = "",
  style,
}: CoverflowProps) {
  const lista = useMemo(() => (items && items.length >= 2 ? items : EJEMPLO), [items]);
  const n = lista.length;
  const [indice, setIndice] = useState(() => limitar(startIndex, 0, n - 1));

  const escena = useRef<HTMLDivElement>(null);
  const portadas = useRef<(HTMLDivElement | null)[]>([]);
  const lienzos = useRef<(HTMLCanvasElement | null)[]>([]);
  const reflejos = useRef<(HTMLCanvasElement | null)[]>([]);
  const fis = useRef({
    pos: limitar(startIndex, 0, n - 1), vel: 0, meta: limitar(startIndex, 0, n - 1),
    raf: 0, t: 0, visible: false, quieto: false,
    arrastre: false, x: 0, p0: 0, x0: 0, movido: 0, ultimo: 0, id: -1,
    encima: false, dir: 1, timer: 0, ult: -1,
  });
  const param = useRef({ n, cover: coverSize });
  param.current = { n, cover: coverSize };

  // Las escenas se pintan en un efecto temprano: así la portada nunca se ve vacía entre el montaje y el primer pintado.
  useEfectoTemprano(() => {
    for (let i = 0; i < n; i++) {
      const c = lienzos.current[i];
      if (!c) continue;
      pintarEscena(c, coverSize, coverSize, i + seed * 17 + 5);
      const r = reflejos.current[i];
      if (r) {
        r.width = c.width;
        r.height = c.height;
        r.getContext("2d")?.drawImage(c, 0, 0);
      }
    }
  }, [n, coverSize, seed, reflection]);

  const pintar = () => {
    const s = fis.current;
    const cs = param.current.cover;
    const sep = cs * 0.34;
    const hueco = cs * 0.56;
    for (let i = 0; i < param.current.n; i++) {
      const el = portadas.current[i];
      if (!el) continue;
      const d = i - s.pos;
      const ad = Math.abs(d);
      const k = limitar(d, -1, 1);
      const x = d * sep + k * hueco;
      const z = -Math.abs(k) * cs * 0.9 - Math.max(ad - 1, 0) * cs * 0.1;
      const rot = -k * 58;
      el.style.transform = `translate3d(${x.toFixed(2)}px, 0, ${z.toFixed(2)}px) rotateY(${rot.toFixed(2)}deg)`;
      el.style.zIndex = String(1000 - Math.round(ad * 20));
      el.style.opacity = String(limitar(1 - (ad - 2.8) / 1.1, 0, 1).toFixed(3));
      el.style.setProperty("--furin-cf-dim", limitar(ad * 0.42, 0, 0.62).toFixed(3));
    }
    const cercano = limitar(Math.round(s.pos), 0, param.current.n - 1);
    if (cercano !== s.ult) {
      s.ult = cercano;
      setIndice(cercano);
    }
  };

  const correr = () => {
    const s = fis.current;
    if (s.raf || !s.visible) return;
    s.t = performance.now();
    const paso = (ahora: number) => {
      let dt = Math.min(0.04, Math.max(0, (ahora - s.t) / 1000));
      s.t = ahora;
      if (!s.arrastre) {
        const w = 2 * Math.PI * 1.25;
        const z = 0.8;
        while (dt > 0) {
          const h = Math.min(dt, 1 / 240);
          dt -= h;
          s.vel += (w * w * (s.meta - s.pos) - 2 * z * w * s.vel) * h;
          s.pos += s.vel * h;
        }
      }
      pintar();
      if (!s.arrastre && Math.abs(s.pos - s.meta) < 0.0015 && Math.abs(s.vel) < 0.01) { s.pos = s.meta; s.vel = 0; pintar(); s.raf = 0; return; }
      if (!s.visible) { s.raf = 0; return; }
      s.raf = requestAnimationFrame(paso);
    };
    s.raf = requestAnimationFrame(paso);
  };

  const ir = (i: number) => {
    const s = fis.current;
    s.meta = limitar(Math.round(i), 0, param.current.n - 1);
    if (s.quieto) { s.pos = s.meta; s.vel = 0; pintar(); return; }
    correr();
  };

  // Posición inicial de las portadas antes del primer pintado (sin esto aparecerían todas apiladas en el centro un instante).
  useEfectoTemprano(() => {
    fis.current.quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pintar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const el = escena.current;
    if (!el) return;
    const s = fis.current;
    const io = new IntersectionObserver(([e]) => {
      s.visible = e.isIntersecting;
      if (e.isIntersecting) correr();
    });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(s.raf); s.raf = 0; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEfectoTemprano(() => { pintar(); correr(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [n, coverSize]);

  // Avance automático: va y vuelve de un extremo al otro, y se detiene cuando alguien lo toca.
  useEffect(() => {
    const s = fis.current;
    if (autoplay <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tic = () => {
      if (s.visible && !s.encima && !s.arrastre) {
        if (s.meta >= n - 1) s.dir = -1;
        else if (s.meta <= 0) s.dir = 1;
        ir(s.meta + s.dir);
      }
      s.timer = window.setTimeout(tic, autoplay * 1000);
    };
    s.timer = window.setTimeout(tic, autoplay * 1000);
    return () => window.clearTimeout(s.timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, n]);

  const alBajar = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const s = fis.current;
    s.arrastre = true;
    s.x = e.clientX;
    s.x0 = e.clientX;
    s.p0 = s.pos;
    s.movido = 0;
    s.ultimo = performance.now();
    s.vel = 0;
    s.id = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const alMover = (e: PointerEvent<HTMLDivElement>) => {
    const s = fis.current;
    if (!s.arrastre || e.pointerId !== s.id) return;
    const ahora = performance.now();
    const dx = e.clientX - s.x;
    s.movido += Math.abs(dx);
    s.x = e.clientX;
    const sep = param.current.cover * 0.34;
    const previa = s.pos;
    // Más allá de los extremos la fila se resiste, como una banda elástica.
    let np = s.p0 - (e.clientX - s.x0) / sep;
    if (np < 0) np = np * 0.35;
    if (np > param.current.n - 1) np = param.current.n - 1 + (np - (param.current.n - 1)) * 0.35;
    s.pos = np;
    const dt = Math.max(1, ahora - s.ultimo) / 1000;
    s.ultimo = ahora;
    s.vel = s.vel * 0.6 + ((s.pos - previa) / dt) * 0.4;
    pintar();
  };
  const alSoltar = (e: PointerEvent<HTMLDivElement>) => {
    const s = fis.current;
    if (!s.arrastre) return;
    s.arrastre = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (s.movido < 5) {
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("[data-i]") as HTMLElement | null;
      if (el) { ir(Number(el.dataset.i)); return; }
    }
    if (performance.now() - s.ultimo > 90) s.vel = 0;
    // Destino: hacia donde llevaba el gesto, con un empujón proporcional a la velocidad.
    ir(s.pos + limitar(s.vel, -9, 9) * 0.22);
  };
  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); ir(fis.current.meta - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); ir(fis.current.meta + 1); }
    else if (e.key === "Home") { e.preventDefault(); ir(0); }
    else if (e.key === "End") { e.preventDefault(); ir(n - 1); }
  };

  const vars = { "--furin-cf-size": `${coverSize}px` } as CSSProperties;
  const actual = lista[indice] ?? lista[0];

  // El título es el mismo elemento siempre (antes se remontaba con `key` y la línea quedaba en blanco un instante): al cambiar de
  // portada solo se anima su entrada, sin pasar nunca por opacidad 0.
  const titulo = useRef<HTMLSpanElement>(null);
  const tituloPrevio = useRef(indice);
  useEffect(() => {
    if (tituloPrevio.current === indice) return;
    tituloPrevio.current = indice;
    if (fis.current.quieto || typeof titulo.current?.animate !== "function") return;
    titulo.current.animate(
      [{ opacity: 0.35, transform: "translateY(5px)" }, { opacity: 1, transform: "none" }],
      { duration: 380, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" },
    );
  }, [indice]);

  return (
    <div className={`furin-coverflow ${className}`} style={{ ...vars, ...style }}>
      <div
        ref={escena}
        className="furin-coverflow__scene"
        role="group"
        aria-roledescription="carousel"
        aria-label="Coverflow; use the arrow keys or drag to change the cover"
        tabIndex={0}
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        onPointerEnter={() => { fis.current.encima = true; }}
        onPointerLeave={() => { fis.current.encima = false; }}
        onKeyDown={alTeclear}
      >
        <div className="furin-coverflow__floor" aria-hidden="true" />
        <div className="furin-coverflow__stage">
          {lista.map((it, i) => (
            <div
              key={it.title + i}
              ref={(el) => { portadas.current[i] = el; }}
              data-i={i}
              className="furin-coverflow__cover"
              role="img"
              aria-label={`${it.title}${it.subtitle ? `, ${it.subtitle}` : ""}`}
            >
              <div className="furin-coverflow__art">
                <canvas ref={(el) => { lienzos.current[i] = el; }} aria-hidden="true" />
                <i className="furin-coverflow__gloss" />
                <i className="furin-coverflow__shade" />
              </div>
              {reflection ? (
                <div className="furin-coverflow__refl" aria-hidden="true">
                  <canvas ref={(el) => { reflejos.current[i] = el; }} />
                  <i className="furin-coverflow__shade" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <button type="button" className="furin-coverflow__nav is-prev" aria-label="Previous cover" disabled={indice <= 0} onClick={() => ir(fis.current.meta - 1)}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="furin-coverflow__nav is-next" aria-label="Next cover" disabled={indice >= n - 1} onClick={() => ir(fis.current.meta + 1)}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div className="furin-coverflow__caption" aria-live="polite">
        <span ref={titulo} className="furin-coverflow__title">{actual.title}</span>
        <span className="furin-coverflow__sub">{actual.subtitle ?? ""}</span>
      </div>
      <div className="furin-coverflow__dots" aria-hidden="true">
        {lista.map((_, i) => <i key={i} className={`furin-coverflow__dot${i === indice ? " is-on" : ""}`} />)}
      </div>
    </div>
  );
}

export default Coverflow;
