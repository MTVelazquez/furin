"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./DitherWave.css";

export interface DitherWaveProps {
  /** Contenido que va encima de la onda. */
  children?: ReactNode;
  /** Color de los píxeles apagados (el fondo). */
  dark?: string;
  /** Color de los píxeles encendidos. */
  light?: string;
  /** Tamaño de cada píxel del tramado, en px. */
  cell?: number;
  /** Qué tan rápido avanza la onda. */
  speed?: number;
  /** Altura del relieve. */
  amplitude?: number;
  /** Qué tanto deforma el cursor la superficie. */
  reactivity?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_t;
uniform float u_cell;       // tamaño del píxel de tramado, en píxeles reales
uniform float u_amp;
uniform vec3 u_dark;
uniform vec3 u_light;
uniform vec3 u_ptr;         // x, y (espacio de la superficie) y fuerza
uniform vec4 u_ond[6];      // ondas del cursor: x, y, nacimiento, fuerza
uniform float u_now;
out vec4 o;

// Matriz de Bayer 8x8 como umbral de tramado ordenado.
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

// Relieve: marejada de varias capas con el dominio doblado, para que no repita.
float H(vec2 p) {
  float t = u_t;
  vec2 q = p;
  q += 0.30 * vec2(sin(p.y * 1.5 + t * 0.40), cos(p.x * 1.3 - t * 0.33));
  float a = 0.50 * sin(q.x * 3.4 + q.y * 1.5 + t * 0.7 + sin(q.y * 1.9 + t * 0.3) * 1.8);
  a += 0.34 * sin(q.y * 3.1 - q.x * 1.9 - t * 0.55);
  a += 0.22 * sin(length(q - vec2(0.55, -0.25)) * 6.0 - t * 0.9);
  // Oleaje fino montado sobre la marejada grande.
  a += 0.16 * sin((q.x * 0.8 + q.y * 1.5) * 9.0 - t * 1.3 + a * 2.0);
  float h = a * u_amp;
  vec2 d = p - u_ptr.xy;
  h += u_ptr.z * 0.55 * exp(-dot(d, d) * 6.0);
  for (int i = 0; i < 6; i++) {
    vec4 g = u_ond[i];
    if (g.w <= 0.0) continue;
    float age = u_now - g.z;
    float x = length(p - g.xy) - age * 0.55;
    h += g.w * 0.3 * cos(x * 16.0) * exp(-x * x * 30.0) * exp(-age * 1.1);
  }
  return h;
}

void main() {
  vec2 pc = floor(gl_FragCoord.xy / u_cell);
  vec2 c = (pc + 0.5) * u_cell;
  vec2 p = (c - 0.5 * u_res) / u_res.y * 2.0;
  float e = u_cell / u_res.y * 2.0;
  float h0 = H(p), hx = H(p + vec2(e, 0.0)), hy = H(p + vec2(0.0, e));
  vec3 n = normalize(vec3(-(hx - h0) / e * 0.30, -(hy - h0) / e * 0.30, 1.0));
  vec3 l = normalize(vec3(-0.5, 0.55, 0.67));
  float dif = dot(n, l);
  // Tono: altura (valles oscuros, crestas claras) + luz difusa que modela cada ola; el tramado convierte ese gradiente en puntos.
  float L = 0.5 + 0.30 * h0 + 0.5 * (dif - 0.67);
  L = smoothstep(0.08, 0.92, L);
  // Hacia las esquinas la onda se apaga: el centro queda como escenario.
  vec2 vv = gl_FragCoord.xy / u_res - 0.5;
  L *= 1.0 - 0.9 * smoothstep(0.18, 0.62, dot(vv, vv) * 1.6);
  float th = bayer8(pc);
  vec3 col = L > th ? u_light : u_dark;
  o = vec4(col, 1.0);
}`;

let colorCtx: CanvasRenderingContext2D | null = null;
const RGB_CACHE = new Map<string, [number, number, number]>();
function rgb(css: string, def: [number, number, number]): [number, number, number] {
  const hit = RGB_CACHE.get(css);
  if (hit) return hit;
  try {
    colorCtx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    colorCtx.clearRect(0, 0, 1, 1);
    colorCtx.fillStyle = "#010203";
    colorCtx.fillStyle = css;
    colorCtx.fillRect(0, 0, 1, 1);
    const d = colorCtx.getImageData(0, 0, 1, 1).data;
    const out: [number, number, number] = [d[0] / 255, d[1] / 255, d[2] / 255];
    if (RGB_CACHE.size > 64) RGB_CACHE.clear();
    RGB_CACHE.set(css, out);
    return out;
  } catch {
    return def;
  }
}

function compilar(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const mk = (tipo: number, src: string) => {
    const s = gl.createShader(tipo)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const a = mk(gl.VERTEX_SHADER, vs), b = mk(gl.FRAGMENT_SHADER, fs);
  if (!a || !b) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, a); gl.attachShader(p, b);
  gl.linkProgram(p);
  gl.deleteShader(a); gl.deleteShader(b);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); return null; }
  return p;
}

/** Fondo de onda tramada: un relieve que fluye, dibujado solo con píxeles de dos colores (tramado Bayer de 1 bit). */
export function DitherWave({
  children,
  dark = "#0a0b0f",
  light = "#d9d3c3",
  cell = 3,
  speed = 1,
  amplitude = 1,
  reactivity = 1,
  className = "",
  style,
}: DitherWaveProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const props = useRef({ dark, light, cell, speed, amplitude, reactivity });
  props.current = { dark, light, cell, speed, amplitude, reactivity };
  const wakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-dither-wave__lienzo";
    canvas.setAttribute("aria-hidden", "true");
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, powerPreference: "high-performance" });
    if (!gl) return; // sin WebGL2 queda el color oscuro de fondo
    root.insertBefore(canvas, root.firstChild);

    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let prog: WebGLProgram | null = null;
    let U: Record<string, WebGLUniformLocation | null> = {};
    let visible = true, muerto = false, raf = 0, w = 0, h = 0, dpr = 1, t = reducido ? 6.2 : 1.5, ult = 0, reloj = 0;
    const ptr = { x: 0, y: 0, tx: 0, ty: 0, k: 0, kObj: 0, lx: 0, ly: 0, hay: false };
    const ond = new Float32Array(6 * 4);
    let sig = 0;

    const iniciarGl = () => {
      prog = compilar(gl, VERT, FRAG);
      if (!prog) return;
      for (const k of ["u_res", "u_t", "u_cell", "u_amp", "u_dark", "u_light", "u_ptr", "u_ond", "u_now"]) U[k] = gl.getUniformLocation(prog, k);
      gl.useProgram(prog);
    };

    const pintar = () => {
      if (!prog || gl.isContextLost() || !w) return;
      const p = props.current;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.uniform2f(U.u_res, canvas.width, canvas.height);
      gl.uniform1f(U.u_t, t);
      gl.uniform1f(U.u_cell, Math.max(1, Math.round(p.cell * dpr)));
      gl.uniform1f(U.u_amp, p.amplitude);
      gl.uniform3f(U.u_dark, ...rgb(p.dark, [0.04, 0.04, 0.06]));
      gl.uniform3f(U.u_light, ...rgb(p.light, [0.85, 0.83, 0.76]));
      gl.uniform3f(U.u_ptr, ptr.x, ptr.y, ptr.k * p.reactivity);
      gl.uniform4fv(U.u_ond, ond);
      gl.uniform1f(U.u_now, reloj);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const paso = (ts: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.05, ult ? (ts - ult) / 1000 : 0.016);
      ult = ts;
      reloj += dt;
      t += dt * 0.6 * props.current.speed;
      const k = 1 - Math.exp(-dt * 8);
      ptr.x += (ptr.tx - ptr.x) * k; ptr.y += (ptr.ty - ptr.y) * k;
      ptr.k += (ptr.kObj - ptr.k) * (1 - Math.exp(-dt * 4));
      for (let i = 0; i < 6; i++) if (ond[i * 4 + 3] > 0 && reloj - ond[i * 4 + 2] > 4) ond[i * 4 + 3] = 0;
      pintar();
      raf = requestAnimationFrame(paso);
    };
    const wake = () => { if (reducido) return; if (!raf && visible && !muerto) { ult = 0; raf = requestAnimationFrame(paso); } };
    wakeRef.current = () => { if (reducido) pintar(); else wake(); };

    const medir = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = root.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width * dpr)); h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      pintar();
      wake();
    };
    const ro = new ResizeObserver(medir);
    ro.observe(root);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "80px" });
    io.observe(root);

    const aSuperficie = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      const s = 2 / Math.max(r.height, 1);
      return [(e.clientX - r.left - r.width / 2) * s, -(e.clientY - r.top - r.height / 2) * s] as const;
    };
    const onMove = (e: PointerEvent) => {
      const [x, y] = aSuperficie(e);
      if (!ptr.hay) { ptr.x = x; ptr.y = y; ptr.hay = true; }
      ptr.tx = x; ptr.ty = y; ptr.kObj = 1;
      // Cada tramo de recorrido suelta un anillo que se expande.
      if (Math.hypot(x - ptr.lx, y - ptr.ly) > 0.3) {
        const i = sig++ % 6;
        ond[i * 4] = x; ond[i * 4 + 1] = y; ond[i * 4 + 2] = reloj; ond[i * 4 + 3] = 0.7;
        ptr.lx = x; ptr.ly = y;
      }
    };
    const onLeave = () => { ptr.kObj = 0; ptr.hay = false; };
    if (!reducido) {
      root.addEventListener("pointermove", onMove, { passive: true });
      root.addEventListener("pointerdown", onMove, { passive: true });
      root.addEventListener("pointerleave", onLeave);
    }
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
    canvas.addEventListener("webglcontextrestored", () => { U = {}; iniciarGl(); medir(); });

    iniciarGl();
    medir();

    return () => {
      muerto = true;
      wakeRef.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onMove);
      root.removeEventListener("pointerleave", onLeave);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);

  useEffect(() => { wakeRef.current?.(); }, [dark, light, cell, speed, amplitude, reactivity]);

  const vars = { "--furin-dither-wave-dark": dark } as CSSProperties;
  return (
    <div ref={rootRef} className={`furin-dither-wave ${className}`} style={{ ...vars, ...style }}>
      {children != null ? <div className="furin-dither-wave__contenido">{children}</div> : null}
    </div>
  );
}

export default DitherWave;
