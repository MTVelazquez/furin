"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import "./MetalCard.css";

export interface MetalCardProps {
  /** Línea grabada abajo a la izquierda (nombre del titular). */
  children?: string;
  /** Marca grabada junto al emblema. */
  title?: string;
  /** Texto pequeño grabado abajo a la derecha. */
  subtitle?: string;
  /** Muestra el emblema grabado (una campana de viento). */
  emblem?: boolean;
  /** Ancho máximo de la tarjeta, en px. */
  width?: number;
  /** Inclinación máxima en grados. */
  tilt?: number;
  /** Color base del titanio. */
  color?: string;
  /** Pulido del reflejo: menor es satinado, mayor es espejo (0 a 1). */
  gloss?: number;
  /** Intensidad general de la luz. */
  intensity?: number;
  /** Deja que la tarjeta se mece sola cuando no hay cursor. */
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

// Todo el sombreado ocurre en el marco local de la tarjeta (x derecha, y abajo, z hacia el espectador),
// igual que CSS: así las luces del mundo se ven distintas según cómo esté inclinada.
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_campo;   // rg: pendientes del grabado, b: cavidad, a: máscara del grabado
uniform vec2 u_res;
uniform vec2 u_card;
uniform float u_rc;
uniform float u_bw;
uniform mat3 u_Rt;           // mundo -> tarjeta
uniform vec3 u_col;
uniform float u_grain;
uniform float u_gloss;
uniform float u_int;
uniform float u_dpr;
out vec4 o;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float wrapd(float a) { return a - 6.2831853 * floor((a + 3.1415926) / 6.2831853); }
float rbox(float az, float el, float caz, float cel, float hw, float hh, float soft) {
  float a = abs(wrapd(az - caz)), e = abs(el - cel);
  return smoothstep(hw + soft, hw - soft, a) * smoothstep(hh + soft, hh - soft, e);
}

// Estudio (y hacia arriba). "soft" ensancha los bordes de las cajas: para la cara cepillada, que difumina.
vec3 studio(vec3 d, float soft) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float az = atan(d.x, d.z);
  float up = clamp(el / 1.2, 0.0, 1.0);
  vec3 sky = mix(vec3(0.62, 0.68, 0.76), vec3(0.10, 0.14, 0.24), pow(up, 0.55));
  float dn = clamp(-el / 1.1, 0.0, 1.0);
  vec3 gnd = mix(vec3(0.26, 0.25, 0.25), vec3(0.015, 0.016, 0.02), pow(dn, 0.5));
  vec3 c = el >= 0.0 ? sky : gnd;
  c += vec3(1.0, 0.98, 0.94) * 1.4 * exp(-pow(el / (0.03 * soft + 0.01), 2.0));
  c += vec3(1.00, 0.96, 0.90) * 6.0 * rbox(az, el, -0.80, 0.52, 0.34, 0.22, 0.05 * soft);
  c += vec3(0.86, 0.93, 1.00) * 5.0 * rbox(az, el, 1.05, 0.30, 0.09, 0.46, 0.04 * soft);
  c += vec3(1.00) * 3.5 * rbox(az, el, 0.20, 1.10, 0.62, 0.10, 0.05 * soft);
  c += vec3(1.00, 0.90, 0.80) * 2.5 * rbox(az, el, 2.60, 0.10, 0.10, 0.50, 0.06 * soft);
  c += vec3(0.80, 0.88, 1.00) * 1.8 * rbox(az, el, -1.90, -0.38, 0.50, 0.07, 0.05 * soft);
  return c;
}

// Reflejo anisotrópico (Kajiya-Kay): brilla donde la mitad-vector es perpendicular a la hebra.
float aniso(vec3 T, vec3 L, vec3 V, float sh) {
  vec3 H = normalize(L + V);
  float th = dot(T, H);
  return pow(sqrt(max(1.0 - th * th, 0.0)), sh) * max(L.z, 0.0);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 pc = p - 0.5 * u_res;
  vec2 q = abs(pc) - (0.5 * u_card - u_rc);
  float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_rc;
  float cov = clamp(0.5 - sdf, 0.0, 1.0);
  if (cov <= 0.0) { o = vec4(0.0); return; }
  float din = -sdf;

  vec4 f = texture(u_campo, p / u_res);
  vec2 g = f.rg;
  float cav = f.b;
  float eng = f.a;

  vec3 pl = vec3(pc / (0.5 * u_card.x), 0.0);
  vec3 V = normalize(u_Rt * vec3(0.0, 0.0, 5.5) - pl);

  // Hebras del cepillado, horizontales. El grabado es más liso: allí casi no hay hebras.
  float st = 0.50 * pn(vec2(p.x / (150.0 * u_dpr), p.y / 1.3))
           + 0.30 * pn(vec2(p.x / (52.0 * u_dpr), p.y / 0.9 + 17.0))
           + 0.20 * pn(vec2(p.x / (420.0 * u_dpr), p.y / 3.2 + 5.0));
  float sg = (st - 0.5) * u_grain * (1.0 - 0.8 * eng);
  vec3 T = normalize(vec3(1.0, 0.0, sg * 0.55));
  vec3 N = normalize(vec3(-g.x, -g.y + sg * 0.35, 1.0));

  // Tres luces puntuales fijas en el mundo; cada una se vuelve a expresar en el marco de la tarjeta.
  vec3 lk = normalize(u_Rt * vec3(-1.7, -1.5, 1.7) - pl);
  vec3 l2 = normalize(u_Rt * vec3(2.0, -0.5, 1.5) - pl);
  vec3 l3 = normalize(u_Rt * vec3(0.5, 1.8, 1.3) - pl);
  float core = aniso(T, lk, V, mix(30.0, 300.0, u_gloss)) * 1.9;
  float halo = aniso(T, lk, V, mix(8.0, 38.0, u_gloss)) * 0.5;
  float s2 = aniso(T, l2, V, mix(10.0, 60.0, u_gloss)) * 0.55;
  float s3 = aniso(T, l3, V, mix(10.0, 60.0, u_gloss)) * 0.38;

  vec3 white = mix(u_col, vec3(1.0), 0.4);
  vec3 Rl = reflect(-V, N);
  vec3 Rw = transpose(u_Rt) * Rl;
  vec3 envF = studio(vec3(Rw.x, -Rw.y, Rw.z), 1.6);
  float ndv = max(dot(N, V), 0.0);
  vec3 Fr = u_col + (1.0 - u_col) * pow(1.0 - ndv, 5.0);

  vec3 face = u_col * 0.13 * (1.0 + sg * 1.6);
  face += white * (core + halo + s2 + s3);
  face += envF * Fr * 0.30;
  // Grabado: el fondo es más oscuro y las paredes que miran a la luz se encienden.
  float wall = clamp(length(g) * 0.4, 0.0, 1.0);
  float lit = dot(normalize(-g + vec2(1e-4)), lk.xy);
  face *= 1.0 - 0.30 * eng - 0.40 * cav;
  face *= 1.0 + wall * lit * 1.2;
  face += white * wall * max(lit, 0.0) * 0.55;

  // Bisel pulido de 45 grados: espejo que refleja el estudio con bordes nítidos.
  vec2 g2 = (q.x > 0.0 && q.y > 0.0) ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec3 Nc = normalize(vec3(g2 * sign(pc) * 0.85, 0.55));
  vec3 Rc = transpose(u_Rt) * reflect(-V, Nc);
  vec3 envC = studio(vec3(Rc.x, -Rc.y, Rc.z), 0.4);
  float ndc = max(dot(Nc, V), 0.0);
  vec3 Fc = u_col + (1.0 - u_col) * pow(1.0 - ndc, 5.0);
  vec3 chamfer = envC * Fc * 1.15;
  chamfer += white * pow(max(dot(Nc, normalize(lk + V)), 0.0), 110.0) * 1.6;
  float cm = smoothstep(u_bw + 0.75, u_bw - 0.75, din);

  vec3 col = mix(face, chamfer, cm);
  col *= 1.0 - 0.42 * exp(-pow((din - u_bw) / 0.9, 2.0));   // surco fino entre bisel y cara
  col += white * 0.22 * exp(-din * din / 1.4);             // brillo del canto exterior
  col *= u_int;
  col = 1.0 - exp(-col * 1.7);
  col = pow(col, vec3(0.94));
  col += (hash(gl_FragCoord.xy + 3.7) - 0.5) / 255.0;
  o = vec4(col * cov, cov);
}`;

/* ───────────── Campo del grabado (CPU) ───────────── */

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

/** Desenfoque de caja separable (varias pasadas ≈ gaussiana). Modifica y devuelve `a`. */
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

interface Textos { title: string; subtitle: string; holder: string; emblem: boolean; family: string }

/** Una campana de viento (furin) hecha solo con curvas y círculos. */
function campana(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx - 0.95 * r, cy + 0.55 * r);
  ctx.bezierCurveTo(cx - 0.95 * r, cy - 0.25 * r, cx - 0.55 * r, cy - 0.85 * r, cx, cy - 0.85 * r);
  ctx.bezierCurveTo(cx + 0.55 * r, cy - 0.85 * r, cx + 0.95 * r, cy - 0.25 * r, cx + 0.95 * r, cy + 0.55 * r);
  ctx.lineTo(cx + 1.15 * r, cy + 0.74 * r);
  ctx.lineTo(cx - 1.15 * r, cy + 0.74 * r);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy + 1.14 * r, 0.21 * r, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy - 1.02 * r, 0.14 * r, 0, Math.PI * 2); ctx.fill();
}

interface Campo { w: number; h: number; datos: Float32Array }

/** Dibuja el logo y los textos como máscara y la convierte en un grabado: pendientes de las paredes, cavidad y máscara. */
function construirCampo(cw: number, ch: number, pad: number, dpr: number, t: Textos): Campo {
  const W = Math.max(8, Math.ceil((cw + pad * 2) * dpr)), H = Math.max(8, Math.ceil((ch + pad * 2) * dpr));
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  const u = cw * dpr;                 // ancho de la tarjeta en px de dispositivo
  const ox = pad * dpr, oy = pad * dpr;
  const m = 0.075 * u;
  ctx.fillStyle = "#fff";
  const setLs = (em: number, size: number) => { if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${em * size}px`; };

  const r = 0.05 * u;
  const cyTop = oy + m + 0.045 * u;
  if (t.emblem) campana(ctx, ox + m + r, cyTop - 0.1 * r, r);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let fs = 0.06 * u;
  ctx.font = `600 ${fs}px ${t.family}`;
  setLs(0.22, fs);
  ctx.fillText(t.title, ox + m + (t.emblem ? 2.9 * r : 0), cyTop);

  // Símbolo de pago sin contacto: cuatro arcos concéntricos hechos con trazos redondeados.
  ctx.save();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 0.0068 * u;
  ctx.lineCap = "round";
  const ax = ox + u - m - 0.052 * u;
  for (let i = 0; i < 4; i++) {
    const rr = (0.012 + i * 0.0155) * u;
    ctx.beginPath();
    ctx.arc(ax - 0.014 * u, cyTop, rr, -0.62, 0.62);
    ctx.stroke();
  }
  ctx.restore();

  const base = oy + ch * dpr - m * 0.95;
  ctx.textBaseline = "alphabetic";
  fs = 0.05 * u;
  ctx.font = `500 ${fs}px ${t.family}`;
  setLs(0.16, fs);
  ctx.fillText(t.holder, ox + m, base);
  fs = 0.03 * u;
  ctx.font = `500 ${fs}px ${t.family}`;
  setLs(0.34, fs);
  ctx.textAlign = "right";
  ctx.fillText(t.subtitle, ox + u - m + 0.34 * fs, base);

  const img = ctx.getImageData(0, 0, W, H).data;
  const n = W * H;
  const alfa = new Float32Array(n);
  const dentro = new Uint8Array(n);
  for (let i = 0; i < n; i++) { alfa[i] = img[i * 4 + 3] / 255; dentro[i] = alfa[i] > 0.5 ? 1 : 0; }

  // Grabado: perfil de cuarto de círculo hacia abajo desde el borde (pared empinada y fondo plano).
  const R = Math.max(2, 0.0075 * u);
  const d2 = edt(dentro, W, H);
  const hgt = new Float32Array(n);
  const cav = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!dentro[i]) continue;
    const dist = Math.max(0, Math.sqrt(d2[i]) - 0.5);
    const tt = Math.min(1, dist / R);
    hgt[i] = -R * Math.sqrt(1 - (1 - tt) * (1 - tt));
    cav[i] = Math.exp(-dist / (R * 1.6));
  }
  blur(hgt, W, H, Math.max(1, R * 0.28), 2);

  const datos = new Float32Array(n * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xl = hgt[y * W + Math.max(0, x - 1)], xr = hgt[y * W + Math.min(W - 1, x + 1)];
      const yu = hgt[Math.max(0, y - 1) * W + x], yd = hgt[Math.min(H - 1, y + 1) * W + x];
      const o = i * 4;
      datos[o] = Math.max(-5, Math.min(5, (xr - xl) * 0.5));
      datos[o + 1] = Math.max(-5, Math.min(5, (yd - yu) * 0.5));
      datos[o + 2] = cav[i];
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
    x.fillStyle = "#80838a";
    x.fillStyle = css;
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  } catch {
    return [0.56, 0.57, 0.6];
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

type M3 = number[];
const mul = (A: M3, B: M3): M3 => {
  const C = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return C;
};

/** Matriz mundo→tarjeta (la transpuesta de rotateX(a) rotateY(b) de CSS), en columnas para WebGL. */
function matrizInversa(aDeg: number, bDeg: number): Float32Array {
  const a = (aDeg * Math.PI) / 180, b = (bDeg * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const Rx: M3 = [1, 0, 0, 0, ca, -sa, 0, sa, ca];
  const Ry: M3 = [cb, 0, sb, 0, 1, 0, -sb, 0, cb];
  const M = mul(Rx, Ry);
  // Transpuesta, guardada por columnas: columna c de Mt = fila c de M.
  return new Float32Array([M[0], M[1], M[2], M[3], M[4], M[5], M[6], M[7], M[8]]);
}

const PAD = 8;

/** Tarjeta de titanio cepillado: bisel pulido, logo grabado y un reflejo que viaja al inclinarla con el cursor. */
export function MetalCard({
  children = "MARIANA RIVERA",
  title = "FURIN",
  subtitle = "TITANIUM",
  emblem = true,
  width = 400,
  tilt = 16,
  color = "#80838a",
  gloss = 0.6,
  intensity = 1,
  sweep = true,
  className = "",
  style,
}: MetalCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const sombraRef = useRef<HTMLDivElement>(null);
  const vivo = useRef<{ rebuild: () => void; wake: () => void } | null>(null);
  const props = useRef({ children, title, subtitle, emblem, tilt, color, gloss, intensity, sweep });
  props.current = { children, title, subtitle, emblem, tilt, color, gloss, intensity, sweep };

  useEffect(() => {
    const root = rootRef.current, tiltEl = tiltRef.current, sombra = sombraRef.current;
    if (!root || !tiltEl || !sombra) return;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-metal-card__lienzo";
    canvas.setAttribute("aria-hidden", "true");
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return; // sin WebGL2 queda la placa de CSS
    tiltEl.appendChild(canvas);

    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let prog: WebGLProgram | null = null;
    let tex: WebGLTexture | null = null;
    let U: Record<string, WebGLUniformLocation | null> = {};
    let listo = false;
    let visible = true;
    let raf = 0;
    let muerto = false;
    let dpr = 1, cssW = 0, cssH = 0;

    const iniciarGl = () => {
      prog = compilar(gl, VERT, FRAG);
      if (!prog) return;
      for (const k of ["u_campo", "u_res", "u_card", "u_rc", "u_bw", "u_Rt", "u_col", "u_grain", "u_gloss", "u_int", "u_dpr"]) U[k] = gl.getUniformLocation(prog, k);
      tex = gl.createTexture();
      gl.useProgram(prog);
      gl.uniform1i(U.u_campo, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
    };

    // Estado de la inclinación (grados): un resorte por eje hacia el cursor, o hacia un balanceo lento.
    const est = { rx: -3, ry: 6, vx: 0, vy: 0, tx: -3, ty: 6, sc: 1, vs: 0, tsc: 1, auto: true, t0: performance.now(), ult: 0 };

    const aplicar = () => {
      tiltEl.style.transform = `rotateX(${est.rx.toFixed(3)}deg) rotateY(${est.ry.toFixed(3)}deg) scale(${est.sc.toFixed(4)})`;
      // La sombra se corre y se abre con la inclinación, como si la tarjeta flotara sobre la mesa.
      sombra.style.transform = `translate(${(5 - est.ry * 0.9).toFixed(2)}px, ${(12 + est.rx * 0.9).toFixed(2)}px) scale(${(1 + (est.sc - 1) * 2).toFixed(4)})`;
      sombra.style.opacity = String((0.5 + Math.min(0.2, (Math.abs(est.rx) + Math.abs(est.ry)) * 0.008)).toFixed(3));
    };

    const pintar = () => {
      if (!prog || !listo || gl.isContextLost()) return;
      const p = props.current;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.uniform2f(U.u_res, canvas.width, canvas.height);
      gl.uniform2f(U.u_card, cssW * dpr, cssH * dpr);
      gl.uniform1f(U.u_rc, cssW * dpr * 0.037);
      gl.uniform1f(U.u_bw, Math.max(2, cssW * dpr * 0.0075));
      gl.uniformMatrix3fv(U.u_Rt, false, matrizInversa(est.rx, est.ry));
      const [r, g, b] = colorARgb(p.color);
      gl.uniform3f(U.u_col, r, g, b);
      gl.uniform1f(U.u_grain, 0.65);
      gl.uniform1f(U.u_gloss, p.gloss);
      gl.uniform1f(U.u_int, p.intensity);
      gl.uniform1f(U.u_dpr, dpr);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const rebuild = () => {
      if (muerto || gl.isContextLost() || !prog) return;
      const p = props.current;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssW = root.offsetWidth; cssH = root.offsetHeight;
      if (!cssW || !cssH) return;
      const campo = construirCampo(cssW, cssH, PAD, dpr, {
        title: p.title, subtitle: p.subtitle, holder: p.children, emblem: p.emblem,
        family: getComputedStyle(root).fontFamily,
      });
      canvas.width = campo.w; canvas.height = campo.h;
      canvas.style.width = `${cssW + PAD * 2}px`;
      canvas.style.height = `${cssH + PAD * 2}px`;
      canvas.style.left = `${-PAD}px`;
      canvas.style.top = `${-PAD}px`;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, campo.w, campo.h, 0, gl.RGBA, gl.FLOAT, campo.datos);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      listo = true;
      aplicar();
      pintar();
      root.setAttribute("data-gl", "1");
      wake();
    };

    // ── Bucle: duerme fuera de pantalla o cuando el resorte se asentó ──
    const balanceo = () => !!props.current.sweep && est.auto && !reducido;
    const quieto = () => !balanceo() && Math.abs(est.vx) + Math.abs(est.vy) + Math.abs(est.vs) < 1e-2 && Math.abs(est.tx - est.rx) + Math.abs(est.ty - est.ry) + Math.abs(est.tsc - est.sc) * 100 < 2e-2;
    const paso = (now: number) => {
      raf = 0;
      if (muerto || !visible || !listo) return;
      const dt = Math.min(0.05, (now - (est.ult || now)) / 1000 || 0.016);
      est.ult = now;
      const T = props.current.tilt;
      if (balanceo()) {
        const t = (now - est.t0) / 1000;
        est.tx = -Math.cos(t * 0.45) * 0.42 * T - 0.1 * T;
        est.ty = Math.sin(t * 0.62) * 0.6 * T;
      }
      // Resorte subamortiguado: la tarjeta llega con un pequeño rebote, como un objeto con peso.
      const k = 150, c = 17;
      est.vx += ((est.tx - est.rx) * k - est.vx * c) * dt;
      est.vy += ((est.ty - est.ry) * k - est.vy * c) * dt;
      est.vs += ((est.tsc - est.sc) * 260 - est.vs * 22) * dt;
      est.rx += est.vx * dt;
      est.ry += est.vy * dt;
      est.sc += est.vs * dt;
      aplicar();
      pintar();
      if (!quieto()) raf = requestAnimationFrame(paso);
      else est.ult = 0;
    };
    const wake = () => { if (!raf && visible && listo && !muerto && !reducido) { est.ult = 0; raf = requestAnimationFrame(paso); } };

    // ── Cursor: la tarjeta se inclina hacia donde está, aunque el mouse ande cerca ──
    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      if (!r.width) return;
      const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 0.9)));
      const dy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height * 1.3)));
      const T = props.current.tilt;
      // Metáfora de "presionar": el lado donde está el cursor se hunde.
      est.ty = dx * T;
      est.tx = -dy * T;
      const dentro = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      est.tsc = dentro ? 1.025 : 1;
      est.auto = false;
      wake();
    };
    const onLeave = () => { est.auto = true; est.tsc = 1; est.t0 = performance.now(); wake(); };
    const onUp = (e: PointerEvent) => { if (e.pointerType !== "mouse") onLeave(); };
    if (!reducido) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onMove, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "80px" });
    io.observe(root);
    let pend = 0;
    const pedirRebuild = () => { cancelAnimationFrame(pend); pend = requestAnimationFrame(rebuild); };
    const ro = new ResizeObserver(pedirRebuild);
    ro.observe(root);
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

  useEffect(() => { vivo.current?.rebuild(); }, [children, title, subtitle, emblem, width, tilt, color, gloss, intensity, sweep]);

  const etiqueta = [title, children, subtitle].filter(Boolean).join(" · ");
  return (
    <div
      ref={rootRef}
      className={`furin-metal-card ${className}`}
      style={{ "--furin-mc-w": `${width}px`, ...style } as CSSProperties}
      role="img"
      aria-label={etiqueta}
    >
      <div ref={sombraRef} className="furin-metal-card__sombra" aria-hidden="true" />
      <div ref={tiltRef} className="furin-metal-card__inclinar" />
    </div>
  );
}

export default MetalCard;
