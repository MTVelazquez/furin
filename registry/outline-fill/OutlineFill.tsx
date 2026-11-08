"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./OutlineFill.css";

export interface OutlineFillProps {
  /** Texto a mostrar. */
  children?: ReactNode;
  /** Tamaño máximo de la letra, en px (se ajusta al ancho). */
  fontSize?: number;
  /** Grosor de la letra. */
  fontWeight?: number;
  /** Color del líquido. */
  color?: string;
  /** Color del contorno. */
  strokeColor?: string;
  /** Grosor del contorno, en px. */
  strokeWidth?: number;
  /** Qué tan alta es la ola al entrar y salir. */
  waveHeight?: number;
  /** Se llena y se vacía solo cuando nadie lo toca. */
  autoplay?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

function textOf(n: ReactNode): string {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  return "";
}

let colorCtx: CanvasRenderingContext2D | null = null;
function rgb255(color: string): [number, number, number] {
  colorCtx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = "#000";
  colorCtx.fillStyle = color;
  colorCtx.fillRect(0, 0, 1, 1);
  const d = colorCtx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}
const mix = (c: [number, number, number], t: number, to: number) =>
  `rgb(${Math.round(c[0] + (to - c[0]) * t)},${Math.round(c[1] + (to - c[1]) * t)},${Math.round(c[2] + (to - c[2]) * t)})`;

/** Texto en contorno que se llena de líquido: una ola nace donde entra el cursor y se reparte por las letras. */
export function OutlineFill({
  children = "Waves",
  fontSize = 132,
  fontWeight = 900,
  color = "#3FA9FF",
  strokeColor = "rgba(255,255,255,0.9)",
  strokeWidth = 1.6,
  waveHeight = 1,
  autoplay = false,
  className = "",
  style,
}: OutlineFillProps) {
  const host = useRef<HTMLDivElement>(null);
  const text = textOf(children);
  const live = useRef({ color, strokeColor, strokeWidth, waveHeight, autoplay });
  live.current = { color, strokeColor, strokeWidth, waveHeight, autoplay };
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-outline-fill__canvas";
    canvas.setAttribute("aria-hidden", "true");
    el.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;
    const lq = document.createElement("canvas");
    const lctx = lq.getContext("2d")!;

    const lines = text.split("\n");
    const N = 150;
    const h = new Float32Array(N);
    const v = new Float32Array(N);
    let W = 0, H = 0, dpr = 1, fs = fontSize, lh = fs;
    let family = "system-ui, sans-serif";
    let L = 0, Lv = 0, T = 0, x0 = 0.5;
    let time = 0, acc = 0, last = 0, raf = 0, visible = true;
    let autoT = 0;
    let inside = false;
    let lastX = -1;
    const bubbles = Array.from({ length: 16 }, (_, i) => ({ x: (i * 0.618 + 0.13) % 1, y: (i * 0.37) % 1, r: 1.4 + ((i * 7) % 5) * 0.7, s: 0.12 + ((i * 3) % 4) * 0.05 }));

    const layout = () => {
      W = el.clientWidth || 300;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      family = getComputedStyle(el).fontFamily || family;
      ctx.font = `${fontWeight} 100px ${family}`;
      const w100 = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
      fs = Math.min(fontSize, (W * 0.92) / (w100 / 100));
      lh = fs * 1.02;
      H = Math.ceil(lines.length * lh + fs * 0.4);
      el.style.height = `${H}px`;
      for (const c of [canvas, lq]) {
        c.width = Math.max(2, Math.round(W * dpr));
        c.height = Math.max(2, Math.round(H * dpr));
      }
      cache.dark = cache.light = cache.ring = null;
      cache.key = "";
      draw();
    };

    const textPath = (c: CanvasRenderingContext2D, mode: "fill" | "stroke") => {
      c.font = `${fontWeight} ${fs}px ${family}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineJoin = "round";
      c.miterLimit = 2;
      lines.forEach((l, i) => {
        const y = H / 2 + (i - (lines.length - 1) / 2) * lh + fs * 0.03;
        if (mode === "fill") c.fillText(l, W / 2, y);
        else c.strokeText(l, W / 2, y);
      });
    };

    // Silueta "unida" de las letras. Las fuentes variables (San Francisco, Geist, Inter...) dibujan algunas letras con contornos que se
    // solapan (la barra de la "e" cruza su ojo, la "a", la "&", el "8"...). Un strokeText traza CADA contorno, así que esas líneas
    // internas aparecían dentro de la letra y la "e" se veía rota. Rellenar sí funciona (regla non-zero = la unión), de modo que el contorno
    // y los bordes de volumen se derivan de la silueta rellena: nunca se traza texto para dibujarlos.
    const K = 24;
    const cache: { dark: HTMLCanvasElement | null; light: HTMLCanvasElement | null; ring: HTMLCanvasElement | null; key: string } = { dark: null, light: null, ring: null, key: "" };
    const blank = () => {
      const c = document.createElement("canvas");
      c.width = lq.width;
      c.height = lq.height;
      return c;
    };
    /** Silueta de las letras encogida r px hacia adentro (erosión: intersección de copias desplazadas en círculo), movida (dx, dy). */
    const silhouette = (r: number, dx = 0, dy = 0) => {
      const c = blank();
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff";
      g.setTransform(dpr, 0, 0, dpr, dx * dpr, dy * dpr);
      textPath(g, "fill");
      if (r > 0.01) {
        g.globalCompositeOperation = "destination-in";
        for (let k = 0; k < K; k++) {
          const a = (k / K) * Math.PI * 2;
          g.setTransform(dpr, 0, 0, dpr, (dx + Math.cos(a) * r) * dpr, (dy + Math.sin(a) * r) * dpr);
          textPath(g, "fill");
        }
      }
      return c;
    };
    const minus = (a: HTMLCanvasElement, hole: HTMLCanvasElement) => {
      const g = a.getContext("2d")!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "destination-out";
      g.drawImage(hole, 0, 0);
      g.globalCompositeOperation = "source-over";
      return a;
    };
    const tint = (a: HTMLCanvasElement, color: string) => {
      const g = a.getContext("2d")!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = color;
      g.fillRect(0, 0, a.width, a.height);
      g.globalCompositeOperation = "source-over";
      return a;
    };
    /** Bordes de volumen del líquido (oscuro hacia adentro y un filo de luz arriba-izquierda), siempre sobre la silueta unida. */
    const edges = () => {
      cache.dark ??= tint(minus(silhouette(0), silhouette(3.5)), "rgba(0,12,40,0.38)");
      cache.light ??= tint(minus(silhouette(0), silhouette(1.5, 0.8, 1.4)), "rgba(255,255,255,0.13)");
      return cache as { dark: HTMLCanvasElement; light: HTMLCanvasElement };
    };
    /** Contorno centrado en el borde de la silueta: (silueta dilatada w/2) menos (silueta erosionada w/2). */
    const ringOf = (w: number, color: string) => {
      const key = `${w}|${color}`;
      if (cache.key !== key || !cache.ring) {
        const c = blank();
        const g = c.getContext("2d")!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = "#fff";
        g.strokeStyle = "#fff";
        g.lineWidth = w;
        textPath(g, "fill");
        textPath(g, "stroke"); // dilata la silueta w/2 (las trazas internas quedan dentro y se borran abajo)
        cache.ring = tint(minus(c, silhouette(w / 2)), color);
        cache.key = key;
      }
      return cache.ring;
    };

    const surface = (i: number, lvl: number, back: boolean) => {
      const x = (i / (N - 1)) * W;
      const yBottom = H / 2 + (lines.length * lh) / 2 + fs * 0.05;
      const yTop = H / 2 - (lines.length * lh) / 2 - fs * 0.5;
      const amp = fs * 0.1 * live.current.waveHeight;
      // El líquido se amontona donde entró el cursor y se reparte al subir.
      const dx = (x / W - x0) / 0.24;
      const heap = Math.exp(-dx * dx) * 4 * lvl * (1 - lvl) * fs * 0.42 * Math.min(1.4, live.current.waveHeight + 0.2);
      const hh = back ? h[(i + 7) % N] * 0.7 : h[i];
      const swell = Math.sin(x * 0.03 + time * (back ? 2.7 : 2.1) + (back ? 1.7 : 0)) * fs * 0.018 * Math.min(1, lvl * 6) * (back ? 1.3 : 1);
      return yBottom + (yTop - yBottom) * lvl - hh * amp - heap + swell;
    };

    const draw = () => {
      if (!W) return;
      const col = rgb255(live.current.color);
      const light = mix(col, 0.5, 255);
      const base = mix(col, 0, 0);
      const deep = mix(col, 0.55, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // Cuerpo de vidrio apenas visible: da peso a las letras vacías.
      ctx.fillStyle = "rgba(255,255,255,0.045)";
      textPath(ctx, "fill");

      if (L > 0.004) {
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        lctx.globalCompositeOperation = "source-over";
        lctx.clearRect(0, 0, W, H);
        const yBottom = H / 2 + (lines.length * lh) / 2 + fs * 0.05;
        const lvl = Math.min(L, 1.02);
        let minY = H;
        for (let i = 0; i < N; i++) minY = Math.min(minY, surface(i, lvl, false));
        const grad = lctx.createLinearGradient(0, minY - fs * 0.05, 0, yBottom + fs * 0.1);
        grad.addColorStop(0, light);
        grad.addColorStop(0.22, base);
        grad.addColorStop(1, deep);
        // capa de atrás: más oscura y desfasada, da profundidad al agua
        lctx.globalAlpha = 0.65;
        lctx.fillStyle = mix(col, 0.35, 0);
        lctx.beginPath();
        lctx.moveTo(0, H + 4);
        for (let i = 0; i < N; i++) lctx.lineTo((i / (N - 1)) * W, surface(i, lvl, true));
        lctx.lineTo(W, H + 4);
        lctx.closePath();
        lctx.fill();
        lctx.globalAlpha = 1;
        // capa frontal
        lctx.fillStyle = grad;
        lctx.beginPath();
        lctx.moveTo(0, H + 4);
        for (let i = 0; i < N; i++) lctx.lineTo((i / (N - 1)) * W, surface(i, lvl, false));
        lctx.lineTo(W, H + 4);
        lctx.closePath();
        lctx.fill();
        // menisco: el borde brillante del líquido
        lctx.save();
        lctx.beginPath();
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * W;
          const y = surface(i, lvl, false);
          if (i === 0) lctx.moveTo(x, y);
          else lctx.lineTo(x, y);
        }
        lctx.strokeStyle = "rgba(255,255,255,0.85)";
        lctx.lineWidth = 2.2;
        lctx.shadowColor = light;
        lctx.shadowBlur = 10;
        lctx.stroke();
        lctx.restore();
        // burbujas dentro del líquido
        lctx.save();
        lctx.lineWidth = 1;
        for (const b of bubbles) {
          const bx = b.x * W;
          const yTopB = surface(Math.round(b.x * (N - 1)), lvl, false);
          const by = yBottom - ((b.y + time * b.s) % 1) * (yBottom - yTopB);
          if (by < yTopB + 4) continue;
          lctx.strokeStyle = "rgba(255,255,255,0.55)";
          lctx.beginPath();
          lctx.arc(bx + Math.sin(time * 1.3 + b.x * 9) * 3, by, b.r, 0, Math.PI * 2);
          lctx.stroke();
          lctx.fillStyle = "rgba(255,255,255,0.7)";
          lctx.beginPath();
          lctx.arc(bx - b.r * 0.3 + Math.sin(time * 1.3 + b.x * 9) * 3, by - b.r * 0.3, b.r * 0.28, 0, Math.PI * 2);
          lctx.fill();
        }
        lctx.restore();
        // reflejo de vidrio en diagonal, como luz de ventana
        const g2 = lctx.createLinearGradient(0, 0, W, H * 1.1);
        g2.addColorStop(0, "rgba(255,255,255,0)");
        g2.addColorStop(0.3, "rgba(255,255,255,0)");
        g2.addColorStop(0.36, "rgba(255,255,255,0.26)");
        g2.addColorStop(0.42, "rgba(255,255,255,0)");
        g2.addColorStop(0.5, "rgba(255,255,255,0.08)");
        g2.addColorStop(0.58, "rgba(255,255,255,0)");
        lctx.fillStyle = g2;
        lctx.fillRect(0, 0, W, H);
        // recorta el líquido a las letras
        lctx.globalCompositeOperation = "destination-in";
        lctx.fillStyle = "#fff";
        textPath(lctx, "fill");
        // volumen de tubo: borde oscuro y luz suave hacia adentro (solo donde hay líquido). Sale de la silueta unida de las letras,
        // no de strokeText (que dibujaría también los contornos internos de la "e", la "a"...).
        lctx.globalCompositeOperation = "source-atop";
        const e = edges();
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.drawImage(e.dark, 0, 0);
        lctx.drawImage(e.light, 0, 0);
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const g3 = lctx.createLinearGradient(0, H / 2 - (lines.length * lh) / 2, 0, H / 2 + (lines.length * lh) / 2);
        g3.addColorStop(0, "rgba(255,255,255,0.20)");
        g3.addColorStop(0.45, "rgba(255,255,255,0)");
        lctx.fillStyle = g3;
        lctx.fillRect(0, 0, W, H);
        lctx.globalCompositeOperation = "source-over";
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(lq, 0, 0);
        ctx.restore();
      }
      // contorno: borde de la silueta unida, centrado, sin las líneas internas de las fuentes variables
      if (live.current.strokeWidth > 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(ringOf(live.current.strokeWidth, live.current.strokeColor), 0, 0);
      }
    };

    const splash = (nx: number, amount: number) => {
      const c = nx * (N - 1);
      for (let i = 0; i < N; i++) {
        const d = (i - c) / 5;
        v[i] -= amount * Math.exp(-d * d);
      }
    };

    const stepWave = (dt: number) => {
      acc += dt;
      const sub = 1 / 120;
      while (acc >= sub) {
        acc -= sub;
        for (let i = 0; i < N; i++) {
          const a = h[i > 0 ? i - 1 : 0] + h[i < N - 1 ? i + 1 : N - 1] - 2 * h[i];
          v[i] = (v[i] + a * 0.5) * 0.9935;
        }
        for (let i = 0; i < N; i++) h[i] += v[i];
      }
    };

    const setTarget = (t: number, nx: number) => {
      if (T === t) return;
      T = t;
      x0 = nx;
      splash(nx, 0.9 * (t ? 1 : 0.7));
      wake();
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      time += dt;
      // resorte del nivel con un poco de rebote, como líquido que se acomoda
      Lv += ((T - L) * 38 - Lv * 9.5) * dt;
      L += Lv * dt;
      stepWave(dt);
      if (live.current.autoplay && !inside) {
        autoT += dt;
        if (T === 0 && autoT > 1.1) {
          autoT = 0;
          setTarget(1, 0.12 + Math.random() * 0.22);
        } else if (T === 1 && autoT > 3.2) {
          autoT = 0;
          setTarget(0, 0.55 + Math.random() * 0.3);
        }
      }
      draw();
      let energy = 0;
      for (let i = 0; i < N; i++) energy += Math.abs(h[i]) + Math.abs(v[i]) * 20;
      const moving = Math.abs(T - L) > 0.002 || Math.abs(Lv) > 0.004 || energy > 0.01 || L > 0.02;
      if ((moving || live.current.autoplay) && visible && !reduce) raf = requestAnimationFrame(frame);
    };
    function wake() {
      if (raf || !visible || reduce) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    wakeRef.current = () => {
      draw();
      wake();
    };

    const nxOf = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };
    const onEnter = (e: PointerEvent) => {
      inside = true;
      lastX = e.clientX;
      setTarget(1, nxOf(e));
    };
    const onMove = (e: PointerEvent) => {
      if (!inside) onEnter(e);
      const dx = Math.abs(e.clientX - lastX);
      lastX = e.clientX;
      if (dx > 0 && T === 1) {
        splash(nxOf(e), Math.min(dx / 40, 1) * 0.16 * live.current.waveHeight);
        wake();
      }
    };
    const onLeave = (e: PointerEvent) => {
      inside = false;
      autoT = 0;
      setTarget(0, nxOf(e));
    };
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointercancel", onLeave);

    const io = new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
      if (visible) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    io.observe(el);
    let rz = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(rz);
      rz = window.setTimeout(() => {
        if (Math.abs(el.clientWidth - W) > 1) layout();
      }, 60);
    });
    ro.observe(el);

    if (reduce) L = 0.55; // estado quieto: medio lleno, sin movimiento
    layout();
    document.fonts?.ready.then(() => {
      layout();
    });
    if (live.current.autoplay) wake();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(rz);
      io.disconnect();
      ro.disconnect();
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointercancel", onLeave);
      wakeRef.current = () => {};
      canvas.remove();
    };
  }, [text, fontSize, fontWeight]);

  useEffect(() => {
    wakeRef.current();
  }, [color, strokeColor, strokeWidth, waveHeight, autoplay]);

  return (
    <div ref={host} className={`furin-outline-fill ${className}`} style={style}>
      <span className="furin-outline-fill__sr">{text}</span>
    </div>
  );
}

export default OutlineFill;
