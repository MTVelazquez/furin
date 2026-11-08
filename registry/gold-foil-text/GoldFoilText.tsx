"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import "./GoldFoilText.css";

export interface GoldFoilTextProps {
  /** El texto que se vuelve lámina de oro (acepta saltos de línea). */
  children?: string;
  /** Tamaño de la letra, en px. */
  size?: number;
  /** Profundidad del relieve: bisel del borde y arrugas de la lámina (0 a 1). */
  relief?: number;
  /** Cantidad de micro-grano que centellea en la lámina (0 a 1). */
  grain?: number;
  /** Brillo de la luz de estudio que refleja el oro. */
  intensity?: number;
  /** Color de la lámina (oro cálido por defecto). */
  tint?: string;
  /** Deja que el reflejo pasee solo cuando no hay cursor. */
  sweep?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

/* ───────────── Shaders ───────────── */

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Campo de pendientes (rg), sombra (b) y máscara (a) vienen de la CPU; aquí solo se sombrea.
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_campo;
uniform vec2 u_res;
uniform vec2 u_ptr;
uniform vec3 u_tint;
uniform float u_int;
uniform float u_relief;
uniform float u_grain;
uniform float u_em;
out vec4 o;

vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
float wrapd(float a) { return a - 6.2831853 * floor((a + 3.1415926) / 6.2831853); }
float rbox(float az, float el, float caz, float cel, float hw, float hh, float soft) {
  float a = abs(wrapd(az - caz)), e = abs(el - cel);
  return smoothstep(hw + soft, hw - soft, a) * smoothstep(hh + soft, hh - soft, e);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

// Estudio cálido de luces grandes y suaves: el oro las convierte en bandas de brillo.
vec3 studio(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float az = atan(d.x, d.z);
  vec3 c = mix(vec3(0.10, 0.08, 0.07), vec3(0.62, 0.58, 0.54), smoothstep(-0.35, 0.95, el));
  c += vec3(1.0, 0.96, 0.9) * 1.1 * exp(-pow(el / 0.05, 2.0));
  c += vec3(1.00, 0.97, 0.92) * 5.5 * rbox(az, el, -0.75, 0.40, 0.46, 0.34, 0.30);
  c += vec3(1.00, 0.95, 0.88) * 4.4 * rbox(az, el, 1.05, 0.15, 0.20, 0.60, 0.18);
  c += vec3(1.00) * 3.2 * rbox(az, el, 0.15, 1.15, 0.80, 0.16, 0.22);
  c += vec3(1.00, 0.92, 0.80) * 1.6 * rbox(az, el, 2.55, 0.05, 0.28, 0.55, 0.20);
  c += vec3(0.9, 0.85, 0.8) * 1.0 * rbox(az, el, -2.0, -0.45, 0.55, 0.12, 0.10);
  return c;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 uv = px / u_res;
  vec4 f = texture(u_campo, uv);
  float a = f.a;
  float sh = f.b;
  vec3 col = vec3(0.0);
  if (a > 0.002) {
    vec2 g = f.rg * u_relief;
    // Arrugas de la lámina: ondulación suave de baja frecuencia + micro-grano casi a nivel de píxel.
    float s = u_em * 0.30;
    vec2 q = px / s;
    vec2 wr = vec2(vnoise(q + vec2(3.1, 1.7)) - vnoise(q + vec2(11.4, 8.2)), vnoise(q + vec2(5.5, 9.1)) - vnoise(q + vec2(2.2, 14.6)));
    wr += 0.5 * vec2(vnoise(q * 2.7 + 4.0) - 0.5, vnoise(q * 2.7 + 9.0) - 0.5);
    vec2 gr = vec2(vnoise(px * 0.9) - 0.5, vnoise(px * 0.9 + 31.0) - 0.5) + 0.6 * vec2(hash(px) - 0.5, hash(px + 7.0) - 0.5);
    vec2 cv = vec2((uv.x - 0.5) * 0.34, (0.5 - uv.y) * 0.62);
    vec3 N = normalize(vec3(-g.x + cv.x + wr.x * 0.11 * u_relief + gr.x * 0.075 * u_grain, g.y + cv.y + wr.y * 0.11 * u_relief + gr.y * 0.075 * u_grain, 1.0));
    vec3 V = vec3(0.0, 0.0, 1.0);
    float ndv = max(dot(N, V), 0.0);
    vec3 R = reflect(-V, N);
    float yaw = u_ptr.x * 1.05;
    float pitch = u_ptr.y * 0.32;
    vec3 rf = studio(rotX(rotY(R, yaw), pitch));
    vec3 F0 = u_tint;
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);
    col = rf * F * u_int;
    // Brillo de la luz que sigue al cursor: amplio sobre la lámina y puntual en el grano.
    vec3 L = normalize(vec3(u_ptr.x * 0.9, u_ptr.y * 0.9 + 0.1, 0.5));
    float nh = max(dot(N, normalize(L + V)), 0.0);
    col += vec3(1.0, 0.9, 0.65) * (pow(nh, 500.0) * 3.2 + pow(nh, 45.0) * 0.28) * mix(0.7, 1.0, u_grain);
    // Filo de la lámina: el borde que mira a la luz se aviva y el opuesto se hunde.
    float rim = clamp(length(g) * 0.5, 0.0, 1.0);
    float lit = dot(normalize(g + vec2(1e-4)), -normalize(vec2(u_ptr.x, -u_ptr.y) + vec2(1e-4)));
    col *= 1.0 + rim * 0.5 * lit;
    col = 1.0 - exp(-col * 2.0);
    col = pow(col, vec3(0.95));
    col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  }
  float oa = a + sh * (1.0 - a);
  o = vec4(col * a, oa);
}
`;

/* ───────────── Campo de alturas del texto (CPU) ───────────── */

const INF = 1e20;

/** Transformada de distancia euclídea (Felzenszwalb): distancia² de cada píxel de "dentro" al "fuera" más cercano. */
function edt(inside: Uint8Array, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = inside[i] ? INF : 0;
  const n = Math.max(w, h);
  const f = new Float32Array(n), d = new Float32Array(n), z = new Float32Array(n + 1), v = new Int32Array(n);
  const pasada = (len: number) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    pasada(h);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    pasada(w);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
  return g;
}

/** Desenfoque de caja separable (3 pasadas ≈ gaussiana). Modifica y devuelve `a`. */
function blur(a: Float32Array, w: number, h: number, r: number, pasadas = 3): Float32Array {
  r = Math.max(1, Math.round(r));
  const t = new Float32Array(Math.max(w, h));
  const inv = 1 / (2 * r + 1);
  for (let p = 0; p < pasadas; p++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0;
      for (let i = -r; i <= r; i++) s += a[o + Math.min(w - 1, Math.max(0, i))];
      for (let x = 0; x < w; x++) {
        t[x] = s * inv;
        s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
      }
      for (let x = 0; x < w; x++) a[o + x] = t[x];
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += a[Math.min(h - 1, Math.max(0, i)) * w + x];
      for (let y = 0; y < h; y++) {
        t[y] = s * inv;
        s += a[Math.min(h - 1, y + r + 1) * w + x] - a[Math.max(0, y - r) * w + x];
      }
      for (let y = 0; y < h; y++) a[y * w + x] = t[y];
    }
  }
  return a;
}

interface Campo { w: number; h: number; datos: Float32Array }

/** Dibuja el texto en un lienzo 2D alineado con el DOM y lo convierte en pendientes, sombra y máscara. */
function construirCampo(textEl: HTMLElement, texto: string, pad: number, dpr: number, relief: number): Campo {
  const cs = getComputedStyle(textEl);
  const fs = parseFloat(cs.fontSize) || 96;
  const cw = textEl.offsetWidth, ch = textEl.offsetHeight;
  const W = Math.max(8, Math.ceil((cw + pad * 2) * dpr)), H = Math.max(8, Math.ceil((ch + pad * 2) * dpr));
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${fs * dpr}px ${cs.fontFamily}`;
  const ls = parseFloat(cs.letterSpacing);
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${(Number.isFinite(ls) ? ls : 0) * dpr}px`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineJoin = "round";
  ctx.lineWidth = fs * dpr * 0.012;
  const m = ctx.measureText("Hg");
  const asc = m.fontBoundingBoxAscent ?? fs * 0.95, desc = m.fontBoundingBoxDescent ?? fs * 0.25;
  const lineas = texto.split("\n");
  const lh = ch / lineas.length * dpr;
  const al = cs.textAlign;
  lineas.forEach((ln, i) => {
    const wl = ctx.measureText(ln).width;
    const x = pad * dpr + (al === "left" || al === "start" ? 0 : al === "right" || al === "end" ? cw * dpr - wl : (cw * dpr - wl) / 2);
    const base = pad * dpr + i * lh + (lh - (asc + desc)) / 2 + asc;
    ctx.fillText(ln, x, base);
    // Un contorno del mismo color engorda la letra sin depender del peso de la tipografía.
    ctx.strokeText(ln, x, base);
  });
  const img = ctx.getImageData(0, 0, W, H).data;
  const n = W * H;
  const alfa = new Float32Array(n);
  const dentro = new Uint8Array(n);
  for (let i = 0; i < n; i++) { alfa[i] = img[i * 4 + 3] / 255; dentro[i] = alfa[i] > 0.5 ? 1 : 0; }

  // Altura: perfil de cuarto de círculo medido desde el borde, así las letras salen "infladas".
  const R = Math.max(2, fs * dpr * (0.012 + 0.05 * relief));
  const d2 = edt(dentro, W, H);
  const hgt = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!dentro[i]) continue;
    const t = Math.min(1, Math.max(0, Math.sqrt(d2[i]) - 0.5) / R);
    hgt[i] = R * Math.sqrt(1 - (1 - t) * (1 - t));
  }
  blur(hgt, W, H, Math.max(1, R * 0.22), 2);

  // Sombra suave, desplazada hacia abajo.
  const sombra = blur(Float32Array.from(alfa), W, H, fs * dpr * 0.022, 3);
  const off = Math.round(fs * dpr * 0.03);

  const datos = new Float32Array(n * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xl = hgt[y * W + Math.max(0, x - 1)], xr = hgt[y * W + Math.min(W - 1, x + 1)];
      const yu = hgt[Math.max(0, y - 1) * W + x], yd = hgt[Math.min(H - 1, y + 1) * W + x];
      const o = i * 4;
      datos[o] = Math.max(-6, Math.min(6, (xr - xl) * 0.5));
      datos[o + 1] = Math.max(-6, Math.min(6, (yd - yu) * 0.5));
      datos[o + 2] = sombra[Math.max(0, y - off) * W + x] * 0.7;
      datos[o + 3] = alfa[i];
    }
  }
  return { w: W, h: H, datos };
}

/* ───────────── Utilidades ───────────── */

function colorARgb(css: string): [number, number, number] {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.fillStyle = "#e4e9f0";
    x.fillStyle = css;
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  } catch {
    return [0.89, 0.91, 0.94];
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

interface Vivo { rebuild: () => void; wake: () => void }

/** Texto en lámina de oro estampada: bisel fino, arrugas y micro-grano que centellean con el cursor. */
export function GoldFoilText({
  children = "GOLD",
  size = 112,
  relief = 0.6,
  grain = 0.6,
  intensity = 1,
  tint = "#f6c453",
  sweep = true,
  className = "",
  style,
}: GoldFoilTextProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const vivo = useRef<Vivo | null>(null);
  const texto = String(children ?? "");
  const props = useRef({ texto, size, relief, grain, intensity, tint, sweep });
  props.current = { texto, size, relief, grain, intensity, tint, sweep };

  useEffect(() => {
    const root = rootRef.current, textEl = textRef.current;
    if (!root || !textEl) return;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-gold-foil-text__lienzo";
    canvas.setAttribute("aria-hidden", "true");
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return; // sin WebGL2 queda el degradado de CSS
    root.appendChild(canvas);

    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let prog: WebGLProgram | null = null;
    let tex: WebGLTexture | null = null;
    let U: Record<string, WebGLUniformLocation | null> = {};
    let listo = false;
    let visible = true;
    let raf = 0;
    let muerto = false;

    const iniciarGl = () => {
      prog = compilar(gl, VERT, FRAG);
      if (!prog) return;
      for (const k of ["u_campo", "u_res", "u_ptr", "u_tint", "u_int", "u_relief", "u_grain", "u_em"]) U[k] = gl.getUniformLocation(prog, k);
      tex = gl.createTexture();
      gl.useProgram(prog);
      gl.uniform1i(U.u_campo, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
    };

    // Estado del reflejo: un resorte lleva (x, y) hacia el cursor, o hacia un paseo lento si no hay cursor.
    const est = { x: 0.35, y: -0.05, vx: 0, vy: 0, tx: 0.35, ty: -0.05, auto: true, t0: performance.now(), ultimo: 0 };

    const pintar = () => {
      if (!prog || !listo || gl.isContextLost()) return;
      const p = props.current;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.uniform2f(U.u_res, canvas.width, canvas.height);
      gl.uniform2f(U.u_ptr, est.x, est.y);
      const [r, g, b] = colorARgb(p.tint);
      gl.uniform3f(U.u_tint, r, g, b);
      gl.uniform1f(U.u_int, p.intensity);
      gl.uniform1f(U.u_relief, 0.6 + p.relief * 0.8);
      gl.uniform1f(U.u_grain, p.grain);
      gl.uniform1f(U.u_em, p.size * Math.min(window.devicePixelRatio || 1, 2));
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const rebuild = () => {
      if (muerto || gl.isContextLost() || !prog) return;
      const p = props.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pad = Math.round(p.size * 0.3);
      const cw = textEl.offsetWidth, ch = textEl.offsetHeight;
      if (!cw || !ch) return;
      const campo = construirCampo(textEl, p.texto, pad, dpr, p.relief);
      canvas.width = campo.w; canvas.height = campo.h;
      canvas.style.width = `${cw + pad * 2}px`;
      canvas.style.height = `${ch + pad * 2}px`;
      canvas.style.left = `${-pad}px`;
      canvas.style.top = `${-pad}px`;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, campo.w, campo.h, 0, gl.RGBA, gl.FLOAT, campo.datos);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      listo = true;
      pintar();
      root.setAttribute("data-gl", "1");
      wake();
    };

    // ── Bucle: duerme cuando está fuera de pantalla o el resorte ya se asentó ──
    const quieto = () => !p_auto() && Math.abs(est.vx) + Math.abs(est.vy) < 1e-3 && Math.abs(est.tx - est.x) + Math.abs(est.ty - est.y) < 1e-3;
    const p_auto = () => est.auto && props.current.sweep && !reducido;
    const paso = (now: number) => {
      raf = 0;
      if (muerto || !visible || !listo) return;
      const dt = Math.min(0.05, (now - (est.ultimo || now)) / 1000 || 0.016);
      est.ultimo = now;
      if (p_auto()) {
        const t = (now - est.t0) / 1000;
        est.tx = Math.sin(t * 0.5) * 0.9;
        est.ty = Math.cos(t * 0.37) * 0.32;
      }
      // Resorte ligeramente subamortiguado: llega con un pequeño rebote.
      const k = 120, c = 15;
      est.vx += ((est.tx - est.x) * k - est.vx * c) * dt;
      est.vy += ((est.ty - est.y) * k - est.vy * c) * dt;
      est.x += est.vx * dt;
      est.y += est.vy * dt;
      pintar();
      if (!quieto()) raf = requestAnimationFrame(paso);
      else est.ultimo = 0;
    };
    const wake = () => {
      if (!raf && visible && listo && !muerto && !reducido) { est.ultimo = 0; raf = requestAnimationFrame(paso); }
    };

    // ── Cursor: se mide contra el propio texto, aunque el mouse ande cerca ──
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      est.tx = Math.max(-1.4, Math.min(1.4, (e.clientX - cx) / Math.max(r.width * 0.5, 160)));
      est.ty = Math.max(-1.0, Math.min(1.0, -(e.clientY - cy) / Math.max(r.height * 0.5, 120)));
      est.auto = false;
      wake();
    };
    const onLeave = () => { est.auto = true; est.t0 = performance.now() - (Math.asin(Math.max(-1, Math.min(1, est.x / 0.9))) / 0.55) * 1000; wake(); };
    const onUp = (e: PointerEvent) => { if (e.pointerType !== "mouse") onLeave(); };
    if (!reducido) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      window.addEventListener("pointerup", onUp, { passive: true });
    } else {
      est.x = est.tx = 0.35; est.y = est.ty = -0.05;
    }

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "80px" });
    io.observe(root);
    let pend = 0;
    const pedirRebuild = () => { cancelAnimationFrame(pend); pend = requestAnimationFrame(rebuild); };
    const ro = new ResizeObserver(pedirRebuild);
    ro.observe(textEl);
    document.fonts?.ready.then(pedirRebuild);
    document.fonts?.addEventListener?.("loadingdone", pedirRebuild);

    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); listo = false; cancelAnimationFrame(raf); raf = 0; });
    canvas.addEventListener("webglcontextrestored", () => { U = {}; iniciarGl(); rebuild(); });

    iniciarGl();
    vivo.current = { rebuild, wake };
    rebuild();

    return () => {
      muerto = true;
      vivo.current = null;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(pend);
      io.disconnect(); ro.disconnect();
      document.fonts?.removeEventListener?.("loadingdone", pedirRebuild);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      root.removeAttribute("data-gl");
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);

  useEffect(() => { vivo.current?.rebuild(); }, [texto, size, relief, grain, intensity, tint, sweep]);

  return (
    <span ref={rootRef} className={`furin-gold-foil-text ${className}`} style={{ fontSize: size, ...style }}>
      <span ref={textRef} className="furin-gold-foil-text__texto">{texto}</span>
    </span>
  );
}

export default GoldFoilText;
