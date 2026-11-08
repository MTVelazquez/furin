"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, RefObject } from "react";
import "./WeightWave.css";

export interface WeightWaveProps {
  /** El texto (acepta saltos de línea). */
  children?: string;
  /** Tamaño de la letra, en px. */
  size?: number;
  /** Familia de Google Fonts con eje de peso (wght). Si no carga, se usa una de respaldo. */
  family?: string;
  /** Peso de las letras lejos del cursor (100 a 1000). */
  minWeight?: number;
  /** Peso de las letras justo bajo el cursor (100 a 1000). */
  maxWeight?: number;
  /** Radio de influencia del cursor, en px. */
  radius?: number;
  /** Cuando no hay cursor cerca, una ola recorre el texto sola. */
  idle?: boolean;
  /** Color del texto. */
  color?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

/** Carga la fuente de Google Fonts una sola vez por familia y rango de peso. */
function cargarFuente(family: string, min: number, max: number) {
  if (typeof document === "undefined" || !family) return;
  const id = `furin-ww-${family.replace(/\W+/g, "-")}-${min}-${max}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${min}..${max}&display=swap`;
  document.head.appendChild(link);
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

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

/** Texto de fuente variable cuyo grosor ondula según qué tan cerca pasa el cursor de cada letra. */
export function WeightWave({
  children = "Weight",
  size = 112,
  family = "Roboto Flex",
  minWeight = 100,
  maxWeight = 1000,
  radius = 190,
  idle = true,
  color = "#F4F5F7",
  className = "",
  style,
}: WeightWaveProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const capaRef = useRef<HTMLSpanElement>(null);
  const texto = String(children ?? "");
  useAjuste(rootRef, "--furin-ww-fit", texto + size);
  const lineas = texto.split("\n");
  const cfg = useRef({ minWeight, maxWeight, radius, idle });
  cfg.current = { minWeight, maxWeight, radius, idle };
  const vivo = useRef<{ wake: () => void } | null>(null);

  useEffect(() => { cargarFuente(family, Math.min(minWeight, maxWeight), Math.max(minWeight, maxWeight)); }, [family, minWeight, maxWeight]);

  useEffect(() => {
    const root = rootRef.current, capa = capaRef.current;
    if (!root || !capa) return;
    const letras = Array.from(capa.querySelectorAll<HTMLElement>("[data-l]"));
    const n = letras.length;
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const w = new Float32Array(n).fill(cfg.current.minWeight);
    const ptr = { x: 0, y: 0, activo: false };
    let visible = true, raf = 0, muerto = false, ultimo = 0;
    const t0 = performance.now();

    const escribir = () => {
      const { minWeight: a, maxWeight: b } = cfg.current;
      for (let i = 0; i < n; i++) {
        const f = (w[i] - a) / Math.max(1, b - a);
        letras[i].style.fontWeight = w[i].toFixed(1);
        // Las letras gruesas se ven más blancas; las finas, más tenues.
        letras[i].style.opacity = (0.62 + 0.38 * clamp(f, 0, 1)).toFixed(3);
      }
    };

    const paso = (now: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.05, (now - (ultimo || now)) / 1000 || 0.016);
      ultimo = now;
      const { minWeight: a, maxWeight: b, radius: R, idle: ocioso } = cfg.current;
      const rr = root.getBoundingClientRect();
      const rects = letras.map((l) => l.getBoundingClientRect());
      let px = NaN, py = NaN, fantasma = false;
      if (ptr.activo) { px = ptr.x; py = ptr.y; }
      else if (ocioso) {
        // Una ola que va y viene por el texto, a velocidad de lectura.
        const t = (now - t0) / 1000;
        const ph = 0.5 + 0.5 * Math.sin(t * 0.85 - 1.3);
        px = rr.left - R * 0.2 + ph * (rr.width + R * 0.4);
        py = rr.top + rr.height / 2;
        fantasma = true;
      }
      let mueve = false;
      const k = 1 - Math.exp(-dt * 11);
      for (let i = 0; i < n; i++) {
        const r = rects[i];
        let f = 0;
        if (px === px) {
          const dx = px - (r.left + r.width / 2);
          const dy = fantasma ? 0 : py - (r.top + r.height / 2);
          const d = Math.hypot(dx, dy);
          if (d < R) f = 0.5 + 0.5 * Math.cos(Math.PI * (d / R));
        }
        const objetivo = a + (b - a) * f;
        w[i] += (objetivo - w[i]) * k;
        if (Math.abs(objetivo - w[i]) > 0.4) mueve = true;
      }
      escribir();
      if (mueve || fantasma || ptr.activo) raf = requestAnimationFrame(paso);
      else ultimo = 0;
    };
    const wake = () => { if (!raf && visible && !muerto && !reducido) { ultimo = 0; raf = requestAnimationFrame(paso); } };
    vivo.current = { wake };

    if (reducido) {
      // Estado quieto: una joroba de grosor al centro del texto.
      const { minWeight: a, maxWeight: b } = cfg.current;
      for (let i = 0; i < n; i++) { const d = (i + 0.5) / Math.max(1, n) - 0.4; w[i] = a + (b - a) * Math.exp(-d * d * 14); }
      escribir();
    } else {
      escribir();
    }

    const onMove = (e: PointerEvent) => {
      const rr = root.getBoundingClientRect();
      const m = cfg.current.radius * 1.2;
      const dentro = e.clientX > rr.left - m && e.clientX < rr.right + m && e.clientY > rr.top - m && e.clientY < rr.bottom + m;
      ptr.x = e.clientX; ptr.y = e.clientY; ptr.activo = dentro;
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
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "60px" });
    io.observe(root);
    wake();
    return () => {
      muerto = true; vivo.current = null;
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onFuera);
    };
  }, [texto]);

  const vars = {
    "--furin-ww-size": `${size}px`,
    "--furin-ww-family": `"${family}"`,
    "--furin-ww-min": minWeight,
    "--furin-ww-max": maxWeight,
    "--furin-ww-color": color,
  } as CSSProperties;

  return (
    <span ref={rootRef} className={`furin-weight-wave ${className}`} style={{ ...vars, ...style }}>
      <span className="furin-weight-wave__sr">{texto}</span>
      {/* El fantasma fija el ancho con el peso máximo, así la caja no baila mientras ondula. */}
      <span className="furin-weight-wave__capa furin-weight-wave__capa--fantasma" aria-hidden="true">{texto}</span>
      <span ref={capaRef} className="furin-weight-wave__capa" aria-hidden="true">
        {lineas.map((ln, li) => (
          <span key={li} className="furin-weight-wave__linea">
            {Array.from(ln).map((ch, ci) =>
              ch === " " ? <span key={ci} className="furin-weight-wave__esp"> </span> : <span key={ci} data-l="" className="furin-weight-wave__letra">{ch}</span>,
            )}
          </span>
        ))}
      </span>
    </span>
  );
}

export default WeightWave;
