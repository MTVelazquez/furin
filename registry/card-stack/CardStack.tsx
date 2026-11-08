"use client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import "./CardStack.css";

export interface CardStackItem {
  /** Título grande de la tarjeta. */
  title: string;
  /** Texto de apoyo. */
  caption?: string;
  /** Color de arranque del degradado. */
  from?: string;
  /** Color de cierre del degradado. */
  to?: string;
}

export interface CardStackProps {
  /** Tarjetas del mazo, de arriba hacia abajo. */
  cards?: CardStackItem[];
  /** Ancho de cada tarjeta, en px. */
  width?: number;
  /** Cuánto asoma cada tarjeta de abajo, en px. */
  fan?: number;
  /** Giro máximo de las tarjetas del mazo, en grados. */
  messiness?: number;
  /** Distancia de arrastre que baraja la tarjeta, en px. */
  threshold?: number;
  /** Se llama con el índice de la tarjeta que acaba de quedar arriba. */
  onShuffle?: (topIndex: number) => void;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const DEFAULT_CARDS: CardStackItem[] = [
  { title: "Sunrise", caption: "Cold light over the bay", from: "#ff8a5c", to: "#ff3d7f" },
  { title: "Tide", caption: "Blues that never repeat", from: "#5b6cff", to: "#27c6ff" },
  { title: "Jungle", caption: "Damp green, long shadows", from: "#22d3a0", to: "#0a6f63" },
  { title: "Golden", caption: "The hour when everything glows", from: "#ffd166", to: "#ff8f3d" },
  { title: "Night", caption: "Quiet, with neon in the distance", from: "#3a3f55", to: "#12141c" },
];

interface S { x: number; y: number; r: number; s: number; d: number; vx: number; vy: number; vr: number; vs: number; vd: number; phase: "idle" | "drag" | "fly" | "back"; t: number }
const TAU_DEG = 180 / Math.PI;
void TAU_DEG;

/** Mazo de tarjetas: arrastra la de arriba con inercia y giro; al soltarla se baraja y vuelve al fondo del mazo con resorte. */
export function CardStack({
  cards = DEFAULT_CARDS,
  width = 250,
  fan = 18,
  messiness = 4,
  threshold = 90,
  onShuffle,
  className = "",
  style,
}: CardStackProps) {
  const n = cards.length;
  const rootRef = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const order = useRef<number[]>(Array.from({ length: n }, (_, i) => i));
  const S = useRef<S[]>([]);
  const raf = useRef(0);
  const last = useRef(0);
  const drag = useRef({ id: -1, i: -1, sx: 0, sy: 0, dx: 0, dy: 0, t0: 0, samples: [] as { t: number; x: number; y: number }[] });
  const reduced = useRef(false);
  const live = useRef<HTMLSpanElement>(null);
  const cfg = useRef({ fan, messiness, threshold, onShuffle });
  cfg.current = { fan, messiness, threshold, onShuffle };

  // Giro fijo de cada tarjeta (determinista): alterna lados para que el mazo se vea hecho a mano.
  const jitter = useMemo(() => cards.map((_, i) => (((i * 37) % 11) / 10 - 0.35) * (i % 2 ? 1 : -1)), [cards]);

  const pose = useCallback((rank: number, i: number) => {
    const { fan: f, messiness: m } = cfg.current;
    const d = Math.min(rank, 4);
    return { x: 0, y: -d * f, r: rank === 0 ? jitter[i] * m * 0.12 : jitter[i] * m, s: 1 - d * 0.04, d: Math.min(d * 0.13, 0.5) };
  }, [jitter]);

  const applyOrder = useCallback(() => {
    order.current.forEach((i, rank) => {
      const el = els.current[i];
      if (!el) return;
      el.style.zIndex = String(n - rank);
      el.dataset.top = rank === 0 ? "true" : "false";
      el.setAttribute("aria-hidden", rank === 0 ? "false" : "true");
      el.tabIndex = -1;
    });
    const top = cards[order.current[0]];
    if (live.current && top) live.current.textContent = `${top.title}. Card ${order.current[0] + 1} of ${n}.`;
  }, [cards, n]);

  const paint = useCallback((i: number) => {
    const el = els.current[i], c = S.current[i];
    if (!el || !c) return;
    el.style.transform = `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, 0) rotate(${c.r.toFixed(3)}deg) scale(${c.s.toFixed(4)})`;
    el.style.setProperty("--furin-card-stack-dim", Math.max(0, c.d).toFixed(3));
    el.style.setProperty("--furin-card-stack-sx", String(Math.max(-1, Math.min(1, c.x / (el.offsetWidth || 250)))));
    el.style.setProperty("--furin-card-stack-lift", c.phase === "drag" || c.phase === "fly" ? "1" : "0");
  }, []);

  const tick = useCallback((now: number) => {
    raf.current = 0;
    const dt = Math.min(0.033, (now - last.current) / 1000 || 0.016);
    last.current = now;
    let moving = false;
    const W = rootRef.current?.offsetWidth || 250;
    const dr = drag.current;
    const topIdx = order.current[0];
    // Cuánto se ha sacado la tarjeta de arriba: las de abajo "se asoman" un poco para anticipar el relevo.
    const topC = S.current[topIdx];
    const prog = topC && (topC.phase === "drag" || topC.phase === "fly") ? Math.min(1, Math.hypot(topC.x, topC.y) / (W * 0.7)) : 0;

    for (let i = 0; i < n; i++) {
      const c = S.current[i];
      if (!c) continue;
      const rank = order.current.indexOf(i);
      if (c.phase === "drag") {
        const vxs = dr.samples.length > 1 ? (dr.samples[dr.samples.length - 1].x - dr.samples[0].x) / Math.max(0.016, (dr.samples[dr.samples.length - 1].t - dr.samples[0].t) / 1000) : 0;
        const tr = Math.max(-24, Math.min(24, dr.dx * 0.055 + vxs * 0.0035));
        c.x = dr.dx; c.y = dr.dy;
        c.vr += (180 * (tr - c.r) - 20 * c.vr) * dt; c.r += c.vr * dt;
        c.vs += (260 * (1.045 - c.s) - 22 * c.vs) * dt; c.s += c.vs * dt;
        c.d += (0 - c.d) * Math.min(1, dt * 12);
        moving = true;
      } else if (c.phase === "fly") {
        c.t += dt;
        c.x += c.vx * dt; c.y += c.vy * dt;
        const f = Math.pow(0.9, dt * 60);
        c.vx *= f; c.vy *= f;
        c.r += c.vr * dt; c.vr *= Math.pow(0.95, dt * 60);
        c.s += (1.0 - c.s) * Math.min(1, dt * 8);
        if (Math.hypot(c.x, c.y) > W * 0.95 || c.t > 0.34 || Math.hypot(c.vx, c.vy) < 90) {
          // Ya salió del mazo: pasa al fondo y regresa por debajo de las demás.
          order.current = order.current.filter((k) => k !== i).concat(i);
          c.phase = "back";
          applyOrder();
          cfg.current.onShuffle?.(order.current[0]);
        }
        moving = true;
      } else {
        const tg = pose(rank, i);
        let { x: tx, y: ty, r: tr, s: ts, d: td } = tg;
        if (rank > 0 && prog > 0) {
          const up = pose(rank - 1, order.current[rank - 1]);
          const p = prog * 0.55;
          tx += (up.x - tx) * p; ty += (up.y - ty) * p; tr += (up.r - tr) * p; ts += (up.s - ts) * p; td += (up.d - td) * p;
        }
        const back = c.phase === "back";
        const k = back ? 120 : 230, cc = back ? 15 : 23;
        const sub = 2, h = dt / sub;
        for (let q = 0; q < sub; q++) {
          c.vx += (k * (tx - c.x) - cc * c.vx) * h; c.x += c.vx * h;
          c.vy += (k * (ty - c.y) - cc * c.vy) * h; c.y += c.vy * h;
          c.vr += (k * (tr - c.r) - cc * c.vr) * h; c.r += c.vr * h;
          c.vs += (k * 1.3 * (ts - c.s) - cc * c.vs) * h; c.s += c.vs * h;
        }
        c.d += (td - c.d) * Math.min(1, dt * 10);
        const err = Math.abs(tx - c.x) + Math.abs(ty - c.y) + Math.abs(tr - c.r) * 2 + Math.abs(ts - c.s) * 100;
        const vel = Math.abs(c.vx) + Math.abs(c.vy) + Math.abs(c.vr) * 2;
        if (err < 0.15 && vel < 1.2) { c.x = tx; c.y = ty; c.r = tr; c.s = ts; c.d = td; c.vx = c.vy = c.vr = c.vs = 0; if (c.phase === "back") c.phase = "idle"; }
        else moving = true;
      }
      paint(i);
    }
    if (moving) raf.current = requestAnimationFrame(tick);
  }, [n, pose, paint, applyOrder]);

  const wake = useCallback(() => {
    if (!raf.current) { last.current = performance.now(); raf.current = requestAnimationFrame(tick); }
  }, [tick]);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    order.current = Array.from({ length: n }, (_, i) => i);
    S.current = cards.map((_, i) => { const p = pose(i, i); return { ...p, vx: 0, vy: 0, vr: 0, vs: 0, vd: 0, phase: "idle", t: 0 } as S; });
    applyOrder();
    for (let i = 0; i < n; i++) paint(i);
    return () => { cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [cards, n, pose, paint, applyOrder]);

  // Si cambian fan o messiness con el mazo montado, reacomoda.
  useEffect(() => { wake(); }, [fan, messiness, wake]);

  const shuffle = useCallback((vx: number, vy: number) => {
    const i = order.current[0];
    const c = S.current[i];
    if (!c || c.phase === "fly") return;
    if (reduced.current) {
      order.current = order.current.slice(1).concat(i);
      c.phase = "idle"; applyOrder();
      cfg.current.onShuffle?.(order.current[0]);
      wake();
      return;
    }
    c.phase = "fly"; c.t = 0;
    c.vx = vx; c.vy = vy;
    c.vr = vx * 0.03 + (vx >= 0 ? 38 : -38);
    els.current[i]!.style.zIndex = String(n + 5);
    wake();
  }, [applyOrder, n, wake]);

  const onDown = (e: PointerEvent<HTMLDivElement>, i: number) => {
    if (order.current[0] !== i || S.current[i].phase === "fly") return;
    const c = S.current[i];
    const dr = drag.current;
    dr.id = e.pointerId; dr.i = i; dr.sx = e.clientX - c.x; dr.sy = e.clientY - c.y; dr.dx = c.x; dr.dy = c.y; dr.t0 = performance.now();
    dr.samples = [{ t: dr.t0, x: e.clientX, y: e.clientY }];
    c.phase = "drag";
    e.currentTarget.setPointerCapture(e.pointerId);
    wake();
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const dr = drag.current;
    if (dr.id !== e.pointerId) return;
    dr.dx = e.clientX - dr.sx; dr.dy = e.clientY - dr.sy;
    const now = performance.now();
    dr.samples.push({ t: now, x: e.clientX, y: e.clientY });
    while (dr.samples.length > 2 && now - dr.samples[0].t > 90) dr.samples.shift();
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const dr = drag.current;
    if (dr.id !== e.pointerId) return;
    dr.id = -1;
    const c = S.current[dr.i];
    if (!c) return;
    const sm = dr.samples;
    let vx = 0, vy = 0;
    if (sm.length > 1) {
      const dt = Math.max(0.016, (sm[sm.length - 1].t - sm[0].t) / 1000);
      vx = (sm[sm.length - 1].x - sm[0].x) / dt; vy = (sm[sm.length - 1].y - sm[0].y) / dt;
    }
    const dist = Math.hypot(dr.dx, dr.dy), speed = Math.hypot(vx, vy);
    const tap = dist < 6 && performance.now() - dr.t0 < 350;
    const W = rootRef.current?.offsetWidth || 250;
    const thr = Math.max(50, Math.min(cfg.current.threshold, W * 0.5));
    if (tap) { c.phase = "idle"; shuffle(1000, -160); }
    else if (dist > thr || (speed > 700 && dist > 24)) {
      // La dirección sale de la velocidad del gesto; si fue lento, del desplazamiento.
      const bx = speed > 400 ? vx : dr.dx, by = speed > 400 ? vy : dr.dy;
      const len = Math.hypot(bx, by) || 1;
      const sp = Math.max(speed, 1150);
      shuffle((bx / len) * sp, (by / len) * sp);
    } else { c.phase = "idle"; c.vx = vx * 0.1; c.vy = vy * 0.1; }
    wake();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") { e.preventDefault(); shuffle(1000, -160); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); shuffle(-1000, -160); }
  };

  const vars = { "--furin-card-stack-w": `${width}px` } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={`furin-card-stack ${className}`}
      style={{ ...vars, ...style }}
      role="group"
      aria-roledescription="card deck"
      aria-label="Card deck. Drag the top card, or press Enter, to shuffle."
      tabIndex={0}
      onKeyDown={onKey}
    >
      {cards.map((c, i) => {
        const p = pose(i, i);
        return (
          <div
            key={i}
            ref={(el) => { els.current[i] = el; }}
            className="furin-card-stack__card"
            data-top={i === 0 ? "true" : "false"}
            aria-hidden={i === 0 ? "false" : "true"}
            style={{
              zIndex: n - i,
              transform: `translate3d(0, ${p.y}px, 0) rotate(${p.r}deg) scale(${p.s})`,
              "--furin-card-stack-from": c.from ?? "#5b6cff",
              "--furin-card-stack-to": c.to ?? "#27c6ff",
              "--furin-card-stack-dim": p.d,
            } as CSSProperties}
            onPointerDown={(e) => onDown(e, i)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <span className="furin-card-stack__count">{String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}</span>
            <span className="furin-card-stack__dot" />
            <div className="furin-card-stack__text">
              <strong>{c.title}</strong>
              {c.caption ? <span>{c.caption}</span> : null}
            </div>
            <i className="furin-card-stack__sheen" />
          </div>
        );
      })}
      <span ref={live} className="furin-card-stack__live" aria-live="polite" />
    </div>
  );
}

export default CardStack;
