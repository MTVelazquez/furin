"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./LavaLamp.css";

export interface LavaLampProps {
  /** Color de la cera. */
  waxColor?: string;
  /** Color del líquido dentro del vidrio. */
  liquidColor?: string;
  /** Velocidad de las burbujas. */
  speed?: number;
  /** Intensidad de la luz cálida alrededor de la lámpara. */
  glow?: number;
  /** El cursor calienta la cera y atrae una burbuja. */
  interactive?: boolean;
  /** Contenido opcional encima del fondo. */
  children?: ReactNode;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

let colorCtx: CanvasRenderingContext2D | null = null;
function rgb(color: string): [number, number, number] {
  colorCtx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = "#000";
  colorCtx.fillStyle = color;
  colorCtx.fillRect(0, 0, 1, 1);
  const d = colorCtx.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}

const VS = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

const FS = `precision highp float;
uniform vec2 uRes;
uniform float uTime, uGlow;
uniform vec3 uWax, uLiquid;
uniform vec3 uMouse;

float hash(float n){ return fract(sin(n * 12.9898 + 1.7) * 43758.5453); }
float hwV(float y){
  float t = clamp((y + 0.30) / 0.64, 0.0, 1.0);
  return mix(0.205, 0.07, pow(t, 0.9)) + 0.014 * sin(t * 3.14159);
}

// campo de metaballs (Wyvill): x = campo, yz = gradiente
vec3 ball(vec2 q, vec2 c, float r){
  vec2 d = q - c;
  d.y *= 0.84;
  float R = r * 2.1;
  float k = dot(d, d) / (R * R);
  if (k >= 1.0) return vec3(0.0);
  float m = 1.0 - k;
  return vec3(m * m * m, -6.0 * m * m * vec2(d.x, d.y * 0.84) / (R * R));
}

vec3 field(vec2 q, float t){
  vec3 f = vec3(0.0);
  // charco de cera en el fondo, calentado por el foco
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = vec2(-0.115 + fi * 0.077, -0.268 + 0.010 * sin(t * 0.5 + fi * 1.9));
    f += ball(q, c, 0.062 + 0.007 * sin(t * 0.37 + fi));
  }
  // burbujas que suben, se enfrían y bajan
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float h1 = hash(fi), h2 = hash(fi + 11.0), h3 = hash(fi + 23.0), h4 = hash(fi + 37.0);
    float ph = fract(t * (0.055 + 0.04 * h1) + h2);
    float w = 0.5 - 0.5 * cos(6.2832 * ph);
    w = smoothstep(0.0, 1.0, w);
    float y = mix(-0.255, 0.305, w);
    float x = hwV(y) * 0.6 * sin(6.2832 * (t * (0.02 + 0.02 * h3) + h4));
    float r = (0.036 + 0.026 * h3) * (1.12 - 0.42 * w);
    f += ball(q, vec2(x, y), r);
  }
  if (uMouse.z > 0.001) f += ball(q, uMouse.xy, 0.05 * uMouse.z);
  return f;
}

vec3 metal(float u, float v, vec3 tint){
  float c = sqrt(max(1.0 - u * u, 0.0));
  vec3 n = vec3(u, 0.0, c);
  vec3 L = normalize(vec3(-0.55, 0.35, 0.8));
  float l = 0.22 + 0.78 * max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 26.0);
  vec3 col = tint * l;
  col += tint * vec3(1.0, 0.5, 0.2) * 0.55 * smoothstep(0.7, 0.0, v) * c;
  col += vec3(1.0, 0.84, 0.6) * spec * 0.85;
  col *= 0.8 + 0.2 * smoothstep(0.0, 0.25, 1.0 - abs(u));
  return col;
}

void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float px = 1.0 / uRes.y;
  vec3 warm = mix(uLiquid, uWax, 0.45);

  // ---------- fondo: penumbra con la luz de la lámpara ----------
  vec3 col = vec3(0.030, 0.022, 0.026);
  float halo = exp(-length(vec2(p.x * 1.15, (p.y + 0.02) * 0.62)) * 4.4);
  col += warm * halo * 0.20 * uGlow;
  col += uWax * exp(-length(vec2(p.x * 0.9, (p.y + 0.12) * 0.55)) * 3.2) * 0.05 * uGlow;
  // piso: un brillo suave bajo la base
  float floorY = -0.462;
  float onFloor = smoothstep(floorY + px, floorY - px, p.y);
  col = mix(col, vec3(0.018, 0.013, 0.016) + warm * 0.10 * uGlow * exp(-abs(p.x) * 4.5) * exp(-(floorY - p.y) * 9.0), onFloor);
  col += uWax * 0.12 * uGlow * exp(-pow(p.x / 0.22, 2.0)) * exp(-pow((p.y - floorY + 0.012) / 0.02, 2.0)) * onFloor;

  // ---------- base y tapa de metal ----------
  float tb = clamp((p.y + 0.462) / 0.162, 0.0, 1.0);
  float hwB = mix(0.262, 0.214, smoothstep(0.0, 1.0, tb));
  float mB = (1.0 - smoothstep(-px, px, abs(p.x) - hwB)) * smoothstep(-0.462 - px, -0.462 + px, p.y) * (1.0 - smoothstep(-0.30 - px, -0.30 + px, p.y));
  vec3 bronze = vec3(0.58, 0.36, 0.19);
  vec3 baseCol = metal(clamp(p.x / hwB, -1.0, 1.0), tb, bronze * 0.62);
  baseCol += vec3(1.0, 0.8, 0.5) * 0.5 * exp(-pow((p.y + 0.318) / 0.006, 2.0));
  baseCol *= 1.0 - 0.45 * smoothstep(0.06, 0.0, tb);
  col = mix(col, baseCol, mB);

  float tc = clamp((p.y - 0.335) / 0.115, 0.0, 1.0);
  float hwC = 0.098 * sqrt(max(1.0 - tc * tc, 0.0)) + 0.0001;
  float mC = (1.0 - smoothstep(-px, px, abs(p.x) - hwC)) * smoothstep(0.335 - px, 0.335 + px, p.y) * (1.0 - smoothstep(0.45, 0.452, p.y));
  vec3 capCol = metal(clamp(p.x / max(hwC, 0.001), -1.0, 1.0), 1.0 - tc, bronze * 0.55);
  col = mix(col, capCol, mC);

  // ---------- vidrio con líquido y cera ----------
  float hv = hwV(p.y);
  float mV = (1.0 - smoothstep(-px, px, abs(p.x) - hv)) * smoothstep(-0.30 - px, -0.30 + px, p.y) * (1.0 - smoothstep(0.34 - px, 0.34 + px, p.y));
  if (mV > 0.001) {
    float u = p.x / hv;
    float t = clamp((p.y + 0.30) / 0.64, 0.0, 1.0);
    // luz del foco: sube desde abajo y se pierde arriba
    float bulb = exp(-t * 3.1) * (1.0 - 0.55 * u * u);
    vec3 liquid = mix(uLiquid * uLiquid * 0.55, uLiquid * 1.25, bulb);
    liquid += uWax * uWax * 0.45 * exp(-t * 7.5);

    vec3 f = field(p, uTime);
    float T = 0.5;
    float g = length(f.yz) + 1e-4;
    float edge = clamp((f.x - T) / (g * px * 1.3), -1.0, 1.0) * 0.5 + 0.5;
    float depth = clamp((f.x - T) / 0.55, 0.0, 1.0);
    // brillo de cera que se filtra al líquido
    liquid += uWax * 0.22 * smoothstep(0.0, T, f.x) * (0.4 + bulb);

    float nz = pow(depth, 0.55);
    vec2 nxy = normalize(-f.yz) * sqrt(max(1.0 - nz * nz, 0.0));
    vec3 n = vec3(nxy, nz);
    vec3 bulbPos = vec3(0.0, -0.37, 0.28);
    vec3 Ld = normalize(bulbPos - vec3(p, 0.0));
    float diff = max(dot(n, Ld), 0.0);
    float glowY = exp(-t * 2.4);
    vec3 hot = mix(uWax, vec3(1.0, 0.72, 0.30), 0.42);
    vec3 wax = mix(uWax * uWax * 0.62, hot, pow(depth, 1.0)) * (0.40 + 0.70 * diff + 0.75 * glowY) * mix(1.1, 0.72, t);
    wax += hot * 0.30 * pow(depth, 2.0) * (0.35 + glowY);
    vec3 V = vec3(0.0, 0.0, 1.0);
    float s1 = pow(max(dot(n, normalize(Ld + V)), 0.0), 36.0);
    float s2 = pow(max(dot(n, normalize(normalize(vec3(-0.45, 0.65, 0.75)) + V)), 0.0), 70.0);
    wax += vec3(1.0, 0.92, 0.75) * (s1 * 0.40 + s2 * 0.70);
    wax += hot * pow(1.0 - nz, 3.0) * 0.35;

    vec3 inner = mix(liquid, wax, edge);

    // vidrio: borde grueso y oscuro, reflejos de ventana
    float au = abs(u);
    inner *= 1.0 - 0.58 * pow(au, 3.4);
    float fadeY = smoothstep(0.04, 0.2, t) * (1.0 - smoothstep(0.72, 0.97, t));
    float st1 = exp(-pow((u + 0.70) / 0.075, 2.0));
    float st2 = exp(-pow((u + 0.52) / 0.03, 2.0));
    float st3 = exp(-pow((u - 0.80) / 0.04, 2.0));
    inner += vec3(1.0, 0.95, 0.9) * (st1 * 0.20 + st2 * 0.11 + st3 * 0.12) * fadeY;
    inner += vec3(1.0, 0.8, 0.6) * smoothstep(0.90, 0.985, au) * (1.0 - smoothstep(0.985, 1.0, au)) * 0.22;
    // reflejo curvo arriba
    inner += vec3(1.0, 0.95, 0.9) * 0.07 * smoothstep(0.9, 0.99, t) * (1.0 - au);
    col = mix(col, inner, mV);
  }
  // pequeño destello donde la base abraza el vidrio
  col += vec3(1.0, 0.7, 0.4) * 0.10 * exp(-pow((p.y + 0.30) / 0.012, 2.0)) * (1.0 - smoothstep(0.0, 1.0, abs(p.x) / 0.22)) * mV;

  col = col / (1.0 + max(col - 0.8, 0.0));
  col = pow(col, vec3(0.95));
  // viñeta suave
  col *= 1.0 - 0.35 * dot(p * vec2(0.9, 1.1), p * vec2(0.9, 1.1));
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 160.0;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Lámpara de lava con vidrio, base de bronce y cera que se funde: metaballs en un solo shader. */
export function LavaLamp({
  waxColor = "#FF6A1F",
  liquidColor = "#8A1240",
  speed = 1,
  glow = 1,
  interactive = true,
  children,
  className = "",
  style,
}: LavaLampProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ waxColor, liquidColor, speed, glow, interactive });
  live.current = { waxColor, liquidColor, speed, glow, interactive };
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-lava-lamp__canvas";
    canvas.setAttribute("aria-hidden", "true");
    el.insertBefore(canvas, el.firstChild);
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) {
      canvas.remove();
      return;
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error("[lava-lamp] shader:", gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error("[lava-lamp] link:", gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {
      res: gl.getUniformLocation(prog, "uRes"),
      time: gl.getUniformLocation(prog, "uTime"),
      glow: gl.getUniformLocation(prog, "uGlow"),
      wax: gl.getUniformLocation(prog, "uWax"),
      liquid: gl.getUniformLocation(prog, "uLiquid"),
      mouse: gl.getUniformLocation(prog, "uMouse"),
    };

    let W = 1, H = 1, time = reduce ? 14 : 3 + Math.random() * 4, last = 0, raf = 0, visible = true;
    let waxKey = "", liqKey = "";
    let wax: [number, number, number] = [1, 0.5, 0.2];
    let liq: [number, number, number] = [0.5, 0.07, 0.25];
    const m = { tx: 0, ty: 0, x: 0, y: 0, s: 0, ts: 0 };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = el.clientWidth || 300;
      H = el.clientHeight || 300;
      canvas.width = Math.max(2, Math.round(W * dpr));
      canvas.height = Math.max(2, Math.round(H * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      draw();
    };

    const draw = () => {
      if (waxKey !== live.current.waxColor) {
        waxKey = live.current.waxColor;
        wax = rgb(waxKey);
      }
      if (liqKey !== live.current.liquidColor) {
        liqKey = live.current.liquidColor;
        liq = rgb(liqKey);
      }
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.time, time);
      gl.uniform1f(U.glow, live.current.glow);
      gl.uniform3f(U.wax, wax[0], wax[1], wax[2]);
      gl.uniform3f(U.liquid, liq[0], liq[1], liq[2]);
      gl.uniform3f(U.mouse, m.x, m.y, m.s);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      time += dt * live.current.speed;
      // la burbuja del cursor se desliza con suavidad hasta donde está la mano
      const k = 1 - Math.exp(-dt * 7);
      m.x += (m.tx - m.x) * k;
      m.y += (m.ty - m.y) * k;
      m.s += (m.ts - m.s) * (1 - Math.exp(-dt * 4));
      draw();
      if (visible) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (raf || !visible || reduce) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    wakeRef.current = () => {
      draw();
      wake();
    };

    const hw = (y: number) => {
      const t = Math.min(1, Math.max(0, (y + 0.3) / 0.64));
      return 0.205 + (0.07 - 0.205) * Math.pow(t, 0.9) + 0.014 * Math.sin(t * Math.PI);
    };
    const onMove = (e: PointerEvent) => {
      if (!live.current.interactive) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left - r.width / 2) / r.height;
      const py = (r.height / 2 - (e.clientY - r.top)) / r.height;
      // la cera busca la mano, pero dentro del vidrio
      const y = Math.min(0.29, Math.max(-0.24, py));
      const lim = hw(y) - 0.05;
      m.tx = Math.min(lim, Math.max(-lim, px));
      m.ty = y;
      if (m.ts === 0) {
        m.x = m.tx;
        m.y = m.ty;
      }
      m.ts = 1;
    };
    const onLeave = () => {
      m.ts = 0;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointercancel", onLeave);

    const io = new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
      if (visible) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    io.observe(el);
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    wake();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointercancel", onLeave);
      wakeRef.current = () => {};
      gl.deleteBuffer(quad);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    wakeRef.current();
  }, [waxColor, liquidColor, speed, glow]);

  return (
    <div ref={host} className={`furin-lava-lamp ${className}`} style={style}>
      {children ? <div className="furin-lava-lamp__contenido">{children}</div> : null}
    </div>
  );
}

export default LavaLamp;
