"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./SmokeField.css";

export interface SmokeFieldProps {
  /** Color del humo iluminado. */
  color?: string;
  /** Color de la luz de contraluz desde abajo. */
  glowColor?: string;
  /** Qué tan espeso es el humo. */
  density?: number;
  /** Velocidad con la que sube. */
  speed?: number;
  /** El cursor aparta y arremolina el humo. */
  interactive?: boolean;
  /** Contenido opcional encima del humo. */
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
uniform float uTime, uDensity;
uniform sampler2D uDisp;
uniform vec3 uColor, uGlow;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = m * p; a *= 0.5; }
  return s;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec4 d = texture2D(uDisp, uv);
  vec2 disp = (d.rg - 0.5) * 2.0 * 0.24;
  float hole = d.b;
  vec2 p = (uv - disp) * vec2(asp, 1.0) * 2.1;
  float t = uTime;
  p.y -= t * 0.14;
  p.x += 0.12 * sin(t * 0.11 + uv.y * 2.0);
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.04)), fbm(p + vec2(5.2, 1.3) - t * 0.03));
  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + 0.11 * t), fbm(p + 3.0 * q + vec2(8.3, 2.8) + 0.09 * t));
  vec2 pp = p + 3.0 * r;
  float f = fbm(pp);
  float e = 0.05;
  float fx = fbm(pp + vec2(e, 0.0));
  float fy = fbm(pp + vec2(0.0, e));
  vec2 g = vec2(fx - f, fy - f) / e;

  float dens = pow(smoothstep(0.24, 0.80, f), 1.05) * uDensity;
  // más espeso abajo, más ralo arriba y hacia los lados
  dens *= 0.62 + 0.8 * (1.0 - uv.y);
  dens *= smoothstep(1.35, 0.25, length((uv - vec2(0.5, 0.45)) * vec2(1.0, 1.15)));
  dens *= 1.0 - hole * 0.8;
  dens = clamp(dens, 0.0, 1.0);

  vec3 n = normalize(vec3(-g * 0.17, 1.0));
  vec3 L = normalize(vec3(-0.45, 0.75, 0.55));
  float lit = clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0);
  vec3 shade = vec3(0.075, 0.09, 0.14);
  vec3 smoke = mix(shade, uColor, smoothstep(0.25, 0.95, lit));
  // contraluz cálido desde abajo, solo en los bordes que miran hacia abajo
  float under = clamp(-n.y * 1.2 + 0.25, 0.0, 1.0) * (1.0 - uv.y);
  smoke += uGlow * under * 0.55 * dens;
  smoke += uColor * pow(clamp(length(g) * 0.12, 0.0, 1.0), 2.0) * 0.30;

  vec3 bg = vec3(0.022, 0.026, 0.038) + uGlow * 0.05 * exp(-uv.y * 3.2) * (1.0 - abs(uv.x - 0.5));
  vec3 col = bg + smoke * dens * 1.12;
  col *= 1.0 - 0.30 * dot(uv - 0.5, uv - 0.5) * 2.0;
  col = col / (1.0 + max(col - 0.70, 0.0) * 1.2);
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 160.0;
  gl_FragColor = vec4(col, 1.0);
}`;

const GW = 64;

/** Humo volumétrico: fbm con dominio deformado y luz de estudio; el cursor lo aparta y lo arremolina. */
export function SmokeField({
  color = "#BFD0FF",
  glowColor = "#FF8A4A",
  density = 1,
  speed = 1,
  interactive = true,
  children,
  className = "",
  style,
}: SmokeFieldProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ color, glowColor, density, speed, interactive });
  live.current = { color, glowColor, density, speed, interactive };
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-smoke-field__canvas";
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
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error("[smoke-field] shader:", gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error("[smoke-field] link:", gl.getProgramInfoLog(prog));
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
      density: gl.getUniformLocation(prog, "uDensity"),
      color: gl.getUniformLocation(prog, "uColor"),
      glow: gl.getUniformLocation(prog, "uGlow"),
      disp: gl.getUniformLocation(prog, "uDisp"),
    };
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.uniform1i(U.disp, 0);

    let W = 1, H = 1, GH = 40;
    let dx = new Float32Array(GW * GH);
    let dy = new Float32Array(GW * GH);
    let hl = new Float32Array(GW * GH);
    let tmp = new Float32Array(GW * GH);
    let bytes = new Uint8Array(GW * GH * 4);
    let time = reduce ? 31 : 22 + Math.random() * 10;
    let last = 0, raf = 0, visible = true;
    let colKey = "", glowKey = "";
    let col: [number, number, number] = [0.75, 0.82, 1];
    let glo: [number, number, number] = [1, 0.54, 0.29];
    const ptr = { x: 0, y: 0, has: false };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = el.clientWidth || 300;
      H = el.clientHeight || 300;
      const scale = 0.78;
      canvas.width = Math.max(2, Math.round(W * dpr * scale));
      canvas.height = Math.max(2, Math.round(H * dpr * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      GH = Math.max(16, Math.round((GW * H) / W));
      dx = new Float32Array(GW * GH);
      dy = new Float32Array(GW * GH);
      hl = new Float32Array(GW * GH);
      tmp = new Float32Array(GW * GH);
      bytes = new Uint8Array(GW * GH * 4);
      draw();
    };

    const upload = () => {
      const MAX = 0.24;
      for (let i = 0; i < GW * GH; i++) {
        bytes[i * 4] = Math.round((Math.max(-1, Math.min(1, dx[i] / MAX)) * 0.5 + 0.5) * 255);
        bytes[i * 4 + 1] = Math.round((Math.max(-1, Math.min(1, dy[i] / MAX)) * 0.5 + 0.5) * 255);
        bytes[i * 4 + 2] = Math.round(Math.min(1, hl[i]) * 255);
        bytes[i * 4 + 3] = 255;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    };

    const draw = () => {
      if (colKey !== live.current.color) {
        colKey = live.current.color;
        col = rgb(colKey);
      }
      if (glowKey !== live.current.glowColor) {
        glowKey = live.current.glowColor;
        glo = rgb(glowKey);
      }
      upload();
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.time, time);
      gl.uniform1f(U.density, live.current.density);
      gl.uniform3f(U.color, col[0], col[1], col[2]);
      gl.uniform3f(U.glow, glo[0], glo[1], glo[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    // El humo desplazado vuelve a su sitio poco a poco, y se difunde para no verse a cuadros.
    const relax = (dt: number) => {
      const k = Math.exp(-dt / 1.9);
      for (const arr of [dx, dy, hl]) {
        for (let j = 0; j < GH; j++) {
          for (let i = 0; i < GW; i++) {
            const o = j * GW + i;
            const l = arr[j * GW + Math.max(i - 1, 0)];
            const r = arr[j * GW + Math.min(i + 1, GW - 1)];
            const u = arr[Math.max(j - 1, 0) * GW + i];
            const d = arr[Math.min(j + 1, GH - 1) * GW + i];
            tmp[o] = (arr[o] * 0.6 + (l + r + u + d) * 0.1) * k;
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
      // cx, cy en [0,1] (y hacia arriba); mx, my = movimiento en unidades de uv
      const speed = Math.hypot(mx, my);
      if (speed < 1e-5) return;
      const sigma = 0.12; // en alturas de la caja
      const sx = sigma * (H / W) * GW;
      const sy = sigma * GH;
      const reachX = Math.ceil(sx * 2.4);
      const reachY = Math.ceil(sy * 2.4);
      const ci = Math.floor(cx * GW);
      const cj = Math.floor(cy * GH);
      for (let j = Math.max(0, cj - reachY); j <= Math.min(GH - 1, cj + reachY); j++) {
        for (let i = Math.max(0, ci - reachX); i <= Math.min(GW - 1, ci + reachX); i++) {
          const rx = (i + 0.5) / GW - cx;
          const ry = (j + 0.5) / GH - cy;
          const nx = ((i + 0.5 - cx * GW) / sx) ** 2;
          const ny = ((j + 0.5 - cy * GH) / sy) ** 2;
          const w = Math.exp(-(nx + ny) * 0.5);
          // el humo acompaña al cursor y se abre a ambos lados de su camino
          const side = Math.sign(mx * ry - my * rx) || 0;
          const o = j * GW + i;
          dx[o] += w * (mx * 1.5 + -my * side * 1.1);
          dy[o] += w * (my * 1.5 + mx * side * 1.1);
          hl[o] += w * Math.min(speed * 18, 0.35);
        }
      }
      for (let i = 0; i < dx.length; i++) {
        if (dx[i] > 0.24) dx[i] = 0.24;
        else if (dx[i] < -0.24) dx[i] = -0.24;
        if (dy[i] > 0.24) dy[i] = 0.24;
        else if (dy[i] < -0.24) dy[i] = -0.24;
        if (hl[i] > 1) hl[i] = 1;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!live.current.interactive) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      if (ptr.has) {
        // reparte el movimiento en pasos cortos para que el trazo sea continuo
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
    const onLeave = () => {
      ptr.has = false;
    };
    el.addEventListener("pointermove", onMove);
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
  }, [color, glowColor, density, speed]);

  return (
    <div ref={host} className={`furin-smoke-field ${className}`} style={style}>
      {children ? <div className="furin-smoke-field__contenido">{children}</div> : null}
    </div>
  );
}

export default SmokeField;
