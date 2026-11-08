"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./Galaxy.css";

export interface GalaxyProps {
  /** Contenido que va encima de la galaxia. */
  children?: ReactNode;
  /** Color del núcleo y del bulbo central. */
  coreColor?: string;
  /** Color de los brazos espirales. */
  armColor?: string;
  /** Color del fondo del espacio. */
  background?: string;
  /** Cantidad de partículas (1 = normal). */
  density?: number;
  /** Cuántos brazos tiene la espiral. */
  arms?: number;
  /** Qué tan rápido gira. */
  speed?: number;
  /** Inclinación de la galaxia respecto a la vista, en grados (90 = de frente). */
  tilt?: number;
  /** Qué tanto inclina la vista el cursor. */
  reactivity?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const VERT = `#version 300 es
in vec4 a_p;   // radio, ángulo inicial, altura, tamaño
in vec4 a_c;   // mezcla de color, fase de parpadeo, tipo (0 galaxia, 1 estrella de fondo), brillo
uniform float u_t;
uniform float u_spin;
uniform float u_radius;     // radio de la galaxia en píxeles reales
uniform float u_dpr;
uniform vec2 u_res;
uniform vec2 u_rot;         // cabeceo y giro
uniform vec3 u_core;
uniform vec3 u_arm;
out vec3 v_col;
out float v_a;
void main() {
  if (a_c.z > 0.5) {
    vec2 pos = a_p.xy + vec2(-u_rot.y, u_rot.x - 0.9) * 0.012 * a_p.w;
    gl_Position = vec4(pos, 0.0, 1.0);
    gl_PointSize = max(1.0, a_p.w * u_dpr);
    v_col = vec3(0.78, 0.84, 1.0);
    v_a = a_c.w * (0.65 + 0.35 * sin(u_t * 1.1 + a_c.y * 6.2831));
    return;
  }
  float r = a_p.x;
  float th = a_p.y + u_spin;
  vec3 P = vec3(r * cos(th), a_p.z, r * sin(th));
  float cy = cos(u_rot.y), sy = sin(u_rot.y);
  P = vec3(cy * P.x + sy * P.z, P.y, -sy * P.x + cy * P.z);
  float cp = cos(u_rot.x), sp = sin(u_rot.x);
  P = vec3(P.x, cp * P.y - sp * P.z, sp * P.y + cp * P.z);
  float D = 3.2;
  float k = D / (D - P.z);
  vec2 px = P.xy * k * u_radius;
  gl_Position = vec4(px / (0.5 * u_res), 0.0, 1.0);
  gl_PointSize = max(1.0, a_p.w * k * u_dpr * 1.2);
  float mixc = smoothstep(0.0, 0.62, r + (a_c.x - 0.5) * 0.4);
  v_col = mix(u_core, u_arm, mixc);
  // Unas pocas estrellas rosadas dan polvo y calor a los brazos.
  v_col = mix(v_col, vec3(1.0, 0.62, 0.72), step(0.93, a_c.x) * 0.45 * mixc);
  float tw = 0.82 + 0.18 * sin(u_t * 1.7 + a_c.y * 6.2831);
  v_a = a_c.w * tw * clamp(k, 0.6, 1.5) * (1.0 - 0.5 * smoothstep(0.7, 1.0, r));
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 v_col;
in float v_a;
out vec4 o;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 3.6) * (1.0 - smoothstep(0.82, 1.0, d));
  o = vec4(v_col * a * v_a, 1.0);
}`;

// Halo del núcleo: una pasada de pantalla completa, aditiva, bajo las partículas.
const GLOW_FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_radius;
uniform float u_sinp;
uniform vec3 u_core;
uniform vec3 u_arm;
uniform float u_t;
out vec4 o;
void main() {
  vec2 q = (gl_FragCoord.xy - 0.5 * u_res) / u_radius;
  float tight = exp(-dot(q, q) * 55.0);
  float bulge = exp(-dot(q, q) * 9.0);
  vec2 qd = vec2(q.x, q.y / max(u_sinp, 0.3));
  float disc = exp(-dot(qd, qd) * 2.4);
  vec3 c = u_core * (0.6 * tight + 0.26 * bulge) + mix(u_core, u_arm, 0.7) * 0.07 * disc;
  c *= 0.94 + 0.06 * sin(u_t * 0.6);
  o = vec4(c, 1.0);
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

const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += Math.random(); return (s - 2) * 1.7; };
const GLOW_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Fondo de galaxia espiral: decenas de miles de partículas con un núcleo brillante que gira; el cursor inclina la vista. */
export function Galaxy({
  children,
  coreColor = "#ffd9a6",
  armColor = "#7f9eea",
  background = "#04050a",
  density = 1,
  arms = 3,
  speed = 1,
  tilt = 50,
  reactivity = 1,
  className = "",
  style,
}: GalaxyProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const props = useRef({ coreColor, armColor, density, arms, speed, tilt, reactivity });
  props.current = { coreColor, armColor, density, arms, speed, tilt, reactivity };
  const wakeRef = useRef<(() => void) | null>(null);
  const claveGeo = `${density}|${arms}`;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-galaxy__lienzo";
    canvas.setAttribute("aria-hidden", "true");
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, powerPreference: "high-performance" });
    if (!gl) return; // sin WebGL2 queda el fondo oscuro
    root.insertBefore(canvas, root.firstChild);

    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let progP: WebGLProgram | null = null, progG: WebGLProgram | null = null;
    let U: Record<string, WebGLUniformLocation | null> = {};
    let UG: Record<string, WebGLUniformLocation | null> = {};
    let vao: WebGLVertexArrayObject | null = null, bufP: WebGLBuffer | null = null, bufC: WebGLBuffer | null = null, vaoG: WebGLVertexArrayObject | null = null;
    let nGal = 0, nTot = 0;
    let visible = true, muerto = false, raf = 0, w = 0, h = 0, dpr = 1, t = 0, ult = 0, spin = reducido ? 1.3 : 0.4;
    const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
    let geoClave = "";

    const generar = () => {
      const p = props.current;
      const nG = Math.round(34000 * Math.max(0.2, Math.min(2.5, p.density)));
      const nB = 650;
      const A = new Float32Array((nG + nB) * 4), C = new Float32Array((nG + nB) * 4);
      const brazos = Math.max(2, Math.min(6, Math.round(p.arms)));
      for (let i = 0; i < nG; i++) {
        const r = Math.pow(Math.random(), 1.7);
        const bulbo = Math.exp(-r * 7);
        let th: number, y: number;
        if (Math.random() < bulbo * 0.9) {
          th = Math.random() * 6.2832;
          y = gauss() * 0.075 * (0.4 + bulbo);
        } else {
          const brazo = Math.floor(Math.random() * brazos);
          // Los brazos se enrollan con el radio y se ensanchan hacia afuera.
          th = (brazo * 6.2832) / brazos + r * 4.6 + gauss() * (0.1 + 0.34 * r);
          y = gauss() * 0.035 * (1 - 0.6 * r);
        }
        const q = Math.random();
        const tam = q < 0.025 ? 3.0 + Math.random() * 2.2 : 0.9 + Math.random() * 1.6;
        A.set([r, th, y, tam], i * 4);
        C.set([Math.random(), Math.random(), 0, (q < 0.025 ? 0.5 : 0.22) * (0.55 + 0.7 * Math.random())], i * 4);
      }
      for (let i = 0; i < nB; i++) {
        const k = nG + i;
        A.set([Math.random() * 2 - 1, Math.random() * 2 - 1, 0, 0.8 + Math.random() * 1.1], k * 4);
        C.set([0, Math.random(), 1, 0.12 + Math.random() * 0.55], k * 4);
      }
      nGal = nG; nTot = nG + nB;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufP); gl.bufferData(gl.ARRAY_BUFFER, A, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufC); gl.bufferData(gl.ARRAY_BUFFER, C, gl.STATIC_DRAW);
      geoClave = `${p.density}|${p.arms}`;
    };

    const iniciarGl = () => {
      progP = compilar(gl, VERT, FRAG);
      progG = compilar(gl, GLOW_VERT, GLOW_FRAG);
      if (!progP || !progG) return;
      for (const k of ["u_t", "u_spin", "u_radius", "u_dpr", "u_res", "u_rot", "u_core", "u_arm"]) U[k] = gl.getUniformLocation(progP, k);
      for (const k of ["u_res", "u_radius", "u_sinp", "u_core", "u_arm", "u_t"]) UG[k] = gl.getUniformLocation(progG, k);
      vao = gl.createVertexArray(); bufP = gl.createBuffer(); bufC = gl.createBuffer(); vaoG = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const aP = gl.getAttribLocation(progP, "a_p"), aC = gl.getAttribLocation(progP, "a_c");
      gl.bindBuffer(gl.ARRAY_BUFFER, bufP); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufC); gl.enableVertexAttribArray(aC); gl.vertexAttribPointer(aC, 4, gl.FLOAT, false, 0, 0);
      generar();
    };

    const pintar = () => {
      if (!progP || !progG || gl.isContextLost() || !w) return;
      const p = props.current;
      const [cr, cg, cb] = rgb(p.coreColor, [1, 0.85, 0.65]);
      const [ar, ag, ab] = rgb(p.armColor, [0.5, 0.62, 0.92]);
      const pitch = (p.tilt * Math.PI) / 180 + ptr.y * 0.45 * p.reactivity;
      const yaw = ptr.x * 0.55 * p.reactivity + Math.sin(t * 0.13) * 0.05;
      const radius = 0.5 * (h * 0.78 + w * 0.22) * 1.08;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      // 1) halo del núcleo
      gl.useProgram(progG);
      gl.uniform2f(UG.u_res, canvas.width, canvas.height);
      gl.uniform1f(UG.u_radius, radius);
      gl.uniform1f(UG.u_sinp, Math.abs(Math.sin(pitch)));
      gl.uniform3f(UG.u_core, cr, cg, cb);
      gl.uniform3f(UG.u_arm, ar, ag, ab);
      gl.uniform1f(UG.u_t, t);
      gl.bindVertexArray(vaoG);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 2) partículas
      gl.useProgram(progP);
      gl.uniform1f(U.u_t, t);
      gl.uniform1f(U.u_spin, spin);
      gl.uniform1f(U.u_radius, radius);
      gl.uniform1f(U.u_dpr, dpr);
      gl.uniform2f(U.u_res, canvas.width, canvas.height);
      gl.uniform2f(U.u_rot, pitch, yaw);
      gl.uniform3f(U.u_core, cr, cg, cb);
      gl.uniform3f(U.u_arm, ar, ag, ab);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, nTot);
      void nGal;
    };

    const paso = (ts: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.05, ult ? (ts - ult) / 1000 : 0.016);
      ult = ts;
      t += dt;
      spin += dt * 0.07 * props.current.speed;
      const k = 1 - Math.exp(-dt * 3);
      ptr.x += (ptr.tx - ptr.x) * k; ptr.y += (ptr.ty - ptr.y) * k;
      pintar();
      raf = requestAnimationFrame(paso);
    };
    const wake = () => { if (reducido) return; if (!raf && visible && !muerto) { ult = 0; raf = requestAnimationFrame(paso); } };
    wakeRef.current = () => {
      if (geoClave !== `${props.current.density}|${props.current.arms}` && vao) generar();
      if (reducido) pintar(); else wake();
    };

    const medir = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const r = root.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width * dpr)); h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      // Las dimensiones que usa el shader van en píxeles reales.
      pintar();
      wake();
    };
    const ro = new ResizeObserver(medir);
    ro.observe(root);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "80px" });
    io.observe(root);

    // El cursor inclina la galaxia: arriba/abajo cabecea, izquierda/derecha gira la vista.
    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      ptr.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptr.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
    };
    const onLeave = () => { ptr.tx = 0; ptr.ty = 0; };
    if (!reducido) {
      root.addEventListener("pointermove", onMove, { passive: true });
      root.addEventListener("pointerdown", onMove, { passive: true });
      root.addEventListener("pointerleave", onLeave);
    }
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
    canvas.addEventListener("webglcontextrestored", () => { U = {}; UG = {}; iniciarGl(); medir(); });

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
      if (bufP) gl.deleteBuffer(bufP);
      if (bufC) gl.deleteBuffer(bufC);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);

  useEffect(() => { wakeRef.current?.(); }, [claveGeo, coreColor, armColor, speed, tilt, reactivity]);

  const vars = { "--furin-galaxy-bg": background } as CSSProperties;
  return (
    <div ref={rootRef} className={`furin-galaxy ${className}`} style={{ ...vars, ...style }}>
      <span className="furin-galaxy__vineta" aria-hidden="true" />
      {children != null ? <div className="furin-galaxy__contenido">{children}</div> : null}
    </div>
  );
}

export default Galaxy;
