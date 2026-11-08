"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./PrismLight.css";

export interface PrismLightProps {
  /** Cuánto se abre el espectro (0 a 2). */
  dispersion?: number;
  /** Brillo de la luz y del espectro (0 a 1.5). */
  intensity?: number;
  /** Resplandor suave alrededor de la luz (0 a 2). */
  glow?: number;
  /** Grosor del haz blanco, en px. */
  beamWidth?: number;
  /** Tinte del vidrio del prisma. */
  tint?: string;
  /** Si no hay cursor, el orbe de luz recorre la escena solo. */
  autoplay?: boolean;
  /** Si es true, el orbe de luz sigue al cursor y cambia el ángulo del haz. */
  interactive?: boolean;
  /** Contenido (p. ej. un titular) que se ilumina con los colores del espectro. */
  children?: ReactNode;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

type V = [number, number];
type RGB = [number, number, number];

/** Rayos de espectro (longitudes de onda) que se trazan con la ley de Snell. */
const N = 32;
const DEG = Math.PI / 180;
// Ángulos del haz permitidos (la luz solo puede llegar desde abajo a la izquierda: arriba habría reflexión total).
const TH_MIN = -58 * DEG;
const TH_MAX = -13 * DEG;

// ---- Escena en unidades de mundo: el prisma mide 1 de lado. x a la derecha, y arriba, z hacia la cámara.
const HH = Math.sqrt(3) / 2; // altura del triángulo equilátero
const HZ = 0.42; // medio espesor del prisma (extrusión en z)
const XR = 1.5; // pared derecha (x = XR)
const ZB = 2.7; // pared de fondo (z = -ZB)
const TANH = Math.tan(15 * DEG); // medio campo de visión vertical
const YAW0 = -17 * DEG; // la cámara arranca a la izquierda y un poco arriba
const PITCH0 = 10 * DEG;
const TARGET: [number, number, number] = [0.12, 0.6, 0];
const NIVELES = [1, 0.8, 0.64, 0.5]; // escalas de la resolución interna

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const unit = (a: V): V => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };

// Triángulo del prisma en el plano medio (z = 0). El punto de entrada del haz está al 56 % de la cara izquierda.
const BL: V = [-0.5, 0];
const BR: V = [0.5, 0];
const AP: V = [0, HH];
const P1: V = add(BL, mul(sub(AP, BL), 0.56));
const outN = (a: V, b: V, c: V): V => {
  const ed = sub(b, a);
  let n = unit([ed[1], -ed[0]]);
  if (dot(n, sub(mul(add(a, b), 0.5), c)) < 0) n = mul(n, -1);
  return n;
};
const CEN: V = [0, HH / 3];
const NL = outN(BL, AP, CEN); // normal exterior de la cara izquierda (por donde entra la luz)
const NR = outN(AP, BR, CEN); // normal exterior de la cara derecha (por donde sale el espectro)

// Ley de Snell en 2D con escalares (sin crear arrays en el bucle). n debe apuntar contra el rayo.
let rfx = 0;
let rfy = 0;
function refract2(dx: number, dy: number, nx: number, ny: number, eta: number): boolean {
  const c = -(nx * dx + ny * dy);
  const k = 1 - eta * eta * (1 - c * c);
  if (k < 0) return false;
  const a = eta * c - Math.sqrt(k);
  rfx = dx * eta + nx * a;
  rfy = dy * eta + ny * a;
  return true;
}
// Intersección del rayo o + t·d con el segmento p→q. Devuelve t (o -1).
function hitSeg(ox: number, oy: number, dx: number, dy: number, px: number, py: number, qx: number, qy: number): number {
  const ex = qx - px, ey = qy - py, den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return -1;
  const wx = px - ox, wy = py - oy;
  const t = (wx * ey - wy * ex) / den, s = (wx * dy - wy * dx) / den;
  return t > 1e-4 && s >= -1e-4 && s <= 1 + 1e-4 ? t : -1;
}
// Reflectancia de Fresnel (aprox. de Schlick) para el vidrio: lo que no se transmite.
const schlick = (cos: number) => 0.04 + 0.96 * Math.pow(1 - clamp(cos, 0, 1), 5);

function parseColor(s: string): RGB {
  let h = s.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (h.length < 6 || Number.isNaN(n)) return [188, 217, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Traza el abanico: un rayo por longitud de onda, con Snell en el plano medio del prisma.
 * rayA = (Qx, Qy, dx, dy) del punto de salida; rayB = (largo hasta el impacto, brillo, separación angular, tipo).
 * tipo: -1 sin rayo, 0 solo dentro del vidrio, 1 cae en la pared, 2 cae en el piso. Devuelve el centro del cáustico en x.
 */
function trazarAbanico(O: V, disp: number, I: number, rayA: Float32Array, rayB: Float32Array): { tin: number; xc: number } {
  const d0 = unit(sub(P1, O));
  const cosI = -dot(d0, NL);
  for (let i = 0; i < N; i++) rayB[i * 4 + 3] = -1;
  if (cosI <= 0.03) return { tin: 0, xc: 1 };
  const dn = Math.max(0.004, 0.15 * disp);
  const tin = 1 - schlick(cosI);
  const ang: number[] = [];
  const idx: number[] = [];
  let xc = XR - 0.3;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const nG = 1.5 + dn * (1 - t);
    if (!refract2(d0[0], d0[1], NL[0], NL[1], 1 / nG)) continue;
    const d1x = rfx, d1y = rfy;
    const tR = hitSeg(P1[0], P1[1], d1x, d1y, AP[0], AP[1], BR[0], BR[1]);
    const tB = hitSeg(P1[0], P1[1], d1x, d1y, BR[0], BR[1], BL[0], BL[1]);
    let tt = -1, onRight = false;
    if (tR > 0 && (tB < 0 || tR < tB)) { tt = tR; onRight = true; } else if (tB > 0) tt = tB;
    if (tt < 0) continue;
    const qx = P1[0] + d1x * tt, qy = P1[1] + d1y * tt;
    const o = i * 4;
    rayA[o] = qx; rayA[o + 1] = qy; rayA[o + 2] = d1x; rayA[o + 3] = d1y;
    rayB[o] = 0; rayB[o + 1] = 0; rayB[o + 2] = 0.01; rayB[o + 3] = 0;
    if (!onRight || !refract2(d1x, d1y, -NR[0], -NR[1], nG)) continue;
    const d2x = rfx, d2y = rfy;
    if (d2x < 0.05) continue;
    const T = tin * (1 - schlick(NR[0] * d1x + NR[1] * d1y));
    const tw = (XR - qx) / d2x;
    const yw = qy + d2y * tw;
    let len = tw, kind = 1;
    if (yw < 0 && d2y < 0) { len = -qy / d2y; kind = 2; }
    rayA[o + 2] = d2x; rayA[o + 3] = d2y;
    rayB[o] = len; rayB[o + 1] = I * T; rayB[o + 3] = kind;
    ang.push(Math.atan2(d2y, d2x));
    idx.push(i);
    if (i === Math.floor(N / 2)) xc = d2y < -0.02 ? clamp(qx + d2x * (qy / -d2y), 0.7, XR - 0.12) : XR - 0.25;
  }
  // Separación angular entre rayos vecinos: sirve para que las bandas de color se fundan sin huecos.
  for (let k = 0; k < idx.length; k++) {
    const a = ang[Math.max(0, k - 1)], b = ang[Math.min(idx.length - 1, k + 1)];
    const span = Math.max(1, Math.min(idx.length - 1, k + 1) - Math.max(0, k - 1));
    rayB[idx[k] * 4 + 2] = Math.max(0.0007, Math.abs(b - a) / span);
  }
  return { tin, xc };
}

// ---------------------------------------------------------------------------------------------
// Sombreador: una sola pasada de pantalla completa que traza la escena 3D (prisma de vidrio como
// sólido de 5 planos con normales, piso, dos paredes, haz volumétrico, orbe) con cámara en perspectiva.
// ---------------------------------------------------------------------------------------------
const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;

const int N = ${N};
const float HZ = ${HZ.toFixed(4)};
const float XR = ${XR.toFixed(4)};
const float ZB = ${ZB.toFixed(4)};
const float BW = 0.034;
const vec2 P1 = vec2(${P1[0].toFixed(5)}, ${P1[1].toFixed(5)});
const vec3 PN[5] = vec3[5](vec3(-0.8660254, 0.5, 0.0), vec3(0.8660254, 0.5, 0.0), vec3(0.0, -1.0, 0.0), vec3(0.0, 0.0, 1.0), vec3(0.0, 0.0, -1.0));
const float PD[5] = float[5](0.4330127, 0.4330127, 0.0, HZ, HZ);

uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uCF;
uniform vec3 uCR;
uniform vec3 uCU;
uniform vec2 uLens;    // tan(fov/2), aspecto
uniform vec3 uOrb;     // posición del orbe (z = 0)
uniform vec4 uCfg;     // intensidad, resplandor, sigma del haz (mundo), dispersión
uniform vec3 uTint;    // tinte del vidrio (lineal)
uniform vec4 uBeam;    // dirección del haz (xy), largo hasta el prisma, transmisión de entrada
uniform vec4 uMisc;    // x: centro del cáustico, y: posición del ángulo (0 a 1), z: tamaño angular de un píxel (rad)
uniform vec4 uBox;     // caja (xmin, ymin, xmax, ymax) en z = 0 que contiene todos los haces
uniform vec4 uRA[N];
uniform vec4 uRB[N];

float gVL = 0.0;       // luz de haz acumulada: sirve de máscara del polvo

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float lum(vec3 c) { return dot(c, vec3(0.3, 0.55, 0.15)); }

// Color del espectro: t = 0 violeta (el que más se dobla), t = 1 rojo.
vec3 spec(float t) {
  float h = 0.77 * (1.0 - t);
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);
  return k * vec3(1.0, 1.0, 1.0) * (0.92 + 0.35 * (1.0 - t) * (1.0 - t));
}

// Entorno de estudio: paneles de luz verticales y una luz de techo, para reflejos en bisel y vidrio.
vec3 studio(vec3 d) {
  vec3 c = mix(vec3(0.004, 0.006, 0.012), vec3(0.03, 0.045, 0.085), smoothstep(-0.3, 0.9, d.y));
  float az = atan(d.x, -d.z);
  float band = smoothstep(-0.2, 0.15, d.y) * smoothstep(1.0, 0.5, d.y);
  float s = smoothstep(0.11, 0.0, abs(az + 0.85)) * 0.9 + smoothstep(0.05, 0.0, abs(az - 0.35)) * 1.3 + smoothstep(0.16, 0.0, abs(az - 1.3)) * 0.55 + smoothstep(0.08, 0.0, abs(az + 2.2)) * 0.5;
  c += vec3(0.85, 0.92, 1.0) * s * band;
  c += vec3(0.9, 0.95, 1.0) * smoothstep(0.8, 0.96, d.y) * 0.7;
  // Panel grande detrás de la cámara: da cuerpo a las tapas de vidrio.
  c += vec3(0.7, 0.8, 1.0) * smoothstep(0.7, 0.0, abs(abs(az) - 2.8)) * 0.16 * smoothstep(-0.45, 0.05, d.y) * smoothstep(0.9, 0.2, d.y);
  return c;
}

// El prisma: sólido convexo de 5 planos (dos caras inclinadas, base y dos tapas).
bool prism(vec3 ro, vec3 rd, out float t0, out float t1, out vec3 n0, out vec3 n1) {
  t0 = -1e9; t1 = 1e9; n0 = PN[0]; n1 = PN[0];
  for (int i = 0; i < 5; i++) {
    float nd = dot(PN[i], rd);
    float no = dot(PN[i], ro) - PD[i];
    if (abs(nd) < 1e-7) { if (no > 0.0) return false; continue; }
    float t = -no / nd;
    if (nd < 0.0) { if (t > t0) { t0 = t; n0 = PN[i]; } }
    else { if (t < t1) { t1 = t; n1 = PN[i]; } }
  }
  return t1 > max(t0, 0.0);
}

// Bisel: junto a cada arista la normal se inclina hacia la cara vecina; rim = hilo especular de la arista.
vec3 bevel(vec3 p, vec3 n, vec3 dir, float tt, out float rim) {
  float md = 1e3;
  vec3 nn = n;
  for (int i = 0; i < 5; i++) {
    float c = dot(PN[i], n);
    if (abs(c) > 0.98) continue;
    float e = (PD[i] - dot(PN[i], p)) / sqrt(1.0 - c * c);
    if (e < md) { md = e; nn = PN[i]; }
  }
  float k = 1.0 - smoothstep(0.0, BW, max(md, 0.0));
  // El hilo mide ~1.5 px en pantalla sin importar el ángulo de la cara: así no se ve punteado en diagonal.
  float pw = tt * uMisc.z / max(abs(dot(n, dir)), 0.12);
  rim = 1.0 - smoothstep(0.0, max(BW * 0.1, 1.6 * pw), max(md, 0.0));
  return normalize(n + nn * (k * k * 1.2));
}

// Perfil gaussiano de un cilindro luminoso (o cinta) visto desde un rayo que cruza el plano z = 0:
// dp = distancia en el plano al eje, c = pendiente transversal del rayo, sp/sz = grosor en el plano y en z.
float tube(float dp, float c, float sp, float sz) {
  float se2 = sp * sp + c * c * sz * sz;
  return exp(-0.5 * dp * dp / se2) * sp * inversesqrt(se2);
}

// Todos los haces (blanco entrante, abanico interno y espectro saliente) evaluados en el punto (p) del plano z = 0.
vec3 beams(vec2 p, vec2 m) {
  float I = uCfg.x, G = uCfg.y, s0 = uCfg.z;
  vec3 acc = vec3(0.0);
  // Haz blanco: núcleo + dos lóbulos de dispersión en el aire.
  {
    vec2 b = uBeam.xy, q = p - uOrb.xy;
    float s = dot(q, b), dp = q.x * b.y - q.y * b.x, c = m.x * b.y - m.y * b.x;
    float w = smoothstep(0.03, 0.14, s) * (1.0 - smoothstep(uBeam.z - 0.02, uBeam.z + 0.01, s));
    float k = tube(dp, c, s0, s0) * 2.4 + tube(dp, c, s0 * 3.2, s0 * 3.2) * 0.42 + tube(dp, c, s0 * 9.0, s0 * 9.0) * 0.1 * G;
    acc += vec3(0.92, 0.96, 1.0) * k * w * I;
    // Destello donde la luz toca el vidrio.
    float dP = length(p - P1);
    acc += vec3(0.9, 0.95, 1.0) * I * (0.9 * exp(-0.5 * dP * dP / 0.0007) + 0.14 * G * exp(-0.5 * dP * dP / 0.012)) * step(0.5, uBeam.w);
  }
  float aIn = 0.075 * I * uBeam.w;
  bool inPrism = p.x < 0.36 && p.x > -0.5 && p.y < 0.92;
  for (int i = 0; i < N; i++) {
    vec4 A = uRA[i];
    vec4 B = uRB[i];
    if (B.w < -0.5) continue;
    float t = float(i) / float(N - 1);
    vec3 col = spec(t);
    // Dentro del vidrio: el blanco ya empieza a abrirse.
    if (inPrism) {
      vec2 e = A.xy - P1;
      float L = length(e);
      vec2 bi = e / L, qi = p - P1;
      float si = dot(qi, bi), di = qi.x * bi.y - qi.y * bi.x, ci = m.x * bi.y - m.y * bi.x;
      float w = smoothstep(0.0, 0.03, si) * (1.0 - smoothstep(L - 0.012, L, si));
      acc += col * aIn * w * (tube(di, ci, s0 * 1.3, s0 * 1.3) + 0.2 * G * tube(di, ci, s0 * 4.0, s0 * 4.0));
    }
    // Fuera del prisma: un rayo por color hasta la pared o el piso; se ensancha y se funde con sus vecinos.
    vec2 bq = p - A.xy;
    if (B.w > 0.5 && dot(bq, A.zw) > -0.05 && dot(bq, A.zw) < B.x + 0.05) {
      vec2 b = A.zw, q = bq;
      float s = dot(q, b), dp = q.x * b.y - q.y * b.x, c = m.x * b.y - m.y * b.x;
      float ss = max(s, 0.0);
      float sp = s0 * 1.1 + (0.55 * B.z + 0.004) * ss;
      float sz = sp * 1.5 + 0.05 * ss;
      float w = smoothstep(-0.004, 0.05, s) * (1.0 - smoothstep(B.x - 0.3, B.x - 0.005, s));
      float k = tube(dp, c, sp, sz) + tube(dp, c, sp * 5.0, sz * 3.0) * 0.16 * G;
      acc += col * B.y * w * k * 0.62 / (1.0 + 0.4 * ss);
    }
  }
  return acc;
}

// Luz en el aire a lo largo de un tramo recto del rayo: orbe (núcleo y halo) y haces donde el rayo cruza el plano z = 0.
vec3 airLight(vec3 ro, vec3 rd, float tmax) {
  vec3 acc = vec3(0.0);
  float I = uCfg.x, G = uCfg.y;
  vec3 oc = uOrb - ro;
  float tc = dot(oc, rd);
  if (tc > 0.0 && tc < tmax) {
    float dm2 = max(dot(oc, oc) - tc * tc, 0.0);
    float dm = sqrt(dm2);
    float core = 1.0 - smoothstep(0.036, 0.05, dm);
    acc += vec3(1.0, 0.98, 0.95) * core * 9.0 * I;
    acc += vec3(0.95, 0.97, 1.0) * I * (1.6 * G * exp(-0.5 * dm2 / 0.0030) + 0.38 * G * exp(-0.5 * dm2 / 0.045) + 0.08 * G * exp(-0.5 * dm2 / 0.45));
  }
  if (abs(rd.z) > 1e-4) {
    float tz = -ro.z / rd.z;
    if (tz > 0.0 && tz < tmax) {
      vec3 pz = ro + rd * tz;
      if (pz.x > uBox.x && pz.x < uBox.z && pz.y > uBox.y && pz.y < uBox.w) acc += beams(pz.xy, rd.xy / rd.z);
    }
  }
  gVL += lum(acc);
  return acc;
}

// Manchas del espectro sobre la pared derecha (impacto de cada rayo, con su baño de color).
vec3 spotsWall(vec3 p) {
  float G = uCfg.y, s0 = uCfg.z;
  vec3 acc = vec3(0.0);
  if (abs(p.z) > 2.8 || p.y > 1.8) return acc;
  for (int i = 0; i < N; i++) {
    vec4 A = uRA[i];
    vec4 B = uRB[i];
    if (B.w < 0.5 || B.w > 1.5) continue;
    float t = float(i) / float(N - 1);
    float sp = s0 * 1.1 + (0.55 * B.z + 0.004) * B.x;
    float sy = sp / max(abs(A.z), 0.3);
    float sz = 0.07 + 0.14 * B.x;
    float ovl = max(1.0, 2.5066 * sy / (B.z * B.x * 1.3 + 1e-4));
    float dy = p.y - (A.y + A.w * B.x);
    float ey = dy * dy / (sy * sy);
    float g = exp(-0.5 * (ey + p.z * p.z / (sz * sz * 0.1)));
    float gw = exp(-0.5 * (ey + p.z * p.z / (sz * sz)));
    float h = exp(-0.5 * (ey / 18.0 + p.z * p.z / (sz * sz * 5.0)));
    acc += spec(t) * B.y * (1.2 * g + 0.75 * gw + 0.2 * G * h) / ovl;
  }
  return acc * 0.9;
}
// Lo mismo sobre el piso: la banda de color queda tendida a lo largo de x.
vec3 spotsFloor(vec3 p) {
  float G = uCfg.y, s0 = uCfg.z;
  vec3 acc = vec3(0.0);
  if (abs(p.z) > 2.2 || p.x < 0.1 || p.x > XR + 0.1) return acc;
  for (int i = 0; i < N; i++) {
    vec4 A = uRA[i];
    vec4 B = uRB[i];
    if (B.w < 1.5) continue;
    float t = float(i) / float(N - 1);
    float sp = s0 * 1.1 + (0.55 * B.z + 0.004) * B.x;
    float sa = sp / max(abs(A.w), 0.14);
    float sz = 0.06 + 0.12 * B.x;
    float ovl = max(1.0, 2.5066 * sa / (B.z * B.x / max(abs(A.w), 0.14) * 1.3 + 1e-4));
    float dx = p.x - (A.x + A.z * B.x);
    float ex = dx * dx / (sa * sa);
    float g = exp(-0.5 * (ex + p.z * p.z / (sz * sz * 0.1)));
    float gw = exp(-0.5 * (ex + p.z * p.z / (sz * sz)));
    float h = exp(-0.5 * (ex / 18.0 + p.z * p.z / (sz * sz * 5.0)));
    acc += spec(t) * B.y * (1.2 * g + 0.75 * gw + 0.2 * G * h) / ovl;
  }
  return acc * 0.9;
}

// Sombra del prisma sobre el piso desde el orbe: la longitud de cuerda que la luz recorre dentro del vidrio
// da una penumbra continua (sin ruido). El vidrio deja pasar algo de luz, teñida.
vec3 shadowAt(vec3 p) {
  vec3 Lv = uOrb - p;
  float dist = length(Lv);
  vec3 rd = Lv / dist, ro = p + vec3(0.0, 1e-3, 0.0);
  float t0 = -1e9, t1 = 1e9;
  for (int i = 0; i < 5; i++) {
    float nd = dot(PN[i], rd);
    float no = dot(PN[i], ro) - PD[i];
    if (abs(nd) < 1e-7) { if (no > 0.0) return vec3(1.0); continue; }
    float t = -no / nd;
    if (nd < 0.0) t0 = max(t0, t); else t1 = min(t1, t);
  }
  float chord = max(min(t1, dist) - max(t0, 0.0), 0.0);
  return mix(vec3(1.0), vec3(0.12) * mix(vec3(0.3), uTint, 0.7), smoothstep(0.0, 0.14, chord));
}

vec3 floorCol(vec3 p) {
  float I = uCfg.x;
  vec3 Lv = uOrb - p;
  float d2 = dot(Lv, Lv);
  float nl = max(Lv.y * inversesqrt(d2), 0.0);
  vec3 sh = shadowAt(p);
  vec2 bd = abs(p.xz) - vec2(0.5, HZ);
  float sd = length(max(bd, 0.0));
  float ao = 1.0 - 0.8 * exp(-sd * 15.0);
  vec3 alb = vec3(0.05, 0.06, 0.088);
  vec3 c = alb * (0.3 + 2.4 * I * nl / (1.0 + 2.2 * d2) * sh) * ao;
  c += spotsFloor(p) * (0.5 + 0.5 * ao);
  // Cáustico: la luz que atraviesa el prisma se concentra en un charco azulado detrás.
  vec2 cq = vec2((p.x - uMisc.x) / 0.42, p.z / 0.24);
  c += vec3(0.4, 0.58, 1.0) * 0.12 * I * exp(-0.5 * dot(cq, cq)) * step(0.0, uBeam.w);
  return c;
}
vec3 wallBack(vec3 p) {
  float I = uCfg.x;
  float x = p.x, y = p.y;
  vec3 c = mix(vec3(0.0075, 0.0105, 0.02), vec3(0.003, 0.0045, 0.009), smoothstep(0.0, 2.8, y));
  c += vec3(0.06, 0.085, 0.15) * 0.2 * exp(-0.5 * (pow((x - 0.3) / 1.25, 2.0) + pow((y - 0.7) / 0.9, 2.0)));
  float pn = smoothstep(0.16, 0.0, abs(x + 1.45)) * 0.9 + smoothstep(0.07, 0.0, abs(x - 0.4)) * 1.0 + smoothstep(0.12, 0.0, abs(x - 1.0)) * 0.55;
  c += vec3(0.5, 0.62, 0.95) * pn * 0.04 * smoothstep(-0.05, 0.4, y) * (1.0 - smoothstep(1.7, 2.5, y));
  vec3 L = uOrb - p;
  float d2 = dot(L, L);
  c += vec3(0.5, 0.62, 1.0) * 0.06 * I * max(L.z * inversesqrt(d2), 0.0) / (1.0 + 1.4 * d2);
  c += vec3(0.4, 0.52, 0.85) * 0.15 * exp(-max(y, 0.0) * 55.0);
  c *= 1.0 - 0.55 * exp(-(XR - x) * 5.0);
  return c;
}
vec3 wallRight(vec3 p) {
  float I = uCfg.x;
  float z = p.z, y = p.y;
  vec3 c = mix(vec3(0.0065, 0.009, 0.017), vec3(0.003, 0.0045, 0.009), smoothstep(0.0, 2.8, y));
  c += vec3(0.06, 0.085, 0.15) * 0.13 * exp(-0.5 * (pow((z + 0.2) / 1.5, 2.0) + pow((y - 0.55) / 0.8, 2.0)));
  float pn = smoothstep(0.12, 0.0, abs(z + 1.4)) * 0.8 + smoothstep(0.2, 0.0, abs(z - 0.9)) * 0.5;
  c += vec3(0.5, 0.62, 0.95) * pn * 0.03 * smoothstep(-0.05, 0.4, y) * (1.0 - smoothstep(1.5, 2.3, y));
  vec3 L = uOrb - p;
  float d2 = dot(L, L);
  c += vec3(0.5, 0.62, 1.0) * 0.045 * I * max(-L.x * inversesqrt(d2), 0.0) / (1.0 + 1.6 * d2);
  c += vec3(0.4, 0.52, 0.85) * 0.13 * exp(-max(y, 0.0) * 55.0);
  c *= 1.0 - 0.5 * exp(-(p.z + ZB) * 3.5);
  c += spotsWall(p);
  return c;
}

// El cuarto sin reflejos: primero se halla la superficie más cercana (piso, pared de fondo o pared derecha)...
float roomT(vec3 ro, vec3 rd, out int kind) {
  float tf = rd.y < -1e-5 ? -ro.y / rd.y : 1e9;
  float tb = rd.z < -1e-5 ? (-ZB - ro.z) / rd.z : 1e9;
  float tr = rd.x > 1e-5 ? (XR - ro.x) / rd.x : 1e9;
  float t = tf; kind = 1;
  if (tb < t) { t = tb; kind = 2; }
  if (tr < t) { t = tr; kind = 3; }
  if (t > 1e8) { kind = 0; return 60.0; }
  return max(t, 0.0);
}
// ...y solo después se sombrea.
vec3 roomShade(vec3 p, int kind) {
  if (kind == 1) return floorCol(p);
  if (kind == 2) return wallBack(p);
  if (kind == 3) return wallRight(p);
  return vec3(0.004, 0.006, 0.012);
}
vec3 roomCol(vec3 ro, vec3 rd, out float tHit, out int kind) {
  tHit = roomT(ro, rd, kind);
  return roomShade(ro + rd * tHit, kind);
}

// Vidrio: fresnel, refracción por canal de color (dispersión), rebotes internos con reflexión total,
// absorción del tinte y bisel con hilo especular. Los haces dentro del vidrio se ven refractados.
vec3 glassShade(vec3 ro, vec3 rd, float ta, vec3 na) {
  float DSP = 0.006 + 0.01 * uCfg.w;
  vec3 p = ro + rd * ta;
  float rim0;
  vec3 nb = bevel(p, na, rd, ta, rim0);
  float ci = clamp(dot(-rd, nb), 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - ci, 5.0);
  vec3 rr = reflect(rd, nb);
  vec3 refl = studio(rr) + vec3(1.0, 0.97, 0.92) * pow(max(dot(rr, normalize(uOrb - p)), 0.0), 120.0) * 6.0 * uCfg.x;
  vec3 air = airLight(ro, rd, ta);
  vec3 vol = vec3(0.0);
  vec3 thr = vec3(0.0);
  float plen = 0.0;
  float rimE = 0.0;
  for (int ch = 0; ch < 3; ch++) {
    float ior = 1.5 + (float(ch) - 1.0) * DSP;
    vec3 d = refract(rd, nb, 1.0 / ior);
    vec3 q = p + d * 2e-4;
    vec3 od = d;
    float len = 0.0;
    int nb = ch == 1 ? 3 : 2;
    for (int b = 0; b < 3; b++) {
      if (b >= nb) break;
      float a0, a1; vec3 m0, m1;
      prism(q, d, a0, a1, m0, m1);
      float tx = max(a1, 1e-3);
      if (ch == 1) vol += airLight(q, d, tx);
      len += tx;
      vec3 pe = q + d * tx;
      float re;
      vec3 ne = bevel(pe, m1, d, ta + len, re);
      if (ch == 1) rimE = max(rimE, re * (b == 0 ? 1.0 : 0.6));
      vec3 o = refract(d, -ne, ior);
      if (dot(o, o) > 0.0) { q = pe; od = o; break; }
      d = reflect(d, ne);
      q = pe + d * 2e-4;
      od = d;
    }
    float th; int kd;
    vec3 rc = roomCol(q, od, th, kd);
    if (ch == 1) { thr.g = rc.g; plen = len; vol += airLight(q, od, th); }
    else if (ch == 0) thr.r = rc.r;
    else thr.b = rc.b;
  }
  vec3 absorb = exp(-plen * (1.0 - uTint) * 1.5);
  vec3 col = air + vol + mix(thr * absorb, refl, F);
  float rl = 0.35 + 1.6 * lum(studio(rr));
  col += vec3(0.8, 0.9, 1.0) * (rim0 * rl * 0.9 + rimE * 0.28);
  return col;
}

// Escena sin el reflejo del piso (para el reflejo mismo y para lo que se ve a través del vidrio).
vec3 scene1(vec3 ro, vec3 rd) {
  float a0, a1; vec3 m0, m1;
  int kd;
  float th = roomT(ro, rd, kd);
  if (prism(ro, rd, a0, a1, m0, m1) && a0 > 0.0 && a0 < th) return glassShade(ro, rd, a0, m0);
  return roomShade(ro + rd * th, kd) + airLight(ro, rd, th);
}

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

// Polvo en suspensión: motas que solo se encienden donde hay luz del haz.
float motes(vec2 frag, float mask) {
  float acc = 0.0;
  float u = uRes.y;
  for (int k = 0; k < 2; k++) {
    float cell = u * (k == 0 ? 0.052 : 0.083);
    vec2 g = (frag + vec2(uTime * 5.0 * float(k + 1), -uTime * 3.0)) / cell;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    vec2 h = hash22(id + float(k) * 17.0);
    float on = step(0.8, hash12(id * 1.7 + float(k) * 5.0));
    float d = length(f - (h - 0.5) * 0.7);
    float tw = 0.5 + 0.5 * sin(uTime * (1.0 + h.x * 2.0) + h.y * 6.283);
    acc += on * (0.35 + 0.65 * tw) * smoothstep(0.1, 0.0, d);
  }
  return acc * mask;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 ndc = frag / uRes * 2.0 - 1.0;
  vec3 ro = uCam;
  vec3 rd = normalize(uCF + uCR * (ndc.x * uLens.y * uLens.x) + uCU * (ndc.y * uLens.x));
  vec3 col;
  float a0, a1; vec3 m0, m1;
  int kind;
  float tr = roomT(ro, rd, kind);
  if (prism(ro, rd, a0, a1, m0, m1) && a0 > 0.0 && a0 < tr) {
    col = glassShade(ro, rd, a0, m0);
  } else {
    col = roomShade(ro + rd * tr, kind);
    if (kind == 1) {
      // Piso brillante tipo vinilo: reflejo de todo lo que hay arriba, más fuerte al ras.
      float cs = clamp(-rd.y, 0.0, 1.0);
      float F = clamp((0.05 + 0.95 * pow(1.0 - cs, 5.0)) * 1.4 + 0.06, 0.0, 0.85);
      vec3 p = ro + rd * tr;
      vec3 refl = scene1(p + vec3(0.0, 2e-4, 0.0), vec3(rd.x, -rd.y, rd.z));
      col = col * (1.0 - F * 0.7) + refl * F;
    }
    col += airLight(ro, rd, tr);
  }
  col += vec3(0.9, 0.95, 1.0) * motes(frag, clamp(gVL * 0.7, 0.0, 1.0)) * 1.4 * uCfg.x;

  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  vec2 uv = frag / uRes - 0.5;
  col *= 1.0 - 0.6 * smoothstep(0.22, 0.95, length(uv * vec2(1.0, 1.1) * 1.3));
  col += (hash12(frag + fract(uTime) * 91.7) - 0.5) * 0.024;
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

const UNIFORMS = ["uRes", "uTime", "uCam", "uCF", "uCR", "uCU", "uLens", "uOrb", "uCfg", "uTint", "uBeam", "uMisc", "uBox", "uRA", "uRB"] as const;

/** Un orbe de luz que sigue al cursor dispara un haz a un prisma de vidrio 3D; el espectro cae sobre la pared y el piso. */
export function PrismLight({
  dispersion = 1,
  intensity = 1,
  glow = 1,
  beamWidth = 2.5,
  tint = "#bcd9ff",
  autoplay = true,
  interactive = true,
  children,
  className = "",
  style,
}: PrismLightProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const opts = useRef({ dispersion, intensity, glow, beamWidth, tint, autoplay, interactive });
  opts.current = { dispersion, intensity, glow, beamWidth, tint, autoplay, interactive };
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    const root = rootRef.current;
    const cv = cvRef.current;
    if (!root || !cv) return;
    const gl = cv.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
    if (!gl) {
      // Sin WebGL2: queda el fondo oscuro de CSS con el titular.
      root.setAttribute("data-sin-gl", "");
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Render por software (SwiftShader, llvmpipe): bajar la resolución no lo salva y solo empeora la imagen.
    const dbgInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const software = !!dbgInfo && /swiftshader|llvmpipe|software/i.test(String(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL)));

    let prog: WebGLProgram | null = null;
    let vao: WebGLVertexArrayObject | null = null;
    let U: Record<string, WebGLUniformLocation | null> = {};
    let lost = false, ready = false, disposed = false, compRaf = 0;
    let W = 0, H = 0, dpr = 1, raf = 0, visible = true, last = 0, time = 0, hover = false, inited = false, lastVars = "";
    let cur: V = [0, 0];
    let nivel = 0;
    const orb = { x: 0, y: 0, vx: 0, vy: 0 };
    const cam = { yaw: YAW0, pitch: PITCH0, vy: 0, vp: 0 };
    const L = { dist: 6.6, rMin: 0.45, rMax: 1.4, rMid: 0.9 };
    const rayA = new Float32Array(N * 4);
    const rayB = new Float32Array(N * 4);

    // ---- Medición de rendimiento: tiempo de GPU con timer query si existe; si no, el intervalo de rAF.
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    const pend: WebGLQuery[] = [];
    let gpuAvg = 0, gpuN = 0, calmos = 0, espera = 60; // los primeros cuadros (compilación, calentamiento) no cuentan
    let minInt = 1e9, prevRaf = 0;
    const lentos: boolean[] = [];
    const cambiarNivel = (d: number) => {
      const n = clamp(nivel + d, 0, NIVELES.length - 1);
      if (n === nivel) return;
      nivel = n; gpuAvg = 0; gpuN = 0; calmos = 0; espera = 40; lentos.length = 0;
      resize();
      if (!raf) draw();
    };
    const medir = (now: number) => {
      if (software) return;
      if (espera > 0) espera--;
      if (ext) {
        while (pend.length) {
          const q = pend[0];
          if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
          pend.shift();
          const bad = gl.getParameter(ext.GPU_DISJOINT_EXT);
          if (!bad) {
            const ms = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
            gpuAvg = gpuN ? gpuAvg * 0.85 + ms * 0.15 : ms; gpuN++;
          }
          gl.deleteQuery(q);
        }
        if (espera === 0 && gpuN > 12) {
          if (gpuAvg > 12) cambiarNivel(1);
          else if (gpuAvg < 4 && nivel > 0) { if (++calmos > 150) cambiarNivel(-1); } else calmos = 0;
        }
        return;
      }
      // Sin timer query: intervalo de rAF relativo al mínimo observado (solo mientras el bucle corre seguido).
      const dtr = prevRaf ? now - prevRaf : 0;
      prevRaf = now;
      // Más de ~140 ms por cuadro es render por software: bajar la resolución no salva la fluidez y solo empeora la imagen.
      if (dtr < 2 || dtr > 140) return;
      minInt = Math.min(minInt * 1.0008, dtr);
      lentos.push(dtr > minInt * 1.5 + 2);
      if (lentos.length > 30) lentos.shift();
      if (espera === 0 && lentos.length === 30 && lentos.filter(Boolean).length > 20) cambiarNivel(1);
    };

    // ---- Programa y recursos de GL (se pueden reconstruir si el contexto se pierde y vuelve).
    // La compilación es asíncrona si el navegador lo permite (KHR_parallel_shader_compile): la página no se congela.
    const pk = gl.getExtension("KHR_parallel_shader_compile") as { COMPLETION_STATUS_KHR: number } | null;
    const start = () => {
      ready = false;
      const mk = (type: number, src: string) => {
        const sh = gl.createShader(type);
        if (sh) { gl.shaderSource(sh, src); gl.compileShader(sh); }
        return sh;
      };
      const vs = mk(gl.VERTEX_SHADER, VERT), fs = mk(gl.FRAGMENT_SHADER, FRAG);
      const pr = gl.createProgram();
      if (!vs || !fs || !pr) { fallo(); return; }
      gl.attachShader(pr, vs); gl.attachShader(pr, fs);
      gl.linkProgram(pr);
      const poll = () => {
        compRaf = 0;
        if (disposed || lost) return;
        if (pk && !gl.getProgramParameter(pr, pk.COMPLETION_STATUS_KHR)) { compRaf = requestAnimationFrame(poll); return; }
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
          console.error("PrismLight: " + (gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(pr)));
          fallo();
          return;
        }
        gl.deleteShader(vs); gl.deleteShader(fs);
        prog = pr;
        vao = gl.createVertexArray();
        U = {};
        for (const n of UNIFORMS) U[n] = gl.getUniformLocation(pr, n);
        ready = true;
        resize();
        draw();
        wake();
      };
      poll();
    };
    // Sin programa utilizable: queda el fondo oscuro de CSS con el titular.
    const fallo = () => { root.setAttribute("data-sin-gl", ""); };

    // ---- Cámara: órbita alrededor del prisma (el paralaje del cursor mueve yaw y pitch con un resorte).
    const basis = () => {
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      const pos: [number, number, number] = [TARGET[0] + L.dist * sy * cp, TARGET[1] + L.dist * sp, TARGET[2] + L.dist * cy * cp];
      let f: [number, number, number] = [TARGET[0] - pos[0], TARGET[1] - pos[1], TARGET[2] - pos[2]];
      const fl = Math.hypot(f[0], f[1], f[2]);
      f = [f[0] / fl, f[1] / fl, f[2] / fl];
      // r = f × (0,1,0)
      let r: [number, number, number] = [-f[2], 0, f[0]];
      const rl = Math.hypot(r[0], r[2]) || 1;
      r = [r[0] / rl, 0, r[2] / rl];
      const u: [number, number, number] = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      return { pos, f, r, u };
    };
    // Proyecta un punto de la pantalla (px de CSS) al plano z = 0 del mundo con la cámara actual.
    const unproject = (px: number, py: number): V | null => {
      const b = basis();
      const nx = (px / W) * 2 - 1, ny = 1 - (py / H) * 2;
      const k1 = nx * (W / H) * TANH, k2 = ny * TANH;
      const dx = b.f[0] + b.r[0] * k1 + b.u[0] * k2, dy = b.f[1] + b.r[1] * k1 + b.u[1] * k2, dz = b.f[2] + b.r[2] * k1 + b.u[2] * k2;
      if (dz > -1e-4) return null;
      const t = -b.pos[2] / dz;
      return [b.pos[0] + dx * t, b.pos[1] + dy * t];
    };

    // ---- El orbe vive en coordenadas polares alrededor del punto de entrada: (ángulo del haz, distancia).
    // Nunca baja del piso: si el ángulo es muy empinado, se acorta la distancia.
    const limitar = (th: number, r: number): V => {
      const s = -Math.sin(th);
      const rf = s > 0.05 ? (P1[1] - 0.12) / s : 1e9;
      return [th, clamp(Math.min(r, rf), 0.3, L.rMax)];
    };
    const aim = (px: number, py: number): V => {
      const w = unproject(px, py) ?? [P1[0] - 1, P1[1] - 0.3];
      const vx = Math.max(P1[0] - w[0], 0.25), vy = w[1] - P1[1];
      return limitar(clamp(Math.atan2(vy, vx), TH_MIN, TH_MAX), clamp(Math.hypot(vx, vy), L.rMin, L.rMax));
    };
    const idle = (t: number): V => limitar((-34 + 11 * Math.sin(t * 0.33) + 3 * Math.sin(t * 0.91 + 1)) * DEG, L.rMid * (1 + 0.14 * Math.sin(t * 0.21 + 0.8)));
    // Pose de reposo: la del instante 0 si el orbe pasea solo; una fija si no.
    const rest = (t: number): V => (opts.current.autoplay ? idle(t) : limitar(-34 * DEG, L.rMid));
    const place = (th: number, r: number): V => [P1[0] - r * Math.cos(th), P1[1] + r * Math.sin(th)];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = Math.max(1, root.clientWidth); H = Math.max(1, root.clientHeight);
      const sc = NIVELES[nivel];
      cv.width = Math.max(2, Math.round(W * dpr * sc));
      cv.height = Math.max(2, Math.round(H * dpr * sc));
      gl.viewport(0, 0, cv.width, cv.height);
      // Encuadre: el ancho visible a la distancia del prisma se mantiene en ~3.5 unidades; en lienzos bajos manda el alto.
      L.dist = clamp(Math.max(1.75 / (TANH * (W / H)), 4.7), 4.7, 11);
      const base = { yaw: cam.yaw, pitch: cam.pitch };
      cam.yaw = YAW0; cam.pitch = PITCH0;
      const wl = unproject(W * 0.07, H * 0.55);
      cam.yaw = base.yaw; cam.pitch = base.pitch;
      const xl = wl ? wl[0] : -1.5;
      L.rMax = Math.max(L.rMin + 0.3, (P1[0] - xl) / Math.cos(TH_MAX));
      L.rMid = Math.max(L.rMin + 0.1, L.rMax * 0.62);
      const t = rest(time), p = place(t[0], t[1]);
      if (!inited) { inited = true; orb.x = p[0]; orb.y = p[1]; orb.vx = orb.vy = 0; }
      else if (hover && opts.current.interactive) { const a = aim(cur[0], cur[1]), q = place(a[0], a[1]); orb.x = q[0]; orb.y = q[1]; }
      else { orb.x = p[0]; orb.y = p[1]; orb.vx = orb.vy = 0; }
    };

    const draw = () => {
      if (lost || !ready || !prog) return;
      const o = opts.current;
      const b = basis();
      const O: V = [orb.x, orb.y];
      const { tin, xc } = trazarAbanico(O, o.dispersion, o.intensity, rayA, rayB);
      const d0 = unit(sub(P1, O));
      const th = Math.atan2(orb.y - P1[1], P1[0] - orb.x);
      const q = clamp((th - TH_MIN) / (TH_MAX - TH_MIN), 0, 1);
      // Grosor del haz: px de CSS → unidades de mundo a la distancia del prisma.
      const wpp = (2 * TANH * L.dist) / H;
      const sigma = Math.max(0.7 * wpp, Math.max(0.8, o.beamWidth) * wpp * 0.42);
      const tc = parseColor(o.tint);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform2f(U.uRes, cv.width, cv.height);
      gl.uniform1f(U.uTime, time);
      gl.uniform3fv(U.uCam, b.pos); gl.uniform3fv(U.uCF, b.f); gl.uniform3fv(U.uCR, b.r); gl.uniform3fv(U.uCU, b.u);
      gl.uniform2f(U.uLens, TANH, W / H);
      gl.uniform3f(U.uOrb, orb.x, orb.y, 0);
      gl.uniform4f(U.uCfg, o.intensity, o.glow, sigma, o.dispersion);
      gl.uniform3f(U.uTint, Math.pow(tc[0] / 255, 2.2), Math.pow(tc[1] / 255, 2.2), Math.pow(tc[2] / 255, 2.2));
      gl.uniform4f(U.uBeam, d0[0], d0[1], Math.hypot(P1[0] - O[0], P1[1] - O[1]), tin);
      gl.uniform4f(U.uMisc, xc, q, (2 * TANH) / cv.height, 0);
      let y1 = Math.max(O[1], P1[1]);
      for (let i = 0; i < N; i++) {
        const o4 = i * 4;
        if (rayB[o4 + 3] > 0.5) y1 = Math.max(y1, rayA[o4 + 1] + Math.max(0, rayA[o4 + 3]) * rayB[o4]);
      }
      gl.uniform4f(U.uBox, Math.min(O[0], P1[0]) - 0.5, -0.1, XR + 0.03, y1 + 0.6);
      gl.uniform4fv(U.uRA, rayA);
      gl.uniform4fv(U.uRB, rayB);
      let qy: WebGLQuery | null = null;
      if (ext && pend.length < 4) { qy = gl.createQuery(); if (qy) gl.beginQuery(ext.TIME_ELAPSED_EXT, qy); }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (qy) { gl.endQuery(ext!.TIME_ELAPSED_EXT); pend.push(qy); }

      // El titular recibe el color: la franja del espectro se desplaza con el ángulo de la luz.
      const vars = `${(10 + 80 * q).toFixed(1)}|${Math.round(272 * (1 - q))}`;
      if (vars !== lastVars) {
        lastVars = vars;
        const [px, ph] = vars.split("|");
        root.style.setProperty("--pl-x", `${px}%`);
        root.style.setProperty("--pl-h", ph);
      }
    };

    // Objetivo de la cámara: el cursor la inclina un poco (paralaje); sin cursor, un vaivén lento.
    const camTarget = (t: number, follow: boolean): V => {
      if (follow) {
        const nx = clamp((cur[0] / W) * 2 - 1, -1, 1), ny = clamp((cur[1] / H) * 2 - 1, -1, 1);
        return [YAW0 + nx * 0.11, PITCH0 - ny * 0.06];
      }
      if (opts.current.autoplay) return [YAW0 + 0.045 * Math.sin(t * 0.23), PITCH0 + 0.022 * Math.sin(t * 0.31 + 1)];
      return [YAW0, PITCH0];
    };

    const tick = (now: number) => {
      raf = 0;
      // dt nunca negativo ni enorme: el timestamp de rAF puede ser anterior a performance.now().
      const dt = Math.min(0.04, Math.max(0, (now - (last || now)) / 1000));
      last = now;
      time += dt;
      const o = opts.current;
      const follow = hover && o.interactive;
      // Cámara con resorte suave.
      const ct = camTarget(time, follow);
      cam.vy += ((ct[0] - cam.yaw) * 38 - cam.vy * 9) * dt;
      cam.vp += ((ct[1] - cam.pitch) * 38 - cam.vp * 9) * dt;
      cam.yaw += cam.vy * dt; cam.pitch += cam.vp * dt;
      let tgt: V;
      if (follow) tgt = aim(cur[0], cur[1]);
      else tgt = rest(time);
      const T = place(tgt[0], tgt[1]);
      // Resorte con un poco de rebote: la luz persigue al cursor, no se pega a él.
      const k = 150, c = 17;
      orb.vx += ((T[0] - orb.x) * k - orb.vx * c) * dt;
      orb.vy += ((T[1] - orb.y) * k - orb.vy * c) * dt;
      orb.x += orb.vx * dt; orb.y += orb.vy * dt;
      draw();
      medir(now);
      const camQuieta = Math.abs(ct[0] - cam.yaw) < 0.0004 && Math.abs(ct[1] - cam.pitch) < 0.0004 && Math.abs(cam.vy) < 0.004 && Math.abs(cam.vp) < 0.004;
      const settled = Math.hypot(T[0] - orb.x, T[1] - orb.y) < 0.0004 && Math.hypot(orb.vx, orb.vy) < 0.004 && camQuieta;
      if (visible && !lost && ((!follow && o.autoplay) || !settled)) raf = requestAnimationFrame(tick);
      else { last = 0; prevRaf = 0; }
    };
    const wake = () => { if (!raf && visible && !reduce && !lost && ready) raf = requestAnimationFrame(tick); };
    // Con movimiento reducido no hay bucle: solo se repinta cuando algo cambia.
    const still = () => {
      if (raf || lost || !ready) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const o = opts.current;
        const follow = hover && o.interactive;
        const ct = camTarget(0, follow);
        cam.yaw = ct[0]; cam.pitch = ct[1]; cam.vy = cam.vp = 0;
        const tgt = follow ? aim(cur[0], cur[1]) : rest(0);
        const p = place(tgt[0], tgt[1]);
        orb.x = p[0]; orb.y = p[1]; orb.vx = orb.vy = 0;
        draw();
      });
    };
    refresh.current = () => { if (reduce) still(); else wake(); };

    // Los eventos de puntero solo guardan la posición y despiertan el bucle.
    const onMove = (ev: PointerEvent) => {
      if (!opts.current.interactive) return;
      const r = root.getBoundingClientRect();
      cur = [ev.clientX - r.left, ev.clientY - r.top];
      hover = true;
      if (reduce) still(); else wake();
    };
    const onLeave = () => { hover = false; if (reduce) still(); else wake(); };
    const onLost = (e: Event) => { e.preventDefault(); lost = true; ready = false; if (raf) cancelAnimationFrame(raf); if (compRaf) cancelAnimationFrame(compRaf); raf = 0; compRaf = 0; pend.length = 0; };
    const onRestored = () => {
      lost = false;
      start();
    };
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerdown", onMove);
    root.addEventListener("pointerleave", onLeave);
    cv.addEventListener("webglcontextlost", onLost);
    cv.addEventListener("webglcontextrestored", onRestored);
    const ro = new ResizeObserver(() => { resize(); draw(); });
    ro.observe(root);
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) { if (reduce) draw(); else wake(); } }, { threshold: 0.01 });
    io.observe(root);

    resize();
    start();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(compRaf);
      raf = 0;
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onMove);
      root.removeEventListener("pointerleave", onLeave);
      cv.removeEventListener("webglcontextlost", onLost);
      cv.removeEventListener("webglcontextrestored", onRestored);
      refresh.current = () => {};
      for (const q of pend) gl.deleteQuery(q);
      if (prog) gl.deleteProgram(prog);
      if (vao) gl.deleteVertexArray(vao);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  // Si cambian las props mientras el bucle duerme, repinta.
  useEffect(() => { refresh.current(); }, [dispersion, intensity, glow, beamWidth, tint, autoplay, interactive]);

  return (
    <div ref={rootRef} className={`furin-prism-light ${className}`} style={style}>
      <canvas ref={cvRef} className="furin-prism-light__canvas" aria-hidden />
      {children != null && children !== false && <div className="furin-prism-light__content">{children}</div>}
    </div>
  );
}

export default PrismLight;
