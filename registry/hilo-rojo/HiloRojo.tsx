"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./HiloRojo.css";

/** Dónde se amarra el otro extremo del hilo. */
export type ThreadAnchor =
  | "none"
  | "center"
  | "top"
  /** Punto fijo dentro del contenedor, en fracciones de 0 a 1: { x: 0.5, y: 0 } es el centro del borde de arriba. */
  | { x: number; y: number };

export interface HiloRojoProps {
  /** Contenido opcional del contenedor; el hilo se dibuja por encima sin bloquear los clics. */
  children?: ReactNode;
  /** Color del hilo. */
  color?: string;
  /** Cuántos tramos tiene el hilo: más tramos, curvas más suaves y más cálculo. */
  segments?: number;
  /** Grosor del hilo en px. */
  thickness?: number;
  /** Fuerza de la gravedad en px/s²: 0 flota, más alta cuelga más pesado. */
  gravity?: number;
  /** Qué tan inextensible es el hilo, de 0.05 (elástico) a 1 (no se estira). */
  stiffness?: number;
  /** Extremo fijo: "none" (el hilo solo sigue al cursor), "center", "top" o un punto { x, y } en fracciones de 0 a 1. */
  anchor?: ThreadAnchor;
  /** Largo total del hilo en px; 0 lo calcula según el tamaño del contenedor. */
  length?: number;
  /** Intensidad del brillo alrededor del hilo, de 0 a 1. */
  glow?: number;
  /** Clase CSS extra para el contenedor. */
  className?: string;
  /** Estilos en línea del contenedor. */
  style?: CSSProperties;
}

/** Un punto del hilo en integración de Verlet: guarda dónde está y dónde estaba. */
interface Punto {
  x: number;
  y: number;
  anteriorX: number;
  anteriorY: number;
}

/** La física avanza en pasos fijos para que el hilo se comporte igual a 60 y a 144 Hz. */
const PASO = 1 / 120;
/** Vueltas del solucionador de restricciones por paso: más vueltas, hilo más firme. */
const ITERACIONES = 14;
/** Frenado del aire por segundo: sin él el hilo ondularía para siempre. */
const AMORTIGUACION = 2.2;
/** Cuánto tarda la punta en alcanzar al cursor (s); con cursor ausente, la deriva es más lenta. */
const TIEMPO_SEGUIR = 0.05;
const TIEMPO_DERIVA = 0.35;
/** Si un cuadro tarda más que esto (pestaña dormida), se recorta para no dar un salto. */
const DT_MAXIMO = 1 / 30;

export function HiloRojo({
  children,
  color = "#E8452C",
  segments = 28,
  thickness = 3,
  gravity = 1400,
  stiffness = 0.95,
  anchor = "top",
  length = 0,
  glow = 0.7,
  className = "",
  style,
}: HiloRojoProps) {
  const contenedor = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  // Se leen dentro del bucle, así cambiarlos en vivo no reinicia el hilo.
  const ajustes = useRef({ color, thickness, gravity, stiffness, anchor, length, glow });

  useEffect(() => {
    ajustes.current = { color, thickness, gravity, stiffness, anchor, length, glow };
  }, [color, thickness, gravity, stiffness, anchor, length, glow]);

  useEffect(() => {
    const caja = contenedor.current;
    const canvas = lienzo.current;
    const ctx = canvas?.getContext("2d");
    if (!caja || !canvas || !ctx) return;

    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = Math.max(2, Math.round(segments));

    let ancho = 0;
    let alto = 0;
    let cuadro = 0;
    let ultimo = 0;
    let acumulado = 0;
    let visible = true;
    /** Posición del cursor dentro del contenedor, o null si está fuera. */
    let cursor: { x: number; y: number } | null = null;
    const puntos: Punto[] = [];

    /** Largo de cada tramo, según la prop `length` o el tamaño del contenedor. */
    const largoTramo = () => {
      const { length: largo } = ajustes.current;
      const base = largo > 0 ? largo : Math.min(640, Math.max(100, Math.min(ancho, alto) * 0.75));
      return base / total;
    };

    /** Punto donde está amarrado el extremo fijo, o null si el hilo va suelto. */
    const posicionAncla = (): { x: number; y: number } | null => {
      const a = ajustes.current.anchor;
      if (a === "none") return null;
      if (a === "top") return { x: ancho / 2, y: Math.min(alto * 0.05, 24) };
      if (a === "center") return { x: ancho / 2, y: alto / 2 };
      return { x: a.x * ancho, y: a.y * alto };
    };

    /** A dónde quiere ir la punta: al cursor, o, sin cursor, a una deriva lenta para que siempre esté viva. */
    const objetivo = (ahora: number): { x: number; y: number; deriva: boolean } => {
      if (cursor) return { ...cursor, deriva: false };
      const ancla = posicionAncla();
      const alcance = largoTramo() * total;
      if (ancla) {
        return {
          x: ancla.x + alcance * 0.72 * Math.sin(ahora / 1500) + alcance * 0.12 * Math.sin(ahora / 530),
          y: ancla.y + alcance * 0.42 * Math.sin(ahora / 2300 + 1.1) + alcance * 0.3,
          deriva: true,
        };
      }
      return {
        x: ancho * 0.5 + ancho * 0.3 * Math.sin(ahora / 1700) + ancho * 0.06 * Math.sin(ahora / 620),
        y: alto * 0.42 + alto * 0.22 * Math.sin(ahora / 2100 + 0.8),
        deriva: true,
      };
    };

    /**
     * Coloca el hilo colgando recto desde (x, y). Con ancla, el extremo fijo queda arriba y
     * la punta abajo; sin ancla, la punta queda arriba y la cola cuelga de ella.
     */
    const reiniciar = (x: number, y: number) => {
      puntos.length = 0;
      const tramo = largoTramo();
      const conAncla = ajustes.current.anchor !== "none";
      for (let i = 0; i <= total; i++) {
        const py = y + (conAncla ? i : total - i) * tramo;
        puntos.push({ x, y: py, anteriorX: x, anteriorY: py });
      }
    };

    /** Avanza la física un paso fijo hacia el objetivo `deseo` de la punta. */
    const simular = (h: number, deseo: { x: number; y: number; deriva: boolean }) => {
      const { gravity: g, stiffness: dureza } = ajustes.current;
      const tramo = largoTramo();
      const anclaFija = posicionAncla();
      const cabeza = puntos[total];
      const cola = puntos[0];

      // 1. La cabeza se mueve (cinemática) hacia el objetivo, sin pasarse del largo si hay ancla.
      let destinoX = deseo.x;
      let destinoY = deseo.y;
      if (anclaFija) {
        const dx = destinoX - anclaFija.x;
        const dy = destinoY - anclaFija.y;
        const distancia = Math.hypot(dx, dy);
        const maximo = tramo * total;
        if (distancia > maximo) {
          destinoX = anclaFija.x + (dx / distancia) * maximo;
          destinoY = anclaFija.y + (dy / distancia) * maximo;
        }
      }
      const suavizado = 1 - Math.exp(-h / (deseo.deriva ? TIEMPO_DERIVA : TIEMPO_SEGUIR));
      cabeza.anteriorX = cabeza.x;
      cabeza.anteriorY = cabeza.y;
      cabeza.x += (destinoX - cabeza.x) * suavizado;
      cabeza.y += (destinoY - cabeza.y) * suavizado;

      // 2. Los puntos libres se integran con Verlet: velocidad implícita + gravedad.
      const freno = Math.exp(-AMORTIGUACION * h);
      const inicio = anclaFija ? 1 : 0;
      for (let i = inicio; i < total; i++) {
        const p = puntos[i];
        const vx = (p.x - p.anteriorX) * freno;
        const vy = (p.y - p.anteriorY) * freno;
        p.anteriorX = p.x;
        p.anteriorY = p.y;
        p.x += vx;
        p.y += vy + g * h * h;
      }
      if (anclaFija) {
        cola.x = cola.anteriorX = anclaFija.x;
        cola.y = cola.anteriorY = anclaFija.y;
      }

      // 3. Restricciones de distancia: cada tramo intenta conservar su largo.
      //    La cabeza y el ancla pesan "infinito" (no se mueven por la restricción).
      for (let vuelta = 0; vuelta < ITERACIONES; vuelta++) {
        for (let k = 0; k < total; k++) {
          const i = vuelta % 2 === 0 ? k : total - 1 - k; // alternar el sentido evita sesgos
          const a = puntos[i];
          const b = puntos[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distancia = Math.hypot(dx, dy) || 1e-6;
          const error = ((distancia - tramo) / distancia) * dureza;
          const aFijo = i === 0 && anclaFija !== null;
          const bFijo = i + 1 === total;
          const peso = aFijo || bFijo ? 1 : 0.5;
          if (!aFijo) {
            a.x += dx * error * peso;
            a.y += dy * error * peso;
          }
          if (!bFijo) {
            b.x -= dx * error * peso;
            b.y -= dy * error * peso;
          }
        }
      }
    };

    /** Dibuja el hilo: halo, cuerpo con brillo y un nudo en la punta. */
    const dibujar = () => {
      const { color: tono, thickness: ancho_, glow: luz } = ajustes.current;
      ctx.clearRect(0, 0, ancho, alto);
      if (puntos.length < 2) return;

      const trazar = () => {
        ctx.beginPath();
        ctx.moveTo(puntos[0].x, puntos[0].y);
        // Curva suave: cada punto es el control de una cuadrática entre puntos medios.
        for (let i = 1; i < puntos.length - 1; i++) {
          const p = puntos[i];
          const q = puntos[i + 1];
          ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
        }
        const fin = puntos[puntos.length - 1];
        ctx.lineTo(fin.x, fin.y);
      };

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Halo suave.
      if (luz > 0) {
        ctx.save();
        ctx.globalAlpha = 0.22 * luz;
        ctx.strokeStyle = tono;
        ctx.lineWidth = ancho_ * 5;
        ctx.shadowColor = tono;
        ctx.shadowBlur = 16 * luz;
        trazar();
        ctx.stroke();
        ctx.restore();
      }

      // Cuerpo del hilo.
      ctx.strokeStyle = tono;
      ctx.lineWidth = ancho_;
      trazar();
      ctx.stroke();

      // Hebra clara: da volumen de hilo trenzado.
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(0.6, ancho_ * 0.32);
      ctx.translate(-ancho_ * 0.14, -ancho_ * 0.14);
      trazar();
      ctx.stroke();
      ctx.restore();

      // Nudo en la punta que sigue al cursor.
      const cabeza = puntos[puntos.length - 1];
      ctx.save();
      ctx.shadowColor = tono;
      ctx.shadowBlur = 14 * luz;
      ctx.fillStyle = tono;
      ctx.beginPath();
      ctx.arc(cabeza.x, cabeza.y, ancho_ * 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(cabeza.x - ancho_ * 0.55, cabeza.y - ancho_ * 0.6, ancho_ * 0.55, 0, Math.PI * 2);
      ctx.fill();

      // Y un pequeño nudo donde está amarrado.
      const fijo = posicionAncla();
      if (fijo) {
        ctx.fillStyle = tono;
        ctx.beginPath();
        ctx.arc(fijo.x, fijo.y, ancho_ * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.beginPath();
        ctx.arc(fijo.x - ancho_ * 0.4, fijo.y - ancho_ * 0.45, ancho_ * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    /** Ajusta el lienzo al contenedor y a la densidad de píxeles (tope 2). */
    const medir = () => {
      // clientWidth/Height no cambian si algún ancestro escala el contenedor con CSS (miniaturas).
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ancho = Math.max(1, caja.clientWidth);
      alto = Math.max(1, caja.clientHeight);
      canvas.width = Math.round(ancho * dpr);
      canvas.height = Math.round(alto * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (puntos.length === 0) {
        const inicio = posicionAncla() ?? { x: ancho / 2, y: alto * 0.3 };
        reiniciar(inicio.x, inicio.y);
        if (reducido) asentar();
      }
      if (reducido) dibujar();
    };

    /** Versión quieta (movimiento reducido): el hilo cuelga en reposo y se dibuja una sola vez. */
    function asentar() {
      const ancla = posicionAncla();
      const tramo = largoTramo();
      const inicio = ancla ?? { x: ancho / 2, y: alto * 0.28 };
      // Con ancla la cabeza queda a un lado, para que se vea la curva del hilo.
      const deseo = ancla
        ? { x: inicio.x + tramo * total * 0.55, y: inicio.y + tramo * total * 0.1, deriva: false }
        : { x: inicio.x, y: inicio.y, deriva: false };
      reiniciar(inicio.x, inicio.y);
      for (let i = 0; i < 600; i++) simular(PASO, deseo);
    }

    const paso = (ahora: number) => {
      const dt = Math.min((ahora - ultimo) / 1000, DT_MAXIMO);
      ultimo = ahora;
      acumulado += dt;
      const deseo = objetivo(ahora);
      while (acumulado >= PASO) {
        simular(PASO, deseo);
        acumulado -= PASO;
      }
      dibujar();
      cuadro = visible ? requestAnimationFrame(paso) : 0;
    };

    const despertar = () => {
      if (cuadro !== 0 || !visible || reducido) return;
      ultimo = performance.now();
      cuadro = requestAnimationFrame(paso);
    };

    // El canvas no recibe eventos (no bloquea clics): el cursor se lee en la ventana.
    const alMover = (e: PointerEvent) => {
      const area = caja.getBoundingClientRect();
      const dentro = e.clientX >= area.left && e.clientX <= area.right && e.clientY >= area.top && e.clientY <= area.bottom;
      // Si el contenedor está escalado por CSS, las coordenadas se pasan a las unidades del lienzo.
      const escala = area.width > 0 ? ancho / area.width : 1;
      cursor = dentro ? { x: (e.clientX - area.left) * escala, y: (e.clientY - area.top) * escala } : null;
    };
    const soltar = () => {
      cursor = null;
    };
    // En pantallas táctiles no hay cursor flotando: al levantar el dedo el hilo se suelta.
    const alLevantar = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") cursor = null;
    };

    const observadorTamano = new ResizeObserver(medir);
    observadorTamano.observe(caja);
    const observadorVista = new IntersectionObserver(([entrada]) => {
      visible = entrada.isIntersecting;
      if (visible) despertar();
    });
    observadorVista.observe(caja);

    medir();

    if (!reducido) {
      window.addEventListener("pointermove", alMover, { passive: true });
      window.addEventListener("pointerdown", alMover, { passive: true });
      window.addEventListener("pointerup", alLevantar, { passive: true });
      window.addEventListener("pointercancel", soltar, { passive: true });
      document.documentElement.addEventListener("pointerleave", soltar, { passive: true });
      despertar();
    }

    return () => {
      cancelAnimationFrame(cuadro);
      observadorTamano.disconnect();
      observadorVista.disconnect();
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerdown", alMover);
      window.removeEventListener("pointerup", alLevantar);
      window.removeEventListener("pointercancel", soltar);
      document.documentElement.removeEventListener("pointerleave", soltar);
    };
  }, [segments]);

  return (
    <div ref={contenedor} className={`furin-hilo-rojo ${className}`.trim()} style={style}>
      {children ? <div className="furin-hilo-rojo__contenido">{children}</div> : null}
      <canvas ref={lienzo} className="furin-hilo-rojo__lienzo" aria-hidden="true" />
    </div>
  );
}

export default HiloRojo;
