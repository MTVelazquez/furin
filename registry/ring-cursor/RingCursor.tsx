"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./RingCursor.css";

export interface RingCursorProps {
  /** Diámetro del anillo en reposo, en px. */
  size?: number;
  /** Color del anillo y del punto. */
  color?: string;
  /** Rigidez del resorte: más alto sigue más pegado al cursor. */
  stiffness?: number;
  /** Rebote del resorte: 0.3 se pasa y regresa, 1 llega sin rebotar. */
  damping?: number;
  /** Sobre un elemento clicable, el anillo se vuelve su silueta (si no, solo se agranda). */
  snap?: boolean;
  /** Cuánto se agranda sobre un clicable cuando no se ajusta a su silueta. */
  grow?: number;
  /** Selector de lo que cuenta como clicable. */
  selector?: string;
  /** Muestra el punto central que sigue al cursor sin retraso. */
  dot?: boolean;
  /** Oculta el cursor del sistema dentro del contenedor. */
  hideCursor?: boolean;
  /** Sigue al cursor en toda la ventana en vez de solo en el contenedor. */
  global?: boolean;
  /** Se pasea solo, visitando lo clicable, cuando nadie mueve el cursor. */
  autoplay?: boolean;
  /** Contenido que queda debajo del cursor (por defecto, unos botones de ejemplo). */
  children?: ReactNode;
  /** Textos del contenido de muestra (solo se ven si omites children). */
  sample?: { title?: string; primary?: string; secondary?: string; link?: string };
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const CLICABLE = "a[href], button, [role='button'], [role='tab'], [role='link'], input, select, textarea, summary, label[for], [data-cursor]";

/** Muelle escalar con velocidad: devuelve el nuevo valor y actualiza v por referencia. */
function muelle(x: number, v: number, to: number, k: number, c: number, dt: number): [number, number] {
  const n = 3;
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    v += (k * (to - x) - c * v) * h;
    x += v * h;
  }
  return [x, v];
}

/** Anillo con retraso elástico: se estira con la velocidad, se ajusta a la silueta de lo clicable y se aprieta al pulsar. */
export function RingCursor({
  size = 38,
  color = "#FFFFFF",
  stiffness = 260,
  damping = 0.62,
  snap = true,
  grow = 1.9,
  selector = CLICABLE,
  dot = true,
  hideCursor = true,
  global = false,
  autoplay = false,
  children,
  sample,
  className = "",
  style,
}: RingCursorProps) {
  const host = useRef<HTMLDivElement>(null);
  const anillo = useRef<HTMLDivElement>(null);
  const punto = useRef<HTMLSpanElement>(null);
  const [activo, setActivo] = useState(true);
  const live = useRef({ size, stiffness, damping, snap, grow, selector, autoplay });
  live.current = { size, stiffness, damping, snap, grow, selector, autoplay };

  useEffect(() => {
    const el = host.current;
    const ring = anillo.current;
    if (!el || !ring) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setActivo(false); return; }
    const pt = punto.current;
    // Estado de los cinco muelles: x, y, ancho, alto y radio.
    const S = { x: 0, y: 0, w: 38, h: 38, r: 19 };
    const V = { x: 0, y: 0, w: 0, h: 0, r: 0 };
    let tx = 0, ty = 0, inside = false, placed = false, lastReal = -1e9, raf = 0, last = 0, visible = true;
    let hover: Element | null = null, press = false, press1 = 1, pressV = 0, show = 0, t = 0;
    let autoEl: Element | null = null;

    const origin = () => (global ? { left: 0, top: 0 } : el.getBoundingClientRect());
    const hitTest = (target: EventTarget | null) => {
      const n = target instanceof Element ? target.closest(live.current.selector) : null;
      return n && el.contains(n) ? n : null;
    };

    const frame = (nowMs: number) => {
      raf = 0;
      const dt = Math.min(0.04, Math.max(0.001, (nowMs - last) / 1000));
      last = nowMs;
      t += dt;
      const L = live.current;
      const o = origin();
      const auto = L.autoplay && (!inside || nowMs - lastReal > 2500);
      if (auto) {
        // Recorre los clicables del contenedor: va, se queda un momento sobre cada uno y sigue.
        const list = Array.from(el.querySelectorAll(L.selector));
        const leg = 1.7;
        const i = Math.floor(t / leg);
        const ph = (t / leg) % 1;
        const a = list[i % Math.max(list.length, 1)], b = list[(i + 1) % Math.max(list.length, 1)];
        if (a && b) {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          const e = ph < 0.45 ? 0 : Math.min(1, (ph - 0.45) / 0.45);
          const k = e * e * (3 - 2 * e);
          tx = ra.left + ra.width / 2 + (rb.left + rb.width / 2 - ra.left - ra.width / 2) * k - o.left;
          ty = ra.top + ra.height / 2 + (rb.top + rb.height / 2 - ra.top - ra.height / 2) * k - o.top;
          autoEl = k < 0.5 ? a : b;
          hover = ph > 0.12 && ph < 0.92 ? autoEl : null;
        } else {
          tx = el.clientWidth * (0.5 + 0.3 * Math.sin(t)); ty = el.clientHeight * (0.5 + 0.2 * Math.sin(t * 1.6));
          hover = null;
        }
        if (!placed) { S.x = tx; S.y = ty; placed = true; }
      } else if (autoEl) { autoEl = null; }

      const vis = inside || auto;
      show += ((vis ? 1 : 0) - show) * (1 - Math.exp(-dt * 12));
      pressV += ((press ? 0.86 : 1) - press1) * 420 * dt - pressV * 16 * dt;
      press1 += pressV * dt;

      // Objetivos: silueta del clicable o círculo en reposo.
      let gx = tx, gy = ty, gw = L.size, gh = L.size, gr = L.size / 2, snapped = false;
      if (hover && hover.isConnected) {
        if (L.snap) {
          const rc = hover.getBoundingClientRect();
          const cx = rc.left + rc.width / 2 - o.left, cy = rc.top + rc.height / 2 - o.top;
          // La silueta se deja atraer un poco hacia el cursor, como un imán suave.
          gx = cx + (tx - cx) * 0.14;
          gy = cy + (ty - cy) * 0.18;
          gw = rc.width + 14;
          gh = rc.height + 12;
          const br = parseFloat(getComputedStyle(hover).borderTopLeftRadius) || 0;
          gr = Math.min(br + 6, gw / 2, gh / 2);
          snapped = true;
        } else {
          gw = gh = L.size * L.grow;
          gr = gw / 2;
        }
      }
      const k = L.stiffness, c = 2 * Math.sqrt(k) * L.damping;
      if (!placed) { S.x = tx; S.y = ty; placed = true; }
      [S.x, V.x] = muelle(S.x, V.x, gx, k, c, dt);
      [S.y, V.y] = muelle(S.y, V.y, gy, k, c, dt);
      const kk = snapped ? k * 1.1 : k * 0.8;
      const cc = 2 * Math.sqrt(kk) * 0.72;
      [S.w, V.w] = muelle(S.w, V.w, gw, kk, cc, dt);
      [S.h, V.h] = muelle(S.h, V.h, gh, kk, cc, dt);
      [S.r, V.r] = muelle(S.r, V.r, gr, kk, cc, dt);

      // Estiramiento por velocidad (solo cuando va libre): se alarga en la dirección del movimiento.
      const sp = Math.hypot(V.x, V.y);
      const stretch = snapped ? 0 : Math.min(0.42, sp * 0.00046);
      const ang = Math.atan2(V.y, V.x);
      const W = Math.max(S.w, 1), H = Math.max(S.h, 1);
      ring.style.width = `${W.toFixed(2)}px`;
      ring.style.height = `${H.toFixed(2)}px`;
      ring.style.borderRadius = `${Math.max(S.r, 0).toFixed(2)}px`;
      ring.style.opacity = String(Math.min(1, show).toFixed(3));
      ring.style.transform = `translate3d(${(S.x - W / 2).toFixed(2)}px, ${(S.y - H / 2).toFixed(2)}px, 0) rotate(${ang}rad) scale(${(1 + stretch).toFixed(3)}, ${(1 / (1 + stretch * 0.7)).toFixed(3)}) rotate(${-ang}rad) scale(${Math.max(press1, 0.5).toFixed(3)})`;
      ring.classList.toggle("is-snap", snapped);
      if (pt) {
        pt.style.opacity = snapped ? "0" : String(show.toFixed(3));
        pt.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${(press ? 1.8 : 1)})`;
      }
      const moving = Math.abs(S.x - gx) > 0.05 || Math.abs(S.y - gy) > 0.05 || Math.abs(S.w - gw) > 0.05 || Math.abs(S.h - gh) > 0.05 || Math.abs(V.x) > 0.5 || Math.abs(V.y) > 0.5 || Math.abs(V.w) > 0.2 || Math.abs(V.r) > 0.2 || Math.abs(press1 - (press ? 0.86 : 1)) > 0.002 || Math.abs(pressV) > 0.01 || Math.abs(show - (vis ? 1 : 0)) > 0.004;
      if ((moving || auto) && visible) raf = requestAnimationFrame(frame);
    };
    const wake = () => { if (raf || !visible) return; last = performance.now(); raf = requestAnimationFrame(frame); };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const o = origin();
      tx = e.clientX - o.left;
      ty = e.clientY - o.top;
      hover = hitTest(e.target);
      if (!inside && (!placed || show < 0.05)) { S.x = tx; S.y = ty; V.x = V.y = 0; placed = true; }
      inside = true;
      lastReal = performance.now();
      wake();
    };
    const onLeave = () => { inside = false; hover = null; wake(); };
    const onDown = (e: PointerEvent) => { if (e.pointerType === "touch") return; press = true; wake(); };
    const onUp = () => { press = false; wake(); };
    const evTarget: EventTarget = global ? window : el;
    evTarget.addEventListener("pointermove", onMove as EventListener);
    evTarget.addEventListener("pointerdown", onDown as EventListener);
    evTarget.addEventListener("pointerup", onUp);
    evTarget.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onLeave);
    if (global) document.documentElement.addEventListener("pointerleave", onLeave);
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } });
    io.observe(el);
    wake();
    return () => {
      cancelAnimationFrame(raf);
      evTarget.removeEventListener("pointermove", onMove as EventListener);
      evTarget.removeEventListener("pointerdown", onDown as EventListener);
      evTarget.removeEventListener("pointerup", onUp);
      evTarget.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onLeave);
      if (global) document.documentElement.removeEventListener("pointerleave", onLeave);
      io.disconnect();
    };
  }, [global]);

  const vars = { "--furin-ring-color": color } as CSSProperties;
  return (
    <div ref={host} className={`furin-ring-cursor${hideCursor && activo ? " furin-ring-cursor--sin-cursor" : ""} ${className}`} style={{ ...vars, ...style }}>
      <div className="furin-ring-cursor__contenido">{children ?? <Demo {...sample} />}</div>
      {activo ? (
        <div className={`furin-ring-cursor__capa${global ? " furin-ring-cursor__capa--global" : ""}`} aria-hidden="true">
          <div ref={anillo} className="furin-ring-cursor__anillo" />
          {dot ? <span ref={punto} className="furin-ring-cursor__punto" /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Contenido de ejemplo: lo que se ilumina es todo lo clicable. */
function Demo({ title = "Everything clickable\nis recognized.", primary = "Get started", secondary = "Documentation", link = "See examples" }: { title?: string; primary?: string; secondary?: string; link?: string }) {
  return (
    <div className="furin-ring-cursor__demo">
      <p className="furin-ring-cursor__titulo">{title.split("\n").flatMap((l, i) => (i ? [<br key={i} />, l] : [l]))}</p>
      <div className="furin-ring-cursor__fila">
        <button type="button" className="furin-ring-cursor__btn furin-ring-cursor__btn--lleno">{primary}</button>
        <button type="button" className="furin-ring-cursor__btn">{secondary}</button>
        <a href="#anillo" className="furin-ring-cursor__enlace" onClick={(e) => e.preventDefault()}>{link}</a>
      </div>
    </div>
  );
}

export default RingCursor;
