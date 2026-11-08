"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import "./AsciiText.css";

export interface AsciiTextProps {
  /** El texto que se dibuja con caracteres (acepta saltos de línea). */
  children?: string;
  /** Tamaño máximo de la letra del texto, en px (se reduce solo si no cabe). */
  size?: number;
  /** Tamaño de cada carácter ASCII, en px: más chico, más detalle. */
  cell?: number;
  /** Alto del lienzo, en px. */
  height?: number;
  /** Radio de la lente del cursor, en px. */
  radius?: number;
  /** Caracteres de menor a mayor densidad. */
  charset?: string;
  /** Cuando no hay cursor, una lente pasea sola por el texto. */
  idle?: boolean;
  /** Color de los caracteres. */
  color?: string;
  /** Color de los caracteres dentro de la lente. */
  accent?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const MONO = `"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
const SANS = `"Geist", "Inter", "SF Pro Display", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;
const S = 3; // submuestras por celda en cada eje

const hash = (a: number, b: number, c: number) => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const suave = (t: number) => t * t * (3 - 2 * t);

/** El texto se dibuja con caracteres ASCII en un lienzo; una lente alrededor del cursor los reacomoda y los revuelve. */
export function AsciiText({
  children = "ASCII",
  size = 190,
  cell = 8,
  height = 260,
  radius = 104,
  charset = " .:-=+*#%@",
  idle = true,
  color = "#E9EBEF",
  accent = "#7CF5C6",
  className = "",
  style,
}: AsciiTextProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const texto = String(children ?? "");
  const cfg = useRef({ size, cell, radius, charset, idle, color, accent });
  cfg.current = { size, cell, radius, charset, idle, color, accent };
  const vivo = useRef<{ build: () => void } | null>(null);

  useEffect(() => {
    const root = rootRef.current, canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, cols = 0, rows = 0, cw = 6, ch = 10, ox = 0, oy = 0, LW = 0, LH = 0;
    let lum = new Float32Array(0);
    let listo = false, visible = true, raf = 0, muerto = false, ultimo = 0, pintado = 0;
    const t0 = performance.now();
    const L = { x: 0, y: 0, act: 0, ptrActivo: false, px: 0, py: 0 };

    const fuente = (px: number, peso = 800) => `${peso} ${px}px ${SANS}`;

    // Dibuja el texto en un lienzo pequeño, con una resolución de S×S por celda ASCII.
    const construir = () => {
      if (muerto) return;
      W = root.clientWidth; H = root.clientHeight;
      if (!W || !H) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      const c = cfg.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = `500 ${c.cell}px ${MONO}`;
      cw = ctx.measureText("0").width || c.cell * 0.6;
      ch = Math.round(c.cell * 1.18);
      cols = Math.max(4, Math.floor(W / cw)); rows = Math.max(3, Math.floor(H / ch));
      ox = (W - cols * cw) / 2; oy = (H - rows * ch) / 2;
      LW = cols * S; LH = rows * S;
      const off = document.createElement("canvas");
      off.width = LW; off.height = LH;
      const o = off.getContext("2d", { willReadFrequently: true })!;
      o.setTransform(S / cw, 0, 0, S / ch, 0, 0);
      const lineas = texto.split("\n");
      const gw = cols * cw, gh = rows * ch;
      let fs = c.size;
      o.font = fuente(fs);
      const ancho = Math.max(...lineas.map((l) => o.measureText(l).width), 1);
      fs = Math.min(fs, (fs * gw * 0.9) / ancho, (gh * 0.82) / (lineas.length * 0.98));
      o.font = fuente(fs);
      o.fillStyle = "#fff";
      o.textAlign = "center";
      o.textBaseline = "alphabetic";
      const lh = fs * 0.98;
      const m0 = o.measureText(lineas[0]), mN = o.measureText(lineas[lineas.length - 1]);
      const top = -m0.actualBoundingBoxAscent, bot = (lineas.length - 1) * lh + mN.actualBoundingBoxDescent;
      const mid = (top + bot) / 2;
      lineas.forEach((ln, i) => o.fillText(ln, gw / 2, gh / 2 + i * lh - mid));
      const img = o.getImageData(0, 0, LW, LH).data;
      lum = new Float32Array(LW * LH);
      for (let i = 0; i < lum.length; i++) lum[i] = img[i * 4 + 3] / 255;
      listo = true;
      L.x = gw * 0.5; L.y = gh * 0.5;
      pintar(performance.now(), true);
      wake();
    };

    // Luminosidad de la imagen en el punto (u, v), en unidades de celda (interpolación bilineal).
    const muestra = (u: number, v: number) => {
      const x = u * S - 0.5, y = v * S - 0.5;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const g = (a: number, b: number) => (a < 0 || b < 0 || a >= LW || b >= LH ? 0 : lum[b * LW + a]);
      return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
    };

    const pintar = (now: number, estatico = false) => {
      if (!listo) return;
      const c = cfg.current;
      const ramp = c.charset.length > 1 ? c.charset : " .:-=+*#%@";
      const nR = ramp.length;
      const t = estatico || reducido ? 0 : (now - t0) / 1000;
      const tq = Math.floor(t * 22); // los caracteres revueltos cambian ~22 veces por segundo
      const gw = cols * cw;
      const R = c.radius;
      // Cubetas por (nivel de opacidad, color): una sola asignación de estilo por cubeta.
      const NIV = 5;
      const cub: number[][] = Array.from({ length: NIV * 2 }, () => []);
      const chars: string[] = [];
      for (let j = 0; j < rows; j++) {
        const y = j * ch + ch / 2;
        for (let i = 0; i < cols; i++) {
          const x = i * cw + cw / 2;
          let u = i + 0.5, v = j + 0.5, f = 0;
          if (L.act > 0.002) {
            const dx = x - L.x, dy = y - L.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < R * R) {
              f = suave(1 - Math.sqrt(d2) / R) * L.act;
              // La lente acerca y gira un poco el texto que tiene debajo.
              const th = f * 0.75, cs = Math.cos(th), sn = Math.sin(th), k = 1 - 0.55 * f;
              u = (L.x + (dx * cs - dy * sn) * k) / cw;
              v = (L.y + (dx * sn + dy * cs) * k) / ch;
            }
          }
          let val = muestra(u, v);
          const ruido = 0.5 * (Math.sin(i * 0.31 + t * 1.1 + j * 0.17) + Math.sin(j * 0.41 - t * 0.8 + i * 0.09));
          let idx = 0, nivel = 0;
          if (val > 0.04) {
            val = Math.min(1, val * (0.8 + 0.2 * ruido + 0.2));
            idx = Math.min(nR - 1, Math.max(1, Math.round(Math.pow(val, 0.9) * (nR - 1))));
            nivel = Math.min(NIV - 1, Math.floor(0.25 * NIV + val * (NIV * 0.75)));
          } else {
            // Un campo muy tenue de puntos alrededor, que se enciende cerca del cursor.
            const h = hash(i, j, Math.floor(t * 1.4));
            if (h > 0.022 + f * 0.1) continue;
            idx = 1; nivel = f > 0.1 ? 1 : 0;
          }
          if (f > 0.12 && hash(i, j, tq) < f * 1.05) {
            // Dentro de la lente, algunos caracteres se reacomodan al azar antes de asentarse.
            idx = 1 + Math.floor(hash(j, i, tq + 7) * (nR - 1));
          }
          const col = f > 0.3 ? 1 : 0;
          cub[nivel * 2 + col].push(chars.length, x, y);
          chars.push(ramp[idx]);
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.font = `500 ${c.cell}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let b = 0; b < cub.length; b++) {
        const arr = cub[b];
        if (!arr.length) continue;
        const nivel = b >> 1;
        ctx.globalAlpha = 0.16 + (0.84 * (nivel + 1)) / NIV;
        ctx.fillStyle = b & 1 ? c.accent : c.color;
        for (let k = 0; k < arr.length; k += 3) ctx.fillText(chars[arr[k]], ox + arr[k + 1], oy + arr[k + 2]);
      }
      ctx.globalAlpha = 1;
      void gw;
    };

    const paso = (now: number) => {
      raf = 0;
      if (muerto || !visible || !listo) return;
      const dt = Math.min(0.05, (now - (ultimo || now)) / 1000 || 0.016);
      ultimo = now;
      const c = cfg.current;
      const gw = cols * cw, gh = rows * ch;
      let objX = L.x, objY = L.y, objAct = 0;
      if (L.ptrActivo) { objX = L.px - ox; objY = L.py - oy; objAct = 1; }
      else if (c.idle) {
        const t = (now - t0) / 1000;
        objX = gw * (0.5 + 0.4 * Math.sin(t * 0.55)); objY = gh * (0.5 + 0.24 * Math.sin(t * 0.93 + 1));
        objAct = 1;
      }
      const k = 1 - Math.exp(-dt * 14);
      L.x += (objX - L.x) * k; L.y += (objY - L.y) * k;
      L.act += (objAct - L.act) * (1 - Math.exp(-dt * 7));
      const vivoAhora = L.act > 0.01;
      // Con la lente apagada solo respira (≈15 cuadros por segundo); con lente, a velocidad completa.
      if (!vivoAhora && now - pintado < 66) { raf = requestAnimationFrame(paso); return; }
      pintado = now;
      pintar(now);
      if (!reducido) raf = requestAnimationFrame(paso);
    };
    const wake = () => { if (!raf && visible && listo && !muerto && !reducido) { ultimo = 0; raf = requestAnimationFrame(paso); } };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const m = cfg.current.radius * 0.6;
      L.px = e.clientX - r.left; L.py = e.clientY - r.top;
      L.ptrActivo = e.clientX > r.left - m && e.clientX < r.right + m && e.clientY > r.top - m && e.clientY < r.bottom + m;
      wake();
    };
    const onFuera = () => { L.ptrActivo = false; wake(); };
    const onUp = (e: PointerEvent) => { if (e.pointerType !== "mouse") onFuera(); };
    if (!reducido) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onMove, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      document.documentElement.addEventListener("pointerleave", onFuera);
    }
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "80px" });
    io.observe(root);
    let pend = 0;
    const pedir = () => { cancelAnimationFrame(pend); pend = requestAnimationFrame(construir); };
    const ro = new ResizeObserver(pedir);
    ro.observe(root);
    vivo.current = { build: pedir };
    // Pinta ya con lo que haya y reconstruye cuando la fuente de verdad esté lista.
    Promise.all([document.fonts?.load(fuente(100)), document.fonts?.load(`500 12px ${MONO}`)]).catch(() => {}).then(() => { pedir(); });
    pedir();
    return () => {
      muerto = true; vivo.current = null;
      cancelAnimationFrame(raf); cancelAnimationFrame(pend);
      ro.disconnect(); io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onFuera);
    };
  }, [texto]);

  useEffect(() => { vivo.current?.build(); }, [size, cell, height, charset, color]);

  return (
    <div ref={rootRef} className={`furin-ascii-text ${className}`} style={{ height, ...style }} role="img" aria-label={texto.replace(/\n/g, " ")}>
      <canvas ref={canvasRef} className="furin-ascii-text__lienzo" aria-hidden="true" />
      <span className="furin-ascii-text__sr">{texto}</span>
    </div>
  );
}

export default AsciiText;
