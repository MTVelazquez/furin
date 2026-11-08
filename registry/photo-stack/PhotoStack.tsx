"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./PhotoStack.css";

export interface PhotoStackProps {
  /** Cuántas fotos hay en la pila (2 a 5). */
  count?: number;
  /** Ancho de cada foto, en px. */
  size?: number;
  /** Grados entre foto y foto cuando se abren en abanico. */
  fan?: number;
  /** Color del papel fotográfico. */
  paperColor?: string;
  /** Si es false, el abanico queda abierto siempre. */
  fanOnHover?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

type Layer = { t: "ridge" | "dunes" | "pines" | "city" | "waves"; y: number; amp: number; c: string; c2?: string; seed: number };
type Look = { sky: string[]; sun?: { x: number; y: number; r: number; c: string; glow: string }; stars?: boolean; layers: Layer[] };

// Cinco escenas generadas por código (nada de imágenes externas): cielo, astro, capas de relieve y grano de película.
const LOOKS: Look[] = [
  { sky: ["#2b1c52", "#9c3f6e", "#ff8f5e", "#ffd9a2"], sun: { x: 0.64, y: 0.56, r: 0.07, c: "#fff3cf", glow: "#ff9d62" }, layers: [
    { t: "ridge", y: 0.6, amp: 0.15, c: "#8a416c", c2: "#b3556d", seed: 1 }, { t: "ridge", y: 0.7, amp: 0.13, c: "#512b5d", c2: "#6e3a66", seed: 2 }, { t: "waves", y: 0.78, amp: 0.1, c: "#2a1a45", c2: "#ff9d62", seed: 3 } ] },
  { sky: ["#f5b67a", "#f6c78d", "#f9dcae", "#fdebd0"], sun: { x: 0.3, y: 0.34, r: 0.1, c: "#fffaf0", glow: "#ffd6a0" }, layers: [
    { t: "dunes", y: 0.58, amp: 0.12, c: "#d98a55", c2: "#e9a672", seed: 4 }, { t: "dunes", y: 0.72, amp: 0.14, c: "#b9633c", c2: "#d4814f", seed: 5 }, { t: "dunes", y: 0.88, amp: 0.1, c: "#7d3a27", c2: "#9a4b30", seed: 6 } ] },
  { sky: ["#bfe3dc", "#dff1e6", "#f3f6e6", "#fdf6df"], sun: { x: 0.74, y: 0.3, r: 0.06, c: "#ffffff", glow: "#fff0c0" }, layers: [
    { t: "ridge", y: 0.52, amp: 0.1, c: "#9bc7b8", c2: "#c0dccb", seed: 7 }, { t: "pines", y: 0.66, amp: 0.2, c: "#4f8a78", c2: "#7db19b", seed: 8 }, { t: "pines", y: 0.86, amp: 0.3, c: "#1d4a44", c2: "#2c6a5e", seed: 9 } ] },
  { sky: ["#05070f", "#0d1730", "#233a6b", "#d9748b"], stars: true, sun: { x: 0.28, y: 0.3, r: 0.045, c: "#fffbe9", glow: "#9db4ff" }, layers: [
    { t: "city", y: 0.7, amp: 0.2, c: "#121a33", c2: "#1d2a52", seed: 10 }, { t: "city", y: 0.9, amp: 0.26, c: "#070a14", c2: "#0d1326", seed: 11 } ] },
  { sky: ["#17315f", "#2f6b9a", "#8fc4d6", "#fbe3c0"], sun: { x: 0.5, y: 0.5, r: 0.08, c: "#fff6dc", glow: "#ffd9a0" }, layers: [
    { t: "ridge", y: 0.5, amp: 0.05, c: "#4d7c93", c2: "#6f9bab", seed: 12 }, { t: "waves", y: 0.54, amp: 0.46, c: "#0f3a5a", c2: "#ffe2b0", seed: 13 } ] },
];

function mix(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
}
const wave = (x: number, seed: number, oct = 4) => {
  let v = 0, a = 0.5, f = 1.4;
  for (let i = 0; i < oct; i++) { v += a * Math.sin(x * f + seed * 7.13 + i * 1.9) * (0.65 + 0.35 * Math.sin(x * f * 0.37 + seed * 3.1 + i)); a *= 0.5; f *= 2.07; }
  return v;
};

function paint(cv: HTMLCanvasElement, look: Look, seedBase: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (!W || !H) return;
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;
  let seed = seedBase * 9301 + 49297;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const sky = g.createLinearGradient(0, 0, 0, H * 0.75);
  look.sky.forEach((c, i) => sky.addColorStop(i / (look.sky.length - 1), c));
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  if (look.stars) { for (let i = 0; i < 70; i++) { g.globalAlpha = 0.25 + rnd() * 0.7; g.fillStyle = "#fff"; g.fillRect(rnd() * W, rnd() * H * 0.5, dpr * (0.6 + rnd()), dpr * (0.6 + rnd())); } g.globalAlpha = 1; }
  if (look.sun) {
    const s = look.sun, x = s.x * W, y = s.y * H, r = s.r * W;
    const gl = g.createRadialGradient(x, y, r * 0.2, x, y, r * 7);
    gl.addColorStop(0, s.glow + "dd"); gl.addColorStop(0.25, s.glow + "55"); gl.addColorStop(1, s.glow + "00");
    g.fillStyle = gl; g.fillRect(0, 0, W, H);
    g.fillStyle = s.c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  // Bandas de nube suaves.
  for (let i = 0; i < 4; i++) {
    const cx = rnd() * W, cy = H * (0.18 + rnd() * 0.3), rx = W * (0.25 + rnd() * 0.3);
    g.save(); g.translate(cx, cy); g.scale(1, 0.12);
    const cg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    cg.addColorStop(0, "rgba(255,255,255,0.22)"); cg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = cg; g.beginPath(); g.arc(0, 0, rx, 0, 7); g.fill(); g.restore();
  }
  for (const L of look.layers) {
    const base = L.y * H, amp = L.amp * H;
    const fill = g.createLinearGradient(0, base - amp, 0, Math.min(H, base + amp * 1.5));
    fill.addColorStop(0, L.c2 ?? L.c); fill.addColorStop(1, L.c);
    g.fillStyle = fill; g.beginPath(); g.moveTo(0, H);
    if (L.t === "ridge" || L.t === "dunes") {
      const k = L.t === "dunes" ? 2.4 : 5.5;
      for (let x = 0; x <= W; x += 2) g.lineTo(x, base - amp * (0.5 + 0.5 * wave((x / W) * k, L.seed, L.t === "dunes" ? 2 : 5)));
      g.lineTo(W, H); g.fill();
    } else if (L.t === "pines") {
      g.lineTo(0, base);
      for (let x = 0; x <= W; x += 2) g.lineTo(x, base + amp * 0.3);
      g.lineTo(W, H); g.fill();
      for (let x = -10; x < W + 10; ) {
        const h = amp * (0.55 + 0.6 * rnd()), w = h * 0.3;
        const by = base + amp * 0.1 + rnd() * amp * 0.5;
        g.fillStyle = mix(L.c, L.c2 ?? L.c, rnd() * 0.5);
        for (let tier = 0; tier < 4; tier++) {
          const ty = by - h * (tier / 4), tw = w * (1 - tier * 0.2);
          g.beginPath(); g.moveTo(x, ty - h * 0.42); g.lineTo(x + tw, ty); g.lineTo(x - tw, ty); g.closePath(); g.fill();
        }
        x += w * (0.8 + rnd() * 0.7);
      }
    } else if (L.t === "city") {
      g.lineTo(0, base);
      for (let x = 0; x < W; ) {
        const bw = W * (0.04 + rnd() * 0.07), bh = amp * H * (0.3 + rnd() * 0.7);
        g.fillStyle = L.c; g.fillRect(x, base - bh * 0.9, bw, H);
        g.fillStyle = L.c2 ?? L.c; g.fillRect(x, base - bh * 0.9, bw * 0.12, H);
        for (let wy = base - bh * 0.9 + 6 * dpr; wy < base; wy += 7 * dpr) for (let wx = x + 4 * dpr; wx < x + bw - 3 * dpr; wx += 6 * dpr) if (rnd() < 0.22) { g.fillStyle = `rgba(255,${200 + Math.round(rnd() * 40)},${120 + Math.round(rnd() * 60)},${0.5 + rnd() * 0.5})`; g.fillRect(wx, wy, 2.4 * dpr, 3 * dpr); }
        x += bw + 1;
      }
    } else {
      // Mar: degradado oscuro y estrías de reflejo del astro.
      g.fillRect(0, base, W, H);
      const sx = (look.sun?.x ?? 0.5) * W;
      for (let i = 0; i < 90; i++) {
        const y = base + (i / 90) * (H - base), spread = W * 0.04 * (1 + (i / 90) * 5), w = (W * 0.04 + rnd() * W * 0.1) * (0.4 + i / 90);
        g.fillStyle = (L.c2 ?? "#fff") + Math.round(60 + rnd() * 120).toString(16).padStart(2, "0");
        g.fillRect(sx + (rnd() - 0.5) * spread * 2 - w / 2, y, w, dpr * (0.8 + rnd() * 1.4));
      }
    }
  }
  // Viñeta y grano de película.
  const vg = g.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.85);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.38)");
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  const id = g.getImageData(0, 0, W, H), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(id, 0, 0);
}

/** Pila de fotos impresas: se reparten en abanico al pasar el cursor y la de arriba pasa al fondo con un clic. */
export function PhotoStack({
  count = 5,
  size = 172,
  fan = 12,
  paperColor = "#f6f2ea",
  fanOnHover = true,
  className = "",
  style,
}: PhotoStackProps) {
  const n = Math.max(2, Math.min(5, Math.round(count)));
  const [order, setOrder] = useState<number[]>(() => Array.from({ length: n }, (_, i) => i));
  const [leaving, setLeaving] = useState<number | null>(null);
  const [open, setOpen] = useState(!fanOnHover);
  const touch = useRef(false);
  const timer = useRef(0);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => { setOrder(Array.from({ length: n }, (_, i) => i)); }, [n]);
  useEffect(() => { setOpen(!fanOnHover); }, [fanOnHover]);
  useEffect(() => {
    const draw = () => canvases.current.forEach((cv, i) => cv && paint(cv, LOOKS[i % LOOKS.length], i + 3));
    draw();
    const ro = new ResizeObserver(draw);
    const first = canvases.current[0];
    if (first) ro.observe(first);
    return () => ro.disconnect();
  }, [size, n]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const next = () => {
    if (leaving !== null) return;
    const top = order[0];
    setLeaving(top);
    timer.current = window.setTimeout(() => { setOrder((o) => [...o.slice(1), o[0]]); setLeaving(null); }, 300);
  };

  const c = (n - 1) / 2;
  const vars = { "--ps-w": `${size}px`, "--ps-paper": paperColor, "--ps-fan": `${fan}deg`, "--ps-n": n } as CSSProperties;
  return (
    <div
      className={`furin-photo-stack ${open ? "is-open" : ""} ${className}`}
      style={{ ...vars, ...style }}
      onPointerEnter={(e) => { touch.current = e.pointerType !== "mouse"; if (fanOnHover && e.pointerType === "mouse") setOpen(true); }}
      onPointerLeave={(e) => { if (fanOnHover && e.pointerType === "mouse") setOpen(false); }}
      onPointerDown={(e) => { touch.current = e.pointerType !== "mouse"; }}
      onClick={() => { if (touch.current && fanOnHover && !open) { setOpen(true); return; } next(); }}
      role="button"
      tabIndex={0}
      aria-label="Photo stack: click to send the top one to the back"
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); next(); } }}
      onFocus={() => fanOnHover && setOpen(true)}
      onBlur={() => fanOnHover && setOpen(false)}
    >
      <div className="furin-photo-stack__deck">
        {Array.from({ length: n }, (_, id) => {
          const pos = order.indexOf(id); // 0 = arriba
          const p = n - 1 - pos; // 0 = izquierda/fondo
          const out = leaving === id;
          const st = { "--p": p, "--pa": (p - c).toFixed(2), "--z": out ? n + 2 : n - pos } as CSSProperties;
          return (
            <figure key={id} className={`furin-photo-stack__card ${out ? "is-leaving" : ""}`} style={st}>
              <canvas ref={(el) => { canvases.current[id] = el; }} />
              <span className="furin-photo-stack__gloss" aria-hidden />
            </figure>
          );
        })}
      </div>
    </div>
  );
}

export default PhotoStack;
