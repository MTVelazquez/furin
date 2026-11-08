"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, MutableRefObject, RefObject } from "react";
import "./BlurNumber.css";

export interface BlurNumberProps {
  /** El número a mostrar; al cambiar, cada cifra rueda con desenfoque. Si no se pasa, cambia sola entre `samples`. */
  value?: number;
  /** Valores que recorre sola cuando no se pasa `value`. */
  samples?: number[];
  /** Segundos entre cambios en modo automático. */
  interval?: number;
  /** Texto fijo antes del número (por ejemplo "$"). */
  prefix?: string;
  /** Texto fijo después del número (por ejemplo "%"). */
  suffix?: string;
  /** Cifras decimales. */
  decimals?: number;
  /** Configuración regional para los separadores (por ejemplo "es-MX"). */
  locale?: string;
  /** Tamaño de la letra, en px. */
  size?: number;
  /** Desenfoque vertical máximo, en px, a la máxima velocidad. */
  maxBlur?: number;
  /** Milisegundos de retraso entre una cifra y la de su izquierda. */
  stagger?: number;
  /** Color del número. */
  color?: string;
  /** Color que toman las cifras mientras ruedan. */
  accent?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

interface Compartido { maxBlur: number; stagger: number; color: string; accent: string; reducido: boolean }

const mod10 = (n: number) => ((n % 10) + 10) % 10;
const CELDAS = 6;

/** Una cifra: una tira de 0 a 9 que rueda con un resorte y se desenfoca en vertical según su velocidad. */
function Columna({ digito, dir, rango, filtro, compartido, parentMontado }: {
  digito: number; dir: number; rango: number; filtro: string; compartido: MutableRefObject<Compartido>; parentMontado: MutableRefObject<boolean>;
}) {
  const ventana = useRef<HTMLSpanElement>(null);
  const celdas = useRef<(HTMLSpanElement | null)[]>([]);
  const E = useRef({ pos: 0, vel: 0, meta: 0, inicio: 0, ultimo: 0, raf: 0, listo: false, vistos: [] as number[], fe: null as Element | null, lh: 0 });
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const e = E.current;
    const win = ventana.current;
    if (!win) return;
    e.fe = document.getElementById(filtro)?.firstElementChild ?? null;
    let muerto = false;
    const pintar = () => {
      const base = Math.floor(e.pos);
      for (let k = 0; k < CELDAS; k++) {
        const c = base - 2 + k;
        const el = celdas.current[k];
        if (!el) continue;
        const d = mod10(c);
        if (e.vistos[k] !== d) { el.textContent = String(d); e.vistos[k] = d; }
        el.style.transform = `translateY(${((c - e.pos) * 100).toFixed(2)}%)`;
      }
    };
    const paso = (now: number) => {
      e.raf = 0;
      if (muerto) return;
      const { maxBlur, color, accent } = compartido.current;
      const dt = Math.min(0.033, (now - (e.ultimo || now)) / 1000 || 0.016);
      e.ultimo = now;
      if (now >= e.inicio) {
        const k = 130, c = 21;
        for (let i = 0; i < 2; i++) { e.vel += ((e.meta - e.pos) * k - e.vel * c) * (dt / 2); e.pos += e.vel * (dt / 2); }
      }
      const llego = Math.abs(e.meta - e.pos) < 0.002 && Math.abs(e.vel) < 0.02 && now >= e.inicio;
      if (llego) { e.pos = e.meta; e.vel = 0; }
      pintar();
      // Desenfoque vertical según la velocidad (en celdas por segundo).
      const v = Math.abs(e.vel);
      const b = llego ? 0 : Math.min(maxBlur, v * 0.34);
      if (e.fe) e.fe.setAttribute("stdDeviation", `0 ${b.toFixed(2)}`);
      win.style.filter = b > 0.12 ? `url(#${filtro})` : "none";
      const m = Math.min(1, b / Math.max(1, maxBlur) * 1.4);
      win.style.color = m > 0.02 ? `color-mix(in srgb, ${accent} ${Math.round(m * 70)}%, ${color})` : "";
      if (!llego) e.raf = requestAnimationFrame(paso);
      else e.ultimo = 0;
    };
    const wake = () => { if (!e.raf && !muerto) { e.ultimo = 0; e.raf = requestAnimationFrame(paso); } };
    wakeRef.current = wake;
    if (!e.listo) {
      e.listo = true;
      // Las cifras que aparecen después del montaje inicial ruedan desde 0.
      const desde = parentMontado.current ? 0 : digito;
      e.pos = e.meta = desde;
      pintar();
      if (desde !== digito) { e.meta = desde + (dir >= 0 ? mod10(digito - desde) : -mod10(desde - digito)); e.inicio = performance.now() + rango * compartido.current.stagger; wake(); }
    }
    return () => { muerto = true; cancelAnimationFrame(e.raf); };
  }, []);

  // Cuando cambia la cifra, calcula el recorrido hacia la nueva y la manda rodar en la dirección del cambio.
  useEffect(() => {
    const e = E.current;
    if (!e.listo) return;
    const actual = mod10(Math.round(e.meta));
    if (actual === digito) return;
    const delta = dir >= 0 ? mod10(digito - actual) : -mod10(actual - digito);
    e.meta += delta;
    if (compartido.current.reducido) { e.pos = e.meta; e.vel = 0; }
    e.inicio = performance.now() + rango * compartido.current.stagger;
    wakeRef.current();
  }, [digito]);

  return (
    <span className="furin-blur-number__columna">
      <span className="furin-blur-number__fantasma">0</span>
      <span ref={ventana} className="furin-blur-number__ventana" aria-hidden="true">
        {Array.from({ length: CELDAS }, (_, k) => (
          <span key={k} ref={(el) => { celdas.current[k] = el; }} className="furin-blur-number__celda" />
        ))}
      </span>
    </span>
  );
}

/** Si el texto no cabe en su contenedor, encoge la letra lo justo (se recalcula al cambiar el tamaño del contenedor). */
function useAjuste(ref: RefObject<HTMLElement | null>, variable: string, dep: unknown) {
  useEffect(() => {
    const el = ref.current, padre = el?.parentElement;
    if (!el || !padre) return;
    let raf = 0;
    const ajustar = () => {
      el.style.setProperty(variable, "1");
      const natural = el.scrollWidth;
      const libre = padre.clientWidth - 28;
      el.style.setProperty(variable, (natural > libre && libre > 40 ? Math.max(0.35, libre / natural) : 1).toFixed(3));
    };
    const pedir = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(ajustar); };
    const ro = new ResizeObserver(pedir);
    ro.observe(padre);
    document.fonts?.ready.then(pedir);
    pedir();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [dep]);
}

/** Número cuyas cifras ruedan hacia el nuevo valor con desenfoque de movimiento vertical, una tras otra. */
export function BlurNumber({
  value,
  samples = [12480, 3907, 58213, 842, 27650, 9164],
  interval = 2.6,
  prefix = "$",
  suffix = "",
  decimals = 0,
  locale = "en-US",
  size = 96,
  maxBlur = 9,
  stagger = 55,
  color = "#F4F5F7",
  accent = "#7CF5C6",
  className = "",
  style,
}: BlurNumberProps) {
  const uid = useId().replace(/:/g, "");
  const rootRef = useRef<HTMLSpanElement>(null);
  const auto = value === undefined;
  const [idx, setIdx] = useState(0);
  const valor = auto ? samples[idx % Math.max(1, samples.length)] ?? 0 : value;
  const montado = useRef(false);
  const compartido = useRef<Compartido>({ maxBlur, stagger, color, accent, reducido: false });
  compartido.current = { ...compartido.current, maxBlur, stagger, color, accent };
  const prev = useRef(valor);
  const dir = useRef(1);
  if (valor !== prev.current) { dir.current = valor >= prev.current ? 1 : -1; prev.current = valor; }

  useEffect(() => {
    compartido.current.reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    montado.current = true;
  }, []);

  // Modo automático: avanza solo mientras esté a la vista (y no con movimiento reducido).
  useEffect(() => {
    if (!auto || samples.length < 2) return;
    const root = rootRef.current;
    if (!root || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0, visible = true;
    const programa = () => {
      clearTimeout(timer);
      if (!visible) return;
      timer = window.setTimeout(() => { setIdx((i) => i + 1); programa(); }, interval * 1000);
    };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; programa(); }, { rootMargin: "40px" });
    io.observe(root);
    programa();
    return () => { clearTimeout(timer); io.disconnect(); };
  }, [auto, samples.length, interval]);

  const texto = useMemo(() => {
    try { return new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(valor); }
    catch { return valor.toFixed(decimals); }
  }, [valor, decimals, locale]);
  useAjuste(rootRef, "--furin-bn-fit", texto + size);

  // Cada carácter recibe una clave contada desde la derecha: así las cifras que quedan conservan su columna.
  const chars = Array.from(texto);
  let nd = 0, ns = 0;
  const piezas = chars.slice().reverse().map((ch) => {
    if (/\d/.test(ch)) return { tipo: "d" as const, ch, k: nd++ };
    return { tipo: "s" as const, ch, k: ns++ };
  }).reverse();
  const totalD = nd;

  const vars = { "--furin-bn-size": `${size}px`, "--furin-bn-color": color } as CSSProperties;
  return (
    <span ref={rootRef} className={`furin-blur-number ${className}`} style={{ ...vars, ...style }} onClick={() => { if (auto) setIdx((i) => i + 1); }}>
      <span className="furin-blur-number__sr" aria-live={auto ? "off" : "polite"}>{`${prefix}${texto}${suffix}`}</span>
      <svg className="furin-blur-number__defs" width="0" height="0" aria-hidden="true" focusable="false">
        {Array.from({ length: totalD + 1 }, (_, k) => (
          <filter key={k} id={`${uid}-f${k}`} x="-25%" y="-60%" width="150%" height="220%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="0 0" />
          </filter>
        ))}
      </svg>
      <span className="furin-blur-number__visible" aria-hidden="true">
        {prefix ? <span className="furin-blur-number__fijo furin-blur-number__fijo--pre">{prefix}</span> : null}
        {piezas.map((p) =>
          p.tipo === "d" ? (
            <Columna key={`d${p.k}`} digito={Number(p.ch)} dir={dir.current} rango={p.k} filtro={`${uid}-f${p.k}`} compartido={compartido} parentMontado={montado} />
          ) : (
            <span key={`s${p.k}`} className="furin-blur-number__sep">{p.ch}</span>
          ),
        )}
        {suffix ? <span className="furin-blur-number__fijo furin-blur-number__fijo--suf">{suffix}</span> : null}
      </span>
    </span>
  );
}

export default BlurNumber;
