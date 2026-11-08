"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./GlassBlobs.css";

export interface GlassBlobsProps {
  /** Contenido que va sobre el panel esmerilado. */
  children?: ReactNode;
  /** Colores de las manchas, separados por comas o como lista. */
  colors?: string | string[];
  /** Cuántas manchas flotan detrás. */
  count?: number;
  /** Velocidad del movimiento: 1 es normal, 0 las detiene. */
  speed?: number;
  /** Desenfoque del vidrio esmerilado, en px. */
  blur?: number;
  /** Cuánto grano tiene el vidrio, de 0 a 1. */
  grain?: number;
  /** Muestra el panel de vidrio centrado (si no, el desenfoque cubre todo). */
  panel?: boolean;
  /** Radio de las esquinas del panel, en px. */
  radius?: number;
  /** Color de fondo detrás de las manchas. */
  background?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const COLORES = "#ff4f9a,#5b7bff,#2fe0b8,#ffb04a,#9b5cff,#ff6a4d";

/** Valor pseudoaleatorio estable por índice (igual en servidor y cliente, sin hidratación rota). */
function sem(i: number, k: number): number {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Fondo de manchas de color que flotan y se deforman detrás de un panel de vidrio esmerilado. */
export function GlassBlobs({
  children,
  colors = COLORES,
  count = 6,
  speed = 1,
  blur = 26,
  grain = 0.5,
  panel = true,
  radius = 32,
  background = "#0b0d24",
  className = "",
  style,
}: GlassBlobsProps) {
  const root = useRef<HTMLDivElement>(null);
  const lista = (Array.isArray(colors) ? colors : colors.split(",")).map((c) => c.trim()).filter(Boolean);

  // Pausa las animaciones CSS cuando el fondo no está a la vista.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => el.toggleAttribute("data-pausa", !e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const vars = {
    "--furin-glass-blobs-bg": background,
    "--furin-glass-blobs-blur": `${blur}px`,
    "--furin-glass-blobs-grain": grain,
    "--furin-glass-blobs-radius": `${radius}px`,
    "--furin-glass-blobs-v": speed > 0 ? 1 / speed : 0,
  } as CSSProperties;
  const quieto = speed <= 0;
  return (
    <div ref={root} className={`furin-glass-blobs${quieto ? " is-quieto" : ""}${panel ? "" : " is-total"} ${className}`} style={{ ...vars, ...style }}>
      <div className="furin-glass-blobs__fondo" aria-hidden="true">
        {Array.from({ length: Math.max(1, count) }, (_, i) => {
          const c = lista[i % lista.length] ?? "#fff";
          const size = 120 + sem(i, 1) * 110;
          const b = {
            "--c": c,
            left: `${(sem(i, 2) * 84 - 4).toFixed(1)}%`,
            top: `${(sem(i, 3) * 84 - 4).toFixed(1)}%`,
            width: size,
            height: size,
            "--dx": `${((sem(i, 4) - 0.5) * 150).toFixed(0)}px`,
            "--dy": `${((sem(i, 5) - 0.5) * 120).toFixed(0)}px`,
            "--t": `${(11 + sem(i, 6) * 9).toFixed(1)}s`,
            "--m": `${(8 + sem(i, 7) * 7).toFixed(1)}s`,
            "--d": `${(-sem(i, 8) * 12).toFixed(1)}s`,
          } as CSSProperties;
          return <i key={i} className="furin-glass-blobs__mancha" style={b} />;
        })}
      </div>
      {panel ? (
        <div className="furin-glass-blobs__panel">
          <span className="furin-glass-blobs__grano" aria-hidden="true" />
          <span className="furin-glass-blobs__rim" aria-hidden="true" />
          <div className="furin-glass-blobs__contenido">{children}</div>
        </div>
      ) : (
        <>
          <div className="furin-glass-blobs__velo" aria-hidden="true" />
          <div className="furin-glass-blobs__contenido furin-glass-blobs__contenido--libre">{children}</div>
        </>
      )}
    </div>
  );
}

export default GlassBlobs;
