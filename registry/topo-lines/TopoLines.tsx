"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./TopoLines.css";

export interface TopoLinesProps {
  /** Contenido que va encima del mapa. */
  children?: ReactNode;
  /** Color de las curvas de nivel. */
  color?: string;
  /** Color de las curvas maestras y de sus cotas. */
  accent?: string;
  /** Color del fondo. */
  background?: string;
  /** Cuántas curvas hay entre la cima y el valle. */
  levels?: number;
  /** Cada cuántas curvas hay una maestra con su cota. */
  interval?: number;
  /** Tamaño de las colinas (mayor = colinas más anchas). */
  scale?: number;
  /** Qué tan rápido se deforma el terreno. */
  speed?: number;
  /** Muestra la altura (cota) sobre las curvas maestras. */
  labels?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

// ── Ruido de Perlin en 3D (x, y, tiempo) con permutación fija para que el terreno sea siempre el mismo ──
const PERM = (() => {
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  let s = 1337;
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
})();
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function grad(h: number, x: number, y: number, z: number) {
  const u = (h & 15) < 8 ? x : y;
  const v = (h & 15) < 4 ? y : (h & 15) === 12 || (h & 15) === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
function noise(x: number, y: number, z: number) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z, B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u), lerp(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u), lerp(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v),
    w,
  );
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

interface Etiqueta { x: number; y: number; c2: number; s2: number; alfa: number; nivel: number; vive: boolean; }

/** Fondo de mapa topográfico: curvas de nivel de un terreno que se deforma lento, con curvas maestras acotadas. */
export function TopoLines({
  children,
  color = "#7f938f",
  accent = "#e6c58e",
  background = "#0a0c0e",
  levels = 30,
  interval = 5,
  scale = 1,
  speed = 1,
  labels = true,
  className = "",
  style,
}: TopoLinesProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const props = useRef({ color, accent, background, levels, interval, scale, speed, labels });
  props.current = { color, accent, background, levels, interval, scale, speed, labels };
  const wakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-topo-lines__lienzo";
    canvas.setAttribute("aria-hidden", "true");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    root.insertBefore(canvas, root.firstChild);

    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, muerto = false, ult = 0;
    let t = reducido ? 9 : 3;
    let cel = 6, gw = 0, gh = 0;
    let campo = new Float32Array(0);
    // Cursor: levanta una colina bajo el puntero (las curvas se cierran a su alrededor).
    const ptr = { x: 0, y: 0, tx: 0, ty: 0, pres: 0, presObj: 0, hay: false };
    const etiquetas: Etiqueta[] = [];

    const medir = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = root.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      cel = Math.max(6, Math.sqrt((w * h) / 42000));
      gw = Math.ceil(w / cel) + 2; gh = Math.ceil(h / cel) + 2;
      campo = new Float32Array(gw * gh);
      etiquetas.length = 0;
      dibujar(0.016);
      wake();
    };

    const dibujar = (dt: number) => {
      const p = props.current;
      const [cr, cg, cb] = rgb(p.color, [127, 147, 143]);
      const [ar, ag, ab] = rgb(p.accent, [230, 197, 142]);
      const [br, bg, bb] = rgb(p.background, [10, 12, 14]);
      // Las líneas se pintan opacas (mezcladas con el fondo): así los empalmes de los segmentos no dejan puntos más brillantes.
      const mezcla = (r: number, g: number, b: number, a: number) => `rgb(${Math.round(br + (r - br) * a)},${Math.round(bg + (g - bg) * a)},${Math.round(bb + (b - bb) * a)})`;
      const nivelesN = Math.max(6, Math.round(p.levels));
      const paso = 1 / nivelesN;
      const inter = Math.max(2, Math.round(p.interval));

      // Cursor suave y colina bajo él.
      const k = 1 - Math.exp(-dt * 7);
      ptr.x += (ptr.tx - ptr.x) * k; ptr.y += (ptr.ty - ptr.y) * k;
      ptr.pres += (ptr.presObj - ptr.pres) * (1 - Math.exp(-dt * 3));

      // 1) Campo de alturas: ruido fractal de 3 octavas; el tiempo es la tercera dimensión.
      const inv = 1 / (230 * p.scale);
      const sigma2 = 2 * Math.pow(Math.min(w, h) * 0.22, 2);
      const amp = 0.3 * ptr.pres;
      for (let j = 0; j < gh; j++) {
        const y = j * cel;
        for (let i = 0; i < gw; i++) {
          const x = i * cel;
          const nx = x * inv, ny = y * inv;
          let v = noise(nx, ny, t) * 0.6 + noise(nx * 2.1 + 7.3, ny * 2.1 - 3.1, t * 1.3) * 0.28 + noise(nx * 4.3 - 5.7, ny * 4.3 + 9.1, t * 1.7) * 0.12;
          v = 0.5 + v * 0.95;
          if (amp > 0.001) { const dx = x - ptr.x, dy = y - ptr.y; v += amp * Math.exp(-(dx * dx + dy * dy) / sigma2); }
          campo[j * gw + i] = v;
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Marcas de registro tipo carta topográfica: cruces muy tenues cada 120 px.
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.22)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 60; x < w; x += 120) for (let y = 60; y < h; y += 120) { ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); }
      ctx.stroke();

      // 2) Marching squares por nivel: se agrupa por curva para pintarla de un solo trazo.
      const total = nivelesN + 1;
      const segs: number[][] = Array.from({ length: total }, () => []);
      for (let j = 0; j < gh - 1; j++) {
        for (let i = 0; i < gw - 1; i++) {
          const a = campo[j * gw + i], b = campo[j * gw + i + 1], c = campo[(j + 1) * gw + i + 1], d = campo[(j + 1) * gw + i];
          const mn = Math.min(a, b, c, d), mx = Math.max(a, b, c, d);
          let l0 = Math.ceil(mn / paso), l1 = Math.floor(mx / paso);
          if (l1 < 1 || l0 > nivelesN - 1) continue;
          if (l0 < 1) l0 = 1;
          if (l1 > nivelesN - 1) l1 = nivelesN - 1;
          const x0 = i * cel, y0 = j * cel;
          for (let l = l0; l <= l1; l++) {
            const lv = l * paso;
            let caso = 0;
            if (a > lv) caso |= 1; if (b > lv) caso |= 2; if (c > lv) caso |= 4; if (d > lv) caso |= 8;
            if (caso === 0 || caso === 15) continue;
            // Puntos de cruce en los cuatro bordes (arriba, derecha, abajo, izquierda).
            const tT = (lv - a) / (b - a), tR = (lv - b) / (c - b), tB = (lv - d) / (c - d), tL = (lv - a) / (d - a);
            const Tx = x0 + tT * cel, Ty = y0, Rx = x0 + cel, Ry = y0 + tR * cel, Bx = x0 + tB * cel, By = y0 + cel, Lx = x0, Ly = y0 + tL * cel;
            const s = segs[l];
            switch (caso) {
              case 1: case 14: s.push(Lx, Ly, Tx, Ty); break;
              case 2: case 13: s.push(Tx, Ty, Rx, Ry); break;
              case 3: case 12: s.push(Lx, Ly, Rx, Ry); break;
              case 4: case 11: s.push(Rx, Ry, Bx, By); break;
              case 6: case 9: s.push(Tx, Ty, Bx, By); break;
              case 7: case 8: s.push(Lx, Ly, Bx, By); break;
              case 5: s.push(Lx, Ly, Tx, Ty, Rx, Ry, Bx, By); break;
              case 10: s.push(Tx, Ty, Rx, Ry, Lx, Ly, Bx, By); break;
            }
          }
        }
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let l = 1; l < total - 1; l++) {
        const s = segs[l];
        if (!s.length) continue;
        const maestra = l % inter === 0;
        // Las curvas altas se encienden un poco más: da lectura de relieve sin colorear el mapa.
        const alt = l / nivelesN;
        if (maestra) { ctx.lineWidth = 1.35; ctx.strokeStyle = mezcla(ar, ag, ab, 0.55 + 0.3 * alt); }
        else { ctx.lineWidth = 0.8; ctx.strokeStyle = mezcla(cr, cg, cb, 0.3 + 0.3 * alt); }
        ctx.beginPath();
        for (let q = 0; q < s.length; q += 4) { ctx.moveTo(s[q], s[q + 1]); ctx.lineTo(s[q + 2], s[q + 3]); }
        ctx.stroke();
      }

      // 3) Cotas: cada etiqueta persigue el punto más cercano de su curva maestra y rompe la línea debajo.
      if (p.labels) {
        const maestras: number[] = [];
        for (let l = inter; l < nivelesN; l += inter) maestras.push(l);
        // Dos etiquetas por curva en pantallas grandes, una en chicas.
        const porCurva = w * h > 260000 ? 2 : 1;
        const meta = maestras.flatMap((l) => Array.from({ length: porCurva }, (_, n) => ({ l, n })));
        while (etiquetas.length < meta.length) {
          const n = etiquetas.length;
          const m = meta[n];
          etiquetas.push({ x: (0.15 + 0.7 * ((n * 0.6180339) % 1)) * w, y: (0.12 + 0.76 * ((n * 0.7548776 + 0.2) % 1)) * h, c2: 1, s2: 0, alfa: 0, nivel: m.l, vive: false });
        }
        etiquetas.length = meta.length;
        ctx.font = `500 ${w < 420 ? 9 : 10}px "JetBrains Mono", ui-monospace, Menlo, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const kk = 1 - Math.exp(-dt * 5);
        for (let n = 0; n < etiquetas.length; n++) {
          const e = etiquetas[n];
          const l = meta[n].l;
          e.nivel = l;
          const s = segs[l];
          let mejor = -1, md = 1e9;
          for (let q = 0; q < s.length; q += 4) {
            const mx = (s[q] + s[q + 2]) / 2, my = (s[q + 1] + s[q + 3]) / 2;
            const d = (mx - e.x) * (mx - e.x) + (my - e.y) * (my - e.y);
            if (d < md) { md = d; mejor = q; }
          }
          if (mejor >= 0 && md < 70 * 70) {
            const mx = (s[mejor] + s[mejor + 2]) / 2, my = (s[mejor + 1] + s[mejor + 3]) / 2;
            const ang = Math.atan2(s[mejor + 3] - s[mejor + 1], s[mejor + 2] - s[mejor]);
            e.x += (mx - e.x) * kk; e.y += (my - e.y) * kk;
            e.c2 += (Math.cos(2 * ang) - e.c2) * kk; e.s2 += (Math.sin(2 * ang) - e.s2) * kk;
            e.vive = true;
          } else if (e.alfa < 0.02) {
            // Perdió su curva: reaparece en otro lugar cuando ya se apagó.
            e.x = (0.12 + 0.76 * Math.random()) * w; e.y = (0.12 + 0.76 * Math.random()) * h; e.vive = false;
          } else e.vive = false;
          const borde = Math.min(e.x, w - e.x, e.y, h - e.y);
          let objetivo = e.vive ? Math.min(1, Math.max(0, (borde - 14) / 40)) : 0;
          // Si otra cota ya ocupa ese sitio, esta cede para que no se encimen.
          for (let o = 0; o < n; o++) { const q = etiquetas[o]; if (q.alfa > 0.25 && Math.hypot(q.x - e.x, q.y - e.y) < 52) objetivo = 0; }
          e.alfa += (objetivo - e.alfa) * (1 - Math.exp(-dt * 3));
          if (e.alfa < 0.02) continue;
          const ang = Math.atan2(e.s2, e.c2) / 2;
          const txt = String(1200 + l * 25);
          const tw = ctx.measureText(txt).width;
          ctx.save();
          ctx.translate(e.x, e.y);
          ctx.rotate(ang);
          ctx.globalCompositeOperation = "destination-out";
          ctx.globalAlpha = e.alfa;
          ctx.fillStyle = "#000";
          ctx.fillRect(-tw / 2 - 5, -7, tw + 10, 14);
          ctx.globalCompositeOperation = "source-over";
          ctx.fillStyle = `rgba(${ar},${ag},${ab},${(0.92 * e.alfa).toFixed(3)})`;
          ctx.fillText(txt, 0, 0.5);
          ctx.restore();
        }
      }
    };

    const paso = (ts: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.05, ult ? (ts - ult) / 1000 : 0.016);
      ult = ts;
      t += dt * 0.045 * props.current.speed;
      dibujar(dt);
      raf = requestAnimationFrame(paso);
    };
    const wake = () => { if (reducido) return; if (!raf && visible && !muerto) { ult = 0; raf = requestAnimationFrame(paso); } };
    wakeRef.current = () => { if (reducido) dibujar(0.016); else wake(); };

    const ro = new ResizeObserver(medir);
    ro.observe(root);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "80px" });
    io.observe(root);

    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      ptr.tx = e.clientX - r.left; ptr.ty = e.clientY - r.top;
      if (!ptr.hay) { ptr.x = ptr.tx; ptr.y = ptr.ty; ptr.hay = true; }
      ptr.presObj = 1;
    };
    const onLeave = () => { ptr.presObj = 0; ptr.hay = false; };
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

  useEffect(() => { wakeRef.current?.(); }, [color, accent, levels, interval, scale, speed, labels]);

  const vars = { "--furin-topo-lines-bg": background } as CSSProperties;
  return (
    <div ref={rootRef} className={`furin-topo-lines ${className}`} style={{ ...vars, ...style }}>
      <span className="furin-topo-lines__vineta" aria-hidden="true" />
      {children != null ? <div className="furin-topo-lines__contenido">{children}</div> : null}
    </div>
  );
}

export default TopoLines;
