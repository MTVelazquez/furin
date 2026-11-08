"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import "./MaskReveal.css";

export interface MaskRevealProps {
  /** El texto: cada línea (separada por salto de línea) sube por su propia máscara. */
  children?: string;
  /** Tamaño de la letra, en px. */
  size?: number;
  /** Milisegundos de retraso entre una línea y la siguiente. */
  stagger?: number;
  /** Milisegundos que dura la subida de cada línea. */
  duration?: number;
  /** Desde qué línea (0 es la primera) el texto se atenúa; −1 deja todas iguales. */
  dimFrom?: number;
  /** Alineación del texto. */
  align?: "left" | "center";
  /** Muestra un botón para repetir la animación. */
  replayButton?: boolean;
  /** Texto del botón de repetir (también su etiqueta accesible). */
  replayLabel?: string;
  /** Repite la animación cada vez que el texto vuelve a entrar en vista. */
  repeat?: boolean;
  /** Color del texto. */
  color?: string;
  /** Color de las líneas atenuadas. */
  dimColor?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

/** Líneas que suben desde detrás de una máscara, escalonadas, como en la presentación de un producto. */
export function MaskReveal({
  children = "Made with care.\nBuilt to last.\nReady for you.",
  size = 44,
  stagger = 120,
  duration = 1050,
  dimFrom = 2,
  align = "left",
  replayButton = true,
  replayLabel = "Replay",
  repeat = true,
  color = "#F4F5F7",
  dimColor = "#6F7480",
  className = "",
  style,
}: MaskRevealProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const texto = String(children ?? "");
  const lineas = texto.split("\n");
  const cfg = useRef({ repeat });
  cfg.current = { repeat };
  const repetir = useRef<() => void>(() => {});

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducido) { root.dataset.estado = "visible"; return; }
    let raf = 0, muerto = false, visto = false;
    const reproducir = () => {
      cancelAnimationFrame(raf);
      root.dataset.estado = "oculto";
      void root.offsetWidth; // fuerza el reflujo para que la transición arranque de cero
      raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => { if (!muerto) root.dataset.estado = "visible"; }); });
    };
    repetir.current = reproducir;
    root.dataset.estado = "oculto";
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { if (!visto || cfg.current.repeat) { visto = true; reproducir(); } }
      else if (cfg.current.repeat) { cancelAnimationFrame(raf); root.dataset.estado = "oculto"; }
    }, { threshold: 0.4 });
    io.observe(root);
    return () => { muerto = true; cancelAnimationFrame(raf); io.disconnect(); repetir.current = () => {}; };
  }, [texto]);

  const vars = {
    "--furin-mr-size": `${size}px`,
    "--furin-mr-stagger": `${stagger}ms`,
    "--furin-mr-dur": `${duration}ms`,
    "--furin-mr-color": color,
    "--furin-mr-dim": dimColor,
  } as CSSProperties;

  return (
    <div ref={rootRef} className={`furin-mask-reveal ${className}`} data-align={align} data-estado="visible" style={{ ...vars, ...style }}>
      <span className="furin-mask-reveal__sr">{lineas.join(" ")}</span>
      <p className="furin-mask-reveal__texto" aria-hidden="true">
        {lineas.map((ln, i) => (
          <span key={i} className="furin-mask-reveal__linea" data-tenue={dimFrom >= 0 && i >= dimFrom ? "1" : "0"} style={{ "--i": i } as CSSProperties}>
            <span className="furin-mask-reveal__dentro">{ln}</span>
          </span>
        ))}
      </p>
      {replayButton ? (
        <button type="button" className="furin-mask-reveal__boton" onClick={() => repetir.current()} aria-label={replayLabel}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75M13.2 2.4v2.9h-2.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{replayLabel}</span>
        </button>
      ) : null}
    </div>
  );
}

export default MaskReveal;
