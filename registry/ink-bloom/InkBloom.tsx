"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./InkBloom.css";

export interface InkBloomProps {
  /** Colores de las gotas (se usan hasta tres); se reparten en ciclo. */
  colors?: string[];
  /** Velocidad con la que florece la tinta. */
  speed?: number;
  /** Brillo y cantidad de tinta. */
  intensity?: number;
  /** El cursor agita el agua y un clic suelta una gota. */
  interactive?: boolean;
  /** Contenido opcional encima del agua. */
  children?: ReactNode;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const DEFAULT_COLORS = ["#2E5BFF", "#18E0C2", "#FF7A3C"];

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
uniform float uTime, uInt;
uniform vec3 uC0, uC1, uC2, uClickCol;
uniform vec4 uClick;
uniform sampler2D uDisp;

float hash(float n){ return fract(sin(n * 127.1 + 3.7) * 43758.5453); }
float h2(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = m * p; a *= 0.5; }
  return s;
}

// x = densidad de tinta, y = nervadura (hebras finas)
vec2 drop(vec2 p, vec2 c, float age, float seed, float life){
  vec2 d = p - c;
  float a = age;
  float grow = 1.0 - exp(-a * 0.42);
  float R = 0.05 + 0.31 * grow;
  float rr = length(d);
  if (rr > R * 2.7) return vec2(0.0);
  // remolino: la tinta se enrolla más con el tiempo y el radio
  float ang = (0.7 + 0.9 * hash(seed)) * sin(rr * 8.0 - a * 0.7 + seed * 6.0) * (1.0 - exp(-a * 0.6)) * exp(-rr * 1.5);
  float cs = cos(ang), sn = sin(ang);
  vec2 q = mat2(cs, -sn, sn, cs) * d;
  float wa = 0.10 + 0.60 * grow;
  vec2 w = vec2(fbm(q * 3.0 + seed * 13.0 + a * 0.10), fbm(q * 3.0 + seed * 7.0 + 4.7 - a * 0.08)) - 0.5;
  q += w * wa * R * 2.4;
  float r = length(q) / R;
  float rag = (fbm(q * 5.5 + seed * 3.0) - 0.5) * (0.25 + 0.55 * grow);
  float body = 1.0 - smoothstep(0.50, 1.05, r + rag);
  float ridge = 1.0 - abs(2.0 * fbm(q * 10.0 + seed * 5.0 + a * 0.05) - 1.0);
  ridge = pow(ridge, 2.2);
  // al principio la gota es un núcleo denso; luego se abre en velos
  float core = (1.0 - smoothstep(0.0, 0.9, r)) * (1.0 - smoothstep(0.0, 2.2, a));
  float dens = body * (0.22 + 0.85 * ridge) * (1.0 - 0.45 * grow) + core * 0.50;
  float fade = smoothstep(0.0, 0.25, a) * (1.0 - smoothstep(0.52 * life, life, a));
  return vec2(dens * fade, ridge * body * fade);
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec4 dp = texture2D(uDisp, uv);
  vec2 disp = (dp.rg - 0.5) * 2.0 * 0.24;
  vec2 p = (uv - disp - 0.5) * vec2(asp, 1.0);

  // agua: fondo profundo con un poco de luz desde arriba
  vec3 col = vec3(0.012, 0.020, 0.034) + vec3(0.015, 0.035, 0.065) * (1.0 - length((uv - vec2(0.5, 0.62)) * vec2(1.0, 1.1)) * 1.25);
  float caustic = fbm(p * 2.2 + vec2(uTime * 0.03, -uTime * 0.02));
  col += vec3(0.01, 0.025, 0.04) * smoothstep(0.45, 0.8, caustic);

  float P = 3.3;
  float LIFE = P * 3.0;
  vec3 ink = vec3(0.0);
  float shine = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float tt = uTime - fk * P;
    float cyc = floor(tt / LIFE);
    float age = tt - cyc * LIFE;
    float id = cyc * 3.0 + fk;
    float seed = hash(id + 1.0);
    vec2 c = vec2((hash(id * 3.1 + 5.0) - 0.5) * 0.70 * asp, (hash(id * 7.7 + 2.0) - 0.5) * 0.62);
    float ci = mod(floor(id), 3.0);
    vec3 cc = ci < 0.5 ? uC0 : (ci < 1.5 ? uC1 : uC2);
    vec2 r = drop(p, c, age, seed, LIFE);
    ink += cc * r.x;
    shine += r.y * r.x;
  }
  if (uClick.w > 0.5) {
    float age = uTime - uClick.z;
    if (age > 0.0 && age < LIFE) {
      vec2 r = drop(p, uClick.xy * vec2(asp, 1.0), age, hash(uClick.z * 9.0), LIFE);
      ink += uClickCol * r.x;
      shine += r.y * r.x;
    }
  }
  col += ink * 1.0 * uInt;
  col += vec3(0.75, 0.9, 1.0) * pow(clamp(shine, 0.0, 1.0), 2.0) * 0.16 * uInt;
  col = col / (1.0 + max(col - 0.75, 0.0) * 1.1);
  col *= 1.0 - 0.45 * dot(uv - 0.5, uv - 0.5) * 2.0;
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 160.0;
  gl_FragColor = vec4(col, 1.0);
}`;

const GW = 64;

/** Tinta en agua: gotas que se abren en núcleos, velos y remolinos; el cursor agita el agua y un clic suelta otra gota. */
export function InkBloom({
  colors = DEFAULT_COLORS,
  speed = 1,
  intensity = 1,
  interactive = true,
  children,
  className = "",
  style,
}: InkBloomProps) {
  const host = useRef<HTMLDivElement>(null);
  const colorsKey = colors.join("|");
  const live = useRef({ colors, speed, intensity, interactive });
  live.current = { colors, speed, intensity, interactive };
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-ink-bloom__canvas";
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
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error("[ink-bloom] shader:", gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error("[ink-bloom] link:", gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const U = { res: u("uRes"), time: u("uTime"), int: u("uInt"), c0: u("uC0"), c1: u("uC1"), c2: u("uC2"), clickCol: u("uClickCol"), click: u("uClick"), disp: u("uDisp") };
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.uniform1i(U.disp, 0);

    const palette = (): [number, number, number][] => {
      const list = live.current.colors.length ? live.current.colors : DEFAULT_COLORS;
      return [0, 1, 2].map((i) => rgb(list[i % list.length]));
    };
    let pal = palette();
    let palKey = colorsKey;

    let W = 1, H = 1, GH = 40;
    let dx = new Float32Array(GW * GH);
    let dy = new Float32Array(GW * GH);
    let tmp = new Float32Array(GW * GH);
    let bytes = new Uint8Array(GW * GH * 4);
    let time = reduce ? 9 : 5 + Math.random() * 3;
    let last = 0, raf = 0, visible = true;
    let clickCount = 0;
    const click = { x: 0.5, y: 0.5, t: 0, on: 0, col: [1, 1, 1] as [number, number, number] };
    const ptr = { x: 0, y: 0, has: false };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = el.clientWidth || 300;
      H = el.clientHeight || 300;
      const scale = 0.8;
      canvas.width = Math.max(2, Math.round(W * dpr * scale));
      canvas.height = Math.max(2, Math.round(H * dpr * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      GH = Math.max(16, Math.round((GW * H) / W));
      dx = new Float32Array(GW * GH);
      dy = new Float32Array(GW * GH);
      tmp = new Float32Array(GW * GH);
      bytes = new Uint8Array(GW * GH * 4);
      draw();
    };

    const draw = () => {
      if (palKey !== live.current.colors.join("|")) {
        palKey = live.current.colors.join("|");
        pal = palette();
      }
      const MAX = 0.24;
      for (let i = 0; i < GW * GH; i++) {
        bytes[i * 4] = Math.round((Math.max(-1, Math.min(1, dx[i] / MAX)) * 0.5 + 0.5) * 255);
        bytes[i * 4 + 1] = Math.round((Math.max(-1, Math.min(1, dy[i] / MAX)) * 0.5 + 0.5) * 255);
        bytes[i * 4 + 2] = 0;
        bytes[i * 4 + 3] = 255;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.time, time);
      gl.uniform1f(U.int, live.current.intensity);
      gl.uniform3f(U.c0, pal[0][0], pal[0][1], pal[0][2]);
      gl.uniform3f(U.c1, pal[1][0], pal[1][1], pal[1][2]);
      gl.uniform3f(U.c2, pal[2][0], pal[2][1], pal[2][2]);
      gl.uniform3f(U.clickCol, click.col[0], click.col[1], click.col[2]);
      gl.uniform4f(U.click, click.x - 0.5, click.y - 0.5, click.t, click.on);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const relax = (dt: number) => {
      const k = Math.exp(-dt / 2.2);
      for (const arr of [dx, dy]) {
        for (let j = 0; j < GH; j++) {
          for (let i = 0; i < GW; i++) {
            const o = j * GW + i;
            const l = arr[j * GW + Math.max(i - 1, 0)];
            const r = arr[j * GW + Math.min(i + 1, GW - 1)];
            const up = arr[Math.max(j - 1, 0) * GW + i];
            const dn = arr[Math.min(j + 1, GH - 1) * GW + i];
            tmp[o] = (arr[o] * 0.6 + (l + r + up + dn) * 0.1) * k;
          }
        }
        arr.set(tmp);
      }
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      time += dt * live.current.speed;
      relax(dt);
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

    const push = (cx: number, cy: number, mx: number, my: number) => {
      const sigma = 0.13;
      const sx = sigma * (H / W) * GW;
      const sy = sigma * GH;
      const reachX = Math.ceil(sx * 2.4);
      const reachY = Math.ceil(sy * 2.4);
      const ci = Math.floor(cx * GW);
      const cj = Math.floor(cy * GH);
      for (let j = Math.max(0, cj - reachY); j <= Math.min(GH - 1, cj + reachY); j++) {
        for (let i = Math.max(0, ci - reachX); i <= Math.min(GW - 1, ci + reachX); i++) {
          const nx = ((i + 0.5 - cx * GW) / sx) ** 2;
          const ny = ((j + 0.5 - cy * GH) / sy) ** 2;
          const w = Math.exp(-(nx + ny) * 0.5);
          const rx = (i + 0.5) / GW - cx;
          const ry = (j + 0.5) / GH - cy;
          // remolino: el agua gira alrededor del trazo, con sentidos opuestos a cada lado
          const side = Math.sign(mx * ry - my * rx) || 0;
          const o = j * GW + i;
          dx[o] += w * (mx * 1.2 + -my * side * 1.15);
          dy[o] += w * (my * 1.2 + mx * side * 1.15);
        }
      }
      for (let i = 0; i < dx.length; i++) {
        dx[i] = Math.max(-0.24, Math.min(0.24, dx[i]));
        dy[i] = Math.max(-0.24, Math.min(0.24, dy[i]));
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!live.current.interactive) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      if (ptr.has) {
        const mx = x - ptr.x;
        const my = y - ptr.y;
        const steps = Math.min(6, Math.max(1, Math.ceil(Math.hypot(mx * W, my * H) / 24)));
        for (let s = 1; s <= steps; s++) push(ptr.x + (mx * s) / steps, ptr.y + (my * s) / steps, mx / steps, my / steps);
      }
      ptr.x = x;
      ptr.y = y;
      ptr.has = true;
      wake();
    };
    const onDown = (e: PointerEvent) => {
      if (!live.current.interactive) return;
      const r = el.getBoundingClientRect();
      click.x = (e.clientX - r.left) / r.width;
      click.y = 1 - (e.clientY - r.top) / r.height;
      click.t = time;
      click.on = 1;
      click.col = pal[clickCount++ % 3];
      wake();
    };
    const onLeave = () => {
      ptr.has = false;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
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
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointercancel", onLeave);
      wakeRef.current = () => {};
      gl.deleteTexture(tex);
      gl.deleteBuffer(quad);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    wakeRef.current();
  }, [colorsKey, speed, intensity]);

  return (
    <div ref={host} className={`furin-ink-bloom ${className}`} style={style}>
      {children ? <div className="furin-ink-bloom__contenido">{children}</div> : null}
    </div>
  );
}

export default InkBloom;
