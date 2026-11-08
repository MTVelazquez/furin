"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import "./ShineCard.css";

export interface ShineCardProps {
  /** Título de la tarjeta. */
  title?: string;
  /** Rótulo pequeño sobre el título. */
  eyebrow?: string;
  /** Texto de la tarjeta. */
  children?: ReactNode;
  /** Línea inferior en tipografía mono. */
  footer?: string;
  /** Acabado del metal de la tarjeta. */
  tone?: "titanium" | "aluminum" | "graphite";
  /** Muestra el disco pulido de la esquina. */
  badge?: boolean;
  /** Fuerza del brillo. */
  intensity?: number;
  /** Radio de las esquinas, en px. */
  radius?: number;
  /** Un barrido de luz cruza la tarjeta cada pocos segundos aunque no haya cursor. */
  idle?: boolean;
  /** Segundos entre barridos automáticos. */
  interval?: number;
  /** Clase extra para la tarjeta. */
  className?: string;
  /** Estilos extra para la tarjeta. */
  style?: CSSProperties;
}

const limitar = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Tarjeta de metal satinado: borde cromado que se enciende hacia el cursor, reflejo suave bajo la luz y un barrido de brillo diagonal al entrar. */
export function ShineCard({
  title = "Grade 5 titanium",
  eyebrow = "Series 04",
  children,
  footer = "No. 0427",
  tone = "titanium",
  badge = true,
  intensity = 1,
  radius = 22,
  idle = true,
  interval = 6,
  className = "",
  style,
}: ShineCardProps) {
  const raiz = useRef<HTMLDivElement>(null);
  const brillo = useRef<HTMLSpanElement>(null);
  const angulo = useRef(-45); // ángulo continuo de la luz del borde (para no girar de más al cruzar 360°)
  const visible = useRef(true);
  const quieto = useRef(false);

  // Un barrido: la franja cruza de izquierda a derecha con una curva suave.
  const barrer = (dur = 1100) => {
    const el = brillo.current;
    if (!el || quieto.current || typeof el.animate !== "function") return;
    el.animate(
      [
        { backgroundPosition: "100% 0", opacity: 1, offset: 0 },
        { backgroundPosition: "0% 0", opacity: 1, offset: 1 },
      ],
      { duration: dur, easing: "cubic-bezier(0.4, 0.05, 0.2, 1)" },
    );
  };

  useEffect(() => {
    quieto.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = raiz.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting; });
    io.observe(el);
    let id = 0;
    const tick = () => {
      if (idle && !quieto.current && visible.current && !el.matches(":hover")) barrer(1500);
      id = window.setTimeout(tick, Math.max(2, interval) * 1000);
    };
    if (idle && !quieto.current) id = window.setTimeout(tick, 1400);
    return () => { io.disconnect(); window.clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idle, interval]);

  const seguir = (e: PointerEvent<HTMLDivElement>) => {
    const el = raiz.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = limitar((e.clientX - r.left) / r.width, 0, 1);
    const y = limitar((e.clientY - r.top) / r.height, 0, 1);
    // Ángulo del cursor respecto al centro; se desenrolla para que la transición tome siempre el camino corto.
    let a = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
    a += Math.round((angulo.current - a) / 360) * 360;
    angulo.current = a;
    el.style.setProperty("--sc-x", x.toFixed(3));
    el.style.setProperty("--sc-y", y.toFixed(3));
    el.style.setProperty("--sc-a", `${a.toFixed(1)}deg`);
  };
  const soltar = () => {
    const el = raiz.current;
    if (!el) return;
    el.style.removeProperty("--sc-x");
    el.style.removeProperty("--sc-y");
    el.style.removeProperty("--sc-a");
    angulo.current = -45;
  };

  const vars = { "--sc-i": intensity, "--sc-r": `${radius}px` } as CSSProperties;
  return (
    <div
      ref={raiz}
      className={`furin-shine-card furin-shine-card--${tone} ${className}`}
      style={{ ...vars, ...style }}
      onPointerEnter={(e) => { seguir(e); barrer(); }}
      onPointerMove={seguir}
      onPointerLeave={soltar}
    >
      {/* El recorte vive en una capa plana interior: la tarjeta (con transform 3D y sombra) no recorta nada, y todo el brillo queda dentro de esta capa. */}
      <div className="furin-shine-card__clip">
        <span className="furin-shine-card__border" aria-hidden="true" />
        <span className="furin-shine-card__grain" aria-hidden="true" />
        <span className="furin-shine-card__glow" aria-hidden="true" />
        <span ref={brillo} className="furin-shine-card__sheen" aria-hidden="true" />
        {badge ? <span className="furin-shine-card__badge" aria-hidden="true" /> : null}
        <div className="furin-shine-card__body">
          {eyebrow ? <span className="furin-shine-card__eyebrow">{eyebrow}</span> : null}
          <h3 className="furin-shine-card__title">{title}</h3>
          {children ? <p className="furin-shine-card__text">{children}</p> : null}
          {footer ? <span className="furin-shine-card__footer">{footer}</span> : null}
        </div>
      </div>
    </div>
  );
}

export default ShineCard;
