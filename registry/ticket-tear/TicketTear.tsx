"use client";
import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import "./TicketTear.css";

export interface TicketTearProps {
  /** Título grande del boleto. */
  title?: string;
  /** Fecha y hora, bajo el título. */
  subtitle?: string;
  /** Lugar del evento. */
  place?: string;
  /** Sección, fila y asiento (datos ficticios). */
  seat?: { section: string; row: string; seat: string };
  /** Rótulo del campo de sección. */
  sectionLabel?: string;
  /** Rótulo del campo de fila. */
  rowLabel?: string;
  /** Rótulo del campo de asiento. */
  seatLabel?: string;
  /** Texto vertical impreso en el talón. */
  stubLabel?: string;
  /** Color de acento del boleto y del talón. */
  accent?: string;
  /** Color del papel. */
  paperColor?: string;
  /** Escala de todo el boleto. */
  scale?: number;
  /** Cuando el talón se arranca, el boleto se rehace solo tras unos segundos. */
  autoReset?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const W = 390, H = 160, WS = 96, XB = W - WS, RN = 9, RC = 12, RH = 2.5, PITCH = 9.5;

// Borde rasgado fijo (semilla), para que el rasgado sea igual en cada render.
const JAG = (() => {
  let s = 11;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out: number[] = [];
  let drift = 0;
  for (let i = 0; i < Math.ceil(H / 1.6) + 2; i++) {
    drift += (r() - 0.5) * 1.8; drift *= 0.9;
    out.push(drift + (r() - 0.5) * 2.2 + (r() < 0.06 ? (r() - 0.5) * 6 : 0));
  }
  return out;
})();
const jag = (y: number) => JAG[Math.min(JAG.length - 1, Math.max(0, Math.round(y / 1.6)))];
const f = (n: number) => n.toFixed(2);
const torn = (y0: number, y1: number): [number, number][] => {
  const pts: [number, number][] = [];
  for (let y = y0; y <= y1; y += 1.6) pts.push([XB + jag(y) * Math.min(1, (y - y0 + 6) / 6, (y1 - y + 6) / 6 + 0.35), y]);
  return pts;
};
const holes = (yF: number) => {
  const hs: number[] = [];
  for (let y = RN + 7; y < H - RN - 2; y += PITCH) if (y - RH >= yF) hs.push(y);
  return hs;
};

function paths(yF: number) {
  const tp = torn(RN, yF);
  const hs = holes(yF);
  const tornD = tp.map((p) => `L${f(p[0])} ${f(p[1])}`).join("");
  // Perforación: mordidas semicirculares a cada lado de la línea.
  const down = hs.map((y) => `L${XB} ${f(y - RH)}A${RH} ${RH} 0 0 0 ${XB} ${f(y + RH)}`).join("");
  const up = [...hs].reverse().map((y) => `L${XB} ${f(y + RH)}A${RH} ${RH} 0 0 0 ${XB} ${f(y - RH)}`).join("");
  const main = `M0 ${RC}A${RC} ${RC} 0 0 1 ${RC} 0L${XB - RN} 0A${RN} ${RN} 0 0 0 ${XB} ${RN}${tornD}L${XB} ${f(Math.max(yF, RN))}${down}L${XB} ${H - RN}A${RN} ${RN} 0 0 0 ${XB - RN} ${H}L${RC} ${H}A${RC} ${RC} 0 0 1 0 ${H - RC}Z`;
  const upper = `M${XB} ${RN}A${RN} ${RN} 0 0 0 ${XB + RN} 0L${W - RC} 0A${RC} ${RC} 0 0 1 ${W} ${RC}L${W} ${f(yF)}L${XB} ${f(yF)}${[...tp].reverse().map((p) => `L${f(p[0])} ${f(p[1])}`).join("")}Z`;
  const lower = `M${XB} ${f(yF)}L${W} ${f(yF)}L${W} ${H - RC}A${RC} ${RC} 0 0 1 ${W - RC} ${H}L${XB + RN} ${H}A${RN} ${RN} 0 0 0 ${XB} ${H - RN}${up}Z`;
  const fiber = tp.map((p, i) => `${i ? "L" : "M"}${f(p[0])} ${f(p[1])}`).join("");
  return { main, upper, lower, fiber, tp };
}

const BARS = (() => {
  let s = 5;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out: { y: number; h: number }[] = [];
  for (let y = 0; y < 62; ) { const h = 1 + Math.floor(r() * 3); out.push({ y, h }); y += h + 1 + Math.floor(r() * 2); }
  return out;
})();

/** Boleto de papel con perforación: arrastra el talón y se rasga de arriba abajo, con borde de fibras y sombra real. */
export function TicketTear({
  title = "Furin Live",
  subtitle = "Saturday, October 3 · 8:00 PM",
  place = "North Forum · Mexico City",
  seat = { section: "A", row: "12", seat: "08" },
  sectionLabel = "Section",
  rowLabel = "Row",
  seatLabel = "Seat",
  stubLabel = "STUB · 0482",
  accent = "#ff5a36",
  paperColor = "#f5f0e5",
  scale = 1,
  autoReset = true,
  className = "",
  style,
}: TicketTearProps) {
  const root = useRef<HTMLDivElement>(null);
  const opts = useRef({ autoReset });
  opts.current = { autoReset };
  const kick = useRef<() => void>(() => {});
  const init = useMemo(() => paths(RN), []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const stage = el.querySelector<HTMLElement>(".furin-ticket__stage")!;
    const main = el.querySelector<HTMLElement>(".furin-ticket__main")!;
    const upper = el.querySelector<HTMLElement>(".furin-ticket__upper")!;
    const lower = el.querySelector<HTMLElement>(".furin-ticket__lower")!;
    const upperWrap = el.querySelector<HTMLElement>(".furin-ticket__upper-wrap")!;
    const lowerWrap = el.querySelector<HTMLElement>(".furin-ticket__lower-wrap")!;
    const hit = el.querySelector<HTMLElement>(".furin-ticket__hit")!;
    const fibers = Array.from(el.querySelectorAll<SVGPathElement>(".furin-ticket__fiber"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    type Mode = "idle" | "drag" | "hold" | "finish" | "fall" | "gone" | "mend" | "nudge";
    let mode: Mode = "idle";
    let t = 0, modeAt = 0, raf = 0, visible = true, last = 0;
    let grabX = 0, grabT = 0, vel = 0, lastX = 0, lastTime = 0, sc = 1;
    const fall = { x: 0, y: 0, vx: 0, vy: 0, r: 0, vr: 0, o: 1 };
    let touched = false, hintTimer = 0;

    const ease = (x: number) => x * x * (3 - 2 * x);
    const apply = () => {
      const yF = RN + (H - RN) * t;
      const p = paths(yF);
      main.style.clipPath = `path('${p.main}')`;
      upper.style.clipPath = `path('${p.upper}')`;
      lower.style.clipPath = `path('${p.lower}')`;
      for (const fb of fibers) fb.setAttribute("d", p.fiber);
      const phi = 64 * Math.pow(Math.min(1, t * 1.15), 0.7);
      upperWrap.style.transformOrigin = `${XB}px ${yF}px`;
      upperWrap.style.transform = `translate(${fall.x}px, ${fall.y}px) rotate(${phi + fall.r}deg)`;
      upperWrap.style.opacity = String(fall.o);
      const lift = Math.min(1, t * 2);
      upperWrap.style.filter = `drop-shadow(${(2 + lift * 7).toFixed(1)}px ${(3 + lift * 9).toFixed(1)}px ${(5 + lift * 10).toFixed(1)}px rgba(0,0,0,${(0.3 + lift * 0.22).toFixed(2)}))`;
      lowerWrap.style.opacity = t >= 0.995 ? "0" : String(fall.o);
      hit.style.pointerEvents = mode === "gone" || mode === "fall" ? "none" : "auto";
      hit.style.cursor = mode === "drag" ? "grabbing" : "grab";
    };

    const setMode = (m: Mode, now: number) => { mode = m; modeAt = now; };
    const reset = () => { t = 0; fall.x = fall.y = fall.r = fall.vx = fall.vy = fall.vr = 0; fall.o = 0; apply(); };
    const scheduleHint = () => {
      window.clearTimeout(hintTimer);
      if (reduce) return;
      hintTimer = window.setTimeout(() => { if (mode === "idle" && visible && !touched) { setMode("nudge", performance.now()); wake(); } scheduleHint(); }, 3600);
    };

    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(0.04, (now - (last || now)) / 1000);
      last = now;
      const el_ = now - modeAt;
      let busy = true;
      if (mode === "nudge") {
        const k = el_ / 900;
        t = k >= 1 ? 0 : 0.2 * Math.sin(k * Math.PI) ** 2 * (1 - 0.2 * k);
        if (k >= 1) { t = 0; mode = "idle"; busy = false; }
      } else if (mode === "finish") {
        t += (1 - t) * Math.min(1, dt * 14) + dt * 0.5;
        if (t >= 1) {
          t = 1;
          fall.vx = 120 + Math.max(0, vel) * 260; fall.vy = -60; fall.vr = 90 + vel * 120;
          setMode("fall", now);
        }
      } else if (mode === "fall") {
        fall.vy += 1500 * dt; fall.x += fall.vx * dt; fall.y += fall.vy * dt; fall.r += fall.vr * dt;
        fall.o = Math.max(0, 1 - Math.max(0, el_ - 450) / 450);
        if (el_ > 900) { fall.o = 0; setMode("gone", now); }
      } else if (mode === "gone") {
        if (opts.current.autoReset && el_ > 2200) { reset(); setMode("mend", now); }
        else busy = el_ < 2400 || opts.current.autoReset;
      } else if (mode === "hold") {
        if (opts.current.autoReset && el_ > 3200) setMode("mend", now);
        else busy = opts.current.autoReset;
      } else if (mode === "mend") {
        if (fall.o < 1 && t === 0) fall.o = Math.min(1, fall.o + dt * 3);
        t = Math.max(0, t - dt * 1.4 * (0.4 + t));
        if (t <= 0.001 && fall.o >= 1) { t = 0; fall.o = 1; setMode("idle", now); busy = false; }
      } else busy = false;
      apply();
      if (busy && visible) raf = requestAnimationFrame(tick); else last = 0;
    };
    const wake = () => { if (!raf && visible) raf = requestAnimationFrame(tick); };
    fall.o = 1;
    apply();
    scheduleHint();

    const onDown = (e: PointerEvent) => {
      if (mode === "gone" || mode === "fall" || mode === "finish") return;
      touched = true;
      sc = stage.getBoundingClientRect().width / W || 1;
      grabX = e.clientX; grabT = t; lastX = e.clientX; lastTime = performance.now(); vel = 0;
      hit.setPointerCapture(e.pointerId);
      setMode("drag", performance.now());
      wake();
    };
    const onMove = (e: PointerEvent) => {
      if (mode !== "drag") return;
      const now = performance.now();
      vel = (e.clientX - lastX) / Math.max(1, now - lastTime);
      lastX = e.clientX; lastTime = now;
      // El rasgado avanza con el arrastre hacia afuera; contra el papel, no cede.
      t = Math.max(0, Math.min(1, grabT + (e.clientX - grabX) / sc / 112));
      wake();
    };
    const onUp = () => {
      if (mode !== "drag") return;
      const now = performance.now();
      if (t > 0.72 || (t > 0.45 && vel > 0.6)) setMode("finish", now);
      else { t *= 0.94; setMode(t < 0.03 ? "idle" : "hold", now); }
      wake();
    };
    hit.addEventListener("pointerdown", onDown);
    hit.addEventListener("pointermove", onMove);
    hit.addEventListener("pointerup", onUp);
    hit.addEventListener("pointercancel", onUp);
    kick.current = () => { if (mode === "idle" || mode === "hold") { touched = true; setMode("finish", performance.now()); wake(); } };
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); }, { threshold: 0.05 });
    io.observe(el);
    if (reduce) { t = 0.34; apply(); }
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(hintTimer);
      io.disconnect();
      hit.removeEventListener("pointerdown", onDown);
      hit.removeEventListener("pointermove", onMove);
      hit.removeEventListener("pointerup", onUp);
      hit.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const vars = { "--tt-accent": accent, "--tt-paper": paperColor, "--tt-w": `${W}px`, "--tt-h": `${H}px`, "--tt-s": scale } as CSSProperties;
  const art = (
    <div className="furin-ticket__art">
      <div className="furin-ticket__main-art">
        <div className="furin-ticket__bar" />
        <div className="furin-ticket__top"><span>ADMIT ONE</span><span>No. 004218</span></div>
        <h3 className="furin-ticket__title">{title}</h3>
        <p className="furin-ticket__sub">{subtitle}</p>
        <p className="furin-ticket__place">{place}</p>
        <div className="furin-ticket__fields">
          <div><i>{sectionLabel}</i><b>{seat.section}</b></div>
          <div><i>{rowLabel}</i><b>{seat.row}</b></div>
          <div><i>{seatLabel}</i><b>{seat.seat}</b></div>
        </div>
      </div>
      <div className="furin-ticket__stub-art">
        <span className="furin-ticket__vert">{stubLabel}</span>
        <svg viewBox="0 0 38 62" className="furin-ticket__code" aria-hidden>
          {BARS.map((b, i) => <rect key={i} x="0" y={b.y} width="38" height={b.h} />)}
        </svg>
      </div>
      <div className="furin-ticket__light" />
      <div className="furin-ticket__grain" />
    </div>
  );
  const fiberSvg = (cls: string, dx: number) => (
    <svg className={`furin-ticket__fibers ${cls}`} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <path className="furin-ticket__fiber" d={init.fiber} transform={`translate(${dx} 0)`} />
    </svg>
  );
  return (
    <div
      ref={root}
      className={`furin-ticket ${className}`}
      style={{ ...vars, ...style }}
      role="img"
      aria-label={`Ticket for ${title}. Drag the stub to tear it.`}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); kick.current(); } }}
    >
      <div className="furin-ticket__stage">
        <div className="furin-ticket__lower-wrap"><div className="furin-ticket__piece furin-ticket__lower" style={{ clipPath: `path('${init.lower}')` }}>{art}</div></div>
        <div className="furin-ticket__main-wrap">
          <div className="furin-ticket__piece furin-ticket__main" style={{ clipPath: `path('${init.main}')` }}>{art}</div>
          {fiberSvg("furin-ticket__fibers--main", -1.6)}
        </div>
        <div className="furin-ticket__upper-wrap">
          <div className="furin-ticket__piece furin-ticket__upper" style={{ clipPath: `path('${init.upper}')` }}>{art}{fiberSvg("furin-ticket__fibers--up", 1.6)}</div>
        </div>
        <div className="furin-ticket__hit" />
      </div>
    </div>
  );
}

export default TicketTear;
