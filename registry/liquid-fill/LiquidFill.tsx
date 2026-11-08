"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./LiquidFill.css";

export interface LiquidFillProps {
  /** Progreso de 0 a 100; si se omite, el matraz se llena y se vacía solo en bucle. */
  value?: number;
  /** Color del líquido. */
  color?: string;
  /** Velocidad del llenado y de las olas (1 = normal). */
  speed?: number;
  /** Muestra el porcentaje grande sobre el matraz. */
  showPercent?: boolean;
  /** Texto opcional bajo el matraz. */
  label?: string;
  /** Alto del matraz en px. */
  size?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

/* ───────────── Geometría del matraz (viewBox 0 0 200 260) ─────────────
   Cada perfil describe el lado izquierdo de arriba a abajo con curvas cúbicas;
   el derecho es su espejo. El contorno exterior y el interior comparten forma,
   así el grosor del vidrio es parejo y el líquido se recorta por el interior. */

type Seg = readonly [number, number, number, number, number, number];
interface Profile {
  start: readonly [number, number];
  segs: readonly Seg[];
}

const OUTER: Profile = {
  start: [83, 20],
  segs: [
    [83, 40, 83, 60, 83, 80],
    [83, 106, 27, 158, 24, 208],
    [23, 232, 38, 244, 62, 244],
  ],
};
const INNER: Profile = {
  start: [89, 22],
  segs: [
    [89, 40, 89, 62, 89, 82],
    [89, 106, 33, 160, 30, 208],
    [29, 228, 42, 238, 64, 238],
  ],
};

/** Silueta cerrada: lado izquierdo, base recta y lado derecho en espejo. */
function closedPath(p: Profile, open = false): string {
  let d = `M${p.start[0]} ${p.start[1]}`;
  for (const s of p.segs) d += `C${s[0]} ${s[1]} ${s[2]} ${s[3]} ${s[4]} ${s[5]}`;
  const end = p.segs[p.segs.length - 1];
  d += `L${200 - end[4]} ${end[5]}`;
  for (let i = p.segs.length - 1; i >= 0; i--) {
    const s = p.segs[i];
    const prev = i > 0 ? p.segs[i - 1] : null;
    const sx = prev ? prev[4] : p.start[0];
    const sy = prev ? prev[5] : p.start[1];
    d += `C${200 - s[2]} ${s[3]} ${200 - s[0]} ${s[1]} ${200 - sx} ${sy}`;
  }
  return open ? d : `${d}Z`;
}

/** Un solo costado desplazado hacia adentro (para reflejos que siguen la curva del vidrio). */
function edgePath(p: Profile, side: "L" | "R", inset: number, from = 0): string {
  const X = (x: number) => (side === "L" ? x + inset : 200 - x - inset) as number;
  let d = "";
  let px = p.start[0];
  let py = p.start[1];
  p.segs.forEach((s, i) => {
    if (i >= from) {
      if (d === "") d = `M${X(px)} ${py}`;
      d += `C${X(s[0])} ${s[1]} ${X(s[2])} ${s[3]} ${X(s[4])} ${s[5]}`;
    }
    px = s[4];
    py = s[5];
  });
  return d;
}

const OUTER_D = closedPath(OUTER);
const INNER_D = closedPath(INNER);
// Contornos abiertos: sin la línea de arriba, que queda escondida bajo la boca.
const OUTER_OPEN = closedPath(OUTER, true);
const INNER_OPEN = closedPath(INNER, true);
const WALL_D = `${OUTER_D}${INNER_D}`;

/** Tabla [y, semiancho] del interior, para saber qué tan ancho es el matraz a cada altura. */
const HW: Array<[number, number]> = [];
(() => {
  let px = INNER.start[0];
  let py = INNER.start[1];
  for (const s of INNER.segs) {
    for (let k = 0; k <= 14; k++) {
      const t = k / 14;
      const m = 1 - t;
      const x = m * m * m * px + 3 * m * m * t * s[0] + 3 * m * t * t * s[2] + t * t * t * s[4];
      const y = m * m * m * py + 3 * m * m * t * s[1] + 3 * m * t * t * s[3] + t * t * t * s[5];
      HW.push([y, 100 - x]);
    }
    px = s[4];
    py = s[5];
  }
})();
function halfWidthAt(y: number): number {
  if (y <= HW[0][0]) return HW[0][1];
  for (let i = 1; i < HW.length; i++) {
    if (y <= HW[i][0]) {
      const [y0, w0] = HW[i - 1];
      const [y1, w1] = HW[i];
      return y1 === y0 ? w1 : w0 + ((w1 - w0) * (y - y0)) / (y1 - y0);
    }
  }
  return HW[HW.length - 1][1];
}

/* ───────────── Ola: suma de senos ───────────── */

const Y_BOT = 238; // fondo interior del vidrio
const Y_TOP = 40; // nivel al 100 %, dentro del cuello
const Y_REST = 245.5; // nivel al 0 %: bajo el fondo grueso del vidrio, no se ve nada
const NP = 33;
const X0 = 10;
const X1 = 190;
const XS: number[] = Array.from({ length: NP }, (_, i) => X0 + ((X1 - X0) * i) / (NP - 1));
const ysFront: number[] = new Array(NP).fill(0);
const ysBack: number[] = new Array(NP).fill(0);

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const levelToY = (level: number) => Y_REST - ((Y_REST - Y_TOP) * level) / 100;

function fillWave(ys: number[], base: number, t: number, amp: number, slosh: number, hw: number, back: boolean) {
  for (let i = 0; i < NP; i++) {
    const x = XS[i];
    const dx = x - 100;
    let y = base;
    if (back) {
      y += amp * (0.5 * Math.sin(0.058 * x - t * 1.55 + 2.1) + 0.32 * Math.sin(0.11 * x + t * 1.15 + 0.4) + 0.18 * Math.sin(0.19 * x - t * 2.3));
      y += slosh * Math.sin(t * 2.2 - 0.9) * (dx / 70);
    } else {
      y += amp * (0.55 * Math.sin(0.072 * x + t * 1.9) + 0.3 * Math.sin(0.128 * x - t * 1.35 + 1.7) + 0.15 * Math.sin(0.21 * x + t * 2.6 + 0.6));
      y += slosh * Math.sin(t * 2.2) * (dx / 70);
    }
    // Menisco: el líquido sube un poco pegado a la pared.
    const edge = Math.max(hw - Math.abs(dx), 0);
    y -= (back ? 1.2 : 2.1) * Math.exp(-edge / 2.6);
    ys[i] = y;
  }
}

/** Traza suave por puntos medios; devuelve la línea abierta y la silueta cerrada hacia el fondo. */
function wavePaths(ys: number[], bottom: number): [string, string] {
  let open = `M${f1(XS[0])} ${f1(ys[0])}`;
  for (let i = 1; i < NP - 1; i++) {
    open += `Q${f1(XS[i])} ${f1(ys[i])} ${f1((XS[i] + XS[i + 1]) / 2)} ${f1((ys[i] + ys[i + 1]) / 2)}`;
  }
  open += `L${f1(XS[NP - 1])} ${f1(ys[NP - 1])}`;
  return [open, `${open}L${f1(XS[NP - 1])} ${bottom}L${f1(XS[0])} ${bottom}Z`];
}

interface Frame {
  back: string;
  front: string;
  crest: string;
  ySurf: number;
  hw: number;
  causticOpacity: number;
  floorOpacity: number;
  haloOpacity: number;
}

function compose(level: number, t: number, ag: number): Frame {
  const base = levelToY(level);
  const hw = halfWidthAt(base);
  // Con el cuello angosto el oleaje se amortigua; en la panza grande se nota más.
  const widthScale = clamp(hw / 58, 0.2, 1);
  const low = Math.min(1, level / 5);
  const amp = (0.85 + 3.4 * ag) * widthScale * low;
  const slosh = 4.6 * ag * widthScale * low;
  fillWave(ysFront, base, t, amp, slosh, hw, false);
  fillWave(ysBack, base - 1.8, t, amp * 1.15, slosh, hw, true);
  const [, back] = wavePaths(ysBack, 250);
  const [crest, front] = wavePaths(ysFront, 250);
  const l = clamp(level / 100, 0, 1);
  return {
    back,
    front,
    crest,
    ySurf: base,
    hw,
    causticOpacity: Math.min(1, level / 12) * 0.85,
    floorOpacity: 0.03 + 0.62 * l,
    haloOpacity: 0.02 + 0.22 * l,
  };
}

/* ───────────── Burbujas ───────────── */

interface Bubble {
  /** Posición horizontal normalizada dentro del matraz (-1 a 1). */
  x: number;
  /** Radio en unidades del viewBox. */
  r: number;
  /** Segundos que tarda en subir del fondo a la superficie. */
  life: number;
  /** Fase inicial del recorrido (0 a 1). */
  p0: number;
  /** Fase del vaivén lateral. */
  wob: number;
}
const BUBBLES: Bubble[] = [
  { x: -0.5, r: 1.7, life: 4.6, p0: 0.12, wob: 0.4 },
  { x: 0.34, r: 2.5, life: 5.8, p0: 0.58, wob: 1.9 },
  { x: -0.12, r: 1.1, life: 3.7, p0: 0.31, wob: 3.1 },
  { x: 0.66, r: 1.4, life: 4.2, p0: 0.84, wob: 0.9 },
  { x: -0.74, r: 2.1, life: 6.4, p0: 0.47, wob: 2.6 },
  { x: 0.08, r: 1.8, life: 5.1, p0: 0.92, wob: 4.2 },
  { x: 0.52, r: 0.9, life: 3.3, p0: 0.2, wob: 5.0 },
  { x: -0.34, r: 1.3, life: 4.0, p0: 0.7, wob: 1.2 },
  { x: 0.8, r: 2.0, life: 6.0, p0: 0.38, wob: 3.8 },
  { x: -0.62, r: 1.0, life: 3.5, p0: 0.77, wob: 2.2 },
];

function bubblePose(b: Bubble, p: number, t: number, ySurf: number, level: number): { tf: string; op: number } {
  const depth = Y_BOT - 4 - ySurf;
  if (depth < 14 || level < 4) return { tf: "translate(0 0)", op: 0 };
  const y = Y_BOT - 5 - p * (depth - 3);
  const x = 100 + b.x * halfWidthAt(y) * 0.72 + Math.sin(t * 1.7 + b.wob) * (1 + p * 1.2);
  const s = 1 + 0.3 * p;
  const op = Math.min(1, p / 0.1) * Math.min(1, (1 - p) / 0.12);
  return { tf: `translate(${f1(x)} ${f1(y)}) scale(${s.toFixed(2)})`, op };
}

/* ───────────── Tiempos del modo automático ───────────── */

const T_FILL = 4.6;
const T_HOLD = 1.5;
const T_DRAIN = 2.7;
const T_REST = 0.8;
const T_LOOP = T_FILL + T_HOLD + T_DRAIN + T_REST;
const T_START = 1.5; // arranca ya con algo de líquido para que no abra vacío

const easeInOutSine = (x: number) => (1 - Math.cos(Math.PI * x)) / 2;
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function autoLevel(tt: number): number {
  const u = ((tt % T_LOOP) + T_LOOP) % T_LOOP;
  if (u < T_FILL) return 100 * easeInOutSine(u / T_FILL);
  if (u < T_FILL + T_HOLD) return 100;
  if (u < T_FILL + T_HOLD + T_DRAIN) return 100 * (1 - easeInOutCubic((u - T_FILL - T_HOLD) / T_DRAIN));
  return 0;
}

/** Matraz Erlenmeyer de vidrio que se llena de líquido con olas, burbujas y porcentaje. */
export function LiquidFill({
  value,
  color = "#18C5DA",
  speed = 1,
  showPercent = true,
  label,
  size = 290,
  className = "",
  style,
}: LiquidFillProps) {
  const uid = "fl" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (n: string) => `${uid}-${n}`;
  const url = (n: string) => `url(#${uid}-${n})`;

  const initLevel = value === undefined ? autoLevel(T_START) : clamp(value, 0, 100);
  // Cuadro inicial estable (también para SSR); después el bucle escribe los atributos por ref.
  const [init] = useState(() => {
    const frame = compose(initLevel, 1.3, 0);
    const poses = BUBBLES.map((b) => bubblePose(b, b.p0, 1.3, frame.ySurf, initLevel));
    return { frame, poses, level: initLevel };
  });

  const live = useRef({ value, speed });
  const redraw = useRef<(() => void) | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<SVGPathElement>(null);
  const frontRef = useRef<SVGPathElement>(null);
  const crestRef = useRef<SVGPathElement>(null);
  const causticRef = useRef<SVGEllipseElement>(null);
  const floorRef = useRef<SVGGElement>(null);
  const haloRef = useRef<SVGEllipseElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);
  const bubRefs = useRef<Array<SVGGElement | null>>([]);

  useEffect(() => {
    live.current = { value, speed };
    // En movimiento reducido no hay bucle: un cambio de valor repinta el cuadro quieto.
    redraw.current?.();
  }, [value, speed]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const st = {
      level: initLevel,
      vel: 0,
      ag: 0,
      t: 1.3,
      auto: T_START,
      phase: BUBBLES.map((b) => b.p0),
      shown: -1,
      aria: -1,
      ariaAt: 0,
    };

    const apply = (level: number) => {
      const fr = compose(level, st.t, st.ag);
      backRef.current?.setAttribute("d", fr.back);
      frontRef.current?.setAttribute("d", fr.front);
      crestRef.current?.setAttribute("d", fr.crest);
      const c = causticRef.current;
      if (c) {
        c.setAttribute("cx", f1(97 - fr.hw * 0.08));
        c.setAttribute("cy", f1(fr.ySurf + 3));
        c.setAttribute("rx", f1(Math.max(fr.hw * 0.8, 4)));
        c.setAttribute("opacity", fr.causticOpacity.toFixed(2));
      }
      floorRef.current?.setAttribute("opacity", fr.floorOpacity.toFixed(2));
      haloRef.current?.setAttribute("opacity", fr.haloOpacity.toFixed(2));
      for (let i = 0; i < BUBBLES.length; i++) {
        const el = bubRefs.current[i];
        if (!el) continue;
        const pose = bubblePose(BUBBLES[i], st.phase[i], st.t, fr.ySurf, level);
        el.setAttribute("transform", pose.tf);
        el.setAttribute("opacity", pose.op.toFixed(2));
      }
      const pct = Math.round(level);
      if (pct !== st.shown) {
        st.shown = pct;
        if (numRef.current) numRef.current.textContent = String(pct);
      }
    };

    const syncAria = (now: number, force: boolean) => {
      const v = live.current.value;
      const n = v === undefined ? Math.round(st.level) : Math.round(clamp(v, 0, 100));
      // Sin cambiar a cada cuadro: los lectores de pantalla no necesitan 60 avisos por segundo.
      if (n !== st.aria && (force || now - st.ariaAt > 400)) {
        st.aria = n;
        st.ariaAt = now;
        root.setAttribute("aria-valuenow", String(n));
      }
    };

    let reduced = false;
    let visible = true;
    let raf = 0;
    let last = 0;

    const settle = () => {
      const v = live.current.value;
      st.level = v === undefined ? 65 : clamp(v, 0, 100);
      st.vel = 0;
      st.ag = 0;
      st.t = 1.3;
      st.phase = BUBBLES.map((b) => b.p0);
      apply(st.level);
      syncAria(0, true);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      const { value: v, speed: sp0 } = live.current;
      const sp = clamp(sp0, 0.1, 4);
      st.t += dt * sp;

      const prev = st.level;
      if (v === undefined) {
        st.auto += dt * sp;
        st.level = autoLevel(st.auto);
        st.vel = (st.level - prev) / Math.max(dt, 0.001);
      } else {
        // Resorte críticamente amortiguado hacia el objetivo: arranca y frena con ease.
        const target = clamp(v, 0, 100);
        const smooth = 0.75 / sp;
        const w = 2 / smooth;
        const x = w * dt;
        const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
        const change = st.level - target;
        const tmp = (st.vel + w * change) * dt;
        st.vel = (st.vel - w * tmp) * e;
        st.level = clamp(target + (change + tmp) * e, 0, 100);
        if (Math.abs(st.level - target) < 0.02 && Math.abs(st.vel) < 0.05) {
          st.level = target;
          st.vel = 0;
        }
      }

      // El oleaje se agita con la velocidad del nivel y se calma solo.
      const goal = Math.min(1, Math.abs(st.vel) / 24);
      st.ag += (goal - st.ag) * (1 - Math.exp(-dt * (goal > st.ag ? 6 : 1.1)));

      for (let i = 0; i < BUBBLES.length; i++) {
        st.phase[i] = (st.phase[i] + (dt * sp) / BUBBLES[i].life) % 1;
      }
      apply(st.level);
      syncAria(now, false);
    };

    const start = () => {
      if (raf || reduced || !visible) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const onMotion = () => {
      reduced = !!mq?.matches;
      stop();
      if (reduced) {
        settle();
        redraw.current = settle;
      } else {
        redraw.current = null;
        start();
      }
    };
    mq?.addEventListener("change", onMotion);

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((entries) => {
        visible = entries[entries.length - 1].isIntersecting;
        if (visible) start();
        else stop();
      });
      io.observe(root);
    }

    onMotion();
    if (!reduced) syncAria(0, true);

    return () => {
      stop();
      redraw.current = null;
      mq?.removeEventListener("change", onMotion);
      io?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vars = { "--furin-liquid-fill-color": color, "--furin-liquid-fill-size": `${size}px` } as CSSProperties;
  const fr = init.frame;

  return (
    <div className={`furin-liquid-fill ${className}`} style={{ ...vars, ...style }}>
      <div
        ref={rootRef}
        className="furin-liquid-fill__flask"
        role="progressbar"
        aria-label={label || "Loading"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(init.level)}
      >
        <svg className="furin-liquid-fill__svg" viewBox="0 0 200 260" aria-hidden="true" focusable="false">
          <defs>
            <clipPath id={id("clip")}>
              <path d={INNER_D} />
            </clipPath>
            <clipPath id={id("wallclip")}>
              <path d={WALL_D} clipRule="evenodd" />
            </clipPath>
            {/* Geometría de las olas: se actualiza una vez por cuadro y todas las capas la reutilizan */}
            <path ref={backRef} id={id("wb")} d={fr.back} />
            <path ref={frontRef} id={id("wf")} d={fr.front} />
            <path ref={crestRef} id={id("wc")} d={fr.crest} />

            {/* Líquido: profundidad vertical y sombreado lateral como en un cilindro */}
            <linearGradient id={id("front")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="furin-liquid-fill__c-hi" />
              <stop offset="0.1" className="furin-liquid-fill__c-mid" />
              <stop offset="0.6" className="furin-liquid-fill__c-mid2" />
              <stop offset="1" className="furin-liquid-fill__c-deep" />
            </linearGradient>
            <linearGradient id={id("back")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="furin-liquid-fill__c-glow" stopOpacity="0.75" />
              <stop offset="1" className="furin-liquid-fill__c-mid" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id={id("shade")} x1="26" y1="0" x2="174" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#001018" stopOpacity="0.34" />
              <stop offset="0.14" stopColor="#001018" stopOpacity="0.04" />
              <stop offset="0.34" stopColor="#fff" stopOpacity="0.05" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.84" stopColor="#001018" stopOpacity="0.08" />
              <stop offset="1" stopColor="#001018" stopOpacity="0.4" />
            </linearGradient>
            <linearGradient id={id("crest")} x1="12" y1="0" x2="188" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
              <stop offset="0.3" stopColor="#fff" stopOpacity="1" />
              <stop offset="0.75" stopColor="#fff" stopOpacity="0.7" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.3" />
            </linearGradient>
            <radialGradient id={id("core")} cx="104" cy="196" r="78" gradientUnits="userSpaceOnUse">
              <stop offset="0" className="furin-liquid-fill__c-hi" stopOpacity="0.32" />
              <stop offset="0.6" className="furin-liquid-fill__c-hi" stopOpacity="0.08" />
              <stop offset="1" className="furin-liquid-fill__c-hi" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={id("caustic")}>
              <stop offset="0" className="furin-liquid-fill__c-glow" stopOpacity="0.9" />
              <stop offset="0.55" className="furin-liquid-fill__c-glow" stopOpacity="0.28" />
              <stop offset="1" className="furin-liquid-fill__c-glow" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={id("bubble")} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#fff" stopOpacity="0.06" />
              <stop offset="0.6" stopColor="#fff" stopOpacity="0.16" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.85" />
            </radialGradient>

            {/* Vidrio */}
            <linearGradient id={id("wall")} x1="24" y1="20" x2="176" y2="244" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity="0.36" />
              <stop offset="0.35" stopColor="#fff" stopOpacity="0.1" />
              <stop offset="0.7" stopColor="#fff" stopOpacity="0.06" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.22" />
            </linearGradient>
            <linearGradient id={id("edge")} x1="26" y1="8" x2="178" y2="248" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity="1" />
              <stop offset="0.28" stopColor="#fff" stopOpacity="0.4" />
              <stop offset="0.62" stopColor="#fff" stopOpacity="0.14" />
              <stop offset="0.88" stopColor="#fff" stopOpacity="0.5" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id={id("edge2")} x1="30" y1="20" x2="170" y2="240" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.28" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id={id("inside")} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
              <stop offset="0.35" stopColor="#fff" stopOpacity="0.02" />
              <stop offset="0.8" stopColor="#fff" stopOpacity="0.03" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
            </linearGradient>
            <radialGradient id={id("glow")} cx="72" cy="150" r="78" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={id("neck")} x1="0" y1="44" x2="0" y2="74" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.25" stopColor="#fff" stopOpacity="0.8" />
              <stop offset="0.75" stopColor="#fff" stopOpacity="0.8" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={id("streak")} x1="0" y1="84" x2="0" y2="204" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.12" stopColor="#fff" stopOpacity="0.95" />
              <stop offset="0.6" stopColor="#fff" stopOpacity="0.78" />
              <stop offset="0.9" stopColor="#fff" stopOpacity="0.3" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={id("streak2")} x1="0" y1="112" x2="0" y2="196" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.3" stopColor="#fff" stopOpacity="0.5" />
              <stop offset="0.75" stopColor="#fff" stopOpacity="0.4" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={id("sheen")} x1="0" y1="110" x2="0" y2="228" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.4" stopColor="#fff" stopOpacity="0.42" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id={id("lip")} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0.42" />
              <stop offset="0.3" stopColor="#fff" stopOpacity="0.1" />
              <stop offset="0.7" stopColor="#fff" stopOpacity="0.07" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.3" />
            </linearGradient>

            {/* Sombra de contacto y luz del líquido sobre la mesa */}
            <radialGradient id={id("shadow")}>
              <stop offset="0" stopColor="#000" stopOpacity="0.75" />
              <stop offset="0.6" stopColor="#000" stopOpacity="0.3" />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={id("pool")}>
              <stop offset="0" className="furin-liquid-fill__c-glow" stopOpacity="0.85" />
              <stop offset="0.5" className="furin-liquid-fill__c-mid" stopOpacity="0.32" />
              <stop offset="1" className="furin-liquid-fill__c-mid" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={id("halo")}>
              <stop offset="0" className="furin-liquid-fill__c-mid" stopOpacity="0.55" />
              <stop offset="1" className="furin-liquid-fill__c-mid" stopOpacity="0" />
            </radialGradient>
            <filter id={id("soft")} x="-30%" y="-10%" width="160%" height="120%">
              <feGaussianBlur stdDeviation="1.7" />
            </filter>
            <filter id={id("soft2")} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="0.7" />
            </filter>
          </defs>

          {/* Halo del líquido, luz sobre la mesa y sombra de contacto */}
          <ellipse ref={haloRef} cx="100" cy="170" rx="118" ry="104" fill={url("halo")} opacity={fr.haloOpacity} />
          <g ref={floorRef} opacity={fr.floorOpacity}>
            <ellipse cx="108" cy="248" rx="92" ry="11" fill={url("pool")} />
            <ellipse cx="116" cy="248.5" rx="42" ry="4.2" fill={url("pool")} />
          </g>
          <ellipse cx="100" cy="246.5" rx="68" ry="6" fill={url("shadow")} />

          {/* Interior del vidrio, ya con brillo propio */}
          <path d={INNER_D} fill={url("inside")} />

          {/* Líquido recortado por el interior del matraz */}
          <g clipPath={url("clip")}>
            <use href={`#${id("wb")}`} fill={url("back")} />
            <use href={`#${id("wf")}`} fill={url("front")} />
            <use href={`#${id("wf")}`} fill={url("core")} />
            <use href={`#${id("wf")}`} fill={url("shade")} />
            <ellipse ref={causticRef} cx="94" cy={fr.ySurf + 3} rx={Math.max(fr.hw * 0.8, 4)} ry="7" fill={url("caustic")} opacity={fr.causticOpacity} />
            <use href={`#${id("wc")}`} fill="none" stroke={url("crest")} strokeWidth="3.2" strokeLinecap="round" opacity="0.38" filter={url("soft2")} />
            <use href={`#${id("wc")}`} fill="none" stroke={url("crest")} strokeWidth="1" strokeLinecap="round" opacity="0.92" />
            {BUBBLES.map((b, i) => (
              <g
                key={i}
                ref={(el) => {
                  bubRefs.current[i] = el;
                }}
                transform={init.poses[i].tf}
                opacity={init.poses[i].op.toFixed(2)}
              >
                <circle r={b.r} fill={url("bubble")} />
                <circle cx={-b.r * 0.32} cy={-b.r * 0.34} r={Math.max(b.r * 0.26, 0.3)} fill="#fff" opacity="0.85" />
              </g>
            ))}
          </g>

          {/* Pared de vidrio: grosor visible entre el contorno exterior y el interior */}
          <path d={WALL_D} fillRule="evenodd" fill={url("wall")} />
          <use href={`#${id("wf")}`} className="furin-liquid-fill__tint" clipPath={url("wallclip")} opacity="0.6" />
          <path d={INNER_D} fill={url("glow")} clipPath={url("clip")} />
          <path d={INNER_OPEN} fill="none" stroke={url("edge2")} strokeWidth="0.8" />
          <path d={OUTER_OPEN} fill="none" stroke={url("edge")} strokeWidth="1.3" strokeLinejoin="round" />

          {/* Boca con reborde */}
          <rect x="76" y="9" width="48" height="15" rx="6" fill={url("lip")} />
          <rect x="76" y="9" width="48" height="15" rx="6" fill="none" stroke={url("edge")} strokeWidth="1.1" />
          <ellipse cx="100" cy="10" rx="23" ry="2.9" fill="#fff" opacity="0.26" />
          <ellipse cx="100" cy="10.4" rx="16.5" ry="2" fill="#05080b" opacity="0.5" />
          <path d="M84 21.2Q100 23.6 116 21.2" fill="none" stroke="#fff" strokeWidth="0.7" opacity="0.35" strokeLinecap="round" />

          {/* Reflejos especulares */}
          <path d={edgePath(OUTER, "R", 14)} fill="none" stroke={url("sheen")} strokeWidth="8" strokeLinecap="round" opacity="0.75" filter={url("soft")} />
          <path d={edgePath(OUTER, "R", 8.5, 1)} fill="none" stroke={url("sheen")} strokeWidth="1.1" strokeLinecap="round" opacity="0.75" />
          <path d="M93.4 44V74" fill="none" stroke={url("neck")} strokeWidth="2.6" strokeLinecap="round" />
          <path d={edgePath(OUTER, "L", 11.5, 1)} fill="none" stroke={url("streak")} strokeWidth="3.8" strokeLinecap="round" />
          <path d={edgePath(OUTER, "L", 19.5, 1)} fill="none" stroke={url("streak2")} strokeWidth="1.8" strokeLinecap="round" />
          <ellipse cx="91.5" cy="86" rx="1.6" ry="3.2" fill="#fff" opacity="0.9" transform="rotate(-18 91.5 86)" />
          <path d="M82 13.4Q85 11.6 90 11.4" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.85" />
          <path d="M60 241.6Q100 246.4 140 241.6" fill="none" stroke="#fff" strokeWidth="0.9" strokeLinecap="round" opacity="0.28" />
          <path d="M158 236Q170 230 173 214" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
        </svg>

        {showPercent ? (
          <div className="furin-liquid-fill__percent" aria-hidden="true">
            <span className="furin-liquid-fill__figure">
              <span ref={numRef}>{Math.round(init.level)}</span>
              <span className="furin-liquid-fill__sign">%</span>
            </span>
          </div>
        ) : null}
      </div>
      {label ? <div className="furin-liquid-fill__label">{label}</div> : null}
    </div>
  );
}

export default LiquidFill;
