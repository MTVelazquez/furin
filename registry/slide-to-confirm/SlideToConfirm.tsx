"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import "./SlideToConfirm.css";

export interface SlideToConfirmProps {
  /** Texto del carril. */
  children?: ReactNode;
  /** Texto cuando se confirma. */
  confirmedLabel?: string;
  /** Color de arranque de la estela que deja el pomo. */
  color?: string;
  /** Color de cierre de la estela. */
  colorTo?: string;
  /** Color de la estela al confirmar. */
  confirmedColor?: string;
  /** Ancho máximo del carril, en px. */
  width?: number;
  /** Alto del carril, en px. */
  height?: number;
  /** Qué tan lejos hay que llegar para confirmar, de 0.5 a 1. */
  threshold?: number;
  /** Milisegundos para volver al inicio tras confirmar (0 = se queda confirmado). */
  resetAfter?: number;
  /** Desactiva el control. */
  disabled?: boolean;
  /** Se llama al confirmar. */
  onConfirm?: () => void;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

/** Deslizar para confirmar: un pomo con física que se arrastra hasta el final; si se suelta antes regresa con resorte y rebote. Accesible como slider (flechas, Fin/Enter). */
export function SlideToConfirm({
  children = "Slide to confirm",
  confirmedLabel = "Confirmed",
  color = "#5b6cff",
  colorTo = "#8b5cf6",
  confirmedColor = "#34d399",
  width = 330,
  height = 66,
  threshold = 0.92,
  resetAfter = 2400,
  disabled = false,
  onConfirm,
  className = "",
  style,
}: SlideToConfirmProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"idle" | "done">("idle");
  const [pct, setPct] = useState(0);
  const phaseRef = useRef<"idle" | "done">("idle");
  const s = useRef({ x: 0, v: 0, tx: 0, max: 1, dragging: false, grab: 0, last: 0, raf: 0, id: -1, timer: 0, lastX: 0, lastT: 0, vel: 0, pct: 0 });
  const reduced = useRef(false);
  const cfg = useRef({ threshold, resetAfter, onConfirm });
  cfg.current = { threshold, resetAfter, onConfirm };
  const pad = 6;

  const paint = useCallback(() => {
    const t = trackRef.current, k = knobRef.current;
    if (!t || !k) return;
    const q = s.current;
    const p = q.max > 0 ? Math.max(0, Math.min(1, q.x / q.max)) : 0;
    const stretch = Math.min(0.14, Math.abs(q.vel) / 9000);
    k.style.transform = `translate3d(${q.x.toFixed(2)}px,0,0) scale(${(1 + stretch).toFixed(3)}, ${(1 - stretch * 0.6).toFixed(3)})`;
    t.style.setProperty("--furin-slide-to-confirm-p", p.toFixed(4));
    t.style.setProperty("--furin-slide-to-confirm-x", `${q.x.toFixed(2)}px`);
    const rounded = Math.round(p * 100);
    if (rounded !== q.pct) { q.pct = rounded; setPct(rounded); }
  }, []);

  const measure = useCallback(() => {
    const t = trackRef.current, k = knobRef.current;
    if (!t || !k) return;
    s.current.max = Math.max(1, t.clientWidth - k.offsetWidth - pad * 2);
    if (phaseRef.current === "done") { s.current.tx = s.current.max; s.current.x = s.current.max; }
    paint();
  }, [paint]);

  const finish = useCallback(() => {
    const q = s.current;
    if (phaseRef.current === "done") return;
    phaseRef.current = "done";
    setPhase("done");
    q.tx = q.max;
    cfg.current.onConfirm?.();
    if (typeof navigator !== "undefined" && "vibrate" in navigator) { try { navigator.vibrate(24); } catch { /* sin vibración */ } }
    window.clearTimeout(q.timer);
    if (cfg.current.resetAfter > 0) {
      q.timer = window.setTimeout(() => { phaseRef.current = "idle"; setPhase("idle"); q.tx = 0; wake(); }, cfg.current.resetAfter);
    }
    wake();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tick = useCallback((now: number) => {
    const q = s.current;
    q.raf = 0;
    const dt = Math.min(0.033, (now - q.last) / 1000 || 0.016);
    q.last = now;
    let moving = true;
    if (q.dragging) {
      // El pomo sigue al dedo; la velocidad se suaviza para el estiramiento.
      q.vel += (((q.x - q.lastX) / Math.max(dt, 0.001)) - q.vel) * Math.min(1, dt * 18);
      q.lastX = q.x;
    } else {
      const done = phaseRef.current === "done";
      const k = done ? 260 : 210, c = done ? 26 : 15;
      const sub = 3, h = dt / sub;
      for (let i = 0; i < sub; i++) {
        q.v += (k * (q.tx - q.x) - c * q.v) * h;
        q.x += q.v * h;
        // El borde izquierdo es una pared: el pomo rebota contra ella.
        if (q.x < 0) { q.x = 0; q.v = Math.abs(q.v) * 0.38; }
        if (q.x > q.max) { q.x = q.max; q.v = -Math.abs(q.v) * 0.2; }
      }
      q.vel = q.v;
      if (Math.abs(q.tx - q.x) < 0.1 && Math.abs(q.v) < 2) { q.x = q.tx; q.v = 0; q.vel = 0; moving = false; }
      if (done && q.x >= q.max - 0.5) moving = Math.abs(q.v) > 2;
    }
    paint();
    if (moving) q.raf = requestAnimationFrame(tick);
  }, [paint]);

  const wake = useCallback(() => {
    const q = s.current;
    if (reduced.current && !q.dragging) { q.x = q.tx; q.v = 0; q.vel = 0; paint(); return; }
    if (!q.raf) { q.last = performance.now(); q.raf = requestAnimationFrame(tick); }
  }, [paint, tick]);

  // Mientras se arrastra, los eventos se escuchan en la ventana: el dedo puede salirse del pomo sin soltarlo.
  const onWinMove = useCallback((e: globalThis.PointerEvent) => {
    const q = s.current;
    if (!q.dragging || q.id !== e.pointerId) return;
    q.x = Math.max(0, Math.min(q.max, e.clientX - q.grab));
    q.tx = q.x;
  }, []);
  const onWinUp = useCallback((e: globalThis.PointerEvent) => {
    const q = s.current;
    if (!q.dragging || q.id !== e.pointerId) return;
    window.removeEventListener("pointermove", onWinMove);
    window.removeEventListener("pointerup", onWinUp);
    window.removeEventListener("pointercancel", onWinUp);
    q.dragging = false;
    knobRef.current?.removeAttribute("data-drag");
    q.v = q.vel;
    const p = q.x / q.max;
    if (e.type !== "pointercancel" && (p >= cfg.current.threshold || (q.vel > 1500 && p > 0.5))) finish();
    else q.tx = 0;
    wake();
  }, [finish, wake, onWinMove]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || phaseRef.current === "done") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const q = s.current;
    q.dragging = true; q.id = e.pointerId;
    q.grab = e.clientX - q.x;
    q.lastX = q.x; q.vel = 0; q.v = 0;
    knobRef.current?.setAttribute("data-drag", "true");
    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp);
    window.addEventListener("pointercancel", onWinUp);
    wake();
  };

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    measure();
    const ro = new ResizeObserver(measure);
    if (trackRef.current) ro.observe(trackRef.current);
    const q = s.current;
    return () => { ro.disconnect(); cancelAnimationFrame(q.raf); window.clearTimeout(q.timer); window.removeEventListener("pointermove", onWinMove); window.removeEventListener("pointerup", onWinUp); window.removeEventListener("pointercancel", onWinUp); };
  }, [measure, onWinMove, onWinUp]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || phaseRef.current === "done") return;
    const q = s.current;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); q.tx = Math.min(q.max, q.tx + q.max * 0.12); if (q.tx / q.max >= cfg.current.threshold) finish(); wake(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); q.tx = Math.max(0, q.tx - q.max * 0.12); wake(); }
    else if (e.key === "Home") { e.preventDefault(); q.tx = 0; wake(); }
    else if (e.key === "End" || e.key === "Enter") { e.preventDefault(); finish(); }
  };

  const vars = {
    "--furin-slide-to-confirm-w": `${width}px`,
    "--furin-slide-to-confirm-h": `${height}px`,
    "--furin-slide-to-confirm-pad": `${pad}px`,
    "--furin-slide-to-confirm-a": color,
    "--furin-slide-to-confirm-b": colorTo,
    "--furin-slide-to-confirm-ok": confirmedColor,
  } as CSSProperties;

  return (
    <div
      ref={trackRef}
      className={`furin-slide-to-confirm ${className}`}
      style={{ ...vars, ...style }}
      data-phase={phase}
      data-disabled={disabled ? "true" : undefined}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={typeof children === "string" ? children : "Slide to confirm"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={phase === "done" ? 100 : pct}
      aria-valuetext={phase === "done" ? confirmedLabel : `${pct}%`}
      aria-disabled={disabled}
      onKeyDown={onKey}
    >
      <div className="furin-slide-to-confirm__fill" aria-hidden="true" />
      <span className="furin-slide-to-confirm__label" aria-hidden="true">{children}</span>
      <span className="furin-slide-to-confirm__done" aria-hidden="true">{confirmedLabel}</span>
      <div ref={knobRef} className="furin-slide-to-confirm__knob" onPointerDown={onDown}>
        <svg className="furin-slide-to-confirm__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h13M13 6.5 18.5 12 13 17.5" /></svg>
        <svg className="furin-slide-to-confirm__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 12.5 4 4 8-9" pathLength="1" /></svg>
        <span className="furin-slide-to-confirm__burst" />
      </div>
    </div>
  );
}

export default SlideToConfirm;
