"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./DownloadButton.css";

export interface DownloadButtonProps {
  /** Texto del botón en reposo. */
  label?: string;
  /** Texto cuando termina. */
  doneLabel?: string;
  /** Nombre del archivo que se muestra mientras "baja". */
  fileName?: string;
  /** Tamaño del archivo que se muestra mientras "baja". */
  fileSize?: string;
  /** Duración de la descarga simulada, en milisegundos. */
  duration?: number;
  /** Si lo pones, al terminar se descarga ese archivo de verdad. */
  href?: string;
  /** Milisegundos que se queda en "listo" antes de volver al inicio (0 = se queda). */
  resetAfter?: number;
  /** Color del botón en reposo. */
  color?: string;
  /** Color del estado "listo". */
  doneColor?: string;
  /** Se llama cuando empieza la descarga. */
  onStart?: () => void;
  /** Se llama cuando termina. */
  onComplete?: () => void;
  /** Segundos entre descargas automáticas (0 = apagado; se detiene al interactuar). */
  autoplay?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

type Fase = "idle" | "bajando" | "listo";

/** Botón de descarga: se afina hasta ser una barra de progreso, avanza a ritmo irregular como una red real y termina en una palomita. */
export function DownloadButton({
  label = "Download",
  doneLabel = "Done",
  fileName = "furin-kit.zip",
  fileSize = "4.2 MB",
  duration = 3200,
  href,
  resetAfter = 2600,
  color = "#F3F4F7",
  doneColor = "#6EE0A6",
  onStart,
  onComplete,
  autoplay = 0,
  className = "",
  style,
}: DownloadButtonProps) {
  const [fase, setFase] = useState<Fase>("idle");
  const [aviso, setAviso] = useState("");
  const relleno = useRef<HTMLSpanElement>(null);
  const pctTxt = useRef<HTMLSpanElement>(null);
  const barra = useRef<HTMLDivElement>(null);
  const progreso = useRef(0);
  const raf = useRef(0);
  const timer = useRef(0);
  const tocado = useRef(false);
  const live = useRef({ duration, onComplete, resetAfter, href, fileName });
  live.current = { duration, onComplete, resetAfter, href, fileName };

  const pinta = (p: number) => {
    progreso.current = p;
    if (relleno.current) relleno.current.style.transform = `scaleX(${(p / 100).toFixed(4)})`;
    if (pctTxt.current) pctTxt.current.textContent = `${Math.floor(p)}%`;
    const b = barra.current;
    if (b) b.setAttribute("aria-valuenow", String(Math.floor(p)));
  };

  const cancelar = () => {
    cancelAnimationFrame(raf.current);
    window.clearTimeout(timer.current);
    pinta(0);
    setFase("idle");
    setAviso("Download canceled");
  };

  const empezar = () => {
    tocado.current = true;
    if (fase === "bajando") { cancelar(); return; }
    if (fase === "listo") return;
    onStart?.();
    arrancar();
  };

  const arrancar = () => {
    window.clearTimeout(timer.current);
    pinta(0);
    setFase("bajando");
    setAviso(`Downloading ${live.current.fileName}`);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let p = 0, t0 = performance.now(), last = t0, avisado = 0;
    const seed = Math.random() * 10;
    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      // Ritmo irregular: arranque lento, ráfagas, un par de pausas y un final que se arrastra, como una red de verdad.
      const t = (now - t0) / 1000 + seed;
      const ruido = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.9) * Math.sin(t * 0.7 + 1.3)) + 0.5 * Math.max(0, Math.sin(t * 3.1));
      const freno = p > 86 ? 0.45 : p < 8 ? 0.6 : 1;
      p = Math.min(100, p + (100 / (live.current.duration / 1000)) * dt * ruido * freno * (reduce ? 3 : 1.15));
      pinta(p);
      const hito = Math.floor(p / 25);
      if (hito > avisado && p < 100) { avisado = hito; setAviso(`${hito * 25}%`); }
      if (p >= 100) { termina(); return; }
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
  };

  const termina = () => {
    pinta(100);
    setFase("listo");
    setAviso(`Download complete: ${live.current.fileName}`);
    live.current.onComplete?.();
    if (live.current.href) {
      const a = document.createElement("a");
      a.href = live.current.href;
      a.download = live.current.fileName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    if (live.current.resetAfter > 0) {
      timer.current = window.setTimeout(() => { setFase("idle"); pinta(0); }, live.current.resetAfter);
    }
  };

  useEffect(() => () => { cancelAnimationFrame(raf.current); window.clearTimeout(timer.current); }, []);

  // Descargas automáticas para la demo; se detienen en cuanto alguien toca el botón.
  useEffect(() => {
    if (!autoplay) return;
    const id = window.setInterval(() => {
      if (tocado.current || document.hidden) return;
      if (faseRef.current === "idle") arrancar();
    }, autoplay * 1000);
    return () => window.clearInterval(id);
  }, [autoplay]); // eslint-disable-line react-hooks/exhaustive-deps
  const faseRef = useRef(fase);
  faseRef.current = fase;

  const vars = { "--furin-dl-color": color, "--furin-dl-done": doneColor } as CSSProperties;
  const nombreAcc = fase === "bajando" ? `Cancel download of ${fileName}` : fase === "listo" ? `${doneLabel}: ${fileName}` : `${label} ${fileName}`;
  return (
    <div className={`furin-download-button is-${fase} ${className}`} style={{ ...vars, ...style }}>
      {/* Datos del archivo: aparecen sobre la barra mientras baja. */}
      <div className="furin-download-button__info" aria-hidden="true">
        <span className="furin-download-button__archivo">{fileName} <i>{fileSize}</i></span>
        <span ref={pctTxt} className="furin-download-button__pct">0%</span>
      </div>
      <button type="button" className="furin-download-button__boton" onClick={empezar} aria-label={nombreAcc} aria-disabled={fase === "listo"}>
        <span className="furin-download-button__relleno-wrap" aria-hidden="true">
          <span ref={relleno} className="furin-download-button__relleno" />
        </span>
        <span className="furin-download-button__contenido" aria-hidden="true">
          <svg className="furin-download-button__flecha" viewBox="0 0 20 20">
            <path d="M10 3.6v9.2M5.8 9l4.2 4.2L14.2 9M4.4 16.4h11.2" />
          </svg>
          <span className="furin-download-button__txt">{label}</span>
        </span>
        <span className="furin-download-button__listo" aria-hidden="true">
          <svg viewBox="0 0 20 20"><path d="M4.6 10.4 8.4 14.2 15.6 6" pathLength="1" /></svg>
          <span>{doneLabel}</span>
        </span>
      </button>
      <div ref={barra} className="furin-download-button__sr" role="progressbar" aria-label={`${fileName} download progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} hidden={fase !== "bajando"} />
      <span className="furin-download-button__sr" role="status" aria-live="polite">{aviso}</span>
    </div>
  );
}

export default DownloadButton;
