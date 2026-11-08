"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import "./SpringTooltip.css";

export interface SpringTooltipProps {
  /** Contenido del tooltip. */
  content?: ReactNode;
  /** Elemento sobre el que aparece. Si no pones nada, se dibuja uno de ejemplo. */
  children?: ReactNode;
  /** Textos del elemento de ejemplo (solo se ven si omites children). */
  sample?: { title?: string; text?: string };
  /** Qué tanto se inclina con la velocidad del cursor (0 = no se inclina). */
  tilt?: number;
  /** Rigidez del resorte con el que sigue al cursor. */
  stiffness?: number;
  /** Distancia al cursor, en px. */
  offset?: number;
  /** Milisegundos de espera antes de mostrarse. */
  delay?: number;
  /** Se pasea solo sobre el elemento cuando nadie lo toca. */
  autoplay?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])";

/** Tooltip con física: sigue al cursor con un resorte y cuelga de él como una etiqueta, así que se inclina con la velocidad. */
export function SpringTooltip({
  content = "It tilts with the cursor's speed",
  children,
  sample,
  tilt = 1,
  stiffness = 360,
  offset = 16,
  delay = 0,
  autoplay = false,
  className = "",
  style,
}: SpringTooltipProps) {
  const muestra = { title: "Hover here", text: "and move fast to watch it swing", ...sample };
  const id = "furin-tip-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const wrap = useRef<HTMLSpanElement>(null);
  const globo = useRef<HTMLDivElement>(null);
  const [presente, setPresente] = useState(false);
  const [montado, setMontado] = useState(false);
  const live = useRef({ tilt, stiffness, offset, delay, autoplay });
  live.current = { tilt, stiffness, offset, delay, autoplay };
  // Estado de la simulación: posición del ancla, ángulo del péndulo, escala de entrada.
  const sim = useRef({ x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, ang: 0, vang: 0, esc: 0.5, vesc: 0, abierto: false, raf: 0, last: 0, placed: false, pvx: 0, lastX: 0, lastT: 0, modo: "cursor" as "cursor" | "foco", escapado: false, timer: 0, real: false, lastReal: -1e9, visible: true, autoOn: false });
  const tick = useRef<(t: number) => void>(() => {});

  useEffect(() => setMontado(true), []);

  const arranca = useCallback(() => {
    const s = sim.current;
    if (!s.raf) { s.last = performance.now(); s.raf = requestAnimationFrame((t) => tick.current(t)); }
  }, []);

  // Enlaza el tooltip con el control para lectores de pantalla.
  const describe = useCallback((on: boolean) => {
    const w = wrap.current;
    if (!w) return;
    const f = (w.matches(FOCUSABLE) ? w : w.querySelector(FOCUSABLE)) as HTMLElement | null;
    if (!f) return;
    if (on) f.setAttribute("aria-describedby", id);
    else if (f.getAttribute("aria-describedby") === id) f.removeAttribute("aria-describedby");
  }, [id]);

  tick.current = (nowMs: number) => {
    const s = sim.current, g = globo.current;
    s.raf = 0;
    const dt = Math.min(0.032, Math.max(0.001, (nowMs - s.last) / 1000));
    s.last = nowMs;
    const L = live.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Autoplay: un cursor virtual recorre el elemento cuando nadie lo toca.
    const auto = L.autoplay && s.visible && !s.real && !s.escapado && nowMs - s.lastReal > 2500 && !!wrap.current;
    if (auto && wrap.current) {
      const r = wrap.current.getBoundingClientRect();
      const t = nowMs / 1000;
      s.tx = r.left + r.width * (0.5 + 0.34 * Math.sin(t * 1.1)) + L.offset;
      s.ty = r.top + r.height * (0.5 + 0.28 * Math.sin(t * 1.7 + 0.5)) + L.offset;
      if (!s.abierto) {
        s.modo = "cursor"; s.abierto = true; s.autoOn = true;
        if (!s.placed || s.esc < 0.65) { s.x = s.tx; s.y = s.ty; s.vx = s.vy = 0; s.placed = true; }
        setPresente(true);
      }
    } else if (s.autoOn) {
      s.autoOn = false;
      if (!s.real) s.abierto = false;
    }
    // Aún sin globo en el DOM (se acaba de pedir): espera al siguiente cuadro.
    if (!g) { if (s.abierto || auto || (L.autoplay && s.visible)) s.raf = requestAnimationFrame((t2) => tick.current(t2)); return; }
    // Posición: resorte rígido con poco rebote.
    const k = L.stiffness, c = 2 * Math.sqrt(k) * 0.82;
    const objetivoX = s.tx, objetivoY = s.ty;
    const h = dt / 2;
    for (let i = 0; i < 2; i++) {
      s.vx += (k * (objetivoX - s.x) - c * s.vx) * h;
      s.x += s.vx * h;
      s.vy += (k * (objetivoY - s.y) - c * s.vy) * h;
      s.y += s.vy * h;
    }
    // Péndulo: la etiqueta cuelga del cursor; el ángulo objetivo sale de la velocidad horizontal del ancla.
    const kAng = 120, cAng = 2 * Math.sqrt(kAng) * 0.3;
    const objetivoAng = reduce ? 0 : Math.max(-26, Math.min(26, s.vx * 0.016 * L.tilt));
    s.vang += (kAng * (objetivoAng - s.ang) - cAng * s.vang) * dt;
    s.ang += s.vang * dt;
    // Entrada y salida: escala con resorte flojo (rebota un poco).
    const escObj = s.abierto ? 1 : 0.6;
    s.vesc += ((escObj - s.esc) * 300 - s.vesc * 17) * dt;
    s.esc += s.vesc * dt;
    const speed = Math.hypot(s.vx, s.vy);
    const squash = reduce ? 0 : Math.min(0.12, speed * 0.00018 * L.tilt);
    // El globo no se sale de la ventana: si no cabe a la derecha o abajo, se pone al otro lado del cursor y, si aun así no cabe, se recorta al borde.
    const w = g.offsetWidth, hh = g.offsetHeight;
    const iw = window.innerWidth, ih = window.innerHeight;
    let ax = s.x, ay = s.y, ox: number, oy: number;
    if (s.modo === "cursor") {
      const cx = s.x - L.offset, cy = s.y - L.offset;
      if (ax + w > iw - 8) ax = cx - L.offset - w;
      if (ay + hh > ih - 8) ay = cy - L.offset - hh;
      ax = Math.max(8, Math.min(ax, iw - w - 8));
      ay = Math.max(8, Math.min(ay, ih - hh - 8));
      // El pivote del giro es el punto del cursor, por eso queda fuera del globo.
      ox = cx - ax; oy = cy - ay;
    } else {
      ax = Math.max(8, Math.min(ax, iw - w - 8));
      ox = s.x - ax + w / 2; oy = -10;
    }
    g.style.transformOrigin = `${ox.toFixed(1)}px ${oy.toFixed(1)}px`;
    g.style.transform = `translate3d(${ax.toFixed(2)}px, ${ay.toFixed(2)}px, 0) rotate(${s.ang.toFixed(3)}deg) scale(${(Math.max(s.esc, 0.01) * (1 + squash)).toFixed(3)}, ${(Math.max(s.esc, 0.01) * (1 - squash * 0.8)).toFixed(3)})`;
    g.style.opacity = String(Math.max(0, Math.min(1, (s.esc - 0.6) / 0.4)).toFixed(3));
    const quieto = Math.abs(objetivoX - s.x) < 0.1 && Math.abs(objetivoY - s.y) < 0.1 && Math.abs(s.vx) < 0.5 && Math.abs(s.vy) < 0.5 && Math.abs(s.ang) < 0.05 && Math.abs(s.vang) < 0.1 && Math.abs(escObj - s.esc) < 0.003 && Math.abs(s.vesc) < 0.02;
    if (!quieto || auto || (L.autoplay && s.visible && !s.real)) { s.raf = requestAnimationFrame((t2) => tick.current(t2)); return; }
    if (!s.abierto) setPresente(false);
  };

  const abrir = useCallback((modo: "cursor" | "foco", x: number, y: number) => {
    const s = sim.current;
    window.clearTimeout(s.timer);
    const go = () => {
      s.modo = modo;
      s.abierto = true;
      const o = live.current.offset;
      if (!s.placed || !globo.current?.classList.contains("is-on")) { s.x = x + (modo === "cursor" ? o : 0); s.y = y + (modo === "cursor" ? o : 0); s.vx = s.vy = 0; s.ang = s.vang = 0; s.placed = true; }
      s.tx = x + (modo === "cursor" ? o : 0);
      s.ty = y + (modo === "cursor" ? o : 0);
      setPresente(true);
      describe(true);
      arranca();
    };
    if (live.current.delay > 0 && !s.abierto) s.timer = window.setTimeout(go, live.current.delay);
    else go();
  }, [arranca, describe]);

  const cerrar = useCallback(() => {
    const s = sim.current;
    window.clearTimeout(s.timer);
    s.abierto = false;
    describe(false);
    arranca();
  }, [arranca, describe]);

  // Clase que marca que el globo ya está visible, para decidir si se reubica al abrir.
  useEffect(() => {
    const g = globo.current;
    if (g) g.classList.toggle("is-on", presente);
    if (presente) arranca();
  }, [presente, arranca, montado]);

  useEffect(() => {
    const w = wrap.current;
    if (!w) return;
    const s = sim.current;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      s.escapado = false; s.real = true; s.lastReal = performance.now(); s.autoOn = false;
      const o = live.current.offset;
      if (s.abierto && s.modo === "cursor") { s.tx = e.clientX + o; s.ty = e.clientY + o; arranca(); }
      else abrir("cursor", e.clientX, e.clientY);
    };
    const onLeave = () => { s.real = false; s.lastReal = performance.now(); if (s.modo === "cursor") cerrar(); };
    const onFocusIn = (e: FocusEvent) => {
      if (!(e.target as HTMLElement).matches?.(":focus-visible")) return;
      s.escapado = false;
      const r = (e.target as HTMLElement).getBoundingClientRect();
      abrir("foco", r.left + r.width / 2, r.bottom + 10);
      if (globo.current) s.tx -= globo.current.offsetWidth / 2;
    };
    const onFocusOut = () => cerrar();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && s.abierto) { s.escapado = true; cerrar(); } };
    w.addEventListener("pointermove", onMove);
    w.addEventListener("pointerleave", onLeave);
    w.addEventListener("focusin", onFocusIn);
    w.addEventListener("focusout", onFocusOut);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      w.removeEventListener("pointermove", onMove);
      w.removeEventListener("pointerleave", onLeave);
      w.removeEventListener("focusin", onFocusIn);
      w.removeEventListener("focusout", onFocusOut);
      window.clearTimeout(s.timer);
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
  }, [abrir, cerrar, arranca]);

  // Demo automática: el cursor virtual solo corre mientras el elemento está a la vista.
  useEffect(() => {
    const w = wrap.current;
    if (!autoplay || !w) return;
    const s = sim.current;
    const io = new IntersectionObserver(([en]) => { s.visible = en.isIntersecting; if (s.visible) arranca(); });
    io.observe(w);
    return () => io.disconnect();
  }, [autoplay, arranca]);

  const tip = presente ? (
    <div ref={globo} id={id} role="tooltip" className="furin-spring-tooltip__globo">
      <span className="furin-spring-tooltip__punto" aria-hidden="true" />
      {content}
    </div>
  ) : null;

  return (
    <span ref={wrap} className={`furin-spring-tooltip ${className}`} style={style}>
      {children ?? (
        <button type="button" className="furin-spring-tooltip__ejemplo">
          <span className="furin-spring-tooltip__etq">{muestra.title}</span>
          <span className="furin-spring-tooltip__sub">{muestra.text}</span>
        </button>
      )}
      {montado && tip ? createPortal(tip, document.body) : null}
    </span>
  );
}

export default SpringTooltip;
