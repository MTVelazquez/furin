"use client";
import { useState } from "react";
import type { CSSProperties } from "react";
import "./FolderPeek.css";

export interface FolderPeekProps {
  /** Texto de la etiqueta de la carpeta. */
  label?: string;
  /** Segunda línea pequeña de la etiqueta. */
  sublabel?: string;
  /** Color del cartón de la carpeta. */
  color?: string;
  /** Color de acento de los documentos. */
  accent?: string;
  /** Cuántos documentos asoman (1 a 3). */
  documents?: number;
  /** Escala de toda la carpeta. */
  scale?: number;
  /** Si es true, la carpeta se queda abierta. */
  open?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

// Anchos de las "líneas de texto" de cada documento (porcentajes fijos, nada al azar entre renders).
const LINES = [[92, 100, 84, 96, 60, 90, 72], [100, 88, 94, 70, 98, 56, 80], [86, 98, 90, 64, 100, 78, 92]];

/** Carpeta de cartón que se abre al pasar el cursor y deja asomar sus documentos. */
export function FolderPeek({
  label = "Projects 2026",
  sublabel = "Archive · 24 documents",
  color = "#d6a96c",
  accent = "#3b6bff",
  documents = 3,
  scale = 1,
  open,
  className = "",
  style,
}: FolderPeekProps) {
  const [hover, setHover] = useState(false);
  const isOpen = open ?? hover;
  const n = Math.max(1, Math.min(3, Math.round(documents)));
  const vars = { "--fp-color": color, "--fp-accent": accent, "--fp-scale": scale } as CSSProperties;
  return (
    <div
      className={`furin-folder ${isOpen ? "is-open" : ""} ${className}`}
      style={{ ...vars, ...style }}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(true); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(false); }}
      onPointerDown={(e) => { if (e.pointerType !== "mouse") setHover((h) => !h); }}
      role="img"
      aria-label={`Folder ${label}`}
    >
      <div className="furin-folder__shadow" aria-hidden />
      <div className="furin-folder__stage">
        <div className="furin-folder__back" />
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className={`furin-folder__doc furin-folder__doc--${i}`}>
            <div className="furin-folder__docbar" />
            {i === 1 ? (
              <div className="furin-folder__chart" aria-hidden>{[38, 62, 48, 84, 66, 92].map((h, k) => <i key={k} style={{ height: `${h}%` }} />)}</div>
            ) : (
              <div className="furin-folder__title" />
            )}
            {LINES[i].map((w, k) => <div key={k} className="furin-folder__line" style={{ width: `${w}%` }} />)}
          </div>
        ))}
        <div className="furin-folder__front">
          <div className="furin-folder__label">
            <b>{label}</b>
            <span>{sublabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FolderPeek;
