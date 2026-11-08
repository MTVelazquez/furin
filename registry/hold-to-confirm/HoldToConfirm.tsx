"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import "./HoldToConfirm.css";

export interface HoldToConfirmProps {
  /** Texto de abajo mientras no se presiona. */
  children?: ReactNode;
  /** Texto mientras se mantiene presionado. */
  holdingLabel?: string;
  /** Texto cuando se confirma. */
  confirmedLabel?: string;
  /** Instrucciones para lectores de pantalla (no se ven). */
  instructions?: string;
  /** Milisegundos que hay que mantener presionado. */
  duration?: number;
  /** Color del anillo y del brillo. */
  color?: string;
  /** Color del anillo cuando se confirma. */
  confirmedColor?: string;
  /** Diámetro del botón, en px. */
  size?: number;
  /** Milisegundos para volver al estado inicial tras confirmar (0 = se queda confirmado). */
  resetAfter?: number;
  /** Icono propio; si falta se usa un bote de basura. */
  icon?: ReactNode;
  /** Desactiva el botón. */
  disabled?: boolean;
  /** Se llama al completar la pausa. */
  onConfirm?: () => void;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const R = 46;
const C = 2 * Math.PI * R;

/** Botón de mantener presionado: un anillo se llena, la tecla tiembla cada vez más y al completar vibra y se confirma. Funciona con ratón, toque y teclado (mantén Espacio o Enter). */
export function HoldToConfirm({
  children = "Hold to delete",
  holdingLabel = "Keep holding…",
  confirmedLabel = "Deleted",
  instructions = "Press and hold the button, or the Space key, until the ring is complete.",
  duration = 1200,
  color = "#ff5a64",
  confirmedColor = "#34d399",
  size = 96,
  resetAfter = 2200,
  icon,
  disabled = false,
  onConfirm,
  className = "",
  style,
}: HoldToConfirmProps) {
  const uid = useId().replace(/:/g, "");
  const btnRef = useRef<HTMLButtonElement>(null);
  const arcRef = useRef<SVGCircleElement>(null);
  const headRef = useRef<SVGCircleElement>(null);
  const [phase, setPhase] = useState<"idle" | "holding" | "done">("idle");
  const phaseRef = useRef<"idle" | "holding" | "done">("idle");
  const st = useRef({ p: 0, p0: 0, t0: 0, holding: false, raf: 0, last: 0, timer: 0, id: -1 });
  const reduced = useRef(false);
  const cfg = useRef({ duration, resetAfter, onConfirm });
  cfg.current = { duration, resetAfter, onConfirm };

  const setPh = (v: "idle" | "holding" | "done") => { phaseRef.current = v; setPhase(v); };

  const paint = useCallback(() => {
    const s = st.current;
    const p = s.p;
    arcRef.current?.setAttribute("stroke-dashoffset", String(C * (1 - p)));
    const a = p * Math.PI * 2;
    headRef.current?.setAttribute("cx", String(50 + R * Math.sin(a)));
    headRef.current?.setAttribute("cy", String(50 - R * Math.cos(a)));
    headRef.current?.setAttribute("opacity", p > 0.01 && p < 0.999 ? "1" : "0");
    const b = btnRef.current;
    if (!b) return;
    b.style.setProperty("--furin-hold-to-confirm-p", p.toFixed(4));
    // Temblor creciente: se siente que algo está por ceder.
    const amp = p > 0.45 && p < 1 ? Math.pow((p - 0.45) / 0.55, 1.6) * 2.2 : 0;
    b.style.setProperty("--furin-hold-to-confirm-jx", `${((Math.random() - 0.5) * 2 * amp).toFixed(2)}px`);
    b.style.setProperty("--furin-hold-to-confirm-jy", `${((Math.random() - 0.5) * 2 * amp).toFixed(2)}px`);
  }, []);

  const complete = useCallback(() => {
    const s = st.current;
    s.holding = false;
    s.p = 1;
    paint();
    setPh("done");
    cfg.current.onConfirm?.();
    if (typeof navigator !== "undefined" && "vibrate" in navigator) { try { navigator.vibrate([18, 40, 30]); } catch { /* sin vibración */ } }
    window.clearTimeout(s.timer);
    if (cfg.current.resetAfter > 0) {
      s.timer = window.setTimeout(() => { setPh("idle"); wake(); }, cfg.current.resetAfter);
    }
  }, [paint]); // eslint-disable-line react-hooks/exhaustive-deps

  const tick = useCallback((now: number) => {
    const s = st.current;
    s.raf = 0;
    const dt = Math.min(0.05, (now - s.last) / 1000 || 0.016);
    s.last = now;
    if (phaseRef.current === "done") { paint(); return; }
    if (s.holding) {
      // El avance se mide con el reloj, no con los cuadros: si la pestaña se atora, la pausa dura lo mismo.
      s.p = Math.min(1, s.p0 + (performance.now() - s.t0) / cfg.current.duration);
      paint();
      if (s.p >= 1) { complete(); return; }
    } else if (s.p > 0) {
      // Al soltar antes de tiempo el anillo se vacía rápido, con un poco de inercia.
      s.p = Math.max(0, s.p - dt * (0.9 + s.p * 3.2));
      if (s.p < 0.002) s.p = 0;
      paint();
      if (s.p === 0) { if (phaseRef.current === "holding") setPh("idle"); return; }
    } else { paint(); return; }
    s.raf = requestAnimationFrame(tick);
  }, [paint, complete]);

  const wake = useCallback(() => {
    const s = st.current;
    if (!s.raf) { s.last = performance.now(); s.raf = requestAnimationFrame(tick); }
  }, [tick]);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    paint();
    const s = st.current;
    return () => { cancelAnimationFrame(s.raf); window.clearTimeout(s.timer); };
  }, [paint]);

  const start = () => {
    if (disabled || phaseRef.current === "done") return;
    const s = st.current;
    s.holding = true;
    s.p0 = s.p;
    s.t0 = performance.now();
    setPh("holding");
    wake();
  };
  const cancel = () => {
    const s = st.current;
    if (!s.holding) return;
    s.holding = false;
    wake();
  };

  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ya capturado */ }
    st.current.id = e.pointerId;
    start();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); start(); }
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); cancel(); }
  };

  const vars = {
    "--furin-hold-to-confirm-size": `${size}px`,
    "--furin-hold-to-confirm-color": color,
    "--furin-hold-to-confirm-ok": confirmedColor,
  } as CSSProperties;
  const label = phase === "done" ? confirmedLabel : phase === "holding" ? holdingLabel : children;

  return (
    <div className={`furin-hold-to-confirm ${className}`} style={{ ...vars, ...style }} data-phase={phase}>
      <button
        ref={btnRef}
        type="button"
        className={`furin-hold-to-confirm__btn${phase === "done" ? " is-done" : ""}`}
        disabled={disabled}
        aria-describedby={`${uid}-hint`}
        onPointerDown={onDown}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={cancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="furin-hold-to-confirm__glow" aria-hidden="true" />
        <svg className="furin-hold-to-confirm__ring" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="color-mix(in srgb, var(--furin-hold-to-confirm-color) 60%, #fff)" />
              <stop offset="1" stopColor="var(--furin-hold-to-confirm-color)" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={R} fill="none" className="furin-hold-to-confirm__track" strokeWidth="4" />
          <circle ref={arcRef} cx="50" cy="50" r={R} fill="none" className="furin-hold-to-confirm__arc" stroke={`url(#${uid}-g)`} strokeWidth="4.6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C} transform="rotate(-90 50 50)" />
          <circle ref={headRef} r="3.4" fill="#fff" className="furin-hold-to-confirm__head" opacity="0" cx="50" cy="4" />
        </svg>
        <span className="furin-hold-to-confirm__face">
          <span className="furin-hold-to-confirm__icon" aria-hidden="true">
            {icon ?? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12.2c.1.9.8 1.6 1.7 1.6h6c.9 0 1.6-.7 1.7-1.6L17.5 7M10 11v6M14 11v6" />
              </svg>
            )}
          </span>
          <svg className="furin-hold-to-confirm__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 12.5 4 4 8-9" pathLength="1" />
          </svg>
        </span>
        <span className="furin-hold-to-confirm__burst" aria-hidden="true" />
      </button>
      <span className="furin-hold-to-confirm__label" aria-live="polite">{label}</span>
      <span id={`${uid}-hint`} className="furin-hold-to-confirm__sr">{instructions}</span>
    </div>
  );
}

export default HoldToConfirm;
