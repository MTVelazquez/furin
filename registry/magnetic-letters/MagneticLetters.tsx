"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, RefObject } from "react";
import "./MagneticLetters.css";

export interface MagneticLettersProps {
  /** El texto (acepta saltos de línea). */
  children?: string;
  /** Tamaño de la letra, en px. */
  size?: number;
  /** Radio de atracción del cursor, en px. */
  radius?: number;
  /** Cuánto se acerca cada letra al cursor, en proporción al tamaño (0.1 a 1). */
  strength?: number;
  /** Rigidez del resorte: más alto, más nervioso. */
  stiffness?: number;
  /** Cuando no hay cursor cerca, un imán invisible pasea por el texto. */
  idle?: boolean;
  /** Color del texto. */
  color?: string;
  /** Color al que se tiñen las letras atraídas. */
  accent?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

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

/** Si el texto no cabe en su contenedor, encoge la letra lo justo (se recalcula al cambiar el tamaño del contenedor). */
function useAjuste(ref: RefObject<HTMLElement | null>, variable: string, dep: unknown) {
  useEffect(() => {
    const el = ref.current, padre = el?.parentElement;
    if (!el || !padre) return;
    let raf = 0;
    const ajustar = () => {
      el.style.setProperty(variable, "1");
      const natural = el.scrollWidth;
      const libre = padre.clientWidth - 28;
      el.style.setProperty(variable, (natural > libre && libre > 40 ? Math.max(0.35, libre / natural) : 1).toFixed(3));
    };
    const pedir = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(ajustar); };
    const ro = new ResizeObserver(pedir);
    ro.observe(padre);
    document.fonts?.ready.then(pedir);
    pedir();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [dep]);
}

/** Cada letra es atraída por el cursor con un resorte con rebote, y se tiñe y crece al acercarse. */
export function MagneticLetters({
  children = "Magnetic",
  size = 96,
  radius = 170,
  strength = 0.3,
  stiffness = 210,
  idle = true,
  color = "#E9EBEF",
  accent = "#7CF5C6",
  className = "",
  style,
}: MagneticLettersProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const texto = String(children ?? "");
  useAjuste(rootRef, "--furin-ml-fit", texto + size);
  const lineas = texto.split("\n");
  const cfg = useRef({ size, radius, strength, stiffness, idle, color, accent });
  cfg.current = { size, radius, strength, stiffness, idle, color, accent };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const letras = Array.from(root.querySelectorAll<HTMLElement>("[data-l]"));
    const n = letras.length;
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Centro de cada letra en reposo, en coordenadas locales del contenedor (sin transformaciones).
    const cx = new Float32Array(n), cy = new Float32Array(n);
    const x = new Float32Array(n), y = new Float32Array(n), vx = new Float32Array(n), vy = new Float32Array(n);
    const esc = new Float32Array(n), rot = new Float32Array(n), vesc = new Float32Array(n), vrot = new Float32Array(n);
    const mezcla = new Float32Array(n);
    const ptr = { x: 0, y: 0, activo: false };
    let visible = true, raf = 0, muerto = false, ultimo = 0, t0 = performance.now();
    let c0: [number, number, number] = [233, 235, 239], c1: [number, number, number] = [124, 245, 198];

    const medir = () => {
      for (let i = 0; i < n; i++) {
        const l = letras[i];
        cx[i] = l.offsetLeft + l.offsetWidth / 2;
        cy[i] = l.offsetTop + l.offsetHeight / 2;
      }
      c0 = rgbDe(cfg.current.color, c0); c1 = rgbDe(cfg.current.accent, c1);
    };

    const pintar = () => {
      for (let i = 0; i < n; i++) {
        const m = mezcla[i];
        const l = letras[i];
        l.style.transform = `translate3d(${x[i].toFixed(2)}px, ${y[i].toFixed(2)}px, 0) rotate(${rot[i].toFixed(2)}deg) scale(${esc[i].toFixed(3)})`;
        l.style.color = `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * m)}, ${Math.round(c0[1] + (c1[1] - c0[1]) * m)}, ${Math.round(c0[2] + (c1[2] - c0[2]) * m)})`;
      }
    };

    const paso = (now: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.033, (now - (ultimo || now)) / 1000 || 0.016);
      ultimo = now;
      const { size: S, radius: R, strength: F, stiffness: K, idle: ocioso } = cfg.current;
      const rr = root.getBoundingClientRect();
      let px = NaN, py = NaN, fantasma = false;
      if (ptr.activo) { px = ptr.x - rr.left; py = ptr.y - rr.top; }
      else if (ocioso) {
        // Un imán invisible que pasea de lado a lado, con un vaivén vertical lento.
        const t = (now - t0) / 1000;
        px = rr.width * (0.5 + 0.56 * Math.sin(t * 0.7));
        py = rr.height * (0.5 + 0.35 * Math.sin(t * 1.13 + 1));
        fantasma = true;
      }
      const C = 2 * Math.sqrt(K) * 0.52; // amortiguamiento: ζ ≈ 0.52, con rebote visible pero sin montarse
      let mueve = false;
      const sub = 2, h = dt / sub;
      for (let i = 0; i < n; i++) {
        let tx = 0, ty = 0, te = 1, tr = 0, tm = 0;
        if (px === px) {
          const dx = px - cx[i], dy = py - cy[i];
          const d = Math.hypot(dx, dy);
          if (d < R) {
            let f = 1 - d / R; f = f * f * (3 - 2 * f);
            // Atracción máxima a media distancia; justo bajo el cursor la letra casi no se mueve, así no se encimen.
            const pull = Math.min(d * 0.7, S * F * f * (d / (d + R * 0.28)) * 1.2);
            // En horizontal la atracción es más suave: las letras se acercan al cursor sin montarse unas sobre otras.
            tx = (dx / (d || 1)) * pull * 0.3; ty = (dy / (d || 1)) * pull;
            te = 1 + 0.12 * f; tr = (dx / R) * 9 * f; tm = f;
          }
        }
        for (let s = 0; s < sub; s++) {
          vx[i] += ((tx - x[i]) * K - vx[i] * C) * h; x[i] += vx[i] * h;
          vy[i] += ((ty - y[i]) * K - vy[i] * C) * h; y[i] += vy[i] * h;
          vesc[i] += ((te - esc[i]) * K - vesc[i] * C) * h; esc[i] += vesc[i] * h;
          vrot[i] += ((tr - rot[i]) * K - vrot[i] * C) * h; rot[i] += vrot[i] * h;
        }
        mezcla[i] += (tm - mezcla[i]) * (1 - Math.exp(-dt * 12));
        if (Math.abs(tx - x[i]) + Math.abs(ty - y[i]) + Math.abs(vx[i]) * 0.05 + Math.abs(vy[i]) * 0.05 + Math.abs(te - esc[i]) * 10 + Math.abs(tm - mezcla[i]) > 0.02) mueve = true;
      }
      pintar();
      if (mueve || fantasma || ptr.activo) raf = requestAnimationFrame(paso);
      else { ultimo = 0; for (let i = 0; i < n; i++) { x[i] = y[i] = vx[i] = vy[i] = rot[i] = vrot[i] = vesc[i] = 0; esc[i] = 1; mezcla[i] = 0; } pintar(); }
    };
    const wake = () => { if (!raf && visible && !muerto && !reducido) { ultimo = 0; raf = requestAnimationFrame(paso); } };

    for (let i = 0; i < n; i++) esc[i] = 1;
    medir();
    pintar();

    const onMove = (e: PointerEvent) => {
      const rr = root.getBoundingClientRect();
      const m = cfg.current.radius * 1.1;
      ptr.x = e.clientX; ptr.y = e.clientY;
      ptr.activo = e.clientX > rr.left - m && e.clientX < rr.right + m && e.clientY > rr.top - m && e.clientY < rr.bottom + m;
      wake();
    };
    const onFuera = () => { ptr.activo = false; wake(); };
    const onUp = (e: PointerEvent) => { if (e.pointerType !== "mouse") onFuera(); };
    if (!reducido) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onMove, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      document.documentElement.addEventListener("pointerleave", onFuera);
    }
    const ro = new ResizeObserver(() => { medir(); wake(); });
    ro.observe(root);
    document.fonts?.ready.then(() => { medir(); wake(); });
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "60px" });
    io.observe(root);
    wake();
    return () => {
      muerto = true; cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onFuera);
    };
  }, [texto]);

  const vars = { "--furin-ml-size": `${size}px`, "--furin-ml-color": color } as CSSProperties;
  return (
    <span ref={rootRef} className={`furin-magnetic-letters ${className}`} style={{ ...vars, ...style }}>
      <span className="furin-magnetic-letters__sr">{texto}</span>
      <span className="furin-magnetic-letters__vis" aria-hidden="true">
        {lineas.map((ln, li) => (
          <span key={li} className="furin-magnetic-letters__linea">
            {ln.split(" ").map((palabra, pi, arr) => (
              <span key={pi} className="furin-magnetic-letters__palabra">
                {Array.from(palabra).map((ch, ci) => <span key={ci} data-l="" className="furin-magnetic-letters__letra">{ch}</span>)}
                {pi < arr.length - 1 ? " " : null}
              </span>
            ))}
          </span>
        ))}
      </span>
    </span>
  );
}

export default MagneticLetters;
