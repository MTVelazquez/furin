"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./RejillaViva.css";

export interface RejillaVivaProps {
  /** Distancia entre un punto y el siguiente, en px. */
  spacing?: number;
  /** Diámetro de cada punto en reposo, en px. */
  dotSize?: number;
  /** Radio de influencia del cursor (o del dedo), en px. */
  radius?: number;
  /** Cuánto se apartan los puntos del cursor: 1 es casi un espacio entero. */
  strength?: number;
  /** Color de los puntos en reposo (cualquier color CSS, sin variables). */
  baseColor?: string;
  /** Color de los puntos que el cursor ilumina. */
  activeColor?: string;
  /** Si no hay cursor, lanza de vez en cuando una onda suave para que la rejilla no se vea muerta. */
  ambientWave?: boolean;
  /**
   * Dónde escucha el cursor: en su contenedor ("parent") o en toda la ventana ("window"). Usa "window" cuando la
   * rejilla es el fondo de una sección con contenido encima, para que reaccione aunque el cursor pase sobre ese contenido.
   */
  listenTo?: "parent" | "window";
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
  /** Contenido que se dibuja encima de la rejilla, centrado. */
  children?: ReactNode;
}

type Rgba = [number, number, number, number];

/** Valores que el bucle de dibujo lee en cada cuadro (así cambiar una prop no reconstruye la rejilla). */
interface LiveValues {
  dotSize: number;
  radius: number;
  strength: number;
  base: Rgba;
  active: Rgba;
  ambientWave: boolean;
  /** Mancha de luz suave ya pintada, que se dibuja detrás de los puntos encendidos. */
  halo: HTMLCanvasElement | null;
}

/** Rigidez y amortiguación del resorte: algo subamortiguado, así los puntos "rebotan" un poco al volver. */
const SPRING = 190;
const DAMPING = 15;
/** Cuánto crece un punto con la luz al máximo (1.6 = 2.6 veces su tamaño). */
const GROW = 1.6;
/** La onda ambiental: velocidad y grosor del anillo, en px. */
const WAVE_SPEED = 420;
const WAVE_WIDTH = 90;
const MAX_DPR = 2;
const TAU = Math.PI * 2;

let colorContext: CanvasRenderingContext2D | null = null;

/** Convierte cualquier color CSS a [r, g, b, a] (r, g y b de 0 a 255, a de 0 a 1). */
function toRgba(color: string): Rgba {
  colorContext ??= document.createElement("canvas").getContext("2d");
  if (!colorContext) return [0, 0, 0, 1];
  colorContext.fillStyle = "#000000";
  colorContext.fillStyle = color; // si el color no es válido se queda en negro
  const normalized = colorContext.fillStyle; // "#rrggbb" o "rgba(r, g, b, a)"
  if (normalized.startsWith("#")) {
    const n = parseInt(normalized.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 1];
  }
  const [r, g, b, a = 1] = normalized.match(/[\d.]+/g)!.map(Number);
  return [r, g, b, a];
}

/** Pinta una vez la mancha de luz del color activo: dibujar una imagen es más barato que un degradado por punto. */
function paintHalo(color: Rgba): HTMLCanvasElement {
  const size = 64;
  const halo = document.createElement("canvas");
  halo.width = halo.height = size;
  const g = halo.getContext("2d")!;
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const [r, green, b] = color.map(Math.round);
  gradient.addColorStop(0, `rgba(${r}, ${green}, ${b}, 0.85)`);
  gradient.addColorStop(0.35, `rgba(${r}, ${green}, ${b}, 0.3)`);
  gradient.addColorStop(1, `rgba(${r}, ${green}, ${b}, 0)`);
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  return halo;
}

const css = ([r, g, b, a]: Rgba) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(3)})`;

/** Mezcla dos colores: amount 0 da `from`, 1 da `to`. */
const mix = (from: Rgba, to: Rgba, amount: number): Rgba => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount,
  from[3] + (to[3] - from[3]) * amount,
];

/** Rejilla de puntos que se aparta y se ilumina alrededor del cursor. Llena a su padre, que debe tener position: relative. */
export function RejillaViva({
  spacing = 28,
  dotSize = 3,
  radius = 170,
  strength = 1,
  baseColor = "#4A4A62",
  activeColor = "#8C9BFF",
  ambientWave = true,
  listenTo = "parent",
  className = "",
  style,
  children,
}: RejillaVivaProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<LiveValues>({ dotSize, radius, strength, base: [0, 0, 0, 1], active: [0, 0, 0, 1], ambientWave, halo: null });
  const refresh = useRef<() => void>(() => {});

  // Pasa las props actuales al bucle de dibujo y lo despierta si estaba dormido.
  useEffect(() => {
    const active = toRgba(activeColor);
    live.current = { dotSize, radius, strength, base: toRgba(baseColor), active, ambientWave, halo: paintHalo(active) };
    refresh.current();
  }, [dotSize, radius, strength, baseColor, activeColor, ambientWave]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!root || !canvas || !ctx) return;

    // Los eventos se escuchan en el padre: así reacciona aunque haya contenido encima de la rejilla.
    const host = root.parentElement ?? root;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const gap = Math.max(8, spacing);

    let width = 0;
    let height = 0;
    let count = 0;
    // Un arreglo por dato (en vez de un objeto por punto) para no generar basura en cada cuadro.
    let homeX = new Float32Array(0); // posición de reposo
    let homeY = new Float32Array(0);
    let offX = new Float32Array(0); // desplazamiento actual respecto al reposo
    let offY = new Float32Array(0);
    let velX = new Float32Array(0); // velocidad del resorte
    let velY = new Float32Array(0);
    let glow = new Float32Array(0); // 0 = apagado, 1 = encendido al máximo

    const pointer = { x: 0, y: 0, active: false };
    const wave = { active: false, x: 0, y: 0, r: 0, maxR: 0 };
    let nextWaveAt = performance.now() + 900;
    let visible = true;
    let frameId = 0;
    let timerId = 0;
    let lastNow = 0;

    /** Coloca los puntos en una rejilla centrada que respeta un margen de medio espacio. */
    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = root.clientWidth;
      height = root.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cols = Math.max(1, Math.floor(width / gap));
      const rows = Math.max(1, Math.floor(height / gap));
      count = cols * rows;
      homeX = new Float32Array(count);
      homeY = new Float32Array(count);
      offX = new Float32Array(count);
      offY = new Float32Array(count);
      velX = new Float32Array(count);
      velY = new Float32Array(count);
      glow = new Float32Array(count);
      const startX = (width - (cols - 1) * gap) / 2;
      const startY = (height - (rows - 1) * gap) / 2;
      for (let i = 0; i < count; i++) {
        homeX[i] = startX + (i % cols) * gap;
        homeY[i] = startY + Math.floor(i / cols) * gap;
      }
    };

    /** Avanza la física. Devuelve true mientras algo siga moviéndose. */
    const step = (dt: number): boolean => {
      const { radius, strength } = live.current;
      const radiusSq = radius * radius;
      const maxPush = gap * 0.95 * strength;
      const glowUp = 1 - Math.exp(-dt * 16); // se enciende rápido…
      const glowDown = 1 - Math.exp(-dt * 4.5); // …y se apaga despacio
      let moving = false;

      if (wave.active) {
        wave.r += WAVE_SPEED * dt;
        if (wave.r > wave.maxR) {
          wave.active = false;
          nextWaveAt = performance.now() + 4000 + Math.random() * 3000;
        }
      }

      for (let i = 0; i < count; i++) {
        let targetX = 0;
        let targetY = 0;
        let targetGlow = 0;

        if (pointer.active) {
          const dx = homeX[i] - pointer.x;
          const dy = homeY[i] - pointer.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < radiusSq) {
            const dist = Math.sqrt(distSq);
            const near = 1 - dist / radius; // 1 junto al cursor, 0 en el borde del radio
            const push = near * near * maxPush;
            const inv = dist > 0.001 ? 1 / dist : 0;
            targetX = dx * inv * push;
            targetY = dy * inv * push;
            targetGlow = near * near * (3 - 2 * near);
          }
        }

        if (wave.active) {
          const dx = homeX[i] - wave.x;
          const dy = homeY[i] - wave.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const band = (dist - wave.r) / WAVE_WIDTH;
          const lift = Math.exp(-band * band);
          if (lift > 0.01) {
            const inv = dist > 0.001 ? 1 / dist : 0;
            targetX += dx * inv * lift * maxPush * 0.3;
            targetY += dy * inv * lift * maxPush * 0.3;
            targetGlow = Math.max(targetGlow, lift * 0.85);
          }
        }

        // Punto en reposo y sin nada que lo mueva: no hay que calcular nada.
        if (targetGlow === 0 && glow[i] === 0 && offX[i] === 0 && offY[i] === 0) continue;

        // Resorte hacia el desplazamiento objetivo.
        velX[i] += ((targetX - offX[i]) * SPRING - velX[i] * DAMPING) * dt;
        velY[i] += ((targetY - offY[i]) * SPRING - velY[i] * DAMPING) * dt;
        offX[i] += velX[i] * dt;
        offY[i] += velY[i] * dt;
        glow[i] += (targetGlow - glow[i]) * (targetGlow > glow[i] ? glowUp : glowDown);

        const error = Math.abs(targetX - offX[i]) + Math.abs(targetY - offY[i]) + Math.abs(velX[i]) + Math.abs(velY[i]);
        const glowError = Math.abs(targetGlow - glow[i]);
        if (error > 0.04 || glowError > 0.004) {
          moving = true;
        } else if (targetGlow === 0 && targetX === 0 && targetY === 0) {
          // Ya volvió: se deja exactamente en reposo.
          offX[i] = offY[i] = velX[i] = velY[i] = glow[i] = 0;
        }
      }
      return moving || wave.active;
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const { dotSize, base, active, halo } = live.current;
      const baseRadius = dotSize / 2;

      // Los puntos en reposo son la gran mayoría: se dibujan todos juntos en un solo trazo.
      ctx.fillStyle = css(base);
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        if (glow[i] !== 0 || offX[i] !== 0 || offY[i] !== 0) continue;
        ctx.moveTo(homeX[i] + baseRadius, homeY[i]);
        ctx.arc(homeX[i], homeY[i], baseRadius, 0, TAU);
      }
      ctx.fill();

      // Los puntos tocados por la luz, uno por uno, con su color y tamaño propios.
      for (let i = 0; i < count; i++) {
        const light = glow[i];
        if (light === 0 && offX[i] === 0 && offY[i] === 0) continue;
        const x = homeX[i] + offX[i];
        const y = homeY[i] + offY[i];
        const dotRadius = baseRadius * (1 + light * GROW);
        if (halo && light > 0.05) {
          // Mancha de luz suave detrás del punto.
          const haloRadius = dotRadius * 4.2;
          ctx.globalAlpha = light * 0.55;
          ctx.drawImage(halo, x - haloRadius, y - haloRadius, haloRadius * 2, haloRadius * 2);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = css(mix(base, active, light));
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, TAU);
        ctx.fill();
      }
    };

    /** Con movimiento reducido: una mancha de luz fija en la rejilla, sin animación. */
    const drawStill = () => {
      const lightRadius = Math.max(live.current.radius * 1.6, Math.min(width, height) * 0.4);
      for (let i = 0; i < count; i++) {
        const near = Math.max(0, 1 - Math.hypot(homeX[i] - width * 0.5, homeY[i] - height * 0.45) / lightRadius);
        glow[i] = near * near * (3 - 2 * near);
      }
      draw();
    };

    const frame = (now: number) => {
      frameId = 0;
      const dt = Math.min((now - lastNow) / 1000, 1 / 30);
      lastNow = now;
      const busy = step(dt);
      draw();
      if (busy) frameId = requestAnimationFrame(frame);
      else scheduleWave();
    };

    /** Despierta el bucle. Cuando todo está quieto el bucle se duerme y no gasta nada. */
    const wake = () => {
      if (frameId || !visible || reducedMotion.matches) return;
      window.clearTimeout(timerId);
      timerId = 0;
      lastNow = performance.now();
      frameId = requestAnimationFrame(frame);
    };

    /** Con todo en reposo, programa la próxima onda ambiental. */
    const scheduleWave = () => {
      if (timerId || !live.current.ambientWave || pointer.active) return;
      timerId = window.setTimeout(() => {
        timerId = 0;
        if (pointer.active || !live.current.ambientWave) return;
        wave.x = width * (0.25 + Math.random() * 0.5);
        wave.y = height * (0.25 + Math.random() * 0.5);
        wave.r = 0;
        wave.maxR = Math.hypot(width, height) + WAVE_WIDTH * 2;
        wave.active = true;
        wake();
      }, Math.max(0, nextWaveAt - performance.now()));
    };

    const sleep = () => {
      cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
      frameId = 0;
      timerId = 0;
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      // Escuchando la ventana, el cursor fuera de la rejilla cuenta como "irse".
      if (listenTo === "window" && (x < 0 || y < 0 || x > rect.width || y > rect.height)) {
        if (pointer.active) onPointerLeave();
        return;
      }
      pointer.x = x;
      pointer.y = y;
      pointer.active = true;
      wake();
    };
    const onPointerLeave = () => {
      pointer.active = false;
      nextWaveAt = performance.now() + 2500;
      wake();
    };
    // Con el dedo, soltar es "irse"; con el mouse solo cuenta salir del padre.
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") onPointerLeave();
    };

    const resizeObserver = new ResizeObserver(() => {
      layout();
      if (reducedMotion.matches) drawStill();
      else {
        draw();
        wake();
      }
    });
    resizeObserver.observe(root);

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
      else sleep();
    });
    visibilityObserver.observe(root);

    const applyMotionPreference = () => {
      if (reducedMotion.matches) {
        sleep();
        pointer.active = false;
        wave.active = false;
        drawStill();
      } else {
        glow.fill(0);
        draw();
        wake();
      }
    };
    reducedMotion.addEventListener("change", applyMotionPreference);

    // "window": el cursor se sigue en toda la página; salir del documento cuenta como "irse".
    const target: HTMLElement | Window = listenTo === "window" ? window : host;
    const leaveTarget: HTMLElement = listenTo === "window" ? document.documentElement : host;
    target.addEventListener("pointermove", onPointerMove as EventListener, { passive: true });
    target.addEventListener("pointerdown", onPointerMove as EventListener, { passive: true });
    target.addEventListener("pointerup", onPointerUp as EventListener);
    target.addEventListener("pointercancel", onPointerLeave);
    leaveTarget.addEventListener("pointerleave", onPointerLeave);

    refresh.current = () => (reducedMotion.matches ? drawStill() : wake());
    layout();
    if (reducedMotion.matches) drawStill();
    else {
      draw();
      wake();
    }

    return () => {
      sleep();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      reducedMotion.removeEventListener("change", applyMotionPreference);
      target.removeEventListener("pointermove", onPointerMove as EventListener);
      target.removeEventListener("pointerdown", onPointerMove as EventListener);
      target.removeEventListener("pointerup", onPointerUp as EventListener);
      target.removeEventListener("pointercancel", onPointerLeave);
      leaveTarget.removeEventListener("pointerleave", onPointerLeave);
      refresh.current = () => {};
    };
  }, [spacing, listenTo]);

  return (
    <div ref={rootRef} className={`furin-rejilla-viva ${className}`.trim()} style={style}>
      <canvas ref={canvasRef} className="furin-rejilla-viva__canvas" aria-hidden="true" />
      {children !== undefined && <div className="furin-rejilla-viva__content">{children}</div>}
    </div>
  );
}

export default RejillaViva;
