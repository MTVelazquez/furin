"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import "./SilkFlow.css";

export interface SilkFlowProps {
  /** Color base de la seda (las sombras salen más oscuras). */
  color?: string;
  /** Color del brillo de la seda. */
  highlight?: string;
  /** Cuántos pliegues hay (más alto = más ondas). */
  folds?: number;
  /** Intensidad del brillo anisotrópico (0 a 2). */
  sheen?: number;
  /** Velocidad del vaivén (1 = normal). */
  speed?: number;
  /** Si es true, la luz sigue al cursor. */
  interactive?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPtr;
uniform vec3 uMid;
uniform vec3 uHi;
uniform float uFolds;
uniform float uSheen;
out vec4 outColor;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
// Altura de la tela: pliegues largos que se deforman unos a otros.
float H(vec2 p) {
  float t = uTime;
  vec2 q = p + 0.34 * vec2(sin(p.y * 1.4 + t * 0.30), cos(p.x * 1.1 - t * 0.24));
  float h = 0.0;
  h += 0.62 * sin(dot(q, vec2(0.84, 0.54)) * uFolds * 2.0 + t * 0.40 + 1.3 * sin(q.y * 1.2 + t * 0.17));
  h += 0.32 * sin(dot(q, vec2(-0.30, 0.95)) * uFolds * 3.3 - t * 0.31 + 1.0 * sin(q.x * 2.1 - t * 0.2));
  h += 0.14 * sin(dot(q, vec2(0.96, -0.28)) * uFolds * 5.7 + t * 0.52);
  return h;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(asp, 1.0) * 2.0;
  float e = 0.004;
  float h0 = H(p);
  float hx = (H(p + vec2(e, 0.0)) - H(p - vec2(e, 0.0))) / (2.0 * e);
  float hy = (H(p + vec2(0.0, e)) - H(p - vec2(0.0, e))) / (2.0 * e);
  vec3 N = normalize(vec3(-hx * 0.2, -hy * 0.2, 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(-0.5 + uPtr.x * 0.8, 0.55 + uPtr.y * 0.6, 0.7));
  vec3 Hh = normalize(L + V);
  // Dirección del hilo: sigue los pliegues y varía despacio.
  float ta = 0.6 + 0.5 * sin(p.x * 0.9 + uTime * 0.07) + h0 * 0.28;
  vec3 T = normalize(vec3(cos(ta), sin(ta), 0.0));
  T = normalize(T - N * dot(T, N));
  float th = dot(T, Hh);
  float sinTH = sqrt(max(0.0, 1.0 - th * th));
  float nl = dot(N, L);
  float diff = pow(clamp(nl * 1.15 - 0.12, 0.0, 1.0), 2.2);
  vec3 col = mix(uMid * 0.07, uMid * 1.15, diff);
  // Fibras: ruido muy estirado a lo largo del hilo.
  vec2 tp = vec2(dot(p, T.xy), dot(p, vec2(-T.y, T.x)));
  float fib = 0.55 * vn(vec2(tp.x * 4.0, tp.y * 260.0)) + 0.45 * vn(vec2(tp.x * 9.0, tp.y * 520.0));
  float fm = 0.86 + 0.28 * fib;
  float lit = smoothstep(-0.15, 0.5, nl);
  float nh = max(dot(N, Hh), 0.0);
  vec3 hi2 = mix(uHi, uMid * 2.4, 0.6);
  vec3 spec = uHi * (0.5 * pow(sinTH, 70.0) * lit * fm + 0.5 * pow(nh, 55.0))
            + hi2 * (0.32 * pow(sinTH, 10.0) * lit * fm + 0.3 * pow(nh, 9.0));
  col += spec * uSheen * 0.85;
  col += uMid * pow(1.0 - N.z, 2.2) * 0.22;
  col *= 1.0 - 0.34 * dot(uv - 0.5, uv - 0.5) * 2.0;
  col = col / (1.0 + col * 0.45) * 1.3;
  col = pow(max(col, 0.0), vec3(0.92));
  col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.012;
  outColor = vec4(col, 1.0);
}`;

// Convierte cualquier color CSS a [r,g,b] en 0..1 usando un canvas de 1px.
let cc: CanvasRenderingContext2D | null = null;
const memo = new Map<string, [number, number, number]>();
function rgb(c: string): [number, number, number] {
  const hit = memo.get(c);
  if (hit) return hit;
  cc ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!cc) return [1, 1, 1];
  cc.clearRect(0, 0, 1, 1);
  cc.fillStyle = "#000";
  cc.fillStyle = c;
  cc.fillRect(0, 0, 1, 1);
  const d = cc.getImageData(0, 0, 1, 1).data;
  const v: [number, number, number] = [d[0] / 255, d[1] / 255, d[2] / 255];
  memo.set(c, v);
  return v;
}

/** Tela de seda que ondula despacio, con brillo anisotrópico que cambia con la luz (WebGL). */
export function SilkFlow({
  color = "#2b1c78",
  highlight = "#ffe3f7",
  folds = 1.5,
  sheen = 1,
  speed = 1,
  interactive = true,
  className = "",
  style,
}: SilkFlowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const opts = useRef({ color, highlight, folds, sheen, speed, interactive });
  opts.current = { color, highlight, folds, sheen, speed, interactive };

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    // El canvas se crea aquí (no en el JSX): así un remonte (StrictMode) nunca hereda un contexto ya perdido.
    const cv = document.createElement("canvas");
    cv.className = "furin-silk-flow-canvas";
    host.appendChild(cv);
    const gl = cv.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) { cv.remove(); return; }
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(prog));
      cv.remove();
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = U("uRes"), uTime = U("uTime"), uPtr = U("uPtr");
    const uMid = U("uMid");
    const uHi = U("uHi");
    const uFolds = U("uFolds");
    const uSheen = U("uSheen");

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
    let time = 12, last = 0, raf = 0, visible = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(2, Math.round(cv.clientWidth * dpr)), h = Math.max(2, Math.round(cv.clientHeight * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h);
    };
    const draw = () => {
      const o = opts.current;
      gl.uniform2f(uRes, cv.width, cv.height);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uPtr, ptr.x, ptr.y);
      gl.uniform3f(uMid, ...rgb(o.color));
      gl.uniform3f(uHi, ...rgb(o.highlight));
      gl.uniform1f(uFolds, o.folds);
      gl.uniform1f(uSheen, o.sheen);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      time += dt * opts.current.speed;
      const a = 1 - Math.exp(-dt * 4);
      ptr.x += (ptr.tx - ptr.x) * a;
      ptr.y += (ptr.ty - ptr.y) * a;
      draw();
      if (visible) raf = requestAnimationFrame(tick); else last = 0;
    };
    const wake = () => { if (!raf && visible && !reduce) raf = requestAnimationFrame(tick); };
    const onMove = (e: PointerEvent) => {
      if (!opts.current.interactive) return;
      const r = cv.getBoundingClientRect();
      ptr.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptr.ty = 1 - ((e.clientY - r.top) / r.height) * 2;
    };
    const onLeave = () => { ptr.tx = 0; ptr.ty = 0; };
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    const ro = new ResizeObserver(() => { resize(); draw(); });
    ro.observe(cv);
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); }, { threshold: 0.01 });
    io.observe(cv);
    resize();
    draw();
    wake();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      cv.remove();
    };
  }, []);

  return <div ref={ref} className={`furin-silk-flow ${className}`} style={style} aria-hidden />;
}

export default SilkFlow;
