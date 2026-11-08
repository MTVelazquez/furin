"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./Iman.css";

export interface ImanProps {
  /** Lo que se deja atraer: un botón, una tarjeta, un ícono, lo que sea. */
  children?: ReactNode;
  /** Qué tanto se acerca al cursor: 0 no se mueve, 1 lo sigue exactamente. */
  strength?: number;
  /** Distancia en px, medida desde el borde del elemento, a la que empieza la atracción. */
  radius?: number;
  /** Rigidez del resorte: más alta, responde más rápido. */
  stiffness?: number;
  /** Amortiguación del resorte: más baja, rebota más al regresar. */
  damping?: number;
  /** Apaga la atracción (el elemento se queda quieto). */
  disabled?: boolean;
  /** Clase CSS extra para el contenedor. */
  className?: string;
  /** Estilos en línea del contenedor. */
  style?: CSSProperties;
}

/** Estado del resorte: posición, velocidad y punto de reposo, en px. */
interface Resorte {
  x: number;
  y: number;
  vx: number;
  vy: number;
  objetivoX: number;
  objetivoY: number;
}

/** El resorte se integra en pasos de este tamaño (en segundos) para que sea estable. */
const PASO_FISICO = 1 / 240;
/** Si un cuadro tarda más que esto (pestaña dormida), se recorta para no dar un salto. */
const DT_MAXIMO = 1 / 30;

export function Iman({
  children,
  strength = 0.4,
  radius = 140,
  stiffness = 170,
  damping = 11,
  disabled = false,
  className = "",
  style,
}: ImanProps) {
  const envoltura = useRef<HTMLDivElement>(null);
  const interior = useRef<HTMLDivElement>(null);
  // Los ajustes viven en una ref para poder cambiarlos en vivo sin reiniciar el resorte.
  const ajustes = useRef({ strength, radius, stiffness, damping });

  useEffect(() => {
    ajustes.current = { strength, radius, stiffness, damping };
  }, [strength, radius, stiffness, damping]);

  useEffect(() => {
    const caja = envoltura.current;
    const pieza = interior.current;
    if (!caja || !pieza || disabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const r: Resorte = { x: 0, y: 0, vx: 0, vy: 0, objetivoX: 0, objetivoY: 0 };
    let cuadro = 0;
    let ultimoCuadro = 0;

    const dibujar = () => {
      pieza.style.transform = `translate3d(${r.x.toFixed(2)}px, ${r.y.toFixed(2)}px, 0)`;
    };

    const paso = (ahora: number) => {
      const dt = Math.min((ahora - ultimoCuadro) / 1000, DT_MAXIMO);
      ultimoCuadro = ahora;
      const { stiffness: k, damping: c } = ajustes.current;

      const pasos = Math.max(1, Math.ceil(dt / PASO_FISICO));
      const h = dt / pasos;
      for (let i = 0; i < pasos; i++) {
        // Resorte amortiguado: la fuerza lo jala al objetivo y la fricción lo frena.
        r.vx += (-k * (r.x - r.objetivoX) - c * r.vx) * h;
        r.vy += (-k * (r.y - r.objetivoY) - c * r.vy) * h;
        r.x += r.vx * h;
        r.y += r.vy * h;
      }

      const quieto =
        Math.abs(r.x - r.objetivoX) < 0.05 &&
        Math.abs(r.y - r.objetivoY) < 0.05 &&
        Math.abs(r.vx) < 0.05 &&
        Math.abs(r.vy) < 0.05;

      if (quieto) {
        r.x = r.objetivoX;
        r.y = r.objetivoY;
        r.vx = 0;
        r.vy = 0;
        cuadro = 0; // el bucle se duerme hasta que el cursor vuelva a moverse
      } else {
        cuadro = requestAnimationFrame(paso);
      }
      dibujar();
    };

    const despertar = () => {
      if (cuadro !== 0) return;
      ultimoCuadro = performance.now();
      cuadro = requestAnimationFrame(paso);
    };

    const soltar = () => {
      r.objetivoX = 0;
      r.objetivoY = 0;
      despertar();
    };

    const alMoverElPuntero = (e: PointerEvent) => {
      // La envoltura no se mueve (solo su interior), así que su caja es el punto de reposo.
      const area = caja.getBoundingClientRect();
      const { strength: fuerza, radius: alcance } = ajustes.current;

      // Distancia del cursor a la caja: 0 si está encima, cuenta desde el borde si está fuera.
      const dx = Math.max(area.left - e.clientX, 0, e.clientX - area.right);
      const dy = Math.max(area.top - e.clientY, 0, e.clientY - area.bottom);
      const distancia = Math.hypot(dx, dy);

      if (distancia > alcance) {
        soltar();
        return;
      }

      // La atracción se desvanece hacia el borde del radio para que no haya tirones al salir.
      const peso = alcance > 0 ? 1 - (distancia / alcance) ** 2 : 1;
      const centroX = area.left + area.width / 2;
      const centroY = area.top + area.height / 2;
      r.objetivoX = (e.clientX - centroX) * fuerza * peso;
      r.objetivoY = (e.clientY - centroY) * fuerza * peso;
      despertar();
    };

    // En pantallas táctiles no hay cursor flotando: al levantar el dedo se suelta.
    const alLevantar = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") soltar();
    };

    window.addEventListener("pointerdown", alMoverElPuntero, { passive: true });
    window.addEventListener("pointermove", alMoverElPuntero, { passive: true });
    window.addEventListener("pointerup", alLevantar, { passive: true });
    window.addEventListener("pointercancel", soltar, { passive: true });
    document.documentElement.addEventListener("pointerleave", soltar, { passive: true });

    return () => {
      cancelAnimationFrame(cuadro);
      window.removeEventListener("pointerdown", alMoverElPuntero);
      window.removeEventListener("pointermove", alMoverElPuntero);
      window.removeEventListener("pointerup", alLevantar);
      window.removeEventListener("pointercancel", soltar);
      document.documentElement.removeEventListener("pointerleave", soltar);
      pieza.style.transform = "";
    };
  }, [disabled]);

  return (
    <div ref={envoltura} className={`furin-iman ${className}`.trim()} style={style}>
      <div ref={interior} className="furin-iman__interior">
        {children}
      </div>
    </div>
  );
}

export default Iman;
