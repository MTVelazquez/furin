"use client";
import { useCallback, useEffect, useRef } from "react";
import type { ButtonHTMLAttributes, CSSProperties, PointerEvent, ReactNode } from "react";
import "./GlintButton.css";

export interface GlintButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style" | "className" | "color"> {
  /** Texto del botón. */
  children?: ReactNode;
  /** Color del cuerpo del botón. */
  color?: string;
  /** Color del destello. */
  glintColor?: string;
  /** Cada cuántos segundos pasa el destello solo (0 = solo al pasar el cursor). */
  interval?: number;
  /** Segundos que tarda el destello en cruzar. */
  speed?: number;
  /** Inclinación del destello, en grados. */
  angle?: number;
  /** Muestra una flecha al final del texto. */
  arrow?: boolean;
  /** Alto del botón, en px. */
  height?: number;
  /** Clase extra para el botón. */
  className?: string;
  /** Estilos extra para el botón. */
  style?: CSSProperties;
}

/** Botón oscuro con un destello que lo cruza cada tanto (y al pasar el cursor): se enciende el relleno, el borde y el texto en el mismo instante. */
export function GlintButton({
  children = "Get started",
  color = "#16171c",
  glintColor = "#ffffff",
  interval = 3.8,
  speed = 1,
  angle = 105,
  arrow = true,
  height = 60,
  className = "",
  style,
  onPointerEnter,
  ...rest
}: GlintButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const reduced = useRef(false);
  const timer = useRef(0);
  const cfg = useRef({ interval, speed });
  cfg.current = { interval, speed };

  /** Dispara un destello (reiniciándolo si ya había uno en curso). */
  const fire = useCallback(() => {
    const el = ref.current;
    if (!el || reduced.current) return;
    el.removeAttribute("data-glint");
    void el.offsetWidth;
    el.setAttribute("data-glint", "true");
  }, []);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = ref.current;
    if (!el || reduced.current) return;
    let visible = true;
    const io = new IntersectionObserver((e) => { visible = e[0]?.isIntersecting ?? true; });
    io.observe(el);
    const loop = (first: boolean) => {
      timer.current = window.setTimeout(() => {
        if (visible && !document.hidden) fire();
        if (cfg.current.interval > 0) loop(false);
      }, first ? 700 : Math.max(0.8, cfg.current.interval) * 1000);
    };
    if (interval > 0) loop(true);
    return () => { window.clearTimeout(timer.current); io.disconnect(); };
  }, [interval, fire]);

  const vars = {
    "--furin-glint-button-color": color,
    "--furin-glint-button-glint": glintColor,
    "--furin-glint-button-dur": `${0.95 / Math.max(0.2, speed)}s`,
    "--furin-glint-button-angle": `${angle}deg`,
    "--furin-glint-button-h": `${height}px`,
  } as CSSProperties;

  return (
    <button
      ref={ref}
      type="button"
      className={`furin-glint-button ${className}`}
      style={{ ...vars, ...style }}
      onPointerEnter={(e: PointerEvent<HTMLButtonElement>) => { if (e.pointerType === "mouse") fire(); onPointerEnter?.(e); }}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("furin-glint-button__fill")) ref.current?.removeAttribute("data-glint"); }}
      {...rest}
    >
      <span className="furin-glint-button__fill" aria-hidden="true" />
      <span className="furin-glint-button__edge" aria-hidden="true" />
      <span className="furin-glint-button__label">{children}</span>
      {arrow ? (
        <svg className="furin-glint-button__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13M13 6.5 18.5 12 13 17.5" /></svg>
      ) : null}
    </button>
  );
}

export default GlintButton;
