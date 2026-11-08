"use client";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, Ref } from "react";
import { createPortal } from "react-dom";
import "./ToastStack.css";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastData {
  /** Identificador (si no lo pones, se genera uno). */
  id?: string;
  /** Título de la notificación. */
  title: string;
  /** Texto de apoyo. */
  description?: string;
  /** Tipo: define el ícono y el color. */
  kind?: ToastKind;
  /** Milisegundos antes de cerrarse sola (0 = no se cierra). */
  duration?: number;
  /** Botón de acción opcional. */
  action?: { label: string; onClick: () => void };
}

export interface ToastStackHandle {
  /** Agrega una notificación y devuelve su id. */
  push: (toast: ToastData) => string;
  /** Cierra una notificación por id. */
  dismiss: (id: string) => void;
  /** Cierra todas. */
  clear: () => void;
}

export interface ToastStackProps {
  /** Referencia con push, dismiss y clear para lanzar notificaciones desde tu código. */
  ref?: Ref<ToastStackHandle>;
  /** Notificaciones de ejemplo que lanzan el botón y el modo autoplay (y las tres primeras son las de partida). */
  samples?: ToastData[];
  /** Notificaciones que ya están al montar. */
  defaultToasts?: ToastData[];
  /** Esquina donde se apilan. */
  position?: "bottom-right" | "bottom-left" | "bottom-center" | "top-right" | "top-left" | "top-center";
  /** Milisegundos por defecto antes de cerrarse (0 = no se cierran). */
  duration?: number;
  /** Máximo de notificaciones a la vez. */
  max?: number;
  /** Se ancla a la ventana en vez de a su contenedor. */
  fixed?: boolean;
  /** Muestra un botón para lanzar notificaciones de ejemplo. */
  trigger?: boolean;
  /** Segundos entre notificaciones de ejemplo automáticas (0 = apagado). */
  autoplay?: number;
  /** Etiqueta accesible de la región. */
  label?: string;
  /** Texto del botón de ejemplo (con trigger). */
  triggerLabel?: string;
  /** Texto de pista bajo el botón de ejemplo (con trigger). */
  triggerHint?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

interface Item extends ToastData { id: string; salida?: boolean; nuevo?: boolean; ms: number }

const MUESTRAS: ToastData[] = [
  { kind: "success", title: "Changes saved", description: "Version 2.4 is now live." },
  { kind: "info", title: "New comment", description: "Ana replied in Product design." },
  { kind: "warning", title: "Storage at 90%", description: "Free up space to keep uploading files." },
  { kind: "error", title: "Sync failed", description: "Retrying in a few seconds." },
  { kind: "success", title: "Invitation sent", description: "We let luis@studio.com know." },
];

let contador = 0;
const GAP = 10;

function Icono({ kind }: { kind: ToastKind }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {kind === "success" ? <path {...p} d="m5.4 10.4 3 3 6.2-6.8" /> : null}
      {kind === "info" ? <path {...p} d="M10 9v5M10 6.1v.1" /> : null}
      {kind === "warning" ? <path {...p} d="M10 5.6v5M10 13.9v.1" /> : null}
      {kind === "error" ? <path {...p} d="m6.8 6.8 6.4 6.4M13.2 6.8l-6.4 6.4" /> : null}
    </svg>
  );
}

/** Notificaciones apiladas como cartas: se despliegan al pasar el cursor o enfocar, se pausan mientras las lees y se cierran solas. */
export function ToastStack({
  ref,
  samples = MUESTRAS,
  defaultToasts = samples.slice(0, 3).map((t) => ({ ...t, duration: 9000 })),
  position = "bottom-right",
  duration = 5000,
  max = 5,
  fixed = false,
  trigger = false,
  autoplay = 0,
  label = "Notifications",
  triggerLabel = "Show notification",
  triggerHint = "Hover over the stack to fan it out.",
  className = "",
  style,
}: ToastStackProps) {
  const crear = (t: ToastData): Item => ({ ...t, id: t.id ?? `t${++contador}`, ms: t.duration ?? duration, nuevo: true });
  const [items, setItems] = useState<Item[]>(() => defaultToasts.map(crear));
  const [abierto, setAbierto] = useState(false);
  const [alturas, setAlturas] = useState<Record<string, number>>({});
  const [montado, setMontado] = useState(false);
  const muestras = useRef(samples);
  muestras.current = samples;
  const pausa = useRef({ cursor: false, foco: false });
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const ultima = useRef<Record<string, { y: number; s: number }>>({});
  const tocado = useRef(false);
  const muestra = useRef(3);
  const live = useRef({ max, duration });
  live.current = { max, duration };
  const arriba = position.startsWith("top");

  useEffect(() => setMontado(true), []);

  const quitar = useCallback((id: string) => {
    setItems((l) => (l.some((t) => t.id === id && !t.salida) ? l.map((t) => (t.id === id ? { ...t, salida: true } : t)) : l));
    window.setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 360);
  }, []);

  const empujar = useCallback((t: ToastData) => {
    const it: Item = { ...t, id: t.id ?? `t${++contador}`, ms: t.duration ?? live.current.duration, nuevo: true };
    setItems((l) => {
      const vivas = l.filter((x) => !x.salida);
      const sobran = vivas.length + 1 - live.current.max;
      const salientes = new Set(sobran > 0 ? vivas.slice(0, sobran).map((x) => x.id) : []);
      return [...l.map((x) => (salientes.has(x.id) ? { ...x, salida: true } : x)), it];
    });
    return it.id;
  }, []);

  useImperativeHandle(ref, () => ({ push: empujar, dismiss: quitar, clear: () => setItems((l) => l.map((t) => ({ ...t, salida: true }))) }), [empujar, quitar]);

  // Las nuevas entran un fotograma después, para que la transición de entrada se vea.
  useEffect(() => {
    if (!items.some((t) => t.nuevo)) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setItems((l) => l.map((t) => (t.nuevo ? { ...t, nuevo: false } : t)))));
    return () => cancelAnimationFrame(id);
  }, [items]);

  // Mide la altura real de cada notificación.
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => {
      setAlturas((prev) => {
        const sig: Record<string, number> = {};
        let cambio = false;
        for (const [id, el] of Object.entries(refs.current)) {
          if (!el) continue;
          sig[id] = el.offsetHeight;
          if (prev[id] !== sig[id]) cambio = true;
        }
        return cambio || Object.keys(prev).length !== Object.keys(sig).length ? sig : prev;
      });
    });
    for (const el of Object.values(refs.current)) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);

  useEffect(() => {
    if (!autoplay) return;
    const id = window.setInterval(() => {
      if (tocado.current || document.hidden) return;
      const m = muestras.current[muestra.current++ % muestras.current.length];
      empujar({ ...m, duration: 7000 });
    }, autoplay * 1000);
    return () => window.clearInterval(id);
  }, [autoplay, empujar]);

  const sync = () => setAbierto(pausa.current.cursor || pausa.current.foco);
  const pausado = abierto;

  // Orden visual: la más nueva al frente (índice 0).
  const vivas = items.filter((t) => !t.salida);
  const orden = [...vivas].reverse();
  const frente = orden[0] ? alturas[orden[0].id] ?? 72 : 0;
  const total = orden.reduce((a, t, i) => a + (alturas[t.id] ?? 72) + (i ? GAP : 0), 0);
  const alto = abierto ? total : frente + Math.min(orden.length - 1, 2) * 12;
  const dir = arriba ? 1 : -1;

  const nodo = (
    <div
      className={`furin-toast-stack__region furin-toast-stack__region--${position}${fixed ? " is-fija" : ""}`}
      role="region"
      aria-label={label}
      tabIndex={-1}
    >
      <div
        className={`furin-toast-stack__pila${abierto ? " is-abierta" : ""}`}
        style={{ height: alto, ["--furin-toast-frente" as string]: `${frente}px` } as CSSProperties}
        onPointerEnter={() => { pausa.current.cursor = true; tocado.current = true; sync(); }}
        onPointerLeave={() => { pausa.current.cursor = false; sync(); }}
        onFocus={() => { pausa.current.foco = true; sync(); }}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { pausa.current.foco = false; sync(); } }}
        aria-live="polite"
        aria-relevant="additions"
      >
        {items.map((t) => {
          const i = orden.findIndex((x) => x.id === t.id);
          let y: number, s: number, op: number;
          if (t.salida || i < 0) {
            const u = ultima.current[t.id] ?? { y: 0, s: 1 };
            y = u.y; s = u.s; op = 0;
          } else if (abierto) {
            const antes = orden.slice(0, i).reduce((a, x) => a + (alturas[x.id] ?? 72) + GAP, 0);
            y = antes * dir; s = 1; op = 1;
          } else {
            y = Math.min(i, 3) * 12 * dir; s = 1 - Math.min(i, 3) * 0.055; op = i > 2 ? 0 : 1;
          }
          if (!t.salida && i >= 0) ultima.current[t.id] = { y, s };
          const entrando = t.nuevo ? 1 : 0;
          const tapada = !abierto && i > 0;
          return (
            <div
              key={t.id}
              ref={(el) => { refs.current[t.id] = el; }}
              role={t.kind === "error" ? "alert" : undefined}
              className={`furin-toast-stack__toast furin-toast-stack__toast--${t.kind ?? "info"}${t.salida ? " is-saliendo" : ""}${entrando ? " is-nuevo" : ""}${tapada ? " is-tapada" : ""}`}
              style={{
                transform: `translate3d(${t.salida ? "28px" : "0"}, ${entrando ? y + 26 * -dir : y}px, 0) scale(${entrando ? 0.94 : s})`,
                opacity: entrando ? 0 : op,
                zIndex: 100 - Math.max(i, 0),
                ["--furin-toast-ms" as string]: `${t.ms}ms`,
              } as CSSProperties}
            >
              <span className="furin-toast-stack__icono"><Icono kind={t.kind ?? "info"} /></span>
              <div className="furin-toast-stack__cuerpo">
                <p className="furin-toast-stack__titulo">{t.title}</p>
                {t.description ? <p className="furin-toast-stack__desc">{t.description}</p> : null}
                {t.action ? (
                  <button type="button" className="furin-toast-stack__accion" onClick={() => { t.action?.onClick(); quitar(t.id); }}>{t.action.label}</button>
                ) : null}
              </div>
              <button type="button" className="furin-toast-stack__cerrar" aria-label={`Dismiss: ${t.title}`} onClick={() => quitar(t.id)} tabIndex={tapada ? -1 : 0}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg>
              </button>
              {t.ms > 0 ? (
                <span className="furin-toast-stack__barra" aria-hidden="true">
                  <i
                    style={{ animationPlayState: pausado ? "paused" : "running" }}
                    onAnimationEnd={() => quitar(t.id)}
                  />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );

  const lanzar = () => {
    tocado.current = true;
    const m = muestras.current[muestra.current++ % muestras.current.length];
    empujar({ ...m, duration: 6000 });
  };

  return (
    <div className={`furin-toast-stack ${className}`} style={style}>
      {trigger ? (
        <div className="furin-toast-stack__centro">
          <button type="button" className="furin-toast-stack__lanzar" onClick={lanzar}>{triggerLabel}</button>
          <p className="furin-toast-stack__pista">{triggerHint}</p>
        </div>
      ) : null}
      {fixed ? (montado ? createPortal(nodo, document.body) : null) : nodo}
    </div>
  );
}

export default ToastStack;
