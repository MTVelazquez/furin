"use client";
import { useEffect, useId, useRef } from "react";
import type { CSSProperties } from "react";
import "./ProfileFoil.css";

export interface ProfileFoilStat {
  label: string;
  value: string;
}

export interface ProfileFoilProps {
  /** Nombre que va en grande. */
  name?: string;
  /** Rol o título debajo del nombre. */
  role?: string;
  /** Usuario con arroba. */
  handle?: string;
  /** Tres datos de resumen al pie de la tarjeta. */
  stats?: ProfileFoilStat[];
  /** Número de serie impreso en el encabezado. */
  serial?: string;
  /** Fuerza de la lámina holográfica (0 a 1.5). */
  intensity?: number;
  /** Inclinación máxima de la tarjeta, en grados. */
  maxTilt?: number;
  /** Giro del tono de la lámina, en grados. */
  hue?: number;
  /** Si no hay cursor encima, la tarjeta se mece sola. */
  autoplay?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const STATS: ProfileFoilStat[] = [
  { label: "Projects", value: "48" },
  { label: "Followers", value: "12.4k" },
  { label: "Reviews", value: "4.9" },
];

/** Tarjeta de perfil con lámina holográfica: se inclina en 3D y la iridiscencia cambia con el ángulo. */
export function ProfileFoil({
  name = "Alex Rivera",
  role = "Product designer",
  handle = "@alexrivera",
  stats = STATS,
  serial = "No. 0482",
  intensity = 1,
  maxTilt = 14,
  hue = 0,
  autoplay = true,
  className = "",
  style,
}: ProfileFoilProps) {
  const root = useRef<HTMLDivElement>(null);
  const opts = useRef({ maxTilt, autoplay });
  opts.current = { maxTilt, autoplay };
  const uid = useId().replace(/:/g, "");

  useEffect(() => {
    const el = root.current;
    const card = el?.querySelector<HTMLElement>(".furin-profile-foil__card");
    if (!el || !card) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = { x: 0.66, y: 0.3, tx: 0.66, ty: 0.3 };
    let hover = false;
    let visible = true;
    let raf = 0;
    let last = 0;
    const t0 = performance.now();

    const pintar = () => {
      const dx = (s.x - 0.5) * 2;
      const dy = (s.y - 0.5) * 2;
      const m = opts.current.maxTilt;
      const set = (k: string, v: string) => card.style.setProperty(k, v);
      set("--pf-rx", `${(-dy * m).toFixed(2)}deg`);
      set("--pf-ry", `${(dx * m).toFixed(2)}deg`);
      set("--pf-shx", `${(-dx * 22).toFixed(1)}px`);
      set("--pf-shy", `${(18 - dy * 14).toFixed(1)}px`);
      set("--hf-x", `${(50 + dx * 50).toFixed(2)}%`);
      set("--hf-y", `${(50 + dy * 50).toFixed(2)}%`);
      set("--hf-a", `${(dx * 70 + dy * 40).toFixed(1)}deg`);
      set("--hf-ga", `${(112 + dx * 16 - dy * 10).toFixed(1)}deg`);
      set("--hf-sx", `${(dx * 38).toFixed(1)}%`);
      set("--hf-sy", `${(dy * 38).toFixed(1)}%`);
      set("--hf-hue", `${(dx * 46 - dy * 30).toFixed(1)}deg`);
    };

    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      if (!hover && opts.current.autoplay) {
        const t = (now - t0) / 1000;
        s.tx = 0.5 + 0.36 * Math.sin(t * 0.7) + 0.08 * Math.sin(t * 1.7 + 1);
        s.ty = 0.5 + 0.3 * Math.cos(t * 0.52 + 0.6);
      }
      const a = 1 - Math.exp(-dt * 7);
      s.x += (s.tx - s.x) * a;
      s.y += (s.ty - s.y) * a;
      pintar();
      const quieto = Math.abs(s.tx - s.x) < 0.0008 && Math.abs(s.ty - s.y) < 0.0008;
      if (visible && !(quieto && !(opts.current.autoplay && !hover))) raf = requestAnimationFrame(tick);
      else last = 0;
    };
    const wake = () => { if (!raf && visible && !reduce) raf = requestAnimationFrame(tick); };

    const onMove = (e: PointerEvent) => {
      const r = card.getBoundingClientRect();
      // Se mide contra el centro de la tarjeta, con holgura: la inclinación empieza antes de tocarla.
      s.tx = Math.min(1, Math.max(0, 0.5 + (e.clientX - (r.left + r.width / 2)) / (r.width * 1.5)));
      s.ty = Math.min(1, Math.max(0, 0.5 + (e.clientY - (r.top + r.height / 2)) / (r.height * 1.5)));
      hover = true;
      wake();
    };
    const onLeave = () => { hover = false; wake(); };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onMove);
    el.addEventListener("pointerleave", onLeave);
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); }, { threshold: 0.01 });
    io.observe(el);
    pintar();
    wake();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const vars = { "--hf-int": intensity, "--hf-hue0": `${hue}deg` } as CSSProperties;

  return (
    <div ref={root} className={`furin-profile-foil ${className}`} style={{ ...vars, ...style }}>
      <div className="furin-profile-foil__card">
        <span className="furin-profile-foil__metal" aria-hidden />
        <span className="furin-profile-foil__crinkle" aria-hidden />
        <span className="furin-profile-foil__film" aria-hidden />
        <span className="furin-profile-foil__film furin-profile-foil__film--b" aria-hidden />
        <span className="furin-profile-foil__grating" aria-hidden />
        <span className="furin-profile-foil__glint" aria-hidden />
        <span className="furin-profile-foil__sparkle" aria-hidden />
        <span className="furin-profile-foil__grain" aria-hidden />

        <div className="furin-profile-foil__body">
          <div className="furin-profile-foil__top">
            <span className="furin-profile-foil__serial">{serial}</span>
            <span className="furin-profile-foil__chip">PRO</span>
          </div>
          <div className="furin-profile-foil__window">
            <svg viewBox="0 0 240 200" preserveAspectRatio="xMidYMax slice" aria-hidden>
              <defs>
                <linearGradient id={`${uid}a`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#1b1d27" stopOpacity="0.15" />
                  <stop offset="1" stopColor="#07080b" stopOpacity="0.85" />
                </linearGradient>
                <linearGradient id={`${uid}b`} x1="0.1" y1="0" x2="0.9" y2="1">
                  <stop offset="0" stopColor="#4b5063" />
                  <stop offset="0.45" stopColor="#14151c" />
                  <stop offset="1" stopColor="#090a0e" />
                </linearGradient>
                <radialGradient id={`${uid}c`} cx="0.5" cy="0.38" r="0.5">
                  <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
                  <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </radialGradient>
              </defs>
              <rect width="240" height="200" fill={`url(#${uid}a)`} />
              <ellipse cx="120" cy="78" rx="62" ry="62" fill={`url(#${uid}c)`} />
              <path d="M24 205c0-44 36-68 96-68s96 24 96 68z" fill={`url(#${uid}b)`} />
              <circle cx="120" cy="80" r="35" fill={`url(#${uid}b)`} />
              <path d="M85 74a35 35 0 0 1 70 0" fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="1.4" />
              <path d="M24 205c0-44 36-68 96-68s96 24 96 68" fill="none" stroke="#fff" strokeOpacity="0.18" strokeWidth="1.2" />
            </svg>
          </div>
          <div className="furin-profile-foil__id">
            <h3 className="furin-profile-foil__name">{name}</h3>
            <p className="furin-profile-foil__role">{role}</p>
            <p className="furin-profile-foil__handle">{handle}</p>
          </div>
          <ul className="furin-profile-foil__stats">
            {stats.slice(0, 3).map((st) => (
              <li key={st.label}>
                <b>{st.value}</b>
                <span>{st.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default ProfileFoil;
