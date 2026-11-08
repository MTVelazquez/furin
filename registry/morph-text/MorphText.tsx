"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./MorphText.css";

export interface MorphTextProps {
  /** Palabras que se van transformando en ciclo. */
  words?: string[];
  /** Segundos que se queda quieta cada palabra. */
  interval?: number;
  /** Segundos que dura el derretido entre palabras. */
  morph?: number;
  /** Tamaño máximo de la letra, en px (se ajusta al ancho). */
  fontSize?: number;
  /** Grosor de la letra. */
  fontWeight?: number;
  /** Color del líquido. */
  color?: string;
  /** Intensidad del brillo especular (0 lo apaga). */
  gloss?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const DEFAULT_WORDS = ["Flow", "Morph", "Shine", "Drip"];

/** Texto que muta: dos palabras se desenfocan y se funden pasando por un umbral, como gotas de mercurio que se unen. */
export function MorphText({
  words = DEFAULT_WORDS,
  interval = 1.8,
  morph = 1.5,
  fontSize = 104,
  fontWeight = 800,
  color = "#A9C8FF",
  gloss = 1,
  className = "",
  style,
}: MorphTextProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const filterId = `furin-morph-${uid}`;
  const host = useRef<HTMLDivElement>(null);
  const refA = useRef<HTMLSpanElement>(null);
  const refB = useRef<HTMLSpanElement>(null);
  const [fs, setFs] = useState(fontSize);
  const [shown, setShown] = useState(words[0] ?? "");
  const list = words.length ? words : DEFAULT_WORDS;
  const key = list.join("\u0001");

  // Ajusta el tamaño para que la palabra más larga quepa.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = `${fontWeight} 100px ${getComputedStyle(el).fontFamily}`;
      const w100 = Math.max(...list.map((w) => ctx.measureText(w).width), 1);
      setFs(Math.max(24, Math.min(fontSize, (el.clientWidth * 0.9) / (w100 / 100))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [key, fontSize, fontWeight]);

  useEffect(() => {
    const a = refA.current;
    const b = refB.current;
    const el = host.current;
    if (!a || !b || !el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let idx = 0;
    a.textContent = list[0];
    b.textContent = list[1 % list.length];
    a.style.filter = "";
    a.style.opacity = "1";
    b.style.filter = "";
    b.style.opacity = "0";
    setShown(list[0]);
    if (reduce || list.length < 2) return;

    let visible = true;
    let raf = 0;
    let timer = 0;
    let t0 = 0;
    const cap = 42; // desenfoque máximo (en unidades de 100 px de letra)
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    const setFrame = (f: number) => {
      // Cada palabra se desenfoca hacia el umbral mientras la otra se enfoca.
      const fa = 1 - f;
      const ba = Math.min(8 / Math.max(fa, 0.001) - 8, cap);
      const bb = Math.min(8 / Math.max(f, 0.001) - 8, cap);
      a.style.filter = `blur(${(ba * fs) / 100}px)`;
      a.style.opacity = String(Math.pow(fa, 0.4));
      b.style.filter = `blur(${(bb * fs) / 100}px)`;
      b.style.opacity = String(Math.pow(f, 0.4));
    };
    const finish = () => {
      idx = (idx + 1) % list.length;
      a.textContent = list[idx];
      b.textContent = list[(idx + 1) % list.length];
      a.style.filter = "";
      a.style.opacity = "1";
      b.style.filter = "";
      b.style.opacity = "0";
      setShown(list[idx]);
    };
    const run = (now: number) => {
      raf = 0;
      if (!visible) return;
      if (!t0) t0 = now;
      const f = Math.min((now - t0) / (morph * 1000), 1);
      if (f >= 1) {
        finish();
        t0 = 0;
        timer = window.setTimeout(start, interval * 1000);
        return;
      }
      setFrame(ease(f));
      raf = requestAnimationFrame(run);
    };
    const start = () => {
      if (!visible) return;
      t0 = 0;
      raf = requestAnimationFrame(run);
    };
    timer = window.setTimeout(start, interval * 1000);

    // Pausa fuera de pantalla: el ciclo se reanuda con una pausa nueva.
    const io = new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
      if (!visible) {
        cancelAnimationFrame(raf);
        window.clearTimeout(timer);
        raf = 0;
        if (t0) {
          // Si se pausó a la mitad, cierra el derretido sin saltos.
          finish();
          t0 = 0;
        }
      } else if (!raf) {
        window.clearTimeout(timer);
        timer = window.setTimeout(start, interval * 1000);
      }
    });
    io.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      io.disconnect();
    };
  }, [key, interval, morph, fs]);

  const g = Math.max(0, gloss);
  const vars = { "--furin-mt-size": `${fs}px`, "--furin-mt-weight": fontWeight, "--furin-mt-color": color } as CSSProperties;
  return (
    <div ref={host} className={`furin-morph-text ${className}`} style={{ ...vars, ...style }}>
      <span className="furin-morph-text__sr" aria-live="polite">{shown}</span>
      <div className="furin-morph-text__goo" aria-hidden="true" style={{ filter: `url(#${filterId})` }}>
        <span ref={refA} className="furin-morph-text__palabra furin-morph-text__palabra--a" />
        <span ref={refB} className="furin-morph-text__palabra furin-morph-text__palabra--b" />
      </div>
      <svg className="furin-morph-text__svg" aria-hidden="true" focusable="false">
        <defs>
          <filter id={filterId} x="-15%" y="-40%" width="130%" height="180%" colorInterpolationFilters="sRGB">
            {/* Umbral: lo desenfocado por debajo de la mitad desaparece y lo demás se solidifica. */}
            <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 56 -24" result="umbral" />
            <feGaussianBlur in="umbral" stdDeviation="0.6" result="forma" />
            <feGaussianBlur in="forma" stdDeviation="3.4" result="relieve" />
            <feDiffuseLighting in="relieve" surfaceScale="7" diffuseConstant="1.18" lightingColor="#ffffff" result="difusa">
              <feDistantLight azimuth="235" elevation="52" />
            </feDiffuseLighting>
            <feComposite in="forma" in2="difusa" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="sombreada" />
            <feSpecularLighting in="relieve" surfaceScale="8" specularConstant={1.15 * g} specularExponent="30" lightingColor="#ffffff" result="brillo">
              <feDistantLight azimuth="235" elevation="46" />
            </feSpecularLighting>
            <feComposite in="brillo" in2="forma" operator="in" result="brilloDentro" />
            <feComposite in="sombreada" in2="brilloDentro" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" />
          </filter>
        </defs>
      </svg>
    </div>
  );
}

export default MorphText;
