"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import "./PixelAssemble.css";

export interface PixelAssembleProps {
  /** El texto que se arma con partículas (acepta saltos de línea). */
  children?: string;
  /** Tamaño máximo de la letra, en px (se reduce solo si no cabe). */
  size?: number;
  /** Alto del lienzo, en px. */
  height?: number;
  /** Separación entre partículas, en px: más chico, más fino (y más partículas). */
  gap?: number;
  /** Radio del cursor que dispersa las partículas, en px. */
  radius?: number;
  /** Fuerza con que el cursor empuja (0.3 a 2.5). */
  repel?: number;
  /** Cada cuántos segundos el texto se deshace y se vuelve a armar (0 = nunca). */
  replay?: number;
  /** Color de las partículas. */
  color?: string;
  /** Color que toman las partículas cuando se mueven. */
  accent?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const SANS = `"Geist", "Inter", "SF Pro Display", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;

function rgbDe(css: string, def: [number, number, number]): [number, number, number] {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.fillStyle = "#000";
    x.fillStyle = css;
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  } catch { return def; }
}

const NIV = 8;

/** El texto se arma desde una nube de partículas con resortes; el cursor las dispersa y vuelven solas a su sitio. */
export function PixelAssemble({
  children = "Pixels",
  size = 150,
  height = 260,
  gap = 3,
  radius = 84,
  repel = 1,
  replay = 9,
  color = "#F4F5F7",
  accent = "#7CF5C6",
  className = "",
  style,
}: PixelAssembleProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const texto = String(children ?? "");
  const cfg = useRef({ size, gap, radius, repel, replay, color, accent });
  cfg.current = { size, gap, radius, repel, replay, color, accent };
  const vivo = useRef<{ build: () => void } | null>(null);

  useEffect(() => {
    const root = rootRef.current, canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, N = 0, px = 4;
    let x = new Float32Array(0), y = new Float32Array(0), vx = new Float32Array(0), vy = new Float32Array(0);
    let tx = new Float32Array(0), ty = new Float32Array(0), sx = new Float32Array(0), sy = new Float32Array(0);
    let dl = new Float32Array(0), tam = new Float32Array(0), tinte = new Uint8Array(0), nivel = new Uint8Array(0);
    let fase: "arma" | "quieto" | "disperso" = "arma";
    let tFase = 0, tReplay = 0, visible = true, raf = 0, muerto = false, ultimo = 0, listo = false, sigReplay = 0;
    const P = { x: -9999, y: -9999, activo: false, vx: 0, vy: 0 };
    let c0: [number, number, number] = [244, 245, 247], c1: [number, number, number] = [124, 245, 198];
    let paleta: string[] = [];

    const colores = () => {
      c0 = rgbDe(cfg.current.color, c0); c1 = rgbDe(cfg.current.accent, c1);
      paleta = Array.from({ length: NIV }, (_, i) => {
        const k = i / (NIV - 1);
        return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * k)},${Math.round(c0[1] + (c1[1] - c0[1]) * k)},${Math.round(c0[2] + (c1[2] - c0[2]) * k)})`;
      });
    };

    const sembrar = (ahora: number) => {
      // Reparte las partículas por el lienzo (con un hueco hacia abajo) y les da un empujón lateral para que lleguen en arco.
      for (let i = 0; i < N; i++) {
        x[i] = Math.random() * W; y[i] = Math.random() * H;
        const a = Math.random() * 6.283, s = 20 + Math.random() * 110;
        vx[i] = Math.cos(a) * s; vy[i] = Math.sin(a) * s;
        dl[i] = (tx[i] / Math.max(1, W)) * 0.55 + Math.random() * 0.4;
      }
      fase = "arma"; tFase = ahora;
    };

    const construir = () => {
      if (muerto) return;
      W = root.clientWidth; H = root.clientHeight;
      if (!W || !H) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      const c = cfg.current;
      px = Math.max(2, c.gap);
      colores();
      // Texto → mapa de alfa → una partícula por celda cubierta.
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      const o = off.getContext("2d", { willReadFrequently: true })!;
      const lineas = texto.split("\n");
      let fs = c.size;
      o.font = `800 ${fs}px ${SANS}`;
      const ancho = Math.max(...lineas.map((l) => o.measureText(l).width), 1);
      fs = Math.min(fs, (fs * W * 0.88) / ancho, (H * 0.78) / (lineas.length * 0.98));
      o.font = `800 ${fs}px ${SANS}`;
      o.fillStyle = "#fff"; o.textAlign = "center"; o.textBaseline = "alphabetic";
      const lh = fs * 0.98;
      const m0 = o.measureText(lineas[0]), mN = o.measureText(lineas[lineas.length - 1]);
      const mid = (-m0.actualBoundingBoxAscent + (lineas.length - 1) * lh + mN.actualBoundingBoxDescent) / 2;
      lineas.forEach((ln, i) => o.fillText(ln, W / 2, H / 2 + i * lh - mid));
      const img = o.getImageData(0, 0, W, H).data;
      const pts: number[] = [];
      for (let yy = px / 2; yy < H; yy += px) for (let xx = px / 2; xx < W; xx += px) {
        if (img[((yy | 0) * W + (xx | 0)) * 4 + 3] > 128) pts.push(xx, yy);
      }
      N = pts.length / 2;
      x = new Float32Array(N); y = new Float32Array(N); vx = new Float32Array(N); vy = new Float32Array(N);
      tx = new Float32Array(N); ty = new Float32Array(N); sx = new Float32Array(N); sy = new Float32Array(N);
      dl = new Float32Array(N); tam = new Float32Array(N); tinte = new Uint8Array(N); nivel = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        tx[i] = pts[i * 2]; ty[i] = pts[i * 2 + 1];
        tam[i] = px * (0.72 + Math.random() * 0.2);
        tinte[i] = Math.random() < 0.07 ? 1 : 0; // algunas partículas conservan el color de acento
      }
      listo = true;
      const ahora = performance.now();
      if (reducido) { x.set(tx); y.set(ty); dibujar(); return; }
      sembrar(ahora);
      sigReplay = c.replay > 0 ? ahora + c.replay * 1000 : 0;
      wake();
    };

    const dibujar = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (let l = 0; l < NIV; l++) {
        ctx.fillStyle = paleta[l];
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const lv = tinte[i] ? Math.max(nivel[i], NIV - 3) : nivel[i];
          if (lv !== l) continue;
          const s = tam[i];
          ctx.rect(x[i] - s / 2, y[i] - s / 2, s, s);
        }
        ctx.fill();
      }
    };

    const paso = (now: number) => {
      raf = 0;
      if (muerto || !visible || !listo) return;
      const dt = Math.min(0.033, (now - (ultimo || now)) / 1000 || 0.016);
      ultimo = now;
      const c = cfg.current;
      const R = c.radius, R2 = R * R, F = 2600 * c.repel;
      const tf = (now - tFase) / 1000;
      // Ciclo: se arma → descansa → se deshace → se vuelve a armar.
      if (fase === "arma" && tf > 2.4) { fase = "quieto"; tFase = now; }
      if (c.replay > 0 && sigReplay && now > sigReplay && fase === "quieto") {
        fase = "disperso"; tFase = now;
        for (let i = 0; i < N; i++) {
          const a = Math.random() * 6.283, r = 40 + Math.random() * 120;
          sx[i] = Math.min(W, Math.max(0, tx[i] + Math.cos(a) * r)); sy[i] = Math.min(H, Math.max(0, ty[i] + Math.sin(a) * r * 0.7 - 20));
          vx[i] += Math.cos(a) * 90; vy[i] += Math.sin(a) * 90 - 40;
        }
      }
      if (fase === "disperso" && tf > 1.1) {
        fase = "arma"; tFase = now; sigReplay = c.replay * 1000 + now + 2400;
        for (let i = 0; i < N; i++) dl[i] = (tx[i] / Math.max(1, W)) * 0.45 + Math.random() * 0.35;
      }
      let energia = 0;
      const sub = 2, h = dt / sub;
      for (let s = 0; s < sub; s++) {
        for (let i = 0; i < N; i++) {
          let ax = 0, ay = 0;
          if (fase === "disperso") {
            ax = (sx[i] - x[i]) * 5 - vx[i] * 2.4; ay = (sy[i] - y[i]) * 5 - vy[i] * 2.4;
          } else if (fase === "arma" && tf < dl[i]) {
            // Todavía no le toca: flota despacio, con un poco de fricción.
            ax = -vx[i] * 1.6; ay = -vy[i] * 1.6;
          } else {
            ax = (tx[i] - x[i]) * 46 - vx[i] * 9.5; ay = (ty[i] - y[i]) * 46 - vy[i] * 9.5;
          }
          if (P.activo) {
            const dx = x[i] - P.x, dy = y[i] - P.y, d2 = dx * dx + dy * dy;
            if (d2 < R2 && d2 > 0.01) {
              const d = Math.sqrt(d2), f = 1 - d / R;
              const k = (f * f * F) / d;
              ax += dx * k; ay += dy * k;
            }
          }
          vx[i] += ax * h; vy[i] += ay * h;
          x[i] += vx[i] * h; y[i] += vy[i] * h;
        }
      }
      for (let i = 0; i < N; i++) {
        const sp = Math.abs(vx[i]) + Math.abs(vy[i]);
        nivel[i] = Math.min(NIV - 1, Math.floor((sp / 260) * NIV));
        energia += sp + Math.abs(tx[i] - x[i]) + Math.abs(ty[i] - y[i]);
      }
      dibujar();
      const reposo = fase === "quieto" && !P.activo && energia / Math.max(1, N) < 0.06;
      if (reposo) {
        // Todo quieto: se asienta, se duerme y despierta solo cuando toque deshacerse otra vez.
        x.set(tx); y.set(ty); vx.fill(0); vy.fill(0); nivel.fill(0); dibujar(); ultimo = 0;
        if (sigReplay) { clearTimeout(tReplay); tReplay = window.setTimeout(wake, Math.max(30, sigReplay - performance.now())); }
        return;
      }
      raf = requestAnimationFrame(paso);
    };
    function wake() { if (!raf && visible && listo && !muerto && !reducido) { ultimo = 0; raf = requestAnimationFrame(paso); } }

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const m = cfg.current.radius;
      P.x = e.clientX - r.left; P.y = e.clientY - r.top;
      P.activo = e.clientX > r.left - m && e.clientX < r.right + m && e.clientY > r.top - m && e.clientY < r.bottom + m;
      wake();
    };
    const onFuera = () => { P.activo = false; wake(); };
    const onUp = (e: PointerEvent) => { if (e.pointerType !== "mouse") onFuera(); };
    // Un clic o toque la deshace toda desde el punto donde se toca.
    const onDown = (e: PointerEvent) => {
      onMove(e);
      const r = canvas.getBoundingClientRect();
      if (!(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) || !listo) return;
      for (let i = 0; i < N; i++) {
        const dx = x[i] - P.x, dy = y[i] - P.y, d = Math.hypot(dx, dy) || 1;
        const k = 160 + Math.random() * 360;
        vx[i] += (dx / d) * k + (Math.random() - 0.5) * 120; vy[i] += (dy / d) * k + (Math.random() - 0.5) * 120;
      }
      fase = "arma"; tFase = performance.now();
      for (let i = 0; i < N; i++) dl[i] = 0.1 + Math.random() * 0.3;
      wake();
    };
    if (!reducido) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      document.documentElement.addEventListener("pointerleave", onFuera);
    }
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) wake();
    }, { rootMargin: "80px" });
    io.observe(root);
    let pend = 0;
    const pedir = () => { cancelAnimationFrame(pend); pend = requestAnimationFrame(construir); };
    const ro = new ResizeObserver(pedir);
    ro.observe(root);
    vivo.current = { build: pedir };
    document.fonts?.load(`800 100px ${SANS}`).catch(() => {}).then(() => { if (!muerto) pedir(); });
    pedir();
    return () => {
      muerto = true; vivo.current = null;
      cancelAnimationFrame(raf); cancelAnimationFrame(pend); clearTimeout(tReplay);
      ro.disconnect(); io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onFuera);
    };
  }, [texto]);

  useEffect(() => { vivo.current?.build(); }, [size, height, gap, color, accent]);

  return (
    <div ref={rootRef} className={`furin-pixel-assemble ${className}`} style={{ height, ...style }} role="img" aria-label={texto.replace(/\n/g, " ")}>
      <canvas ref={canvasRef} className="furin-pixel-assemble__lienzo" aria-hidden="true" />
      <span className="furin-pixel-assemble__sr">{texto}</span>
    </div>
  );
}

export default PixelAssemble;
