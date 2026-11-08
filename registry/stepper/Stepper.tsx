"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./Stepper.css";

export interface StepperStep {
  /** Título del paso. */
  label: string;
  /** Texto de apoyo debajo del título. */
  description?: string;
}

export interface StepperProps {
  /** Pasos: textos o { label, description }. */
  steps?: (string | StepperStep)[];
  /** Paso actual, desde 0 (modo controlado). */
  current?: number;
  /** Paso inicial (modo libre). */
  defaultCurrent?: number;
  /** Se llama al cambiar de paso. */
  onChange?: (index: number) => void;
  /** Dirección de la lista de pasos. */
  orientation?: "horizontal" | "vertical";
  /** Deja volver a un paso ya completado pulsándolo. */
  clickable?: boolean;
  /** Muestra los botones Atrás y Siguiente. */
  controls?: boolean;
  /** Color del progreso. */
  color?: string;
  /** Etiqueta accesible de la lista. */
  label?: string;
  /** Texto del botón para retroceder. */
  backLabel?: string;
  /** Texto del botón para avanzar. */
  nextLabel?: string;
  /** Texto del botón en el último paso. */
  finishLabel?: string;
  /** Texto del botón cuando todo está completo. */
  restartLabel?: string;
  /** Segundos entre avances automáticos (0 = apagado; se detiene al interactuar). */
  autoplay?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const PASOS: StepperStep[] = [
  { label: "Account", description: "Your details" },
  { label: "Team", description: "Invite people" },
  { label: "Plan", description: "Pick one" },
  { label: "Done", description: "Get to work" },
];

/** Pasos con línea de progreso que se llena: el trazo avanza primero y el paso siguiente se enciende al llegar. */
export function Stepper({
  steps = PASOS,
  current,
  defaultCurrent = 1,
  onChange,
  orientation = "horizontal",
  clickable = true,
  controls = true,
  color = "#8EA2FF",
  label = "Progress",
  backLabel = "Back",
  nextLabel = "Next",
  finishLabel = "Finish",
  restartLabel = "Restart",
  autoplay = 0,
  className = "",
  style,
}: StepperProps) {
  const lista = steps.map((s) => (typeof s === "string" ? { label: s } : s));
  const n = lista.length;
  const [interno, setInterno] = useState(defaultCurrent);
  const actual = Math.min(Math.max(current ?? interno, 0), n);
  const previo = useRef(actual);
  const tocado = useRef(false);
  const dir = actual >= previo.current ? "adelante" : "atras";
  useEffect(() => { previo.current = actual; });

  const ir = (i: number) => {
    const v = Math.min(Math.max(i, 0), n);
    if (current === undefined) setInterno(v);
    onChange?.(v);
  };

  // Avance automático para la demo: recorre los pasos, hace una pausa al terminar y vuelve a empezar.
  useEffect(() => {
    if (!autoplay || n < 2) return;
    const id = window.setInterval(() => {
      if (tocado.current || document.hidden) return;
      ir(actual >= n ? 0 : actual + 1);
    }, autoplay * 1000);
    return () => window.clearInterval(id);
  });

  const vars = { "--furin-stepper-color": color } as CSSProperties;
  const terminado = actual >= n;
  return (
    <div className={`furin-stepper furin-stepper--${orientation} furin-stepper--${dir} ${className}`} style={{ ...vars, ...style }} onPointerDown={() => { tocado.current = true; }}>
      <ol className="furin-stepper__lista" aria-label={label}>
        {lista.map((s, i) => {
          const estado = i < actual ? "done" : i === actual ? "current" : "todo";
          const ultimo = i === n - 1;
          const puedeVolver = clickable && i < actual;
          const nodo = (
            <>
              <svg className="furin-stepper__check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.6 8.4 6.7 11.4 12.4 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength="1" /></svg>
              <span className="furin-stepper__num" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
            </>
          );
          return (
            <li key={i} className={`furin-stepper__paso is-${estado}${ultimo ? " is-ultimo" : ""}`} aria-current={estado === "current" ? "step" : undefined}>
              <span className="furin-stepper__fila">
                {puedeVolver ? (
                  <button type="button" className="furin-stepper__nodo" aria-label={`Go back to step ${i + 1}: ${s.label}`} onClick={() => ir(i)}>{nodo}</button>
                ) : (
                  <span className="furin-stepper__nodo">{nodo}</span>
                )}
                {!ultimo ? <span className="furin-stepper__linea" aria-hidden="true"><i className="furin-stepper__relleno" /></span> : null}
              </span>
              <span className="furin-stepper__texto">
                <span className="furin-stepper__titulo">{s.label}</span>
                {s.description ? <span className="furin-stepper__desc">{s.description}</span> : null}
                <span className="furin-stepper__sr">{estado === "done" ? " (completado)" : estado === "current" ? " (paso actual)" : " (pendiente)"}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {controls ? (
        <div className="furin-stepper__controles">
          <button type="button" className="furin-stepper__btn" disabled={actual <= 0} onClick={() => ir(actual - 1)}>{backLabel}</button>
          <button type="button" className="furin-stepper__btn furin-stepper__btn--primario" onClick={() => ir(terminado ? 0 : actual + 1)}>
            {terminado ? restartLabel : actual === n - 1 ? finishLabel : nextLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default Stepper;
