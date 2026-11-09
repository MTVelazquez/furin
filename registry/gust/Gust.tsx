"use client";
import { Fragment, useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import "./Gust.css";

export interface GustProps {
  /** Texto del titular: cada letra es una partícula que el viento puede arrancar. */
  text?: string;
  /** Fuerza de la ráfaga: qué tan lejos y qué tan rápido salen las letras; 0 apaga el viento. */
  strength?: number;
  /** Velocidad del cursor (px/s) a partir de la cual sopla; más lento no pasa nada. */
  threshold?: number;
  /** Segundos que tarda una letra en volver a su lugar. */
  recovery?: number;
  /** Radio de alcance de la ráfaga alrededor del cursor, en px. */
  radius?: number;
  /** Cuánto giran las letras al volar: 0 las deja sin girar. */
  spin?: number;
  /** Color de las letras (por defecto hereda el del texto). */
  color?: string;
  /** Color al que se tiñen las letras mientras vuelan (igual al del texto para apagarlo). */
  accent?: string;
  /** Clase CSS extra para el contenedor. */
  className?: string;
  /** Estilos en línea del contenedor (aquí va el tamaño y la fuente). */
  style?: CSSProperties;
}

/** Una letra convertida en partícula: su sitio fijo (cx, cy) y cuánto se ha desviado de él. */
interface Hoja {
  el: HTMLElement;
  /** Centro de la letra en su lugar, en px del contenedor. */
  cx: number;
  cy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  /** Rasgos propios de cada hoja para que no vuelen todas igual. */
  lift: number;
  side: number;
  phase: number;
  /** Segundos desde la última vez que el viento la tocó. */
  age: number;
  active: boolean;
}

interface LiveValues {
  strength: number;
  threshold: number;
  recovery: number;
  radius: number;
  spin: number;
}

const smoothstep = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const random = (min: number, max: number) => min + Math.random() * (max - min);

/** Radio (px) alrededor de un cursor lento donde la letra se asienta de inmediato. */
const SETTLE_RADIUS = 70;
/** Qué tan rápido, a lo sumo, vuela una letra (px/s). */
const MAX_FLIGHT = 1500;

/** Un titular cuyas letras se las lleva el viento del cursor como hojas y regresan a su lugar con resorte. */
export function Gust({
  text = "Let the wind carry them away",
  strength = 1,
  threshold = 650,
  recovery = 1.8,
  radius = 150,
  spin = 1,
  color,
  accent = "#E8452C",
  className = "",
  style,
}: GustProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const live = useRef<LiveValues>({ strength, threshold, recovery, radius, spin });

  useEffect(() => {
    live.current = { strength, threshold, recovery, radius, spin };
  }, [strength, threshold, recovery, radius, spin]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return; // el titular se queda quieto y entero

    // Los eventos se escuchan en el padre: el viento sopla aunque el cursor pase junto al texto.
    const host = root.parentElement ?? root;
    const leaves: Hoja[] = Array.from(root.querySelectorAll<HTMLElement>(".furin-gust__letra")).map((el) => ({
      el,
      cx: 0,
      cy: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      rot: 0,
      vrot: 0,
      lift: random(0.55, 1.35),
      side: random(-1, 1),
      phase: random(0, Math.PI * 2),
      age: 0,
      active: false,
    }));

    // Velocidad del puntero (px/s, en px de diseño) y por dónde anda.
    const pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false, lastTime: 0 };
    let visible = true;
    let frameId = 0;
    let lastNow = 0;
    let time = 0;
    /** Si un padre escala el titular (vista previa reducida), se convierte a px de diseño. */
    let scale = 1;

    /** Lee dónde está cada letra en reposo (los offsets ignoran los transform, así que no se contaminan). */
    const measure = () => {
      scale = root.offsetWidth > 0 ? root.getBoundingClientRect().width / root.offsetWidth : 1;
      for (const leaf of leaves) {
        leaf.cx = leaf.el.offsetLeft + leaf.el.offsetWidth / 2;
        leaf.cy = leaf.el.offsetTop + leaf.el.offsetHeight / 2;
      }
    };

    const rest = (leaf: Hoja) => {
      leaf.x = leaf.y = leaf.vx = leaf.vy = leaf.rot = leaf.vrot = 0;
      leaf.active = false;
      leaf.el.style.transform = "";
      leaf.el.style.removeProperty("--furin-gust-tinte");
    };

    const frame = (now: number) => {
      frameId = requestAnimationFrame(frame);
      const dt = Math.min((now - lastNow) / 1000, 0.05);
      lastNow = now;
      time += dt;
      const { strength: power, threshold: limit, recovery: seconds, radius: reach, spin: twist } = live.current;

      // El viento del cursor se apaga solo cuando el puntero se detiene.
      const fade = Math.exp(-dt * 6);
      pointer.vx *= fade;
      pointer.vy *= fade;
      if (Math.abs(pointer.vx) < 1 && Math.abs(pointer.vy) < 1) pointer.vx = pointer.vy = 0;
      const speed = Math.hypot(pointer.vx, pointer.vy);

      // Solo las ráfagas rápidas soplan: bajo el umbral no pasa nada, y se abre poco a poco hasta 1.6 veces el umbral.
      const gust = power > 0 ? smoothstep(limit, limit * 1.6, speed) : 0;
      const slowPointer = pointer.active && speed < limit;

      // Resorte con la frecuencia que da el tiempo de regreso (asentado en ~seconds, con un poco de rebote).
      const wn = 6 / Math.max(0.2, seconds);
      const steps = Math.max(1, Math.ceil(dt / 0.012));
      const h = dt / steps;
      let moving = false;

      for (const leaf of leaves) {
        if (gust > 0) {
          const dx = leaf.cx + leaf.x - pointer.x;
          const dy = leaf.cy + leaf.y - pointer.y;
          const near = clamp(1 - Math.hypot(dx, dy) / reach, 0, 1);
          if (near > 0) {
            // Cada hoja se deja llevar a su manera: más o menos fuerte y un poco de lado.
            const f = near * near * gust * power;
            const targetX = clamp(pointer.vx * 0.8 * leaf.lift - pointer.vy * 0.15 * leaf.side, -MAX_FLIGHT, MAX_FLIGHT);
            const targetY = clamp(pointer.vy * 0.8 * leaf.lift + pointer.vx * 0.15 * leaf.side - speed * 0.12 * leaf.lift, -MAX_FLIGHT, MAX_FLIGHT);
            const follow = 1 - Math.exp(-dt * 30 * Math.min(1, f));
            leaf.vx += (targetX * Math.min(1.4, f + 0.3) - leaf.vx) * follow;
            leaf.vy += (targetY * Math.min(1.4, f + 0.3) - leaf.vy) * follow;
            leaf.vrot += (pointer.vx * 0.006 * leaf.side + leaf.side * 2) * f * twist * dt * 14;
            leaf.age = 0;
            leaf.active = true;
          }
        }
        if (!leaf.active) continue;
        leaf.age += dt;

        // La hoja vuela libre un momento y después el resorte la trae de vuelta; un cursor lento encima la asienta ya.
        const pull = smoothstep(seconds * 0.12, seconds * 0.65, leaf.age);
        const here = slowPointer && Math.hypot(leaf.cx + leaf.x - pointer.x, leaf.cy + leaf.y - pointer.y) < SETTLE_RADIUS;
        const stiff = here ? 1 : 0.05 + 0.95 * pull;
        const k = wn * wn * stiff;
        const c = 2 * wn * (0.15 + 0.55 * stiff);
        const flight = 1 - pull;

        for (let s = 0; s < steps; s++) {
          // Aleteo lateral y un poco de caída mientras vuela, como una hoja.
          const flutterX = Math.sin(time * 5 + leaf.phase) * 260 * flight;
          const flutterY = Math.cos(time * 4 + leaf.phase * 1.3) * 120 * flight + 90 * flight;
          leaf.vx += (-k * leaf.x - c * leaf.vx + flutterX) * h;
          leaf.vy += (-k * leaf.y - c * leaf.vy + flutterY) * h;
          leaf.vrot += (-k * leaf.rot - 2 * wn * 0.6 * leaf.vrot) * h;
          leaf.x += leaf.vx * h;
          leaf.y += leaf.vy * h;
          leaf.rot += leaf.vrot * h;
        }

        const drift = Math.hypot(leaf.x, leaf.y);
        const motion = Math.hypot(leaf.vx, leaf.vy);
        if (leaf.age > 0.1 && drift < 0.05 && motion < 0.5 && Math.abs(leaf.rot) < 0.002 && Math.abs(leaf.vrot) < 0.02) {
          rest(leaf); // vuelve a su posición exacta
          continue;
        }
        moving = true;
        const flip = Math.sin(time * 9 + leaf.phase) * clamp(motion / 500, 0, 1) * 55;
        leaf.el.style.transform = `translate3d(${leaf.x.toFixed(2)}px, ${leaf.y.toFixed(2)}px, 0) rotate(${leaf.rot.toFixed(3)}rad) perspective(420px) rotateY(${flip.toFixed(1)}deg)`;
        leaf.el.style.setProperty("--furin-gust-tinte", clamp(drift / 60, 0, 1).toFixed(3));
      }

      // Nada en el aire y el cursor quieto: el bucle se duerme hasta el próximo soplo.
      if (!moving && speed === 0) stop();
    };

    const start = () => {
      if (frameId || !visible) return;
      lastNow = performance.now();
      frameId = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(frameId);
      frameId = 0;
    };

    const onPointerMove = (event: PointerEvent) => {
      const box = root.getBoundingClientRect();
      const x = (event.clientX - box.left) / scale;
      const y = (event.clientY - box.top) / scale;
      const now = performance.now();
      const elapsed = (now - pointer.lastTime) / 1000;
      // Solo se mide la velocidad entre movimientos seguidos; el primero no sopla.
      if (pointer.active && elapsed > 0.001 && elapsed < 0.25) {
        const smoothing = 0.5;
        pointer.vx += ((x - pointer.x) / elapsed - pointer.vx) * smoothing;
        pointer.vy += ((y - pointer.y) / elapsed - pointer.vy) * smoothing;
        pointer.vx = clamp(pointer.vx, -4000, 4000);
        pointer.vy = clamp(pointer.vy, -4000, 4000);
      }
      pointer.x = x;
      pointer.y = y;
      pointer.lastTime = now;
      pointer.active = true;
      start();
    };
    const onPointerLeave = () => {
      pointer.active = false;
    };

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        measure();
        if (leaves.some((leaf) => leaf.active)) start();
      } else stop();
    });
    visibilityObserver.observe(root);

    // Si el usuario activa "reducir movimiento" a media sesión, las letras vuelven a su sitio y se quedan quietas.
    const onMotionChange = () => {
      if (!reducedMotion.matches) return;
      stop();
      leaves.forEach(rest);
    };
    reducedMotion.addEventListener("change", onMotionChange);

    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerdown", onPointerMove);
    host.addEventListener("pointerleave", onPointerLeave);
    host.addEventListener("pointerup", onPointerLeave);
    host.addEventListener("pointercancel", onPointerLeave);

    // Las fuentes web cambian el ancho de las letras al cargar: se vuelve a medir.
    document.fonts?.ready.then(measure);
    measure();

    return () => {
      stop();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      reducedMotion.removeEventListener("change", onMotionChange);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerdown", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      host.removeEventListener("pointerup", onPointerLeave);
      host.removeEventListener("pointercancel", onPointerLeave);
      leaves.forEach(rest);
    };
  }, [text]);

  const vars = { "--furin-gust-acento": accent, ...(color ? { color } : {}) } as CSSProperties;

  return (
    <span ref={rootRef} className={`furin-gust ${className}`.trim()} style={{ ...vars, ...style }}>
      {/* Texto real para lectores de pantalla: las letras sueltas de abajo se ocultan. */}
      <span className="furin-gust__lectura">{text}</span>
      <span className="furin-gust__letras" aria-hidden="true">
        {text.split("\n").map((line, l) => (
          <Fragment key={l}>
            {l > 0 && <br />}
            {line
              .split(/\s+/)
              .filter(Boolean)
              .map((word, w) => (
                <Fragment key={w}>
                  {w > 0 && " "}
                  <span className="furin-gust__palabra">
                    {Array.from(word).map((letter, i) => (
                      <span key={i} className="furin-gust__letra" data-letra={letter}>
                        {letter}
                      </span>
                    ))}
                  </span>
                </Fragment>
              ))}
          </Fragment>
        ))}
      </span>
    </span>
  );
}

export default Gust;
