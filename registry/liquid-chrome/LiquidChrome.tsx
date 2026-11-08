"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./LiquidChrome.css";

export interface LiquidChromeProps {
  /** Contenido que va encima del metal. */
  children?: ReactNode;
  /** Qué tan rápido fluye el metal. */
  speed?: number;
  /** Tamaño de las olas (menor = más olas). */
  scale?: number;
  /** Qué tanto ondula al paso del cursor. */
  reactivity?: number;
  /** Brillo del entorno reflejado. */
  intensity?: number;
  /** Color del metal (plata azulada por defecto). */
  tint?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const MAX_GOTAS = 12;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
#define MAX_GOTAS ${MAX_GOTAS}
uniform vec2 u_res;
uniform float u_t;          // tiempo de flujo del metal
uniform float u_now;        // reloj para la edad de las gotas
uniform float u_scale;
uniform float u_int;
uniform vec3 u_tint;
uniform vec2 u_ptr;         // cursor suavizado, en el espacio de la superficie
uniform float u_dent;       // cuánto empuja el cursor la superficie
uniform vec4 u_gotas[MAX_GOTAS]; // x, y, nacimiento, amplitud
out vec4 o;

vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
float wrapd(float a) { return a - 6.2831853 * floor((a + 3.1415926) / 6.2831853); }
float rbox(float az, float el, float caz, float cel, float hw, float hh, float soft) {
  float a = abs(wrapd(az - caz)), e = abs(el - cel);
  return smoothstep(hw + soft, hw - soft, a) * smoothstep(hh + soft, hh - soft, e);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// Estudio: cielo azul profundo arriba, horizonte blanco, suelo oscuro y cajas de luz de varios tamaños.
vec3 studio(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float az = atan(d.x, d.z);
  float up = clamp(el / 1.25, 0.0, 1.0);
  vec3 sky = mix(vec3(0.92, 0.96, 1.00), vec3(0.14, 0.22, 0.42), pow(up, 0.6));
  float dn = clamp(-el / 1.1, 0.0, 1.0);
  vec3 gnd = mix(vec3(0.50, 0.49, 0.50), vec3(0.02, 0.022, 0.03), pow(dn, 0.55));
  vec3 c = el >= 0.0 ? sky : gnd;
  c += vec3(1.0, 0.98, 0.95) * 2.6 * exp(-pow(el / 0.03, 2.0));
  c += vec3(1.00, 0.96, 0.90) * 8.0 * rbox(az, el, -0.85, 0.50, 0.30, 0.20, 0.04);
  c += vec3(0.86, 0.93, 1.00) * 7.0 * rbox(az, el, 1.00, 0.28, 0.06, 0.46, 0.035);
  c += vec3(1.00) * 5.0 * rbox(az, el, 0.10, 1.05, 0.55, 0.08, 0.04);
  c += vec3(1.00, 0.88, 0.76) * 5.0 * rbox(az, el, 0.45, -0.34, 0.40, 0.045, 0.03);
  c += vec3(0.80, 0.90, 1.00) * 4.0 * rbox(az, el, -1.55, -0.2, 0.05, 0.30, 0.03);
  c += vec3(1.00) * 4.0 * rbox(az, el, 1.65, 0.80, 0.16, 0.10, 0.03);
  return c;
}

// Campo de alturas: metal que fluye (dominio deformado) + abolladura bajo el cursor + ondas de las gotas.
float H(vec2 p) {
  float t = u_t;
  vec2 q = p;
  q += 0.50 * vec2(sin(p.y * 1.25 + t * 0.55), cos(p.x * 1.05 - t * 0.47));
  q += 0.28 * vec2(sin(q.y * 2.30 - t * 0.71 + 1.7), cos(q.x * 2.00 + t * 0.62));
  float h = 0.55 * sin(q.x * 1.65 + q.y * 1.05 + t * 0.35);
  h += 0.28 * sin(q.x * 3.05 - q.y * 2.35 - t * 0.48);
  h += 0.30 * sin(length(q - vec2(0.3, -0.2)) * 3.3 - t * 0.55);
  // Abolladura que sigue al cursor.
  vec2 d = p - u_ptr;
  h -= u_dent * 0.45 * exp(-dot(d, d) * 4.0);
  // Ondas circulares: cada gota viaja hacia afuera y se apaga.
  for (int i = 0; i < MAX_GOTAS; i++) {
    vec4 g = u_gotas[i];
    if (g.w <= 0.0) continue;
    float age = u_now - g.z;
    float r = length(p - g.xy);
    float x = r - age * 1.05;
    h += g.w * 0.085 * cos(x * 9.5) * exp(-x * x * 5.0) * exp(-age * 1.1) / (1.0 + r * 1.5);
  }
  return h;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y * 3.4 * u_scale;
  float e = 2.0 / u_res.y * 3.4 * u_scale;
  float h0 = H(p);
  float hx = H(p + vec2(e, 0.0));
  float hy = H(p + vec2(0.0, e));
  vec2 gr = vec2(hx - h0, hy - h0) / e;
  vec3 N = normalize(vec3(-gr * 0.23, 1.0));
  vec3 V = normalize(vec3((gl_FragCoord.xy - 0.5 * u_res) / u_res.y * 0.45, 1.0));
  float ndv = max(dot(N, V), 0.0);
  vec3 R = reflect(-V, N);
  float yaw = u_t * 0.045 + u_ptr.x * 0.10;
  float pitch = 0.10 + u_ptr.y * 0.06;
  float dsp = 0.03 * (1.0 - ndv) + 0.006;
  vec3 rf;
  rf.r = studio(rotX(rotY(R, yaw - dsp), pitch)).r;
  rf.g = studio(rotX(rotY(R, yaw), pitch)).g;
  rf.b = studio(rotX(rotY(R, yaw + dsp), pitch)).b;
  vec3 F0 = u_tint * 0.93;
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);
  vec3 col = rf * F * u_int;
  col = 1.0 - exp(-col * 1.5);
  col = pow(col, vec3(0.9));
  vec2 vv = gl_FragCoord.xy / u_res - 0.5;
  col *= 1.0 - 0.45 * dot(vv, vv);
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

function colorARgb(css: string): [number, number, number] {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.fillStyle = "#e3eaf5";
    x.fillStyle = css;
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  } catch {
    return [0.89, 0.92, 0.96];
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

/** Fondo de cromo líquido: una lámina de metal que fluye, refleja un estudio y ondula cuando pasas el cursor. */
export function LiquidChrome({
  children,
  speed = 0.6,
  scale = 1,
  reactivity = 1,
  intensity = 1,
  tint = "#e3eaf5",
  className = "",
  style,
}: LiquidChromeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const props = useRef({ speed, scale, reactivity, intensity, tint });
  props.current = { speed, scale, reactivity, intensity, tint };
  const wakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-liquid-chrome__lienzo";
    canvas.setAttribute("aria-hidden", "true");
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, powerPreference: "high-performance" });
    if (!gl) return; // sin WebGL2 queda el cromo de CSS
    root.insertBefore(canvas, root.firstChild);

    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let prog: WebGLProgram | null = null;
    let U: Record<string, WebGLUniformLocation | null> = {};
    let visible = true;
    let raf = 0;
    let muerto = false;
    let w = 0, h = 0;

    const iniciarGl = () => {
      prog = compilar(gl, VERT, FRAG);
      if (!prog) return;
      for (const k of ["u_res", "u_t", "u_now", "u_scale", "u_int", "u_tint", "u_ptr", "u_dent", "u_gotas"]) U[k] = gl.getUniformLocation(prog, k);
      gl.useProgram(prog);
    };

    // Estado: flujo del metal, cursor suavizado y gotas (ondas) que nacen al mover el mouse.
    const gotas = new Float32Array(MAX_GOTAS * 4);
    let sigGota = 0;
    const est = { t: reducido ? 7.3 : 2.0, ult: 0, px: 0, py: 0, tx: 0, ty: 0, dent: 0, dentObj: 0, dentirDentro: false, lx: 0, ly: 0, lt: 0, hayPtr: false };
    const ahora = () => performance.now() / 1000;
    let t0 = ahora();

    const pintar = (now: number) => {
      if (!prog || gl.isContextLost() || !w) return;
      const p = props.current;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.uniform2f(U.u_res, canvas.width, canvas.height);
      gl.uniform1f(U.u_t, est.t);
      gl.uniform1f(U.u_now, now);
      gl.uniform1f(U.u_scale, p.scale);
      gl.uniform1f(U.u_int, p.intensity);
      const [r, g, b] = colorARgb(p.tint);
      gl.uniform3f(U.u_tint, r, g, b);
      gl.uniform2f(U.u_ptr, est.px, est.py);
      gl.uniform1f(U.u_dent, est.dent * p.reactivity);
      gl.uniform4fv(U.u_gotas, gotas);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const hayGotas = (now: number) => {
      for (let i = 0; i < MAX_GOTAS; i++) if (gotas[i * 4 + 3] > 0 && now - gotas[i * 4 + 2] < 4.5) return true;
      return false;
    };

    const paso = () => {
      raf = 0;
      if (muerto || !visible) return;
      const now = ahora() - t0;
      const dt = Math.min(0.05, now - est.ult || 0.016);
      est.ult = now;
      if (!reducido) est.t += dt * props.current.speed;
      // El cursor se suaviza con un resorte crítico; la abolladura se llena y se vacía con inercia.
      const k = 1 - Math.exp(-dt * 9);
      est.px += (est.tx - est.px) * k;
      est.py += (est.ty - est.py) * k;
      est.dent += (est.dentObj - est.dent) * (1 - Math.exp(-dt * 4));
      for (let i = 0; i < MAX_GOTAS; i++) if (gotas[i * 4 + 3] > 0 && now - gotas[i * 4 + 2] > 4.5) gotas[i * 4 + 3] = 0;
      pintar(now);
      // Con speed 0 y sin cursor ni gotas el metal está quieto: el bucle duerme.
      if ((!reducido && props.current.speed > 0) || hayGotas(now) || Math.abs(est.dent - est.dentObj) > 0.01 || Math.hypot(est.tx - est.px, est.ty - est.py) > 0.002) raf = requestAnimationFrame(paso);
    };
    const wake = () => { if (!raf && visible && !muerto) { est.ult = ahora() - t0; raf = requestAnimationFrame(paso); } };
    wakeRef.current = wake;

    // ── Cursor ──
    const aSuperficie = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      const s = 3.4 * props.current.scale / Math.max(r.height, 1);
      return [(e.clientX - r.left - r.width / 2) * s, -(e.clientY - r.top - r.height / 2) * s] as const;
    };
    const onMove = (e: PointerEvent) => {
      if (reducido) return;
      const [x, y] = aSuperficie(e);
      if (!est.hayPtr) { est.px = x; est.py = y; est.hayPtr = true; }
      est.tx = x; est.ty = y;
      est.dentObj = 1;
      const now = ahora() - t0;
      const dist = Math.hypot(x - est.lx, y - est.ly);
      if (dist > 0.38 || !est.lt) {
        const vel = Math.min(1.6, dist / Math.max(now - est.lt, 0.016) * 0.35);
        const i = sigGota++ % MAX_GOTAS;
        gotas[i * 4] = x; gotas[i * 4 + 1] = y; gotas[i * 4 + 2] = now; gotas[i * 4 + 3] = 0.3 + Math.min(vel, 0.9);
        est.lx = x; est.ly = y; est.lt = now;
      }
      wake();
    };
    const onLeave = () => { est.dentObj = 0; est.hayPtr = false; est.lt = 0; wake(); };
    if (!reducido) {
      root.addEventListener("pointermove", onMove, { passive: true });
      root.addEventListener("pointerdown", onMove, { passive: true });
      root.addEventListener("pointerleave", onLeave);
    }

    // ── Tamaño ──
    const medir = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const r = root.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width * dpr)); h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      pintar(ahora() - t0);
      wake();
    };
    const ro = new ResizeObserver(medir);
    ro.observe(root);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "80px" });
    io.observe(root);

    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
    canvas.addEventListener("webglcontextrestored", () => { U = {}; iniciarGl(); medir(); });

    iniciarGl();
    medir();

    return () => {
      muerto = true;
      wakeRef.current = null;
      cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onMove);
      root.removeEventListener("pointerleave", onLeave);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);

  // Si cambian las props mientras el bucle dormía (speed 0), hay que repintar.
  useEffect(() => { wakeRef.current?.(); }, [speed, scale, reactivity, intensity, tint]);

  return (
    <div ref={rootRef} className={`furin-liquid-chrome ${className}`} style={style}>
      {children != null ? <div className="furin-liquid-chrome__contenido">{children}</div> : null}
    </div>
  );
}

export default LiquidChrome;
