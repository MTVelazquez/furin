"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./TypingIndicator.css";

export interface TypingIndicatorProps {
  /** Muestra un mensaje anterior para dar contexto a la burbuja. */
  context?: string;
  /** Respuesta que aparece cuando termina de "escribir" (vacío para que solo escriba). */
  reply?: string;
  /** Segundos que dura el "escribiendo…" antes de mostrar la respuesta. */
  typingTime?: number;
  /** Segundos que se queda la respuesta antes de volver a empezar. */
  replyTime?: number;
  /** Estilo de la burbuja: light, dark o accent. */
  variant?: "light" | "dark" | "accent";
  /** Escala de toda la pieza (1 es el tamaño normal). */
  scale?: number;
  /** Texto oculto que leen los lectores de pantalla. */
  label?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

/** Burbuja de "escribiendo…": tres puntos con rebote elástico (se estiran, caen y se aplastan en cadena), cola de globo y, en ciclo, la respuesta que reemplaza a la burbuja con un pequeño resorte. */
export function TypingIndicator({
  context = "Did you see this week's report yet?",
  reply = "Yes, I'll send it over in a moment.",
  typingTime = 3.2,
  replyTime = 3,
  variant = "dark",
  scale = 1,
  label = "Typing",
  className = "",
  style,
}: TypingIndicatorProps) {
  const [fase, setFase] = useState<"escribe" | "responde">("escribe");
  const [ciclo, setCiclo] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const [pausa, setPausa] = useState(false);

  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = true;
    let timer = 0;
    const programar = (f: "escribe" | "responde") => {
      window.clearTimeout(timer);
      if (quieto || !reply) return;
      const espera = (f === "escribe" ? typingTime : replyTime) * 1000;
      timer = window.setTimeout(() => {
        if (!visible) { programar(f); return; }
        if (f === "escribe") { setFase("responde"); programar("responde"); }
        else { setFase("escribe"); setCiclo((c) => c + 1); programar("escribe"); }
      }, espera);
    };
    programar("escribe");
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; setPausa(!e.isIntersecting); });
    io.observe(el);
    return () => { io.disconnect(); window.clearTimeout(timer); };
  }, [reply, typingTime, replyTime]);

  const vars = { "--furin-ti-scale": scale } as CSSProperties;
  return (
    <div ref={raiz} className={`furin-typing-indicator is-${variant} ${className}`} style={{ ...vars, ...style }} role="status" data-pausa={pausa ? "1" : "0"}>
      {context ? <div className="furin-typing-indicator__ctx" aria-hidden="true">{context}</div> : null}
      <div className="furin-typing-indicator__slot" aria-hidden="true">
        {fase === "escribe" ? (
          <div key={`t${ciclo}`} className="furin-typing-indicator__bubble furin-typing-indicator__typing">
            <i className="furin-typing-indicator__dot" style={{ "--furin-ti-i": 0 } as CSSProperties} />
            <i className="furin-typing-indicator__dot" style={{ "--furin-ti-i": 1 } as CSSProperties} />
            <i className="furin-typing-indicator__dot" style={{ "--furin-ti-i": 2 } as CSSProperties} />
          </div>
        ) : (
          <div key={`r${ciclo}`} className="furin-typing-indicator__bubble furin-typing-indicator__reply">{reply}</div>
        )}
      </div>
      <span className="furin-typing-indicator__sr">{fase === "escribe" ? `${label}…` : reply}</span>
    </div>
  );
}

export default TypingIndicator;
