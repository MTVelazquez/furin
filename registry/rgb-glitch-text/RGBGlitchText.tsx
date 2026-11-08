"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, RefObject } from "react";
import "./RGBGlitchText.css";

export interface RGBGlitchTextProps {
  /** El texto (acepta saltos de línea). */
  children?: string;
  /** Tamaño de la letra, en px. */
  size?: number;
  /** Fuerza de la separación de canales y de los cortes (0.3 a 2). */
  intensity?: number;
  /** Segundos promedio entre ráfagas. */
  interval?: number;
  /** Dispara una ráfaga al pasar el cursor por encima. */
  onHover?: boolean;
  /** Color del texto. */
  color?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

/** Lee #rgb, #rrggbb o rgb()/rgba() sin tocar el DOM (seguro para SSR); si no entiende el color, usa blanco hueso. */
function rgbDe(css: string): [number, number, number] {
  const c = css.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})/.exec(c);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  const r = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c);
  if (r) return [Number(r[1]), Number(r[2]), Number(r[3])];
  return [244, 245, 247];
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const CORTES = 3;

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

/** Texto limpio que cada tanto se parte en ráfagas cortas: canales RGB separados y franjas desplazadas. */
export function RGBGlitchText({
  children = "SIGNAL",
  size = 96,
  intensity = 1,
  interval = 2.8,
  onHover = true,
  color = "#F4F5F7",
  className = "",
  style,
}: RGBGlitchTextProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const texto = String(children ?? "");
  useAjuste(rootRef, "--furin-rgb-fit", texto + size);
  const cfg = useRef({ size, intensity, interval, onHover });
  cfg.current = { size, intensity, interval, onHover };
  const disparar = useRef<() => void>(() => {});

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const base = root.querySelector<HTMLElement>(".furin-rgb-glitch__base")!;
    const R = root.querySelector<HTMLElement>(".furin-rgb-glitch__r")!;
    const G = root.querySelector<HTMLElement>(".furin-rgb-glitch__g")!;
    const B = root.querySelector<HTMLElement>(".furin-rgb-glitch__b")!;
    const cortes = Array.from(root.querySelectorAll<HTMLElement>(".furin-rgb-glitch__corte"));
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const limpiar = () => {
      root.dataset.glitch = "0";
      for (const e of [base, R, G, B]) { e.style.clipPath = ""; e.style.transform = ""; }
      base.style.transform = "";
      for (const c of cortes) { c.style.clipPath = "inset(100% 0 0 0)"; c.style.transform = ""; }
    };
    limpiar();
    if (reducido) {
      // Estado quieto: una separación fija y discreta, sin ráfagas.
      const dx = cfg.current.size * 0.012;
      root.dataset.glitch = "1";
      R.style.transform = `translate(${-dx}px, 0)`; B.style.transform = `translate(${dx}px, 0)`;
      return;
    }

    let timer = 0, visible = true, muerto = false, enRafaga = false, pendiente = false, ultimaRafaga = 0;

    // Un cuadro de la ráfaga: canales desplazados + hasta tres franjas horizontales movidas.
    const cuadro = (fuerza: number) => {
      const { size: S, intensity: I } = cfg.current;
      const f = fuerza * I;
      const dx = S * 0.042 * f * rnd(0.5, 1.15);
      root.dataset.glitch = "1";
      R.style.transform = `translate(${(-dx).toFixed(1)}px, ${rnd(-0.6, 0.6).toFixed(1)}px)`;
      B.style.transform = `translate(${(dx * rnd(0.7, 1.1)).toFixed(1)}px, ${rnd(-0.6, 0.6).toFixed(1)}px)`;
      G.style.transform = `translate(${rnd(-0.12, 0.12) * dx}px, 0)`;
      const n = Math.random() < 0.25 ? 0 : 1 + Math.floor(Math.random() * Math.min(CORTES, 1 + f * 1.5));
      const bandas: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const top = rnd(14, 76);
        const h = rnd(6, 20);
        bandas.push([top, Math.min(100, top + h)]);
      }
      bandas.sort((a, b) => a[0] - b[0]);
      // Sin traslapes: cada franja arranca después de que termina la anterior.
      const ok: [number, number][] = [];
      for (const b of bandas) { const prev = ok[ok.length - 1]; if (!prev || b[0] > prev[1] + 1) ok.push(b); }
      cortes.forEach((c, i) => {
        const b = ok[i];
        if (!b) { c.style.clipPath = "inset(100% 0 0 0)"; return; }
        c.style.clipPath = `inset(${b[0].toFixed(1)}% 0 ${(100 - b[1]).toFixed(1)}% 0)`;
        const sh = (Math.random() < 0.5 ? -1 : 1) * S * rnd(0.04, 0.3) * Math.min(1.4, f);
        c.style.transform = `translateX(${sh.toFixed(1)}px)`;
      });
      // La capa base pierde esas franjas para que el corte se vea limpio: un polígono "peine" que las deja fuera.
      if (ok.length) {
        const pts = ["0 0", "100% 0"];
        for (const b of ok) pts.push(`100% ${b[0].toFixed(1)}%`, `0 ${b[0].toFixed(1)}%`, `0 ${b[1].toFixed(1)}%`, `100% ${b[1].toFixed(1)}%`);
        pts.push("100% 100%", "0 100%");
        const poligono = `polygon(${pts.join(", ")})`;
        for (const e of [base, R, G, B]) e.style.clipPath = poligono;
      } else for (const e of [base, R, G, B]) e.style.clipPath = "";
    };

    const rafaga = () => {
      if (enRafaga || muerto) return;
      enRafaga = true; ultimaRafaga = performance.now();
      const cuadros = 5 + Math.floor(Math.random() * 6);
      let k = 0;
      const siguiente = () => {
        if (muerto) return;
        if (k >= cuadros) { limpiar(); enRafaga = false; programar(); return; }
        // La fuerza sube, se sostiene con altibajos y se apaga; algún cuadro queda limpio.
        const t = k / (cuadros - 1);
        const envolvente = Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)) ;
        if (Math.random() < 0.18) limpiar(); else cuadro(0.35 + envolvente * rnd(0.55, 1.05));
        k++;
        timer = window.setTimeout(siguiente, rnd(34, 92));
      };
      siguiente();
    };
    disparar.current = () => {
      if (!visible || enRafaga || performance.now() - ultimaRafaga < 700) return;
      clearTimeout(timer); rafaga();
    };

    function programar() {
      clearTimeout(timer);
      if (muerto) return;
      if (!visible) { pendiente = true; return; }
      timer = window.setTimeout(rafaga, cfg.current.interval * 1000 * rnd(0.6, 1.5));
    }
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && pendiente) { pendiente = false; programar(); }
    }, { rootMargin: "40px" });
    io.observe(root);
    timer = window.setTimeout(rafaga, 650); // una primera ráfaga pronto, para que se entienda
    return () => { muerto = true; clearTimeout(timer); io.disconnect(); disparar.current = () => {}; };
  }, [texto]);

  const [r, g, b] = rgbDe(color);
  const vars = {
    "--furin-rgb-size": `${size}px`,
    "--furin-rgb-color": color,
    "--furin-rgb-r": `rgb(${r}, 0, 0)`,
    "--furin-rgb-g": `rgb(0, ${g}, 0)`,
    "--furin-rgb-b": `rgb(0, 0, ${b})`,
  } as CSSProperties;

  return (
    <span
      ref={rootRef}
      className={`furin-rgb-glitch ${className}`}
      data-glitch="0"
      style={{ ...vars, ...style }}
      onPointerEnter={() => { if (cfg.current.onHover) disparar.current(); }}
      onPointerDown={() => disparar.current()}
    >
      <span className="furin-rgb-glitch__sr">{texto}</span>
      <span className="furin-rgb-glitch__capa furin-rgb-glitch__base" aria-hidden="true">{texto}</span>
      <span className="furin-rgb-glitch__capa furin-rgb-glitch__canal furin-rgb-glitch__r" aria-hidden="true">{texto}</span>
      <span className="furin-rgb-glitch__capa furin-rgb-glitch__canal furin-rgb-glitch__g" aria-hidden="true">{texto}</span>
      <span className="furin-rgb-glitch__capa furin-rgb-glitch__canal furin-rgb-glitch__b" aria-hidden="true">{texto}</span>
      {Array.from({ length: CORTES }, (_, i) => (
        <span key={i} className="furin-rgb-glitch__capa furin-rgb-glitch__corte" aria-hidden="true">{texto}</span>
      ))}
    </span>
  );
}

export default RGBGlitchText;
