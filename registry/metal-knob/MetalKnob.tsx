"use client";
import { useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import "./MetalKnob.css";

export interface MetalKnobProps {
  /** Valor actual (modo controlado). */
  value?: number;
  /** Valor inicial cuando no se controla desde fuera. */
  defaultValue?: number;
  /** Se llama cada vez que cambia el valor. */
  onChange?: (value: number) => void;
  /** Valor mínimo. */
  min?: number;
  /** Valor máximo. */
  max?: number;
  /** Salto entre valores. */
  step?: number;
  /** Rótulo bajo la perilla. */
  label?: string;
  /** Unidad que se muestra junto al valor. */
  unit?: string;
  /** Diámetro de la perilla, en px. */
  size?: number;
  /** Marcas grandes de la escala. */
  ticks?: number;
  /** Color de las marcas encendidas. */
  accent?: string;
  /** Deshabilita la perilla. */
  disabled?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const BARRIDO = 270; // grados totales que recorre la perilla
const SUBDIV = 5; // subdivisiones entre dos marcas grandes

const limitar = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** Diferencia de ángulos normalizada a -180..180 (para no saltar al cruzar el norte). */
const diferencia = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

/** Perilla metálica moleteada: se gira arrastrando en círculo o con las flechas, con escala de marcas que se encienden y un reflejo que sigue al cursor. */
export function MetalKnob({
  value: controlado,
  defaultValue = 64,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label = "Volume",
  unit = "",
  size = 140,
  ticks = 11,
  accent = "#ffb13b",
  disabled = false,
  className = "",
  style,
}: MetalKnobProps) {
  const [interno, setInterno] = useState(defaultValue);
  const valor = limitar(controlado ?? interno, min, max);
  const [crudo, setCrudo] = useState<number | null>(null); // ángulo continuo mientras se arrastra
  const perilla = useRef<HTMLDivElement>(null);
  const gesto = useRef<{ ultimo: number; ang: number } | null>(null);

  const rango = max - min || 1;
  const aAngulo = (v: number) => ((v - min) / rango) * BARRIDO - BARRIDO / 2;
  const aValor = (ang: number) => {
    const bruto = min + ((ang + BARRIDO / 2) / BARRIDO) * rango;
    const paso = step > 0 ? Math.round((bruto - min) / step) * step + min : bruto;
    return limitar(Number(paso.toFixed(6)), min, max);
  };
  const angulo = crudo ?? aAngulo(valor);

  const fijar = (v: number) => {
    const n = limitar(v, min, max);
    if (n === valor) return;
    if (controlado === undefined) setInterno(n);
    onChange?.(n);
  };

  const puntero = (e: PointerEvent) => {
    const r = perilla.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return { ang: (Math.atan2(dx, -dy) * 180) / Math.PI, dist: Math.hypot(dx, dy) };
  };

  const alBajar = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesto.current = { ultimo: puntero(e).ang, ang: aAngulo(valor) };
    setCrudo(gesto.current.ang);
  };
  const alMover = (e: PointerEvent<HTMLDivElement>) => {
    // El reflejo sigue al cursor aunque no se esté arrastrando.
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--fmk-x", limitar((e.clientX - r.left) / r.width, 0, 1).toFixed(3));
    e.currentTarget.style.setProperty("--fmk-y", limitar((e.clientY - r.top) / r.height, 0, 1).toFixed(3));
    const g = gesto.current;
    if (!g) return;
    const p = puntero(e);
    if (p.dist < 12) return; // junto al centro el ángulo es inestable
    g.ang = limitar(g.ang + diferencia(p.ang, g.ultimo), -BARRIDO / 2, BARRIDO / 2);
    g.ultimo = p.ang;
    setCrudo(g.ang);
    fijar(aValor(g.ang));
  };
  const alSoltar = () => {
    if (!gesto.current) return;
    gesto.current = null;
    setCrudo(null); // el ángulo vuelve al valor con paso, con rebote de muelle
  };
  const alTeclado = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const salto = step > 0 ? step : rango / 100;
    const mapa: Record<string, number> = { ArrowUp: salto, ArrowRight: salto, ArrowDown: -salto, ArrowLeft: -salto, PageUp: salto * 10, PageDown: -salto * 10 };
    if (e.key in mapa) { e.preventDefault(); fijar(valor + mapa[e.key]); }
    else if (e.key === "Home") { e.preventDefault(); fijar(min); }
    else if (e.key === "End") { e.preventDefault(); fijar(max); }
  };

  // Escala: marcas grandes y pequeñas; se encienden hasta el valor actual.
  const W = size + 104;
  const c = W / 2;
  const r0 = size / 2 + 24;
  const segmentos = Math.max(2, ticks - 1);
  const total = segmentos * SUBDIV;
  const fraccion = (valor - min) / rango;
  const marcas = Array.from({ length: total + 1 }, (_, m) => {
    const f = m / total;
    const a = ((-BARRIDO / 2 + f * BARRIDO) * Math.PI) / 180;
    const grande = m % SUBDIV === 0;
    const r1 = r0 + (grande ? 11 : 6);
    return { x1: c + r0 * Math.sin(a), y1: c - r0 * Math.cos(a), x2: c + r1 * Math.sin(a), y2: c - r1 * Math.cos(a), grande, on: f <= fraccion + 1e-6 };
  });
  const etiqueta = (f: number) => {
    const a = ((-BARRIDO / 2 + f * BARRIDO) * Math.PI) / 180;
    return { x: c + (r0 + 24) * Math.sin(a), y: c - (r0 + 24) * Math.cos(a) };
  };
  const eMin = etiqueta(0);
  const eMax = etiqueta(1);

  const vars = { "--fmk-d": `${size}px`, "--fmk-accent": accent, "--fmk-w": `${W}px` } as CSSProperties;
  const texto = `${Number(valor.toFixed(2))}${unit ? ` ${unit}` : ""}`;
  return (
    <div className={`furin-metal-knob ${disabled ? "furin-metal-knob--off" : ""} ${className}`} style={{ ...vars, ...style }}>
      <div className="furin-metal-knob__dial">
        <svg className="furin-metal-knob__scale" viewBox={`0 0 ${W} ${W}`} aria-hidden="true">
          {marcas.map((m, i) => (
            <line key={i} x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} className={`furin-metal-knob__tick${m.on ? " is-on" : ""}${m.grande ? " is-major" : ""}`} />
          ))}
          <text x={eMin.x} y={eMin.y} className="furin-metal-knob__num" textAnchor="middle" dominantBaseline="middle">{min}</text>
          <text x={eMax.x} y={eMax.y} className="furin-metal-knob__num" textAnchor="middle" dominantBaseline="middle">{max}</text>
        </svg>
        <div className="furin-metal-knob__well" />
        <div
          ref={perilla}
          className={`furin-metal-knob__knob${crudo !== null ? " is-dragging" : ""}`}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={valor}
          aria-valuetext={texto}
          aria-disabled={disabled || undefined}
          onPointerDown={alBajar}
          onPointerMove={alMover}
          onPointerUp={alSoltar}
          onPointerCancel={alSoltar}
          onPointerLeave={(e) => { e.currentTarget.style.removeProperty("--fmk-x"); e.currentTarget.style.removeProperty("--fmk-y"); }}
          onKeyDown={alTeclado}
          onDoubleClick={() => fijar(defaultValue)}
        >
          <div className="furin-metal-knob__turn" style={{ transform: `rotate(${angulo}deg)` }}>
            <div className="furin-metal-knob__grip" />
            <div className="furin-metal-knob__cap">
              <div className="furin-metal-knob__mark" />
            </div>
          </div>
          <div className="furin-metal-knob__light furin-metal-knob__light--ring" />
          <div className="furin-metal-knob__light furin-metal-knob__light--cap" />
          <div className="furin-metal-knob__spec" />
        </div>
      </div>
      <div className="furin-metal-knob__readout">
        <span className="furin-metal-knob__label">{label}</span>
        <output className="furin-metal-knob__value">{texto}</output>
      </div>
    </div>
  );
}

export default MetalKnob;
