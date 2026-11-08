"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import "./WordRoller.css";

export interface WordRollerProps {
  /** Palabras separadas por "|" (alternativa a `words`). */
  children?: string;
  /** Lista de palabras que ruedan una tras otra. */
  words?: string[];
  /** Texto fijo antes del rodillo. */
  prefix?: string;
  /** Texto fijo después del rodillo. */
  suffix?: string;
  /** Tamaño de la letra, en px. */
  size?: number;
  /** Milisegundos entre cada cambio de palabra. */
  interval?: number;
  /** Ángulo entre una palabra y la siguiente en el tambor, en grados. */
  curvature?: number;
  /** Dibuja una cápsula detrás de la palabra que cambia. */
  pill?: boolean;
  /** Color del texto fijo. */
  color?: string;
  /** Color de la palabra del rodillo. */
  accent?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const DEG = Math.PI / 180;

/** Una palabra rueda verticalmente entre opciones, sobre un tambor 3D con resorte, y su ancho se anima con ella. */
export function WordRoller({
  children = "build|design|launch|scale",
  words,
  prefix = "Your team",
  suffix = "",
  size = 40,
  interval = 2300,
  curvature = 42,
  pill = true,
  color = "#F4F5F7",
  accent = "#7CF5C6",
  className = "",
  style,
}: WordRollerProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const ventanaRef = useRef<HTMLSpanElement>(null);
  const lista = (words && words.length ? words : String(children ?? "").split("|")).map((s) => s.trim()).filter(Boolean);
  const clave = lista.join("\u0001");
  const cfg = useRef({ interval, curvature });
  cfg.current = { interval, curvature };
  const avanzar = useRef<() => void>(() => {});

  useEffect(() => {
    const root = rootRef.current, ventana = ventanaRef.current;
    if (!root || !ventana) return;
    const vent: HTMLSpanElement = ventana;
    const caras = Array.from(ventana.querySelectorAll<HTMLElement>("[data-cara]"));
    const medidas = Array.from(root.querySelectorAll<HTMLElement>("[data-medida]"));
    const n = lista.length;
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let anchos = new Array<number>(n).fill(0);
    let alto = 0, pad = 0, R = 0;
    // Resorte con un ligero rebote: llega, se pasa un poco y se asienta.
    const E = { pos: 0, vel: 0, meta: 0, ultimo: 0 };
    let raf = 0, timer = 0, visible = true, muerto = false, dormidoTimer = false;

    const medir = () => {
      // Si "prefijo + la palabra más larga" no cabe en el contenedor, encoge la letra lo justo.
      root.style.setProperty("--furin-wr-fit", "1");
      const masAncha = Math.max(...medidas.map((m) => m.getBoundingClientRect().width));
      const fs0 = parseFloat(getComputedStyle(root).fontSize) || 40;
      const natural = root.scrollWidth - vent.offsetWidth + masAncha + fs0 * 0.6;
      const libre = (root.parentElement?.clientWidth ?? 0) - 28;
      root.style.setProperty("--furin-wr-fit", (libre > 40 && natural > libre ? Math.max(0.4, libre / natural) : 1).toFixed(3));
      anchos = medidas.map((m) => m.getBoundingClientRect().width);
      const fs = parseFloat(getComputedStyle(root).fontSize) || 40;
      alto = ventana.clientHeight || fs * 1.2;
      pad = fs * 0.3;
      const paso = cfg.current.curvature * DEG;
      R = alto / 2 / Math.tan(Math.max(0.2, paso / 2));
      pintar();
    };

    const mod = (a: number) => ((a % n) + n) % n;
    function pintar() {
      const paso = cfg.current.curvature;
      const base = mod(Math.floor(E.pos));
      const f = E.pos - Math.floor(E.pos);
      const w = anchos[base] + (anchos[mod(base + 1)] - anchos[base]) * f;
      vent.style.width = `${(w + pad * 2).toFixed(2)}px`;
      for (let j = 0; j < n; j++) {
        let d = mod(j - E.pos);
        if (d > n / 2) d -= n;
        const a = d * paso;
        const c = caras[j];
        if (Math.abs(a) > 88) { c.style.visibility = "hidden"; continue; }
        c.style.visibility = "visible";
        c.style.transform = `translateZ(${(-R).toFixed(1)}px) rotateX(${(-a).toFixed(2)}deg) translateZ(${R.toFixed(1)}px)`;
        const o = Math.max(0, Math.cos(a * DEG * 1.12));
        c.style.opacity = (o * o * o * o).toFixed(3);
        c.style.filter = Math.abs(a) > 4 ? `blur(${(Math.abs(a) / 90 * 2.2).toFixed(2)}px)` : "";
      }
    }

    const paso = (now: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.033, (now - (E.ultimo || now)) / 1000 || 0.016);
      E.ultimo = now;
      const k = 190, c = 19;
      // Dos subpasos para que el resorte sea estable aunque un cuadro tarde.
      for (let i = 0; i < 2; i++) {
        E.vel += ((E.meta - E.pos) * k - E.vel * c) * (dt / 2);
        E.pos += E.vel * (dt / 2);
      }
      if (Math.abs(E.meta - E.pos) < 0.0006 && Math.abs(E.vel) < 0.004) { E.pos = E.meta; E.vel = 0; pintar(); E.ultimo = 0; return; }
      pintar();
      raf = requestAnimationFrame(paso);
    };
    const wake = () => { if (!raf && visible && !muerto) { E.ultimo = 0; raf = requestAnimationFrame(paso); } };

    const siguiente = () => {
      if (muerto) return;
      E.meta += 1;
      if (reducido) { E.pos = E.meta; pintar(); } else wake();
      root.dataset.i = String(mod(E.meta));
    };
    avanzar.current = () => { clearTimeout(timer); siguiente(); programar(); };
    function programar() {
      clearTimeout(timer);
      if (muerto || reducido || n < 2) return;
      if (!visible) { dormidoTimer = true; return; }
      timer = window.setTimeout(() => { siguiente(); programar(); }, cfg.current.interval);
    }

    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(root.parentElement ?? root);
    document.fonts?.ready.then(medir);
    document.fonts?.addEventListener?.("loadingdone", medir);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) { wake(); if (dormidoTimer) { dormidoTimer = false; programar(); } }
    }, { rootMargin: "40px" });
    io.observe(root);
    programar();
    return () => {
      muerto = true; avanzar.current = () => {};
      cancelAnimationFrame(raf); clearTimeout(timer);
      ro.disconnect(); io.disconnect();
      document.fonts?.removeEventListener?.("loadingdone", medir);
    };
  }, [clave, curvature, size]);

  const vars = { "--furin-wr-size": `${size}px`, "--furin-wr-color": color, "--furin-wr-accent": accent } as CSSProperties;
  return (
    <span
      ref={rootRef}
      className={`furin-word-roller ${className}`}
      data-pill={pill ? "1" : "0"}
      style={{ ...vars, ...style }}
      onClick={() => avanzar.current()}
    >
      <span className="furin-word-roller__sr">{`${prefix} ${lista.join(", ")} ${suffix}`.trim()}</span>
      <span className="furin-word-roller__vis" aria-hidden="true">
        {prefix ? <span className="furin-word-roller__fijo">{prefix}</span> : null}
        <span ref={ventanaRef} className="furin-word-roller__ventana">
          <span className="furin-word-roller__tambor">
            {lista.map((w, j) => (
              <span key={j} data-cara="" className="furin-word-roller__cara">{w}</span>
            ))}
          </span>
        </span>
        {suffix ? <span className="furin-word-roller__fijo">{suffix}</span> : null}
        {/* Medidores invisibles: dan el ancho natural de cada palabra para animar la cápsula. */}
        <span className="furin-word-roller__medidas">
          {lista.map((w, j) => <span key={j} data-medida="">{w}</span>)}
        </span>
      </span>
    </span>
  );
}

export default WordRoller;
