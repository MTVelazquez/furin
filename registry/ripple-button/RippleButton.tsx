"use client";
import { useRef } from "react";
import type { ButtonHTMLAttributes, CSSProperties, PointerEvent, ReactNode } from "react";
import "./RippleButton.css";

export interface RippleButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style" | "className" | "color"> {
  /** Texto del botón. */
  children?: ReactNode;
  /** Color del botón. */
  color?: string;
  /** Color de la onda. */
  rippleColor?: string;
  /** Color del texto. */
  textColor?: string;
  /** Milisegundos que dura la onda. */
  duration?: number;
  /** Cuántos anillos tiene la onda (1 a 3). */
  rings?: number;
  /** Radio de las esquinas, en px. */
  radius?: number;
  /** Alto del botón, en px. */
  height?: number;
  /** Clase extra para el botón. */
  className?: string;
  /** Estilos extra para el botón. */
  style?: CSSProperties;
}

/** Botón con una onda que nace exactamente donde haces clic: un frente luminoso con anillos que se ensanchan hasta cubrir la esquina más lejana. */
export function RippleButton({
  children = "Continue",
  color = "#3b4cf0",
  rippleColor = "#ffffff",
  textColor = "#ffffff",
  duration = 900,
  rings = 2,
  radius = 16,
  height = 56,
  className = "",
  style,
  onPointerDown,
  onPointerMove,
  onPointerLeave,
  ...rest
}: RippleButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLSpanElement>(null);

  const spawn = (e: PointerEvent<HTMLButtonElement>) => {
    const b = ref.current, host = layer.current;
    if (!b || !host) return;
    const r = b.getBoundingClientRect();
    // Con teclado no hay punto de clic: la onda nace en el centro.
    const keyboard = e.clientX === 0 && e.clientY === 0;
    const x = keyboard ? r.width / 2 : e.clientX - r.left;
    const y = keyboard ? r.height / 2 : e.clientY - r.top;
    // El radio llega a la esquina más lejana, así la onda siempre cubre todo el botón.
    const far = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const n = Math.max(1, Math.min(3, Math.round(rings)));
    for (let i = 0; i < n; i++) {
      const el = document.createElement("span");
      el.className = "furin-ripple-button__wave";
      const d = far * 2;
      el.style.cssText = `left:${x - far}px;top:${y - far}px;width:${d}px;height:${d}px`;
      host.appendChild(el);
      const delay = i * duration * 0.14;
      const life = duration * (1 - i * 0.08);
      const peak = [0.55, 0.32, 0.18][i];
      const anim = reduce
        ? el.animate([{ opacity: 0.25, transform: "scale(1)" }, { opacity: 0, transform: "scale(1)" }], { duration: 300, fill: "both" })
        : el.animate(
            [
              { transform: "scale(0.02)", opacity: peak, offset: 0 },
              { opacity: peak * 0.8, offset: 0.35 },
              { transform: "scale(1)", opacity: 0, offset: 1 },
            ],
            { duration: life, delay, easing: "cubic-bezier(0.16, 0.7, 0.25, 1)", fill: "both" },
          );
      anim.onfinish = () => el.remove();
    }
    // Un destello breve bajo el dedo, para que el clic se sienta "mojado" de luz.
    const flash = document.createElement("span");
    flash.className = "furin-ripple-button__flash";
    flash.style.cssText = `left:${x - 60}px;top:${y - 60}px`;
    host.appendChild(flash);
    const fa = flash.animate([{ opacity: 0.7, transform: "scale(0.4)" }, { opacity: 0, transform: "scale(1.5)" }], { duration: 420, easing: "ease-out", fill: "both" });
    fa.onfinish = () => flash.remove();
  };

  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const b = ref.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    b.style.setProperty("--furin-ripple-button-mx", `${e.clientX - r.left}px`);
    b.style.setProperty("--furin-ripple-button-my", `${e.clientY - r.top}px`);
  };

  const vars = {
    "--furin-ripple-button-color": color,
    "--furin-ripple-button-ripple": rippleColor,
    "--furin-ripple-button-text": textColor,
    "--furin-ripple-button-r": `${radius}px`,
    "--furin-ripple-button-h": `${height}px`,
  } as CSSProperties;

  return (
    <button
      ref={ref}
      type="button"
      className={`furin-ripple-button ${className}`}
      style={{ ...vars, ...style }}
      onPointerDown={(e) => { spawn(e); onPointerDown?.(e); }}
      onPointerMove={(e) => { move(e); onPointerMove?.(e); }}
      onPointerLeave={onPointerLeave}
      {...rest}
    >
      <span ref={layer} className="furin-ripple-button__layer" aria-hidden="true" />
      <span className="furin-ripple-button__label">{children}</span>
    </button>
  );
}

export default RippleButton;
