"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import "./AnalogGauge.css";

export interface AnalogGaugeProps {
  /** Valor que marca la aguja. */
  value?: number;
  /** Valor al inicio de la escala. */
  min?: number;
  /** Valor al final de la escala. */
  max?: number;
  /** Rótulo impreso en la carátula. */
  label?: string;
  /** Unidad impresa en la carátula. */
  unit?: string;
  /** Marcas grandes con número. */
  ticks?: number;
  /** Valor donde empieza la zona roja (usa el máximo para quitarla). */
  redline?: number;
  /** Diámetro del medidor, en px. */
  size?: number;
  /** Cuánto se pasa y oscila la aguja antes de asentarse (0 a 1). */
  bounce?: number;
  /** Color pintado en la punta de la aguja. */
  accent?: string;
  /** Cambia el valor solo cada pocos segundos (útil en demos). */
  wander?: boolean;
  /** Segundos entre cambios cuando wander está activo. */
  interval?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const BARRIDO = 240; // grados que recorre la aguja
const C = 200; // centro del lienzo SVG (viewBox 400)
const SUBDIV = 5;

const limitar = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const rad = (g: number) => (g * Math.PI) / 180;
const polar = (r: number, grados: number) => ({ x: C + r * Math.sin(rad(grados)), y: C - r * Math.cos(rad(grados)) });

/** Medidor analógico: bisel cromado, carátula con marcas y números, aguja de acero con física de resorte (se pasa y se asienta) y cristal con reflejo. */
export function AnalogGauge({
  value = 72,
  min = 0,
  max = 100,
  label = "Pressure",
  unit = "PSI",
  ticks = 11,
  redline = 85,
  size = 320,
  bounce = 0.55,
  accent = "#ff6a2a",
  wander = false,
  interval = 2.8,
  className = "",
  style,
}: AnalogGaugeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [auto, setAuto] = useState<number | null>(null);
  const actual = limitar(auto ?? value, min, max);
  const rango = max - min || 1;
  const fraccion = (v: number) => limitar((v - min) / rango, 0, 1);

  const raiz = useRef<HTMLDivElement>(null);
  const agujaRef = useRef<SVGGElement>(null);
  const sombraRef = useRef<SVGGElement>(null);
  const fis = useRef({ f: 0, v: 0, meta: 0, raf: 0, t: 0, visible: true, quieto: false });
  const zeta = useRef(0.5);
  zeta.current = 0.9 - 0.7 * limitar(bounce, 0, 1);

  const pintar = (f: number) => {
    // f puede pasarse un poco de 0..1 por el rebote: la aguja gira libre, sin tope.
    const g = (-BARRIDO / 2 + f * BARRIDO).toFixed(3);
    agujaRef.current?.setAttribute("transform", `rotate(${g} ${C} ${C})`);
    sombraRef.current?.setAttribute("transform", `rotate(${g} ${C} ${C})`);
  };

  const correr = () => {
    const s = fis.current;
    if (s.raf || !s.visible) return;
    s.t = performance.now();
    const paso = (ahora: number) => {
      let dt = Math.min(0.04, Math.max(0, (ahora - s.t) / 1000));
      s.t = ahora;
      const w = 2 * Math.PI * 1.15;
      while (dt > 0) {
        const h = Math.min(dt, 1 / 240);
        dt -= h;
        s.v += (w * w * (s.meta - s.f) - 2 * zeta.current * w * s.v) * h;
        s.f += s.v * h;
      }
      pintar(s.f);
      if (Math.abs(s.f - s.meta) < 0.0004 && Math.abs(s.v) < 0.004) { s.f = s.meta; s.v = 0; s.raf = 0; pintar(s.f); return; }
      if (!s.visible) { s.raf = 0; return; }
      s.raf = requestAnimationFrame(paso);
    };
    s.raf = requestAnimationFrame(paso);
  };

  // Entrada: la aguja parte del mínimo y se asienta en su valor. Con movimiento reducido va directo.
  useEffect(() => {
    const s = fis.current;
    s.quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    s.meta = fraccion(actual);
    if (s.quieto) { cancelAnimationFrame(s.raf); s.raf = 0; s.f = s.meta; s.v = 0; pintar(s.f); return; }
    correr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actual, min, max]);

  // Duerme fuera de pantalla.
  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      fis.current.visible = e.isIntersecting;
      if (e.isIntersecting && Math.abs(fis.current.f - fis.current.meta) > 0.0004) correr();
    });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(fis.current.raf); fis.current.raf = 0; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Modo demo: nuevos valores al azar cada cierto tiempo, solo si se ve.
  useEffect(() => {
    if (!wander || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setAuto(null); return; }
    let id = 0;
    let previo = fraccion(actual);
    const siguiente = () => {
      if (fis.current.visible) {
        let n = previo;
        for (let i = 0; i < 6 && Math.abs(n - previo) < 0.28; i++) n = 0.08 + Math.random() * 0.88;
        previo = n;
        setAuto(min + n * rango);
      }
      id = window.setTimeout(siguiente, Math.max(0.8, interval) * 1000);
    };
    id = window.setTimeout(siguiente, 1800);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wander, interval, min, max]);

  const alMover = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--fag-x", limitar((e.clientX - r.left) / r.width, 0, 1).toFixed(3));
    e.currentTarget.style.setProperty("--fag-y", limitar((e.clientY - r.top) / r.height, 0, 1).toFixed(3));
  };
  const alSalir = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.style.removeProperty("--fag-x");
    e.currentTarget.style.removeProperty("--fag-y");
  };

  // Marcas: grandes con número y pequeñas entre ellas; las de la zona roja se pintan de rojo.
  const segmentos = Math.max(2, ticks - 1);
  const total = segmentos * SUBDIV;
  const zonaRoja = redline < max;
  const fRoja = fraccion(redline);
  const marcas = Array.from({ length: total + 1 }, (_, m) => {
    const f = m / total;
    const grande = m % SUBDIV === 0;
    const a = -BARRIDO / 2 + f * BARRIDO;
    const p1 = polar(160, a);
    const p2 = polar(grande ? 140 : 150, a);
    return { ...p1, x2: p2.x, y2: p2.y, grande, roja: zonaRoja && f >= fRoja - 1e-6 };
  });
  const numeros = Array.from({ length: segmentos + 1 }, (_, i) => {
    const f = i / segmentos;
    const p = polar(116, -BARRIDO / 2 + f * BARRIDO);
    const v = min + f * rango;
    return { ...p, texto: String(Number(v.toFixed(1))), roja: zonaRoja && f >= fRoja - 1e-6 };
  });
  const arco = (() => {
    if (!zonaRoja) return "";
    const a0 = -BARRIDO / 2 + fRoja * BARRIDO;
    const a1 = BARRIDO / 2;
    const p0 = polar(166, a0);
    const p1 = polar(166, a1);
    return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A 166 166 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
  })();

  const f0 = -BARRIDO / 2;
  const aguja = "M198.7 52 L192.6 200 L195.4 246 L204.6 246 L207.4 200 L201.3 52 Z";
  const vars = { "--fag-size": `${size}px`, "--fag-accent": accent } as CSSProperties;
  return (
    <div
      ref={raiz}
      className={`furin-analog-gauge ${className}`}
      style={{ ...vars, ...style }}
      role="meter"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(actual.toFixed(2))}
      aria-valuetext={`${Number(actual.toFixed(1))} ${unit}`}
      onPointerMove={alMover}
      onPointerLeave={alSalir}
    >
      <div className="furin-analog-gauge__bezel" />
      <div className="furin-analog-gauge__chamfer" />
      <div className="furin-analog-gauge__dial" />
      <svg className="furin-analog-gauge__svg" viewBox="0 0 400 400" aria-hidden="true">
        <defs>
          <filter id={`${uid}b`} x="-60%" y="-30%" width="220%" height="160%"><feGaussianBlur stdDeviation="3.4" /></filter>
          <linearGradient id={`${uid}l`} x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#ffffff" /><stop offset="0.55" stopColor="#d3d8df" /><stop offset="1" stopColor="#9aa1ab" /></linearGradient>
          <linearGradient id={`${uid}r`} x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#8c939d" /><stop offset="0.6" stopColor="#525861" /><stop offset="1" stopColor="#2b2f36" /></linearGradient>
          <clipPath id={`${uid}t`}><rect x="150" y="40" width="100" height="66" /></clipPath>
        </defs>
        {arco ? <path d={arco} className="furin-analog-gauge__zone" /> : null}
        {marcas.map((m, i) => (
          <line key={i} x1={m.x} y1={m.y} x2={m.x2} y2={m.y2} className={`furin-analog-gauge__tick${m.grande ? " is-major" : ""}${m.roja ? " is-red" : ""}`} />
        ))}
        {numeros.map((n, i) => (
          <text key={i} x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central" className={`furin-analog-gauge__num${n.roja ? " is-red" : ""}`}>{n.texto}</text>
        ))}
        <text x={C} y="262" textAnchor="middle" className="furin-analog-gauge__label">{label}</text>
        <text x={C} y="292" textAnchor="middle" className="furin-analog-gauge__unit">{unit}</text>
        <g transform="translate(7 11)" opacity="0.65">
          <g ref={sombraRef} transform={`rotate(${f0} ${C} ${C})`} filter={`url(#${uid}b)`}><path d={aguja} fill="#000" /></g>
        </g>
        <g ref={agujaRef} transform={`rotate(${f0} ${C} ${C})`}>
          <path d="M200 52 L198.7 52 L192.6 200 L195.4 246 L200 246 Z" fill={`url(#${uid}l)`} />
          <path d="M200 52 L201.3 52 L207.4 200 L204.6 246 L200 246 Z" fill={`url(#${uid}r)`} />
          <g clipPath={`url(#${uid}t)`}>
            <path d="M200 52 L198.7 52 L192.6 200 L200 200 Z" className="furin-analog-gauge__tipL" />
            <path d="M200 52 L201.3 52 L207.4 200 L200 200 Z" className="furin-analog-gauge__tipR" />
          </g>
          <path d="M200 56 L200 244" stroke="rgba(255,255,255,0.6)" strokeWidth="0.8" />
        </g>
      </svg>
      <div className="furin-analog-gauge__hub" />
      <div className="furin-analog-gauge__glass">
        <span className="furin-analog-gauge__glare" />
        <span className="furin-analog-gauge__streak" />
      </div>
    </div>
  );
}

export default AnalogGauge;
