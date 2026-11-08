"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./Holograma.css";

export interface HologramaProps {
  /** Contenido de la tarjeta; si no se pasa, se dibuja una tarjeta coleccionable de ejemplo. */
  children?: ReactNode;
  /** Título de la tarjeta de ejemplo (solo se ve si no pasas `children`). */
  sampleTitle?: string;
  /** Subtítulo de la tarjeta de ejemplo (solo se ve si no pasas `children`). */
  sampleSubtitle?: string;
  /** Ancho de la tarjeta en px. */
  width?: number;
  /** Alto de la tarjeta en px. */
  height?: number;
  /** Inclinación máxima en grados cuando el cursor llega a una orilla. */
  maxTilt?: number;
  /** Cuánto crece la tarjeta al pasar el cursor (1 = no crece). */
  scale?: number;
  /** Intensidad de la lámina holográfica, de 0 a 1. */
  foil?: number;
  /** Intensidad del brillo especular que sigue al cursor, de 0 a 1. */
  glare?: number;
  /** Giro de color de la lámina, en grados (0 a 360). */
  hue?: number;
  /** Distancia de la cámara en px: más baja, más exagerada la perspectiva. */
  perspective?: number;
  /** Redondeo de las esquinas en px. */
  radius?: number;
  /** Si es true, la tarjeta se mece sola cuando nadie la toca (útil en pantallas táctiles). */
  idleAnimation?: boolean;
  /** Clase CSS extra para el contenedor. */
  className?: string;
  /** Estilos en línea del contenedor. */
  style?: CSSProperties;
}

/** Qué tan encendida se ve la tarjeta sin cursor encima (0 = apagada, 1 = a tope). */
const ENCENDIDO_EN_REPOSO = 0.4;
/** Constantes de tiempo (ms) del suavizado: más bajas, más rápido responde. */
const TIEMPO_SEGUIR = 90;
const TIEMPO_SOLTAR = 320;
/** Posición fija de la luz cuando se pide reducir el movimiento. */
const LUZ_QUIETA = { x: 0.32, y: 0.28 };

const limitar = (n: number) => Math.min(1, Math.max(0, n));

export function Holograma({
  children,
  sampleTitle = "Hologram",
  sampleSubtitle = "Founder's edition · one-of-a-kind foil",
  width = 300,
  height = 420,
  maxTilt = 16,
  scale = 1.04,
  foil = 0.9,
  glare = 0.7,
  hue = 0,
  perspective = 900,
  radius = 22,
  idleAnimation = true,
  className = "",
  style,
}: HologramaProps) {
  const zona = useRef<HTMLDivElement>(null);
  // Se leen dentro del bucle de animación, así cambiarlos en vivo no lo reinicia.
  const ajustes = useRef({ maxTilt, scale, idleAnimation });
  const despertarBucle = useRef<() => void>(undefined);

  useEffect(() => {
    ajustes.current = { maxTilt, scale, idleAnimation };
    despertarBucle.current?.(); // si el bucle estaba dormido, que lea los ajustes nuevos
  }, [maxTilt, scale, idleAnimation]);

  useEffect(() => {
    const area = zona.current;
    if (!area) return;

    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // `luz` es lo que se está dibujando (ya suavizado): posición de 0 a 1 y cuánto
    // "encima" está el cursor. `puntero` es hacia dónde se dirige, o null si no hay.
    const luz = { x: 0.5, y: 0.5, sobre: 0 };
    let puntero: { x: number; y: number } | null = null;
    let cuadro = 0;
    let ultimoCuadro = 0;
    let visible = true;

    /** Pasa el estado de la luz a variables CSS; ahí lo usan la inclinación y las capas. */
    const escribir = () => {
      const { maxTilt: inclinacion, scale: crecer } = ajustes.current;
      const encendido = ENCENDIDO_EN_REPOSO + (1 - ENCENDIDO_EN_REPOSO) * luz.sobre;
      const giroY = reducido ? 0 : (luz.x - 0.5) * 2 * inclinacion; // la tarjeta "mira" al cursor
      const giroX = reducido ? 0 : (0.5 - luz.y) * 2 * inclinacion;
      const estilo = area.style;
      estilo.setProperty("--furin-holograma-x", `${(luz.x * 100).toFixed(2)}%`);
      estilo.setProperty("--furin-holograma-y", `${(luz.y * 100).toFixed(2)}%`);
      estilo.setProperty("--furin-holograma-giro-x", `${giroX.toFixed(2)}deg`);
      estilo.setProperty("--furin-holograma-giro-y", `${giroY.toFixed(2)}deg`);
      estilo.setProperty("--furin-holograma-crecer", (1 + (crecer - 1) * luz.sobre).toFixed(4));
      estilo.setProperty("--furin-holograma-encendido", encendido.toFixed(3));
      estilo.setProperty("--furin-holograma-angulo", `${(luz.x * 220 + luz.y * 140).toFixed(1)}deg`);
      // Desplazamiento de las capas profundas del ejemplo (efecto de paralaje).
      estilo.setProperty("--furin-holograma-paralaje-x", `${((luz.x - 0.5) * -14).toFixed(2)}px`);
      estilo.setProperty("--furin-holograma-paralaje-y", `${((luz.y - 0.5) * -14).toFixed(2)}px`);
      // La sombra se corre al lado contrario de la inclinación.
      estilo.setProperty("--furin-holograma-sombra-x", `${(-giroY * 1.2).toFixed(1)}px`);
      estilo.setProperty("--furin-holograma-sombra-y", `${(26 + giroX * 1.2).toFixed(1)}px`);
    };

    if (reducido) {
      // Versión quieta: la tarjeta no se inclina ni se mueve, pero conserva su lámina.
      luz.x = LUZ_QUIETA.x;
      luz.y = LUZ_QUIETA.y;
      luz.sobre = 0.4;
      escribir();
      return;
    }

    const objetivo = (ahora: number) => {
      if (puntero) return { x: puntero.x, y: puntero.y, sobre: 1 };
      if (ajustes.current.idleAnimation) {
        // Sin cursor, la luz dibuja una órbita lenta alrededor del centro.
        return { x: 0.5 + 0.26 * Math.sin(ahora / 1700), y: 0.45 + 0.2 * Math.sin(ahora / 2300 + 1.2), sobre: 0 };
      }
      return { x: 0.5, y: 0.5, sobre: 0 };
    };

    const paso = (ahora: number) => {
      const dt = Math.min(ahora - ultimoCuadro, 64);
      ultimoCuadro = ahora;

      // Suavizado exponencial: sigue al cursor rápido y regresa al centro con calma.
      const meta = objetivo(ahora);
      const factor = 1 - Math.exp(-dt / (puntero ? TIEMPO_SEGUIR : TIEMPO_SOLTAR));
      luz.x += (meta.x - luz.x) * factor;
      luz.y += (meta.y - luz.y) * factor;
      luz.sobre += (meta.sobre - luz.sobre) * factor;
      escribir();

      const asentada =
        Math.abs(meta.x - luz.x) < 0.0005 && Math.abs(meta.y - luz.y) < 0.0005 && Math.abs(meta.sobre - luz.sobre) < 0.0005;
      const sigueMoviendose = puntero !== null || ajustes.current.idleAnimation || !asentada;
      cuadro = visible && sigueMoviendose ? requestAnimationFrame(paso) : 0;
    };

    const despertar = () => {
      if (cuadro !== 0 || !visible) return;
      ultimoCuadro = performance.now();
      cuadro = requestAnimationFrame(paso);
    };

    despertarBucle.current = despertar;

    const alMover = (e: PointerEvent) => {
      const caja = area.getBoundingClientRect();
      puntero = { x: limitar((e.clientX - caja.left) / caja.width), y: limitar((e.clientY - caja.top) / caja.height) };
      despertar();
    };
    const alSalir = () => {
      puntero = null;
      despertar();
    };

    // Fuera de pantalla el bucle se detiene (se retoma al volver a verse).
    const observador = new IntersectionObserver(([entrada]) => {
      visible = entrada.isIntersecting;
      if (visible) despertar();
    });
    observador.observe(area);

    area.addEventListener("pointerenter", alMover);
    area.addEventListener("pointermove", alMover);
    area.addEventListener("pointerleave", alSalir);
    area.addEventListener("pointercancel", alSalir);
    escribir();
    despertar();

    return () => {
      despertarBucle.current = undefined;
      cancelAnimationFrame(cuadro);
      observador.disconnect();
      area.removeEventListener("pointerenter", alMover);
      area.removeEventListener("pointermove", alMover);
      area.removeEventListener("pointerleave", alSalir);
      area.removeEventListener("pointercancel", alSalir);
    };
  }, []);

  const variables = {
    width,
    height,
    "--furin-holograma-perspectiva": `${perspective}px`,
    "--furin-holograma-radio": `${radius}px`,
    "--furin-holograma-lamina": foil,
    "--furin-holograma-brillo": glare,
    "--furin-holograma-tono": `${hue}deg`,
    ...style,
  } as CSSProperties;

  return (
    <div ref={zona} className={`furin-holograma ${className}`.trim()} style={variables}>
      <div className="furin-holograma__aura" aria-hidden="true" />
      <div className="furin-holograma__tarjeta">
        <div className="furin-holograma__contenido">{children ?? <TarjetaDeEjemplo title={sampleTitle} subtitle={sampleSubtitle} />}</div>
        <div className="furin-holograma__capa furin-holograma__arcoiris" aria-hidden="true" />
        <div className="furin-holograma__capa furin-holograma__prisma" aria-hidden="true" />
        <div className="furin-holograma__capa furin-holograma__rejilla" aria-hidden="true" />
        <div className="furin-holograma__capa furin-holograma__destellos" aria-hidden="true" />
        <div className="furin-holograma__capa furin-holograma__brillo" aria-hidden="true" />
        <div className="furin-holograma__capa furin-holograma__borde" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Tarjeta coleccionable que se muestra cuando no se pasa `children`. */
function TarjetaDeEjemplo({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="furin-holograma__ejemplo">
      <header className="furin-holograma__cabecera">
        <span className="furin-holograma__marca">Furin</span>
        <span className="furin-holograma__etiqueta">Pro</span>
      </header>

      <div className="furin-holograma__arte">
        <svg viewBox="0 0 240 150" role="img" aria-label="Furin emblem">
          <g className="furin-holograma__fondo-arte" fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1">
            <circle cx="120" cy="75" r="22" />
            <circle cx="120" cy="75" r="40" />
            <circle cx="120" cy="75" r="58" />
            <circle cx="120" cy="75" r="76" />
            <path d="M0 75H240M120 0V150" strokeOpacity="0.2" />
            <path d="M120 17 L178 75 L120 133 L62 75 Z" strokeOpacity="0.45" />
          </g>
          <g className="furin-holograma__emblema">
            {/* "F" de furin: asta vertical y dos brazos, el de abajo más corto. */}
            <path
              d="M100 110 V44 H146 M100 76 H134"
              fill="none"
              stroke="#ffffff"
              strokeWidth="9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="146" cy="110" r="5" fill="#ffffff" />
          </g>
          <g fill="#ffffff">
            <circle cx="198" cy="75" r="3" />
            <circle cx="42" cy="75" r="2" fillOpacity="0.7" />
            <circle cx="120" cy="17" r="2" fillOpacity="0.7" />
            <circle cx="162" cy="33" r="1.6" fillOpacity="0.6" />
          </g>
        </svg>
      </div>

      <div className="furin-holograma__titulo">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>

      <footer className="furin-holograma__pie">
        <span>Furin · Pro</span>
        <span className="furin-holograma__numero">001/100</span>
      </footer>
    </div>
  );
}

export default Holograma;
