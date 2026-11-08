"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./Crosshair.css";

export interface CrosshairProps {
  /** Color de las líneas y la mira. */
  color?: string;
  /** Hueco central alrededor del cursor, en px. */
  gap?: number;
  /** Muestra las coordenadas en vivo junto al cursor. */
  showCoords?: boolean;
  /** Muestra las reglas con marcas en los bordes. */
  ruler?: boolean;
  /** Coordenadas en porcentaje del contenedor en vez de píxeles. */
  percent?: boolean;
  /** Oculta el cursor del sistema dentro del contenedor. */
  hideCursor?: boolean;
  /** Se pasea solo cuando nadie mueve el cursor. */
  autoplay?: boolean;
  /** Texto de pista que se muestra cuando no hay children. */
  hint?: string;
  /** Contenido que queda debajo de la mira. */
  children?: ReactNode;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const pad = (n: number, d = 4) => String(Math.max(0, Math.round(n))).padStart(d, "0");

/** Mira de precisión: líneas de borde a borde con hueco central, reglas con marcas y coordenadas en vivo en mono. */
export function Crosshair({
  color = "#7DD3FC",
  gap = 18,
  showCoords = true,
  ruler = true,
  percent = false,
  hideCursor = true,
  autoplay = false,
  hint = "Aim with your cursor",
  children,
  className = "",
  style,
}: CrosshairProps) {
  const host = useRef<HTMLDivElement>(null);
  const capa = useRef<HTMLDivElement>(null);
  const etiqueta = useRef<HTMLDivElement>(null);
  const ex = useRef<HTMLSpanElement>(null);
  const ey = useRef<HTMLSpanElement>(null);
  const [activo, setActivo] = useState(true);
  const live = useRef({ percent, autoplay });
  live.current = { percent, autoplay };

  useEffect(() => {
    const el = host.current;
    const cap = capa.current;
    if (!el || !cap) return;
    // En reduced motion la mira no se muestra: el cursor del sistema se queda como está.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setActivo(false); return; }
    let W = 1, H = 1, raf = 0, visible = true, inside = false, lastReal = -1e9, shown = false;
    let px = 0, py = 0, pending = false;

    const render = () => {
      pending = false;
      cap.style.setProperty("--furin-crosshair-x", `${px.toFixed(1)}px`);
      cap.style.setProperty("--furin-crosshair-y", `${py.toFixed(1)}px`);
      const eti = etiqueta.current;
      if (ex.current && ey.current) {
        if (live.current.percent) {
          ex.current.textContent = `${((px / W) * 100).toFixed(1).padStart(5, "0")}%`;
          ey.current.textContent = `${((py / H) * 100).toFixed(1).padStart(5, "0")}%`;
        } else {
          ex.current.textContent = pad(px);
          ey.current.textContent = pad(py);
        }
      }
      if (eti) {
        // La etiqueta cambia de lado cerca de los bordes para no salirse.
        const w = eti.offsetWidth || 120, h = eti.offsetHeight || 32;
        const flipX = px + 22 + w > W - 6, flipY = py + 22 + h > H - 6;
        eti.style.transform = `translate(${(flipX ? px - 22 - w : px + 22).toFixed(1)}px, ${(flipY ? py - 22 - h : py + 22).toFixed(1)}px)`;
      }
    };
    const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(render); } };
    const show = (v: boolean) => { if (v !== shown) { shown = v; cap.classList.toggle("is-on", v); } };

    const setPos = (x: number, y: number) => { px = Math.min(Math.max(x, 0), W); py = Math.min(Math.max(y, 0), H); schedule(); };
    const measure = () => { const b = el.getBoundingClientRect(); W = Math.max(1, b.width); H = Math.max(1, b.height); };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const b = el.getBoundingClientRect();
      W = b.width; H = b.height;
      inside = true;
      lastReal = performance.now();
      setPos(e.clientX - b.left, e.clientY - b.top);
      show(true);
    };
    const onLeave = () => { inside = false; if (!live.current.autoplay) show(false); };
    const onDown = () => cap.classList.add("is-press");
    const onUp = () => cap.classList.remove("is-press");
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);

    // Paseo automático para la demo: una trayectoria en ocho, sin tocar el estado real.
    const loop = (nowMs: number) => {
      raf = 0;
      if (!visible) return;
      const auto = live.current.autoplay && (!inside || nowMs - lastReal > 2500);
      if (auto) {
        const t = nowMs / 1000;
        setPos(W * (0.5 + 0.3 * Math.sin(t * 0.8)), H * (0.5 + 0.28 * Math.sin(t * 1.3 + 0.7)));
        show(true);
        raf = requestAnimationFrame(loop);
      } else {
        // Al volver el control a la persona, se apaga o se queda donde estaba.
        if (live.current.autoplay) raf = requestAnimationFrame(loop);
      }
    };
    const kick = () => { if (!raf && visible && live.current.autoplay) raf = requestAnimationFrame(loop); };
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) kick(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } });
    io.observe(el);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    const poll = window.setInterval(kick, 600);
    kick();
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(poll);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  const vars = { "--furin-crosshair-color": color, "--furin-crosshair-gap": `${gap}px` } as CSSProperties;
  return (
    <div ref={host} className={`furin-crosshair${hideCursor && activo ? " furin-crosshair--sin-cursor" : ""} ${className}`} style={{ ...vars, ...style }}>
      <div className="furin-crosshair__contenido">
        {children ?? <span className="furin-crosshair__pista">{hint}</span>}
      </div>
      {activo ? (
        <div ref={capa} className="furin-crosshair__capa" aria-hidden="true">
          {ruler ? (
            <>
              <i className="furin-crosshair__regla furin-crosshair__regla--x" />
              <i className="furin-crosshair__regla furin-crosshair__regla--y" />
              <i className="furin-crosshair__marca furin-crosshair__marca--x" />
              <i className="furin-crosshair__marca furin-crosshair__marca--y" />
            </>
          ) : null}
          <i className="furin-crosshair__linea furin-crosshair__linea--h" />
          <i className="furin-crosshair__linea furin-crosshair__linea--v" />
          <span className="furin-crosshair__mira">
            <svg viewBox="-16 -16 32 32" width="32" height="32">
              <path d="M-9 -4V-9H-4M4 -9H9V-4M9 4V9H4M-4 9H-9V4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
              <circle r="1.6" fill="currentColor" />
            </svg>
          </span>
          {showCoords ? (
            <div ref={etiqueta} className="furin-crosshair__etq">
              <span><b>X</b><span ref={ex}>0000</span></span>
              <span><b>Y</b><span ref={ey}>0000</span></span>
            </div>
          ) : (
            <div ref={etiqueta} hidden />
          )}
        </div>
      ) : null}
    </div>
  );
}

export default Crosshair;
