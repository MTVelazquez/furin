"use client";
import { useEffect, useRef } from "react";
import type { ButtonHTMLAttributes, CSSProperties, MouseEvent, ReactNode } from "react";
import "./ConfettiButton.css";

export interface ConfettiButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style" | "className"> {
  /** Texto del botón. */
  children?: ReactNode;
  /** Cuántos papelitos salen. */
  count?: number;
  /** Colores de los papelitos. */
  colors?: string[];
  /** Apertura del abanico, en grados. */
  spread?: number;
  /** Dirección central de la explosión, en grados (-90 = hacia arriba). */
  angle?: number;
  /** Fuerza del disparo (1 = normal). */
  power?: number;
  /** De dónde salen: del punto del clic o del centro del botón. */
  origin?: "pointer" | "center";
  /** Color del fondo del botón. */
  background?: string;
  /** Color del texto del botón. */
  color?: string;
  /** Clase extra para el botón. */
  className?: string;
  /** Estilos extra para el botón. */
  style?: CSSProperties;
}

interface P {
  x: number; y: number; vx: number; vy: number;
  w: number; h: number; rot: number; spin: number;
  tilt: number; tiltSpeed: number; sway: number; swayPhase: number; swaySpeed: number;
  drag: number; color: string; shape: 0 | 1 | 2; life: number; max: number;
}

/** Sombrea un color #rgb/#rrggbb (para el reverso del papelito). */
function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Botón que lanza confeti físico: papelitos que giran en 3D, caen con resistencia del aire y se mecen. */
export function ConfettiButton({
  children = "Celebrate",
  count = 120,
  colors = ["#ff5470", "#ffb84d", "#3ddc97", "#4da3ff", "#a66bff", "#ffffff"],
  spread = 130,
  angle = -90,
  power = 1,
  origin = "pointer",
  background = "#f4f4f7",
  color = "#14151a",
  className = "",
  style,
  onClick,
  ...rest
}: ConfettiButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const sim = useRef<{ cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; parts: P[]; rings: { x: number; y: number; t: number }[]; raf: number; last: number; dpr: number; onResize: () => void } | null>(null);

  const stop = () => {
    const s = sim.current;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    window.removeEventListener("resize", s.onResize);
    s.cv.remove();
    sim.current = null;
  };

  useEffect(() => stop, []);

  const frame = (now: number) => {
    const s = sim.current;
    if (!s) return;
    const dt = Math.min(0.033, (now - s.last) / 1000 || 0.016);
    s.last = now;
    const { ctx, parts } = s;
    const W = window.innerWidth, H = window.innerHeight;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // Onda de choque del disparo
    for (let i = s.rings.length - 1; i >= 0; i--) {
      const r = s.rings[i];
      r.t += dt;
      const f = r.t / 0.45;
      if (f >= 1) { s.rings.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * (1 - f)})`;
      ctx.lineWidth = 3 * (1 - f) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + 110 * (1 - Math.pow(1 - f, 3)), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life > p.max || p.y > H + 60) { parts.splice(i, 1); continue; }
      // Resistencia: un papelito de canto cae más rápido que uno de plano.
      const cosT = Math.cos(p.tilt);
      const k = p.drag * (0.55 + 0.9 * Math.abs(cosT));
      p.vx *= Math.exp(-k * dt);
      p.vy = p.vy * Math.exp(-k * dt) + 620 * dt;
      p.swayPhase += p.swaySpeed * dt;
      const settle = Math.min(1, p.life / 0.5);
      p.x += (p.vx + Math.sin(p.swayPhase) * p.sway * settle) * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.tilt += p.tiltSpeed * dt;
      const a = Math.min(1, (p.max - p.life) / 0.7);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, cosT);
      ctx.globalAlpha = a;
      // El anverso y el reverso no tienen el mismo brillo: eso da la sensación de giro.
      ctx.fillStyle = cosT >= 0 ? p.color : shade(p.color, 0.72);
      if (p.shape === 2) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (parts.length || s.rings.length) s.raf = requestAnimationFrame(frame);
    else stop();
  };

  const fire = (cx: number, cy: number) => {
    if (!sim.current) {
      const cv = document.createElement("canvas");
      cv.setAttribute("aria-hidden", "true");
      cv.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000";
      document.body.appendChild(cv);
      const ctx = cv.getContext("2d");
      if (!ctx) { cv.remove(); return; }
      const onResize = () => {
        const q = sim.current;
        if (!q) return;
        q.dpr = Math.min(window.devicePixelRatio || 1, 2);
        q.cv.width = Math.round(window.innerWidth * q.dpr);
        q.cv.height = Math.round(window.innerHeight * q.dpr);
      };
      sim.current = { cv, ctx, parts: [], rings: [], raf: 0, last: performance.now(), dpr: 1, onResize };
      onResize();
      window.addEventListener("resize", onResize);
      sim.current.raf = requestAnimationFrame(frame);
    }
    const s = sim.current;
    s.rings.push({ x: cx, y: cy, t: 0 });
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const pal = colors.length ? colors : ["#fff"];
    for (let i = 0; i < count; i++) {
      const a = ((angle + rnd(-spread / 2, spread / 2)) * Math.PI) / 180;
      // La mayoría sale con fuerza media y unos pocos salen disparados.
      const v = (260 + Math.pow(Math.random(), 1.6) * 1100) * power;
      const shape = (Math.random() < 0.55 ? 0 : Math.random() < 0.55 ? 1 : 2) as 0 | 1 | 2;
      const size = rnd(7, 12);
      s.parts.push({
        x: cx + Math.cos(a) * 6, y: cy + Math.sin(a) * 6,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: shape === 1 ? size * 0.55 : size, h: shape === 1 ? size * 2.6 : size * rnd(0.55, 0.9),
        rot: rnd(0, 6.28), spin: rnd(-9, 9),
        tilt: rnd(0, 6.28), tiltSpeed: rnd(7, 16) * (Math.random() < 0.5 ? -1 : 1),
        sway: rnd(18, 70), swayPhase: rnd(0, 6.28), swaySpeed: rnd(3, 7),
        drag: rnd(2.2, 3.8), color: pal[Math.floor(Math.random() * pal.length)],
        shape, life: 0, max: rnd(2.6, 4.2),
      });
    }
  };

  const handle = (e: MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Un clic con teclado reporta (0,0): ahí se usa el centro del botón.
    const keyboard = e.clientX === 0 && e.clientY === 0;
    const fromPointer = origin === "pointer" && !keyboard;
    fire(fromPointer ? e.clientX : r.left + r.width / 2, fromPointer ? e.clientY : r.top + r.height / 2);
  };

  const vars = { "--furin-confetti-button-bg": background, "--furin-confetti-button-color": color } as CSSProperties;
  return (
    <button ref={ref} type="button" className={`furin-confetti-button ${className}`} style={{ ...vars, ...style }} onClick={handle} {...rest}>
      <svg className="furin-confetti-button__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 3.5c.5 4.2 1.6 5.3 5.8 5.8-4.2.5-5.3 1.6-5.8 5.8-.5-4.2-1.6-5.3-5.8-5.8 4.2-.5 5.3-1.6 5.8-5.8Z" fill="currentColor" />
        <path d="M18 13.5c.3 2.3.9 2.9 3.2 3.2-2.3.3-2.9.9-3.2 3.2-.3-2.3-.9-2.9-3.2-3.2 2.3-.3 2.9-.9 3.2-3.2Z" fill="currentColor" opacity="0.7" />
      </svg>
      <span>{children}</span>
    </button>
  );
}

export default ConfettiButton;
