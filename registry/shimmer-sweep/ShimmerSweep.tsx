"use client";
import { useEffect, useId, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./ShimmerSweep.css";

export interface ShimmerSweepProps {
  /** Texto que recorre el brillo. */
  children?: ReactNode;
  /** Metal de las letras. */
  tone?: "aluminum" | "titanium" | "gold";
  /** Tamaño de la letra, en px. */
  size?: number;
  /** Segundos que tarda el brillo en cruzar el texto. */
  speed?: number;
  /** Segundos de descanso entre barridos. */
  pause?: number;
  /** Inclinación de la franja de luz, en grados. */
  angle?: number;
  /** Fuerza del brillo. */
  intensity?: number;
  /** Relieve del bisel de las letras. */
  depth?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

/** Texto de metal satinado: letras de aluminio con bisel y una franja de luz que las cruza de vez en cuando; al pasar el cursor se repite el barrido. */
export function ShimmerSweep({
  children = "Satin aluminum",
  tone = "aluminum",
  size = 56,
  speed = 1.6,
  pause = 2.2,
  angle = 100,
  intensity = 1,
  depth = 1,
  className = "",
  style,
}: ShimmerSweepProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const frente = useRef<HTMLSpanElement>(null);
  const anim = useRef<Animation | null>(null);

  // El barrido desplaza el degradado de luz con la API de animaciones web: dura speed y descansa pause.
  useEffect(() => {
    const el = frente.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // queda la franja quieta en su sitio
    const total = Math.max(0.2, speed + Math.max(0, pause));
    const corte = Math.max(0.05, speed / total);
    const a = el.animate(
      [
        { backgroundPosition: "100% 0, 0 0, 0 0", easing: "cubic-bezier(0.45, 0.05, 0.2, 1)", offset: 0 },
        { backgroundPosition: "0% 0, 0 0, 0 0", offset: corte },
        { backgroundPosition: "0% 0, 0 0, 0 0", offset: 1 },
      ],
      { duration: total * 1000, iterations: Infinity },
    );
    anim.current = a;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? a.play() : a.pause()));
    io.observe(el);
    return () => { io.disconnect(); a.cancel(); anim.current = null; };
  }, [speed, pause]);

  // Al entrar con el cursor el brillo vuelve a salir desde la izquierda.
  const repetir = () => {
    const a = anim.current;
    if (!a) return;
    const total = (a.effect?.getTiming().duration as number) || 1;
    const t = Number(a.currentTime ?? 0) % total;
    if (t > total * (speed / (speed + Math.max(0, pause))) - 1) { a.currentTime = 0; a.play(); }
  };

  const sigma = (1.3 * depth).toFixed(2);
  const escala = (2.8 * depth).toFixed(2);
  const vars = { "--fss-size": `${size}px`, "--fss-angle": `${angle}deg`, "--fss-i": intensity } as CSSProperties;
  return (
    <span className={`furin-shimmer-sweep furin-shimmer-sweep--${tone} ${className}`} style={{ ...vars, ...style }} onPointerEnter={repetir}>
      <svg className="furin-shimmer-sweep__defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <filter id={`${uid}r`} x="-3%" y="-8%" width="106%" height="116%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation={sigma} result="bump" />
            <feDiffuseLighting in="bump" surfaceScale={escala} diffuseConstant="0.62" lightingColor="#ffffff" result="diff">
              <feDistantLight azimuth="235" elevation="54" />
            </feDiffuseLighting>
            <feComposite in="diff" in2="SourceAlpha" operator="in" result="diffIn" />
            <feBlend in="diffIn" in2="SourceGraphic" mode="hard-light" />
          </filter>
        </defs>
      </svg>
      <span className="furin-shimmer-sweep__line">
        <span className="furin-shimmer-sweep__back" aria-hidden="true">{children}</span>
        <span ref={frente} className="furin-shimmer-sweep__front" style={{ filter: `url(#${uid}r)` }}>{children}</span>
      </span>
    </span>
  );
}

export default ShimmerSweep;
