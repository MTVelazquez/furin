"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import "./GooeyTabs.css";

export type GooeyTab = string | { value: string; label: string };

export interface GooeyTabsProps {
  /** Etiquetas de las pestañas (o { value, label }). */
  tabs?: GooeyTab[];
  /** Pestaña activa (modo controlado). */
  value?: string;
  /** Pestaña activa al inicio (modo libre). */
  defaultValue?: string;
  /** Color del líquido de la selección. */
  color?: string;
  /** Color de las pestañas inactivas. */
  textColor?: string;
  /** Color de la pestaña activa, sobre el líquido. */
  activeTextColor?: string;
  /** Qué tan pegajoso es el líquido (desenfoque del filtro). */
  gooeyness?: number;
  /** Segundos entre cambios automáticos (0 lo apaga); se detiene al tocar. */
  autoplay?: number;
  /** Se llama al cambiar de pestaña. */
  onChange?: (value: string) => void;
  /** Nombre accesible de la lista de pestañas. */
  "aria-label"?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const DEFAULT_TABS = ["Home", "Projects", "Team", "Contact"];
// Cada gota del cuerpo persigue la pestaña con un resorte distinto: la primera llega rápido y las demás se quedan estiradas atrás.
const STIFF = [420, 290, 200, 138];
const BLOBS = STIFF.length;

/** Pestañas con selección de líquido: varias gotas encadenadas con resortes y un filtro SVG que las funde, con brillo especular. */
export function GooeyTabs({
  tabs = DEFAULT_TABS,
  value,
  defaultValue,
  color = "#EEF1FF",
  textColor = "#A8B0C6",
  activeTextColor = "#0B0C12",
  gooeyness = 7,
  autoplay = 0,
  onChange,
  "aria-label": ariaLabel = "Tabs",
  className = "",
  style,
}: GooeyTabsProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const filterId = `furin-gooey-${uid}`;
  const items = tabs.map((t) => (typeof t === "string" ? { value: t, label: t } : t));
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? items[0]?.value ?? "");
  const current = controlled ? value! : inner;
  const idx = Math.max(0, items.findIndex((t) => t.value === current));

  const root = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const blobRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [ready, setReady] = useState(false);
  const touched = useRef(false);
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const wakeRef = useRef<() => void>(() => {});

  const select = useCallback(
    (i: number, fromUser = true) => {
      const next = items[i];
      if (!next) return;
      if (fromUser) touched.current = true;
      if (!controlled) setInner(next.value);
      onChange?.(next.value);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controlled, onChange, items.map((t) => t.value).join("|")],
  );

  const onKeyDown = (e: KeyboardEvent) => {
    let to = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") to = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = items.length - 1;
    if (to < 0) return;
    e.preventDefault();
    select(to);
    tabRefs.current[to]?.focus();
  };

  const key = items.map((t) => t.label).join("|");
  // Simulación de las gotas: se arma una vez y lee la pestaña objetivo de idxRef.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const x = new Float32Array(BLOBS), vx = new Float32Array(BLOBS), w = new Float32Array(BLOBS), vw = new Float32Array(BLOBS);
    let tx = 0, tw = 0, ty = 0, th = 0, rootW = 0, started = false;
    let raf = 0, last = 0, visible = true;

    const measure = () => {
      const tab = tabRefs.current[idxRef.current];
      if (!tab) return false;
      const rr = el.getBoundingClientRect();
      const tr = tab.getBoundingClientRect();
      tx = tr.left - rr.left - 1; // 1 px de borde del contenedor
      ty = tr.top - rr.top - 1;
      tw = tr.width;
      th = tr.height;
      rootW = rr.width;
      return true;
    };
    const paint = () => {
      for (let j = 0; j < BLOBS; j++) {
        const b = blobRefs.current[j];
        if (!b) continue;
        // las gotas rezagadas se adelgazan: así se forma el cuello del líquido
        const lag = Math.min(1, Math.abs(x[j] - x[0]) / Math.max(tw * 1.6, 1) + Math.abs(w[j] - w[0]) / Math.max(tw * 2, 1));
        const h = th * (1 - 0.34 * lag * (j / (BLOBS - 1)));
        const px = Math.min(Math.max(x[j], 0), Math.max(0, rootW - 2 - w[j]));
        b.style.transform = `translate3d(${px}px, ${ty + (th - h) / 2}px, 0)`;
        b.style.width = `${Math.max(w[j], 1)}px`;
        b.style.height = `${Math.max(h, 1)}px`;
      }
    };
    const snap = () => {
      if (!measure()) return;
      for (let j = 0; j < BLOBS; j++) {
        x[j] = tx;
        w[j] = tw;
        vx[j] = vw[j] = 0;
      }
      paint();
    };
    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(1 / 30, Math.max(0.001, (now - last) / 1000));
      last = now;
      measure();
      let moving = false;
      const sub = 3;
      const h = dt / sub;
      for (let s = 0; s < sub; s++) {
        for (let j = 0; j < BLOBS; j++) {
          const k = STIFF[j];
          const c = 2 * Math.sqrt(k) * 0.86;
          vx[j] += ((tx - x[j]) * k - vx[j] * c) * h;
          x[j] += vx[j] * h;
          vw[j] += ((tw - w[j]) * k - vw[j] * c) * h;
          w[j] += vw[j] * h;
        }
      }
      for (let j = 0; j < BLOBS; j++) {
        if (Math.abs(tx - x[j]) > 0.06 || Math.abs(vx[j]) > 0.1 || Math.abs(tw - w[j]) > 0.06 || Math.abs(vw[j]) > 0.1) moving = true;
      }
      if (!moving) {
        for (let j = 0; j < BLOBS; j++) {
          x[j] = tx;
          w[j] = tw;
          vx[j] = vw[j] = 0;
        }
      }
      paint();
      if (moving && visible) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (!started) return;
      if (reduce) {
        snap();
        return;
      }
      if (raf || !visible) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    wakeRef.current = wake;

    const start = () => {
      if (!measure()) return;
      snap();
      started = true;
      setReady(true);
    };
    start();
    document.fonts?.ready.then(() => {
      snap();
    });
    const ro = new ResizeObserver(() => {
      if (!started) start();
      else snap();
    });
    ro.observe(el);
    const io = new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
      if (visible) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        snap();
      }
    });
    io.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      wakeRef.current = () => {};
    };
  }, [key, gooeyness]);

  // La pestaña cambió: las gotas salen hacia la nueva.
  useEffect(() => {
    wakeRef.current();
  }, [idx]);

  // Cambio automático para la demo, hasta que alguien toque.
  useEffect(() => {
    if (!autoplay || autoplay <= 0 || items.length < 2) return;
    const id = window.setInterval(() => {
      if (touched.current || document.hidden) return;
      select((idxRef.current + 1) % items.length, false);
    }, autoplay * 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, key, select]);

  const sigma = Math.max(1, gooeyness);
  const vars = { "--furin-gt-pill": color, "--furin-gt-text": textColor, "--furin-gt-active": activeTextColor } as CSSProperties;
  return (
    <div
      ref={root}
      className={`furin-gooey-tabs${ready ? " is-ready" : ""} ${className}`}
      style={{ ...vars, ...style }}
      onPointerDown={() => {
        touched.current = true;
      }}
    >
      <svg className="furin-gooey-tabs__svg" aria-hidden="true" focusable="false">
        <defs>
          <filter id={filterId} x="-20%" y="-90%" width="140%" height="280%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation={sigma} result="difuso" />
            <feColorMatrix in="difuso" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -9.5" result="goo" />
            <feGaussianBlur in="goo" stdDeviation="2.2" result="relieve" />
            <feDiffuseLighting in="relieve" surfaceScale="3.6" diffuseConstant="1.22" lightingColor="#ffffff" result="difusa">
              <feDistantLight azimuth="240" elevation="58" />
            </feDiffuseLighting>
            <feComposite in="goo" in2="difusa" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="cuerpo" />
            <feSpecularLighting in="relieve" surfaceScale="6" specularConstant="1.1" specularExponent="26" lightingColor="#ffffff" result="brillo">
              <feDistantLight azimuth="240" elevation="50" />
            </feSpecularLighting>
            <feComposite in="brillo" in2="goo" operator="in" result="brilloDentro" />
            <feComposite in="cuerpo" in2="brilloDentro" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" />
          </filter>
        </defs>
      </svg>
      <div className="furin-gooey-tabs__goo" aria-hidden="true" style={{ filter: `url(#${filterId})` }}>
        {Array.from({ length: BLOBS }, (_, j) => (
          <span key={j} ref={(n) => { blobRefs.current[j] = n; }} className="furin-gooey-tabs__blob" />
        ))}
      </div>
      <div role="tablist" aria-label={ariaLabel} className="furin-gooey-tabs__lista" onKeyDown={onKeyDown}>
        {items.map((t, i) => (
          <button
            key={t.value}
            ref={(n) => { tabRefs.current[i] = n; }}
            type="button"
            role="tab"
            id={`${filterId}-tab-${i}`}
            aria-selected={i === idx}
            tabIndex={i === idx ? 0 : -1}
            className="furin-gooey-tabs__tab"
            onClick={() => select(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default GooeyTabs;
