"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import "./ElasticSlider.css";

export interface ElasticSliderProps {
  /** Valor mínimo. */
  min?: number;
  /** Valor máximo. */
  max?: number;
  /** Paso entre valores. */
  step?: number;
  /** Valor actual (modo controlado). */
  value?: number;
  /** Valor inicial (modo libre). */
  defaultValue?: number;
  /** Se llama al cambiar el valor. */
  onChange?: (value: number) => void;
  /** Texto del control (también su etiqueta accesible). */
  label?: string;
  /** Muestra el valor numérico. */
  showValue?: boolean;
  /** Sufijo del valor, por ejemplo "%". */
  unit?: string;
  /** Cuánto se estira al pasar los límites, en px. */
  stretch?: number;
  /** Íconos de los extremos. */
  icon?: "brightness" | "volume" | "none";
  /** Color del relleno. */
  color?: string;
  /** Rebote al regresar: 0.2 rebota mucho, 0.6 casi no. */
  damping?: number;
  /** Se arrastra solo, pasándose de los límites, hasta que lo tocas. */
  autoplay?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

/** Íconos geométricos de los extremos: el de la izquierda es el mínimo y el de la derecha, el máximo. */
function Icono({ tipo, alto }: { tipo: "brightness" | "volume"; alto: boolean }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (tipo === "brightness") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle {...p} cx="10" cy="10" r={alto ? 3.4 : 2.6} />
        <path {...p} d={alto ? "M10 2.4v2M10 15.6v2M2.4 10h2M15.6 10h2M4.6 4.6l1.4 1.4M14 14l1.4 1.4M4.6 15.4 6 14M14 6l1.4-1.4" : "M10 4.2v1M10 14.8v1M4.2 10h1M14.8 10h1"} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path {...p} d="M3.6 8v4h2.8L10 15V5L6.4 8z" />
      {alto ? <path {...p} d="M12.6 7.2a4 4 0 0 1 0 5.6M14.6 5.2a6.8 6.8 0 0 1 0 9.6" /> : <path {...p} d="M12.8 8.2a2.6 2.6 0 0 1 0 3.6" />}
    </svg>
  );
}

/** Deslizador (role slider) que se estira como goma al arrastrarlo más allá de sus límites y regresa con rebote. */
export function ElasticSlider({
  min = 0,
  max = 100,
  step = 1,
  value,
  defaultValue = 62,
  onChange,
  label = "Brightness",
  showValue = true,
  unit = "%",
  stretch = 56,
  icon = "brightness",
  color = "#F3F4F7",
  damping = 0.28,
  autoplay = false,
  className = "",
  style,
}: ElasticSliderProps) {
  const root = useRef<HTMLDivElement>(null);
  const zona = useRef<HTMLDivElement>(null);
  const valRef = useRef(clamp(value ?? defaultValue, min, max));
  const live = useRef({ min, max, step, stretch, damping, onChange, autoplay, controlado: value !== undefined, unit });
  live.current = { min, max, step, stretch, damping, onChange, autoplay, controlado: value !== undefined, unit };
  const api = useRef<{ set: (v: number, emit: boolean) => void; empuja: (dir: number) => void }>({ set: () => {}, empuja: () => {} });

  // Modo controlado: la prop manda cuando no se está arrastrando.
  useEffect(() => { if (value !== undefined) api.current.set(clamp(value, min, max), false); }, [value, min, max]);

  useEffect(() => {
    const el = root.current, z = zona.current;
    if (!el || !z) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const txt = el.querySelector<HTMLElement>(".furin-elastic-slider__valor");
    let W = 1, raf = 0, last = 0, visible = true;
    // Estiramiento (px, con signo) como resorte; presión como resorte de escala.
    let s = 0, sv = 0, sT = 0, pr = 0, prv = 0, prT = 0, arrastra = false, lastReal = -1e9, t = 0, ratioV = 0;
    const redondea = (v: number) => {
      const L = live.current;
      const n = Math.round((v - L.min) / L.step) * L.step + L.min;
      return clamp(Number(n.toFixed(6)), L.min, L.max);
    };
    const ratio = () => (valRef.current - live.current.min) / Math.max(live.current.max - live.current.min, 1e-9);

    const pinta = () => {
      const L = live.current;
      const r = arrastra || autoOn ? ratio() : ratio();
      void ratioV;
      const sx = 1 + Math.abs(s) / W;
      const sy = 1 - Math.min(0.32, (Math.abs(s) / Math.max(L.stretch, 1)) * 0.3);
      // Si se estira por la derecha, la pista crece desde la izquierda; por la izquierda, desde la derecha.
      el.style.setProperty("--furin-es-origen", s >= 0 ? "left center" : "right center");
      el.style.setProperty("--furin-es-sx", sx.toFixed(4));
      el.style.setProperty("--furin-es-sy", sy.toFixed(4));
      el.style.setProperty("--furin-es-fill", `${(r * 100).toFixed(3)}%`);
      // Posición del tirador: el punto del valor, dentro de la pista ya estirada.
      const x = s >= 0 ? r * (W + s) : W - (1 - r) * (W + Math.abs(s));
      el.style.setProperty("--furin-es-x", `${x.toFixed(2)}px`);
      el.style.setProperty("--furin-es-press", pr.toFixed(3));
      el.style.setProperty("--furin-es-izq", `${Math.min(s, 0).toFixed(2)}px`);
      el.style.setProperty("--furin-es-der", `${Math.max(s, 0).toFixed(2)}px`);
    };
    const texto = () => {
      if (txt) txt.textContent = `${valRef.current}${live.current.unit}`;
      z.setAttribute("aria-valuenow", String(valRef.current));
      z.setAttribute("aria-valuetext", `${valRef.current}${live.current.unit}`);
      el.style.setProperty("--furin-es-alto", String(ratio() > 0.5 ? 1 : 0));
    };

    const fisica = (dtIn: number) => {
      const dt = Math.min(0.032, dtIn);
      const L = live.current;
      const k = 190, c = 2 * Math.sqrt(k) * L.damping;
      const h = dt / 3;
      for (let i = 0; i < 3; i++) {
        sv += (k * (sT - s) - c * sv) * h;
        s += sv * h;
      }
      prv += ((prT - pr) * 420 - prv * 24) * dt;
      pr += prv * dt;
    };

    let autoOn = false;
    const frame = (nowMs: number) => {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0.001, (nowMs - last) / 1000));
      last = nowMs;
      t += dt;
      const L = live.current;
      const auto = L.autoplay && !arrastra && nowMs - lastReal > 2600 && !reduce;
      if (auto) {
        // Arrastre virtual: una oscilación lenta que se pasa de los dos límites.
        if (!autoOn) { autoOn = true; prT = 1; }
        const ph = Math.sin(t * 0.85);
        const px = 0.5 + ph * 0.68;   // fracción de la pista, más allá de [0, 1]
        valRef.current = redondea(L.min + clamp(px, 0, 1) * (L.max - L.min));
        const over = (px - clamp(px, 0, 1)) * W;
        sT = Math.sign(over) * L.stretch * (1 - Math.exp(-Math.abs(over) / (L.stretch * 1.4)));
        texto();
      } else if (autoOn) { autoOn = false; prT = 0; sT = 0; }
      if (!reduce) fisica(dt);
      else { s = sT; pr = prT; sv = prv = 0; }
      pinta();
      const quieto = !arrastra && !auto && Math.abs(s - sT) < 0.05 && Math.abs(sv) < 0.1 && Math.abs(pr - prT) < 0.002 && Math.abs(prv) < 0.02;
      if ((!quieto || (L.autoplay && !reduce)) && visible) raf = requestAnimationFrame(frame);
      else if (quieto) { s = sT; pr = prT; pinta(); }
    };
    const wake = () => { if (raf || !visible) return; last = performance.now(); raf = requestAnimationFrame(frame); };

    const aValor = (clientX: number) => {
      const L = live.current;
      const r = z.getBoundingClientRect();
      W = r.width;
      const f = (clientX - r.left) / Math.max(r.width, 1);
      const v = redondea(L.min + clamp(f, 0, 1) * (L.max - L.min));
      // Goma: la parte del arrastre que se pasa de la pista estira con resistencia creciente.
      const over = (f - clamp(f, 0, 1)) * r.width;
      sT = Math.sign(over) * L.stretch * (1 - Math.exp(-Math.abs(over) / (L.stretch * 1.4)));
      if (v !== valRef.current) { valRef.current = v; texto(); L.onChange?.(v); }
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      arrastra = true; lastReal = performance.now(); prT = 1;
      z.setPointerCapture(e.pointerId);
      z.classList.add("is-arrastra");
      aValor(e.clientX);
      wake();
    };
    const onMove = (e: PointerEvent) => { if (!arrastra) return; lastReal = performance.now(); aValor(e.clientX); wake(); };
    const onUp = (e: PointerEvent) => {
      if (!arrastra) return;
      arrastra = false; lastReal = performance.now(); sT = 0; prT = 0;
      z.classList.remove("is-arrastra");
      try { z.releasePointerCapture(e.pointerId); } catch { /* ya soltado */ }
      wake();
    };
    z.addEventListener("pointerdown", onDown);
    z.addEventListener("pointermove", onMove);
    z.addEventListener("pointerup", onUp);
    z.addEventListener("pointercancel", onUp);

    api.current.set = (v, emit) => {
      const nv = redondea(v);
      if (nv === valRef.current) return;
      valRef.current = nv; texto(); pinta();
      if (emit) live.current.onChange?.(nv);
    };
    // Al intentar pasar el límite con el teclado, la goma da un tirón y regresa.
    api.current.empuja = (dir) => { sv += dir * 240; lastReal = performance.now(); wake(); };

    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } });
    io.observe(el);
    const ro = new ResizeObserver(() => { W = z.getBoundingClientRect().width; pinta(); });
    ro.observe(z);
    W = z.getBoundingClientRect().width;
    texto();
    pinta();
    wake();
    return () => {
      cancelAnimationFrame(raf);
      z.removeEventListener("pointerdown", onDown);
      z.removeEventListener("pointermove", onMove);
      z.removeEventListener("pointerup", onUp);
      z.removeEventListener("pointercancel", onUp);
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  const teclas = (e: ReactKeyboardEvent) => {
    const L = live.current;
    const big = Math.max(L.step, (L.max - L.min) / 10);
    const v = valRef.current;
    let n = v;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") n = v + L.step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") n = v - L.step;
    else if (e.key === "PageUp") n = v + big;
    else if (e.key === "PageDown") n = v - big;
    else if (e.key === "Home") n = L.min;
    else if (e.key === "End") n = L.max;
    else return;
    e.preventDefault();
    if (n > L.max) { api.current.empuja(1); return; }
    if (n < L.min) { api.current.empuja(-1); return; }
    api.current.set(n, true);
  };

  const ini = clamp(value ?? defaultValue, min, max);
  const vars = { "--furin-es-color": color, "--furin-es-fill": `${((ini - min) / Math.max(max - min, 1e-9)) * 100}%` } as CSSProperties;
  return (
    <div ref={root} className={`furin-elastic-slider ${className}`} style={{ ...vars, ...style }}>
      <div className="furin-elastic-slider__cab">
        <span className="furin-elastic-slider__etq">{label}</span>
        {showValue ? <span className="furin-elastic-slider__valor" aria-hidden="true">{ini}{unit}</span> : null}
      </div>
      <div className="furin-elastic-slider__fila">
        {icon !== "none" ? <span className="furin-elastic-slider__ico furin-elastic-slider__ico--izq"><Icono tipo={icon} alto={false} /></span> : null}
        <div
          ref={zona}
          className="furin-elastic-slider__zona"
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-orientation="horizontal"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={ini}
          aria-valuetext={`${ini}${unit}`}
          onKeyDown={teclas}
        >
          <div className="furin-elastic-slider__pista">
            <div className="furin-elastic-slider__relleno" />
          </div>
          <span className="furin-elastic-slider__tirador" />
        </div>
        {icon !== "none" ? <span className="furin-elastic-slider__ico furin-elastic-slider__ico--der"><Icono tipo={icon} alto /></span> : null}
      </div>
    </div>
  );
}

export default ElasticSlider;
