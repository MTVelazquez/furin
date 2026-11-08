"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import "./PillNav.css";

export interface PillNavTab {
  /** Valor que identifica la pestaña. */
  value: string;
  /** Texto visible. */
  label: string;
  /** Insignia opcional, por ejemplo un contador. */
  badge?: string | number;
}

export interface PillNavProps {
  /** Pestañas: textos o { value, label, badge }. */
  tabs?: (string | PillNavTab)[];
  /** Pestaña activa (modo controlado). */
  value?: string;
  /** Pestaña inicial (modo libre). */
  defaultValue?: string;
  /** Se llama al elegir otra pestaña. */
  onChange?: (value: string) => void;
  /** Contenido de cada panel, por valor de pestaña (opcional). */
  panels?: Record<string, ReactNode>;
  /** Etiqueta accesible de la lista de pestañas. */
  label?: string;
  /** Rigidez del resorte de la píldora: más alto es más seco. */
  stiffness?: number;
  /** Rebote de la píldora: 0.4 se pasa y regresa, 1 llega sin rebotar. */
  damping?: number;
  /** Color de la píldora. */
  color?: string;
  /** Color del texto sobre la píldora. */
  activeTextColor?: string;
  /** Segundos entre cambios automáticos (0 = apagado; se detiene al interactuar). */
  autoplay?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const TABS = ["Overview", { value: "Activity", label: "Activity", badge: 12 }, "Team", "Settings"] as (string | PillNavTab)[];

const norm = (t: string | PillNavTab): PillNavTab => (typeof t === "string" ? { value: t, label: t } : t);

/** Pestañas accesibles con una píldora que se desliza con resorte: el borde que avanza llega primero y el otro lo alcanza, así se estira al cruzar. */
export function PillNav({
  tabs = TABS,
  value,
  defaultValue,
  onChange,
  panels,
  label = "Sections",
  stiffness = 380,
  damping = 0.6,
  color = "#F3F4F7",
  activeTextColor = "#0B0C0F",
  autoplay = 0,
  className = "",
  style,
}: PillNavProps) {
  const lista = tabs.map(norm);
  const n = Math.max(lista.length, 1);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [interno, setInterno] = useState(defaultValue ?? lista[0]?.value);
  const actual = value ?? interno;
  const idx = Math.max(lista.findIndex((t) => t.value === actual), 0);
  const riel = useRef<HTMLDivElement>(null);
  const pildora = useRef<HTMLSpanElement>(null);
  const fantasma = useRef<HTMLSpanElement>(null);
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  const tocado = useRef(false);
  const [listo, setListo] = useState(false);
  // Borde izquierdo y derecho de la píldora: dos resortes con rigidez distinta según hacia dónde va.
  const fis = useRef({ l: 0, r: 0, vl: 0, vr: 0, tl: 0, tr: 0, raf: 0, last: 0, dir: 1, placed: false });
  const live = useRef({ stiffness, damping });
  live.current = { stiffness, damping };

  const elegir = useCallback(
    (v: string) => {
      if (value === undefined) setInterno(v);
      onChange?.(v);
    },
    [value, onChange],
  );

  const pinta = useCallback(() => {
    const p = pildora.current;
    if (!p) return;
    const f = fis.current;
    const w = Math.max(f.r - f.l, 0);
    p.style.width = `${w.toFixed(2)}px`;
    p.style.transform = `translate3d(${f.l.toFixed(2)}px, 0, 0)`;
  }, []);

  const tick = useCallback((t: number) => {
    const f = fis.current;
    f.raf = 0;
    const dt = Math.min(0.032, Math.max(0.001, (t - f.last) / 1000));
    f.last = t;
    const { stiffness: k0, damping: z } = live.current;
    // El borde que va por delante es más rígido; el de atrás se queda y estira la píldora.
    const kl = f.dir > 0 ? k0 * 0.55 : k0 * 1.1;
    const kr = f.dir > 0 ? k0 * 1.1 : k0 * 0.55;
    const steps = 3, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      f.vl += (kl * (f.tl - f.l) - 2 * Math.sqrt(kl) * z * f.vl) * h;
      f.l += f.vl * h;
      f.vr += (kr * (f.tr - f.r) - 2 * Math.sqrt(kr) * z * f.vr) * h;
      f.r += f.vr * h;
    }
    pinta();
    const quieto = Math.abs(f.tl - f.l) < 0.05 && Math.abs(f.tr - f.r) < 0.05 && Math.abs(f.vl) < 0.1 && Math.abs(f.vr) < 0.1;
    if (quieto) { f.l = f.tl; f.r = f.tr; f.vl = f.vr = 0; pinta(); return; }
    f.raf = requestAnimationFrame(tick);
  }, [pinta]);

  /** Mide la pestaña activa y apunta los resortes; con `snap` salta sin animar (primer pintado, redimensionar, reduced motion). */
  const medir = useCallback(
    (snap: boolean) => {
      const b = botones.current[idx];
      const f = fis.current;
      if (!b) return;
      const nl = b.offsetLeft, nr = b.offsetLeft + b.offsetWidth;
      if (Math.abs(nl - f.tl) < 0.01 && Math.abs(nr - f.tr) < 0.01 && f.placed) return;
      f.dir = nl >= f.tl ? 1 : -1;
      f.tl = nl;
      f.tr = nr;
      const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (snap || quieto || !f.placed) {
        f.l = nl; f.r = nr; f.vl = f.vr = 0; f.placed = true;
        pinta();
        return;
      }
      if (!f.raf) { f.last = performance.now(); f.raf = requestAnimationFrame(tick); }
    },
    [idx, pinta, tick],
  );

  useLayoutEffect(() => {
    medir(false);
    setListo(true);
  }, [medir]);

  useEffect(() => {
    const r = riel.current;
    if (!r) return;
    const ro = new ResizeObserver(() => medir(true));
    ro.observe(r);
    botones.current.forEach((b) => b && ro.observe(b));
    const fnt = (document as Document & { fonts?: FontFaceSet }).fonts;
    void fnt?.ready.then(() => medir(true));
    return () => ro.disconnect();
  }, [medir, n]);

  useEffect(() => () => cancelAnimationFrame(fis.current.raf), []);

  // Cambio automático para la demo; se detiene en cuanto la persona toca el control.
  useEffect(() => {
    if (!autoplay || n < 2) return;
    const id = window.setInterval(() => {
      if (tocado.current || document.hidden) return;
      elegir(lista[(idx + 1) % n].value);
    }, autoplay * 1000);
    return () => window.clearInterval(id);
  });

  const tecla = (e: KeyboardEvent, i: number) => {
    let j = i;
    if (e.key === "ArrowRight") j = (i + 1) % n;
    else if (e.key === "ArrowLeft") j = (i - 1 + n) % n;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = n - 1;
    else return;
    e.preventDefault();
    tocado.current = true;
    elegir(lista[j].value);
    botones.current[j]?.focus();
  };

  // Resplandor tenue que sigue al cursor sobre las pestañas.
  const hover = (i: number | null) => {
    const g = fantasma.current;
    const b = i == null ? null : botones.current[i];
    if (!g) return;
    if (!b) { g.style.opacity = "0"; return; }
    g.style.opacity = "1";
    g.style.width = `${b.offsetWidth}px`;
    g.style.transform = `translate3d(${b.offsetLeft}px, 0, 0)`;
  };

  const vars = { "--furin-pill-nav-color": color, "--furin-pill-nav-active": activeTextColor } as CSSProperties;
  const panel = panels?.[lista[idx]?.value];
  return (
    <div className={`furin-pill-nav ${className}`} style={{ ...vars, ...style }}>
      <div
        ref={riel}
        role="tablist"
        aria-label={label}
        className={`furin-pill-nav__riel${listo ? " is-listo" : ""}`}
        onPointerDown={() => { tocado.current = true; }}
        onPointerLeave={() => hover(null)}
      >
        <span ref={fantasma} className="furin-pill-nav__fantasma" aria-hidden="true" />
        <span ref={pildora} className="furin-pill-nav__pildora" aria-hidden="true" />
        {lista.map((t, i) => (
          <button
            key={t.value}
            ref={(el) => { botones.current[i] = el; }}
            type="button"
            role="tab"
            id={`${uid}-t-${i}`}
            aria-selected={i === idx}
            aria-controls={panels ? `${uid}-p-${i}` : undefined}
            tabIndex={i === idx ? 0 : -1}
            className={`furin-pill-nav__tab${i === idx ? " is-on" : ""}`}
            onClick={() => elegir(t.value)}
            onKeyDown={(e) => tecla(e, i)}
            onPointerEnter={(e) => { if (e.pointerType !== "touch") hover(i); }}
            onFocus={() => hover(null)}
          >
            {t.label}
            {t.badge !== undefined ? <span className="furin-pill-nav__insignia">{t.badge}</span> : null}
          </button>
        ))}
      </div>
      {panels ? (
        <div role="tabpanel" id={`${uid}-p-${idx}`} aria-labelledby={`${uid}-t-${idx}`} tabIndex={0} className="furin-pill-nav__panel">
          {panel}
        </div>
      ) : null}
    </div>
  );
}

export default PillNav;
