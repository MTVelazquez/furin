"use client";
import { useRef } from "react";
import type { ButtonHTMLAttributes, CSSProperties, PointerEvent, ReactNode } from "react";
import "./MetalButton.css";

export interface MetalButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style" | "children"> {
  /** Texto del botón. */
  children?: ReactNode;
  /** Aleación del botón. */
  tone?: "silver" | "titanium" | "graphite" | "gold";
  /** Tamaño del botón. */
  size?: "sm" | "md" | "lg";
  /** Fuerza del reflejo especular que sigue al cursor. */
  intensity?: number;
  /** Clase extra para el botón. */
  className?: string;
  /** Estilos extra para el botón. */
  style?: CSSProperties;
}

/** Botón de metal pulido: bisel con luz y sombra, micro-cepillado y un reflejo que sigue al cursor; se hunde al presionar. */
export function MetalButton({
  children,
  tone = "silver",
  size = "md",
  intensity = 1,
  className = "",
  style,
  type = "button",
  onPointerMove,
  onPointerDown,
  onPointerLeave,
  ...rest
}: MetalButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  // La posición del cursor (0 a 1) vive en variables CSS registradas con @property:
  // el navegador las suaviza solo, sin bucle de animación ni re-render.
  const seguir = (e: PointerEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--fmb-x", String(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)).toFixed(3)));
    el.style.setProperty("--fmb-y", String(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)).toFixed(3)));
  };

  const vars = { "--fmb-spec": intensity } as CSSProperties;
  return (
    <button
      ref={ref}
      type={type}
      className={`furin-metal-button furin-metal-button--${tone} furin-metal-button--${size} ${className}`}
      style={{ ...vars, ...style }}
      onPointerMove={(e) => { seguir(e); onPointerMove?.(e); }}
      onPointerDown={(e) => { seguir(e); onPointerDown?.(e); }}
      onPointerLeave={(e) => {
        ref.current?.style.removeProperty("--fmb-x");
        ref.current?.style.removeProperty("--fmb-y");
        onPointerLeave?.(e);
      }}
      {...rest}
    >
      <span className="furin-metal-button__rim" aria-hidden="true" />
      <span className="furin-metal-button__face" aria-hidden="true">
        <span className="furin-metal-button__grain" />
        <span className="furin-metal-button__spec" />
        <span className="furin-metal-button__sheen" />
      </span>
      <span className="furin-metal-button__label">{children}</span>
    </button>
  );
}

export default MetalButton;
