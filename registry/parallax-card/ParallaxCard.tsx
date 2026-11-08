"use client";
import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import "./ParallaxCard.css";

export interface ParallaxCardProps {
  /** Título grande de la tarjeta. */
  children?: ReactNode;
  /** Texto pequeño sobre el título. */
  eyebrow?: string;
  /** Texto de apoyo debajo del título. */
  caption?: string;
  /** Ancho máximo de la tarjeta, en px. */
  width?: number;
  /** Inclinación máxima bajo el cursor, en grados. */
  tilt?: number;
  /** Cuánto se separan las capas (1 = normal, 0 = planas). */
  depth?: number;
  /** Color del cielo, arriba. */
  skyFrom?: string;
  /** Color del cielo en el horizonte. */
  skyTo?: string;
  /** Color del sujeto (el planeta y su anillo). */
  accent?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const REST_X = 5;
const REST_Y = -9;
const PERSPECTIVE = 900;

/** PRNG determinista para que las estrellas no cambien entre servidor y cliente. */
function rng(seed: number) {
  let a = seed;
  return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; };
}

/** Tarjeta con capas reales en 3D (cielo, estrellas, planeta, anillo, dunas, texto y brillo) que se separan al inclinar. */
export function ParallaxCard({
  children = "Explore",
  eyebrow = "New world",
  caption = "Layers at different depths.",
  width = 300,
  tilt = 14,
  depth = 1,
  skyFrom = "#12104a",
  skyTo = "#ff7a8a",
  accent = "#ffb36b",
  className = "",
  style,
}: ParallaxCardProps) {
  const uid = useId().replace(/:/g, "");
  const rootRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const st = useRef({ rx: REST_X, ry: REST_Y, vx: 0, vy: 0, tx: REST_X, ty: REST_Y });
  const raf = useRef(0);
  const reduced = useRef(false);
  const tiltMax = useRef(tilt);
  tiltMax.current = tilt;

  const stars = useMemo(() => {
    const r = rng(42);
    return Array.from({ length: 70 }, () => ({ x: r() * 100, y: r() * 70, r: 0.12 + r() * r() * 0.42, o: 0.35 + r() * 0.65 }));
  }, []);

  const paint = useCallback(() => {
    const s = st.current;
    const el = tiltRef.current;
    if (!el) return;
    el.style.setProperty("--furin-parallax-card-rx", `${s.rx.toFixed(2)}deg`);
    el.style.setProperty("--furin-parallax-card-ry", `${s.ry.toFixed(2)}deg`);
    el.style.setProperty("--furin-parallax-card-px", (s.ry / 16).toFixed(3));
    el.style.setProperty("--furin-parallax-card-py", (-s.rx / 16).toFixed(3));
    el.style.setProperty("--furin-parallax-card-gx", `${(50 - s.ry * 3).toFixed(1)}%`);
    el.style.setProperty("--furin-parallax-card-gy", `${(35 + s.rx * 3).toFixed(1)}%`);
    rootRef.current?.style.setProperty("--furin-parallax-card-sh", `${(-s.ry * 1.2).toFixed(1)}px`);
  }, []);

  const tick = useCallback(() => {
    raf.current = 0;
    const s = st.current;
    const dt = 1 / 120;
    for (let i = 0; i < 2; i++) {
      s.vx += (120 * (s.tx - s.rx) - 15 * s.vx) * dt; s.rx += s.vx * dt;
      s.vy += (120 * (s.ty - s.ry) - 15 * s.vy) * dt; s.ry += s.vy * dt;
    }
    const moving = Math.abs(s.tx - s.rx) + Math.abs(s.ty - s.ry) > 0.01 || Math.abs(s.vx) + Math.abs(s.vy) > 0.03;
    if (!moving) { s.rx = s.tx; s.ry = s.ty; s.vx = s.vy = 0; }
    paint();
    if (moving) raf.current = requestAnimationFrame(tick);
  }, [paint]);

  const wake = useCallback(() => {
    if (reduced.current) { const s = st.current; s.rx = s.tx; s.ry = s.ty; paint(); return; }
    if (!raf.current) raf.current = requestAnimationFrame(tick);
  }, [paint, tick]);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    paint();
    return () => { cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [paint]);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const ref = shadowRef.current;
    const root = rootRef.current;
    if (!ref || !root || reduced.current) return;
    // Se normaliza contra el tamaño de la tarjeta: a un pelo del borde ya está inclinada al máximo.
    const r = root.getBoundingClientRect();
    const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (ref.offsetWidth * 0.75)));
    const ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (ref.offsetHeight * 0.75)));
    st.current.ty = nx * tiltMax.current;
    st.current.tx = -ny * tiltMax.current;
    wake();
  };
  const onLeave = () => { st.current.tx = REST_X; st.current.ty = REST_Y; wake(); };

  const vars = {
    "--furin-parallax-card-w": `${width}px`,
    "--furin-parallax-card-depth": depth,
    "--furin-parallax-card-persp": `${PERSPECTIVE}px`,
    "--furin-parallax-card-persp-n": PERSPECTIVE,
    "--furin-parallax-card-from": skyFrom,
    "--furin-parallax-card-to": skyTo,
    "--furin-parallax-card-accent": accent,
  } as CSSProperties;

  // z (px) de cada capa; la escala compensa la perspectiva para que en reposo todo encaje.
  const z = (n: number) => ({ "--furin-parallax-card-z": n } as CSSProperties);
  const ringPath = (rx: number, ry: number) => `M ${50 - rx} 52 A ${rx} ${ry} 0 1 0 ${50 + rx} 52 A ${rx} ${ry} 0 1 0 ${50 - rx} 52`;

  return (
    <div ref={rootRef} className={`furin-parallax-card ${className}`} style={{ ...vars, ...style }} onPointerMove={onMove} onPointerLeave={onLeave}>
      <div ref={shadowRef} className="furin-parallax-card__shadow" aria-hidden="true" />
      <div ref={tiltRef} className="furin-parallax-card__tilt" role="img" aria-label={`${typeof children === "string" ? children : "Card"}. ${caption}`}>
        {/* Cielo */}
        <div className="furin-parallax-card__layer furin-parallax-card__sky" style={z(-70)} />
        {/* Estrellas */}
        <div className="furin-parallax-card__layer furin-parallax-card__clip" style={z(-52)}>
          <svg viewBox="0 0 100 133" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            {stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y * 1.3} r={s.r} fill="#fff" opacity={s.o} />)}
          </svg>
        </div>
        {/* Montañas lejanas */}
        <div className="furin-parallax-card__layer furin-parallax-card__clip" style={z(-34)}>
          <svg viewBox="0 0 100 133" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={`${uid}-m1`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7b3f8f" /><stop offset="1" stopColor="#2a1760" /></linearGradient>
            </defs>
            <path d="M0 80 L12 70 L21 75 L34 59 L46 73 L58 63 L71 77 L84 61 L100 74 V133 H0Z" fill={`url(#${uid}-m1)`} opacity="0.85" />
          </svg>
        </div>
        {/* Anillo (la mitad de atrás) */}
        <div className="furin-parallax-card__layer" style={z(-12)}>
          <svg viewBox="0 0 100 133" aria-hidden="true">
            <defs>
              <linearGradient id={`${uid}-r`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--furin-parallax-card-accent)" stopOpacity="0" /><stop offset="0.25" stopColor="var(--furin-parallax-card-accent)" stopOpacity="0.9" /><stop offset="0.75" stopColor="#ffe6c4" stopOpacity="0.95" /><stop offset="1" stopColor="var(--furin-parallax-card-accent)" stopOpacity="0" /></linearGradient>
              <clipPath id={`${uid}-back`}><rect x="-60" y="-80" width="220" height="132" transform="rotate(-16 50 52)" /></clipPath>
            </defs>
            <g clipPath={`url(#${uid}-back)`} fill="none" stroke={`url(#${uid}-r)`}>
              <path d={ringPath(40, 9.5)} transform="rotate(-16 50 52)" strokeWidth="2.6" opacity="0.9" />
              <path d={ringPath(35, 8)} transform="rotate(-16 50 52)" strokeWidth="1.2" opacity="0.7" />
              <path d={ringPath(31.5, 7)} transform="rotate(-16 50 52)" strokeWidth="0.6" opacity="0.6" />
            </g>
          </svg>
        </div>
        {/* Sujeto: el planeta */}
        <div className="furin-parallax-card__layer" style={z(8)}>
          <div className="furin-parallax-card__planet" />
        </div>
        {/* Anillo (la mitad de adelante) */}
        <div className="furin-parallax-card__layer" style={z(26)}>
          <svg viewBox="0 0 100 133" aria-hidden="true">
            <defs>
              <clipPath id={`${uid}-front`}><rect x="-60" y="52" width="220" height="132" transform="rotate(-16 50 52)" /></clipPath>
            </defs>
            <g clipPath={`url(#${uid}-front)`} fill="none" stroke={`url(#${uid}-r)`}>
              <path d={ringPath(40, 9.5)} transform="rotate(-16 50 52)" strokeWidth="2.6" opacity="0.95" />
              <path d={ringPath(35, 8)} transform="rotate(-16 50 52)" strokeWidth="1.2" opacity="0.8" />
              <path d={ringPath(31.5, 7)} transform="rotate(-16 50 52)" strokeWidth="0.6" opacity="0.7" />
            </g>
          </svg>
        </div>
        {/* Dunas de primer plano */}
        <div className="furin-parallax-card__layer furin-parallax-card__clip" style={z(46)}>
          <svg viewBox="0 0 100 133" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={`${uid}-d`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1c0d44" /><stop offset="1" stopColor="#07031a" /></linearGradient>
              <linearGradient id={`${uid}-dl`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--furin-parallax-card-to)" stopOpacity="0" /><stop offset="0.55" stopColor="var(--furin-parallax-card-to)" stopOpacity="0.95" /><stop offset="1" stopColor="var(--furin-parallax-card-to)" stopOpacity="0.1" /></linearGradient>
            </defs>
            <path d="M0 88 C 18 79, 34 83, 52 88 S 86 80, 100 75 V133 H0Z" fill={`url(#${uid}-d)`} />
            <path d="M0 88 C 18 79, 34 83, 52 88 S 86 80, 100 75" fill="none" stroke={`url(#${uid}-dl)`} strokeWidth="0.45" />
          </svg>
        </div>
        {/* Texto */}
        <div className="furin-parallax-card__layer furin-parallax-card__text" style={z(86)}>
          <span className="furin-parallax-card__eyebrow">{eyebrow}</span>
          <h3 className="furin-parallax-card__title">{children}</h3>
          <p className="furin-parallax-card__caption">{caption}</p>
        </div>
        {/* Brillo */}
        <div className="furin-parallax-card__layer furin-parallax-card__shine" style={z(118)} />
      </div>
    </div>
  );
}

export default ParallaxCard;
