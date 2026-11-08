"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./Fireflies.css";

export interface FirefliesProps {
  /** Contenido que va encima de las luciérnagas. */
  children?: ReactNode;
  /** Color cálido de la luz. */
  color?: string;
  /** Color del fondo de la noche. */
  background?: string;
  /** Cuántas luciérnagas hay (1 = normal). */
  count?: number;
  /** Qué tan rápido vuelan y parpadean. */
  speed?: number;
  /** Qué tanto se acercan al cursor por curiosidad. */
  curiosity?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

let colorCtx: CanvasRenderingContext2D | null = null;
const RGB_CACHE = new Map<string, [number, number, number]>();
function rgb(css: string, def: [number, number, number]): [number, number, number] {
  const hit = RGB_CACHE.get(css);
  if (hit) return hit;
  try {
    colorCtx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    colorCtx.clearRect(0, 0, 1, 1);
    colorCtx.fillStyle = "#010203";
    colorCtx.fillStyle = css;
    colorCtx.fillRect(0, 0, 1, 1);
    const d = colorCtx.getImageData(0, 0, 1, 1).data;
    const out: [number, number, number] = [d[0], d[1], d[2]];
    if (RGB_CACHE.size > 64) RGB_CACHE.clear();
    RGB_CACHE.set(css, out);
    return out;
  } catch {
    return def;
  }
}

const TRAZO = 8;
interface Luciernaga {
  x: number; y: number; vx: number; vy: number;
  rumbo: number; giro: number; vel: number;
  z: number; periodo: number; fase: number; curio: number; hold: number;
  hx: Float32Array; hy: Float32Array; hi: number; ht: number;
}

/** Fondo de luciérnagas: puntos de luz cálida que deambulan en tres profundidades, parpadean con su propio ritmo y se acercan con curiosidad al cursor. */
export function Fireflies({
  children,
  color = "#ffd26b",
  background = "#06080a",
  count = 1,
  speed = 1,
  curiosity = 1,
  className = "",
  style,
}: FirefliesProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const props = useRef({ color, count, speed, curiosity });
  props.current = { color, count, speed, curiosity };
  const wakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-fireflies__lienzo";
    canvas.setAttribute("aria-hidden", "true");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    root.insertBefore(canvas, root.firstChild);

    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, muerto = false, ult = 0, t = reducido ? 5 : 0;
    let bichos: Luciernaga[] = [];
    let sprite: HTMLCanvasElement | null = null, spriteSuave: HTMLCanvasElement | null = null;
    const ptr = { x: 0, y: 0, hay: false, k: 0 };
    let cantClave = -1;

    const armarSprites = () => {
      const [r, g, b] = rgb(props.current.color, [255, 210, 107]);
      const mk = (pinta: (c: CanvasRenderingContext2D) => void) => { const cv = document.createElement("canvas"); cv.width = cv.height = 128; pinta(cv.getContext("2d")!); return cv; };
      // Nítido: núcleo casi blanco, halo cálido y una neblina muy tenue alrededor.
      sprite = mk((c) => {
        const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64);
        gr.addColorStop(0, "rgba(255,252,235,1)");
        gr.addColorStop(0.05, `rgba(${Math.min(255, r + 25)},${Math.min(255, g + 30)},${Math.min(255, b + 70)},0.95)`);
        gr.addColorStop(0.16, `rgba(${r},${g},${b},0.5)`);
        gr.addColorStop(0.42, `rgba(${r},${g},${b},0.14)`);
        gr.addColorStop(0.75, `rgba(${r},${g},${b},0.03)`);
        gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
        c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
      });
      // Bokeh de las cercanas: disco grande y difuso, sin núcleo.
      spriteSuave = mk((c) => {
        const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64);
        gr.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
        gr.addColorStop(0.6, `rgba(${r},${g},${b},0.4)`);
        gr.addColorStop(0.85, `rgba(${r},${g},${b},0.14)`);
        gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
        c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
      });
    };

    const armar = () => {
      cantClave = props.current.count;
      const n = Math.max(6, Math.round(((w * h) / 5200) * props.current.count));
      bichos = Array.from({ length: n }, (_, i) => {
        const z = Math.pow(Math.random(), 1.2);
        const x = Math.random() * w, y = Math.random() * h;
        return {
          x, y, vx: 0, vy: 0, rumbo: Math.random() * 6.28, giro: 0, vel: 10 + Math.random() * 18, z,
          periodo: 2.4 + Math.random() * 3.8, fase: Math.random() * 6.28 + i, curio: 0.35 + Math.random() * 0.65, hold: 38 + Math.random() * 60,
          hx: new Float32Array(TRAZO).fill(x), hy: new Float32Array(TRAZO).fill(y), hi: 0, ht: 0,
        };
      });
    };

    const brillo = (b: Luciernaga) => {
      // Destello estrecho con subida y bajada suaves; entre destellos queda una brasa tenue.
      const s = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / b.periodo + b.fase);
      return 0.1 + 0.9 * Math.pow(s, 2.6);
    };

    const pintar = (dt: number) => {
      const p = props.current;
      ptr.k += ((ptr.hay ? 1 : 0) - ptr.k) * (1 - Math.exp(-dt * 3));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "lighter";

      // Las lejanas se pintan primero (más pequeñas y tenues), las cercanas al final.
      const orden = bichos.slice().sort((a, b) => a.z - b.z);
      for (const b of orden) {
        const sp = b.z; // 0 lejos, 1 cerca
        // ── Vuelo: rumbo con giro aleatorio suave (ruido de Ornstein-Uhlenbeck) ──
        b.giro += ((Math.random() - 0.5) * 9 - b.giro * 1.4) * dt;
        b.rumbo += b.giro * dt;
        const v = b.vel * (0.45 + 0.9 * sp) * p.speed * (0.8 + 0.4 * Math.sin(t * 0.7 + b.fase));
        let ax = (Math.cos(b.rumbo) * v - b.vx) * 1.3, ay = (Math.sin(b.rumbo) * v * 0.8 - b.vy) * 1.3;
        // Curiosidad: se acerca al cursor, se queda rondando a su distancia y lo orbita.
        let cerca = 0;
        if (ptr.k > 0.02 && p.curiosity > 0) {
          const dx = ptr.x - b.x, dy = ptr.y - b.y, d = Math.hypot(dx, dy) || 1;
          const R = 260 * b.curio;
          if (d < R) {
            const f = (1 - d / R);
            cerca = f;
            const nx = dx / d, ny = dy / d;
            if (d > b.hold) { ax += nx * 170 * b.curio * f * p.curiosity * ptr.k; ay += ny * 170 * b.curio * f * p.curiosity * ptr.k; }
            else { const e = (b.hold - d) / b.hold; ax -= nx * 120 * e; ay -= ny * 120 * e; }
            // Órbita lenta alrededor del cursor.
            ax += -ny * 55 * f * p.curiosity * ptr.k; ay += nx * 55 * f * p.curiosity * ptr.k;
          }
        }
        // Frontera blanda: si se sale mucho de la escena, regresa.
        const m = 30;
        if (b.x < -m) ax += (-m - b.x) * 3; else if (b.x > w + m) ax -= (b.x - w - m) * 3;
        if (b.y < -m) ay += (-m - b.y) * 3; else if (b.y > h + m) ay -= (b.y - h - m) * 3;
        b.vx += ax * dt; b.vy += ay * dt;
        const sv = Math.hypot(b.vx, b.vy), tope = 120;
        if (sv > tope) { b.vx *= tope / sv; b.vy *= tope / sv; }
        b.x += b.vx * dt; b.y += b.vy * dt + Math.sin(t * 1.9 + b.fase) * 4 * dt;

        // ── Luz ──
        const base = reducido ? 0.75 : brillo(b);
        const luz = Math.min(1, base * (1 + cerca * 0.5));
        // Estela corta que se guarda cada 45 ms.
        b.ht += dt;
        if (b.ht > 0.045) { b.ht = 0; b.hi = (b.hi + 1) % TRAZO; b.hx[b.hi] = b.x; b.hy[b.hi] = b.y; }

        const esBokeh = sp > 0.88;
        const radio = esBokeh ? 26 + 14 * sp : 9 + 20 * sp;
        const alfa = esBokeh ? 0.12 + 0.3 * luz : (0.5 + 0.5 * sp) * luz;
        const img = esBokeh ? spriteSuave : sprite;
        if (!img) continue;
        if (!esBokeh && luz > 0.25) {
          for (let k = 1; k < TRAZO; k++) {
            const q = (b.hi - k + TRAZO) % TRAZO;
            const f = 1 - k / TRAZO;
            ctx.globalAlpha = alfa * f * f * 0.5;
            const rr = radio * (0.3 + 0.35 * f);
            ctx.drawImage(img, b.hx[q] - rr, b.hy[q] - rr, rr * 2, rr * 2);
          }
        }
        ctx.globalAlpha = Math.min(1, alfa);
        ctx.drawImage(img, b.x - radio, b.y - radio, radio * 2, radio * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };

    const paso = (ts: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.05, ult ? (ts - ult) / 1000 : 0.016);
      ult = ts;
      t += dt * props.current.speed;
      pintar(dt);
      raf = requestAnimationFrame(paso);
    };
    const wake = () => { if (reducido) return; if (!raf && visible && !muerto) { ult = 0; raf = requestAnimationFrame(paso); } };
    wakeRef.current = () => {
      armarSprites();
      if (cantClave !== props.current.count) armar();
      if (reducido) pintar(0.016); else wake();
    };

    const medir = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = root.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      armarSprites();
      armar();
      if (reducido) pintar(0.016); else { for (let i = 0; i < 20; i++) pintar(0.03); wake(); }
    };
    const ro = new ResizeObserver(medir);
    ro.observe(root);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "80px" });
    io.observe(root);

    const onMove = (e: PointerEvent) => { const r = root.getBoundingClientRect(); ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top; ptr.hay = true; };
    const onLeave = () => { ptr.hay = false; };
    if (!reducido) {
      root.addEventListener("pointermove", onMove, { passive: true });
      root.addEventListener("pointerdown", onMove, { passive: true });
      root.addEventListener("pointerleave", onLeave);
    }
    medir();

    return () => {
      muerto = true;
      wakeRef.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onMove);
      root.removeEventListener("pointerleave", onLeave);
      canvas.remove();
    };
  }, []);

  useEffect(() => { wakeRef.current?.(); }, [color, count, speed, curiosity]);

  const vars = { "--furin-fireflies-bg": background } as CSSProperties;
  return (
    <div ref={rootRef} className={`furin-fireflies ${className}`} style={{ ...vars, ...style }}>
      <span className="furin-fireflies__bruma" aria-hidden="true" />
      {children != null ? <div className="furin-fireflies__contenido">{children}</div> : null}
    </div>
  );
}

export default Fireflies;
