"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./HoloFoil.css";

export interface HoloFoilProps {
  /** Fuerza de la iridiscencia (0 a 1.5). */
  intensity?: number;
  /** Densidad del patrón difractivo fino (0.5 a 3). */
  density?: number;
  /** Cuánto se inclina la lámina al seguir el cursor (0 a 1.5). */
  tilt?: number;
  /** Giro del tono general, en grados. */
  hue?: number;
  /** Color del metal base bajo la película. */
  baseColor?: string;
  /** Si no hay cursor encima, la lámina se mece sola. */
  autoplay?: boolean;
  /** Contenido que va encima de la lámina. */
  children?: ReactNode;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

/** Fondo holográfico: película iridiscente, rejilla difractiva y brillo que cambian con el ángulo del cursor. */
export function HoloFoil({
  intensity = 1,
  density = 1.4,
  tilt = 1,
  hue = 0,
  baseColor = "#0f1015",
  autoplay = true,
  children,
  className = "",
  style,
}: HoloFoilProps) {
  const ref = useRef<HTMLDivElement>(null);
  const opts = useRef({ tilt, autoplay });
  opts.current = { tilt, autoplay };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Posición del "reflejo" (0..1) y objetivo; el cursor manda, si no hay cursor la lámina se mece sola.
    const s = { x: 0.62, y: 0.38, tx: 0.62, ty: 0.38 };
    let hover = false;
    let visible = true;
    let raf = 0;
    let last = 0;
    const t0 = performance.now();

    const pintar = () => {
      const k = opts.current.tilt;
      const dx = (s.x - 0.5) * 2 * k;
      const dy = (s.y - 0.5) * 2 * k;
      el.style.setProperty("--hf-x", `${(50 + dx * 50).toFixed(2)}%`);
      el.style.setProperty("--hf-y", `${(50 + dy * 50).toFixed(2)}%`);
      el.style.setProperty("--hf-a", `${(dx * 70 + dy * 40).toFixed(1)}deg`);
      el.style.setProperty("--hf-ga", `${(112 + dx * 16 - dy * 10).toFixed(1)}deg`);
      el.style.setProperty("--hf-sx", `${(dx * 38).toFixed(1)}%`);
      el.style.setProperty("--hf-sy", `${(dy * 38).toFixed(1)}%`);
      el.style.setProperty("--hf-hue", `${(dx * 46 - dy * 30).toFixed(1)}deg`);
    };

    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      if (!hover && opts.current.autoplay) {
        const t = (now - t0) / 1000;
        s.tx = 0.5 + 0.34 * Math.sin(t * 0.55) + 0.1 * Math.sin(t * 1.3 + 1);
        s.ty = 0.5 + 0.3 * Math.cos(t * 0.43 + 0.6) + 0.08 * Math.sin(t * 1.1);
      }
      // Resorte amortiguado: la lámina tiene inercia, no salta.
      const a = 1 - Math.exp(-dt * 6.5);
      s.x += (s.tx - s.x) * a;
      s.y += (s.ty - s.y) * a;
      pintar();
      const quieto = Math.abs(s.tx - s.x) < 0.0008 && Math.abs(s.ty - s.y) < 0.0008;
      if (visible && !(quieto && !(opts.current.autoplay && !hover))) raf = requestAnimationFrame(tick);
      else last = 0;
    };
    const wake = () => { if (!raf && visible && !reduce) raf = requestAnimationFrame(tick); };

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      s.tx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      s.ty = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      hover = true;
      wake();
    };
    const onLeave = () => { hover = false; wake(); };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onMove);
    el.addEventListener("pointerleave", onLeave);
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); }, { threshold: 0.01 });
    io.observe(el);
    pintar();
    wake();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const vars = {
    "--hf-int": intensity,
    "--hf-den": `${(3.6 / density).toFixed(2)}px`,
    "--hf-base": baseColor,
    "--hf-hue0": `${hue}deg`,
  } as CSSProperties;

  return (
    <div ref={ref} className={`furin-holo-foil ${className}`} style={{ ...vars, ...style }}>
      <span className="furin-holo-foil__metal" aria-hidden />
      <span className="furin-holo-foil__crinkle" aria-hidden />
      <span className="furin-holo-foil__film" aria-hidden />
      <span className="furin-holo-foil__film furin-holo-foil__film--b" aria-hidden />
      <span className="furin-holo-foil__grating" aria-hidden />
      <span className="furin-holo-foil__glint" aria-hidden />
      <span className="furin-holo-foil__sparkle" aria-hidden />
      <span className="furin-holo-foil__grain" aria-hidden />
      {children ? <div className="furin-holo-foil__content">{children}</div> : null}
    </div>
  );
}

export default HoloFoil;
