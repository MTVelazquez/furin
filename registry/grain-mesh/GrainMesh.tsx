"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./GrainMesh.css";

export interface GrainMeshProps {
  /** Contenido que va encima del degradado. */
  children?: ReactNode;
  /** Colores de la malla (de 2 a 5); cada uno ancla una zona que flota. */
  colors?: string[];
  /** Cantidad de grano de película. */
  grain?: number;
  /** Qué tan rápido se mueve la malla. */
  speed?: number;
  /** Tamaño de las manchas de color (mayor = más suaves y grandes). */
  scale?: number;
  /** Qué tanto jala el cursor a una de las manchas. */
  reactivity?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const MAX_COLORES = 5;
const POR_DEFECTO = ["#0e1a33", "#d9b98f", "#3b5b8f", "#b86f55", "#1c2b52"];

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
#define N ${MAX_COLORES}
uniform vec2 u_res;
uniform float u_t;
uniform float u_scale;
uniform float u_grain;
uniform float u_frame;      // cuadro de grano (24 por segundo)
uniform float u_dpr;
uniform int u_n;
uniform vec3 u_col[N];
uniform vec2 u_ptr;         // cursor suavizado (-1..1) y su fuerza en z
uniform float u_ptrk;
out vec4 o;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float asp = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(asp, 1.0) / u_scale;
  float t = u_t;

  // Doble deformación del dominio: las manchas se estiran como tinta en agua.
  vec2 q = p;
  q += 0.16 * vec2(sin(p.y * 2.3 + t * 0.31), cos(p.x * 2.0 - t * 0.27));
  q += 0.09 * vec2(sin(q.y * 4.1 - t * 0.43 + 1.3), cos(q.x * 3.6 + t * 0.37));

  // Cada color tiene un ancla que orbita con su propio ritmo; el cursor arrastra la última.
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < N; i++) {
    if (i >= u_n) break;
    float fi = float(i);
    vec2 base = vec2(cos(fi * 2.399 + 0.6), sin(fi * 2.399 + 0.6)) * vec2(0.62 * asp * 0.7 + 0.18, 0.42);
    vec2 a = base + 0.22 * vec2(sin(t * (0.19 + fi * 0.047) + fi * 1.7), cos(t * (0.23 + fi * 0.031) + fi * 2.3));
    if (i == u_n - 1) a = mix(a, u_ptr * vec2(asp * 0.5, 0.5) / u_scale, u_ptrk);
    vec2 d = q - a;
    float w = 1.0 / (pow(dot(d, d), 1.35) + 0.012);
    acc += toLin(u_col[i]) * w;
    wsum += w;
  }
  vec3 col = acc / wsum;

  // Veladura sedosa: luz suave que ondula sobre la malla.
  float sheen = vnoise(q * 1.6 + vec2(t * 0.08, -t * 0.05));
  col *= 0.86 + 0.28 * sheen;

  col = toSrgb(col);

  // Viñeta de lente.
  vec2 vv = uv - 0.5;
  col *= 1.0 - 0.55 * dot(vv, vv) * 1.5;

  // Grano de película: tamaño constante en píxeles reales, cambia 24 veces por segundo,
  // más visible en medios tonos que en negros y blancos.
  vec2 gp = floor(gl_FragCoord.xy / max(1.0, u_dpr * 0.85)) + vec2(u_frame * 17.0, u_frame * 31.0);
  float g = (hash12(gp) + hash12(gp + 19.7) + hash12(gp * 1.37 + 3.1)) / 3.0 - 0.5;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float mid = 0.55 + 1.2 * lum * (1.0 - lum) * 2.0;
  col += g * u_grain * 0.15 * mid;
  col += (hash12(gl_FragCoord.xy + 91.7) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

let colorCtx: CanvasRenderingContext2D | null = null;
const RGB_CACHE = new Map<string, [number, number, number]>();
function rgb(css: string): [number, number, number] {
  const hit = RGB_CACHE.get(css);
  if (hit) return hit;
  try {
    colorCtx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    colorCtx.clearRect(0, 0, 1, 1);
    colorCtx.fillStyle = "#101820";
    colorCtx.fillStyle = css;
    colorCtx.fillRect(0, 0, 1, 1);
    const d = colorCtx.getImageData(0, 0, 1, 1).data;
    const out: [number, number, number] = [d[0] / 255, d[1] / 255, d[2] / 255];
    if (RGB_CACHE.size > 64) RGB_CACHE.clear();
    RGB_CACHE.set(css, out);
    return out;
  } catch {
    return [0.06, 0.09, 0.13];
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

/** Fondo de gradiente de malla: manchas de color que flotan y se funden, con grano fino de película encima. */
export function GrainMesh({
  children,
  colors = POR_DEFECTO,
  grain = 1,
  speed = 1,
  scale = 1,
  reactivity = 1,
  className = "",
  style,
}: GrainMeshProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const props = useRef({ colors, grain, speed, scale, reactivity });
  props.current = { colors, grain, speed, scale, reactivity };
  const wakeRef = useRef<(() => void) | null>(null);
  const clave = colors.join("|");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-grain-mesh__lienzo";
    canvas.setAttribute("aria-hidden", "true");
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, powerPreference: "high-performance" });
    if (!gl) return; // sin WebGL2 queda el degradado de CSS
    root.insertBefore(canvas, root.firstChild);

    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let prog: WebGLProgram | null = null;
    let U: Record<string, WebGLUniformLocation | null> = {};
    let visible = true, muerto = false, raf = 0, w = 0, h = 0, dpr = 1;
    let t = reducido ? 5.5 : 1.2, ult = 0;
    const ptr = { x: 0, y: 0, tx: 0, ty: 0, k: 0, kObj: 0 };

    const iniciarGl = () => {
      prog = compilar(gl, VERT, FRAG);
      if (!prog) return;
      for (const k of ["u_res", "u_t", "u_scale", "u_grain", "u_frame", "u_dpr", "u_n", "u_col", "u_ptr", "u_ptrk"]) U[k] = gl.getUniformLocation(prog, k);
      gl.useProgram(prog);
    };

    const pintar = () => {
      if (!prog || gl.isContextLost() || !w) return;
      const p = props.current;
      const lista = (p.colors.length >= 2 ? p.colors : POR_DEFECTO).slice(0, MAX_COLORES);
      const flat = new Float32Array(MAX_COLORES * 3);
      lista.forEach((c, i) => flat.set(rgb(c), i * 3));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.uniform2f(U.u_res, canvas.width, canvas.height);
      gl.uniform1f(U.u_t, t);
      gl.uniform1f(U.u_scale, p.scale);
      gl.uniform1f(U.u_grain, p.grain);
      gl.uniform1f(U.u_frame, Math.floor(performance.now() / 41.7) % 997);
      gl.uniform1f(U.u_dpr, dpr);
      gl.uniform1i(U.u_n, lista.length);
      gl.uniform3fv(U.u_col, flat);
      gl.uniform2f(U.u_ptr, ptr.x, ptr.y);
      gl.uniform1f(U.u_ptrk, ptr.k * 0.8 * Math.min(p.reactivity, 1.25));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const paso = (ts: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.05, ult ? (ts - ult) / 1000 : 0.016);
      ult = ts;
      t += dt * 0.5 * props.current.speed;
      const k = 1 - Math.exp(-dt * 2.4);
      ptr.x += (ptr.tx - ptr.x) * k; ptr.y += (ptr.ty - ptr.y) * k;
      ptr.k += (ptr.kObj - ptr.k) * (1 - Math.exp(-dt * 2));
      pintar();
      raf = requestAnimationFrame(paso);
    };
    const wake = () => { if (reducido) return; if (!raf && visible && !muerto) { ult = 0; raf = requestAnimationFrame(paso); } };
    wakeRef.current = () => { if (reducido) pintar(); else wake(); };

    const medir = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
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

    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      ptr.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptr.ty = -(((e.clientY - r.top) / r.height) * 2 - 1);
      ptr.kObj = 1;
    };
    const onLeave = () => { ptr.kObj = 0; };
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

  // Con velocidad 0 o movimiento reducido el bucle duerme: si cambian las props hay que repintar.
  useEffect(() => { wakeRef.current?.(); }, [clave, grain, speed, scale, reactivity]);

  return (
    <div ref={rootRef} className={`furin-grain-mesh ${className}`} style={style}>
      {children != null ? <div className="furin-grain-mesh__contenido">{children}</div> : null}
    </div>
  );
}

export default GrainMesh;
