"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./GooCursor.css";

export interface GooCursorProps {
  /** Color de la gelatina. */
  color?: string;
  /** Radio de la gota principal, en px. */
  size?: number;
  /** Cuántas gotas siguen al cursor (máx. 9). */
  drops?: number;
  /** Oculta el cursor del sistema dentro del contenedor. */
  hideCursor?: boolean;
  /** Sigue al cursor en toda la ventana en vez de solo en el contenedor. */
  global?: boolean;
  /** Se pasea solo cuando nadie mueve el cursor. */
  autoplay?: boolean;
  /** Contenido que queda debajo del cursor. */
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

const N = 10;
const VS = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

const FS = `precision highp float;
uniform vec2 uRes;
uniform float uDpr;
uniform vec3 uB[${N}];
uniform vec3 uColor;

vec3 ball(vec2 q, vec3 b){
  if (b.z < 0.2) return vec3(0.0);
  vec2 d = q - b.xy;
  float R = b.z * 2.45;
  float k = dot(d, d) / (R * R);
  if (k >= 1.0) return vec3(0.0);
  float m = 1.0 - k;
  return vec3(m * m * m, -6.0 * m * m * d / (R * R));
}

void main(){
  vec2 q = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec3 f = vec3(0.0);
  for (int i = 0; i < ${N}; i++) f += ball(q, uB[i]);
  float T = 0.46;
  float g = length(f.yz) + 1e-5;
  float edge = clamp((f.x - T) / (g / uDpr * 1.1), -1.0, 1.0) * 0.5 + 0.5;
  // aura suave alrededor de la gelatina
  float halo = smoothstep(0.0, T, f.x) * (1.0 - edge);
  if (edge < 0.003 && halo < 0.003) { gl_FragColor = vec4(0.0); return; }
  float depth = clamp((f.x - T) / 0.5, 0.0, 1.0);
  float nz = pow(depth, 0.5);
  vec2 nxy = normalize(-f.yz) * sqrt(max(1.0 - nz * nz, 0.0));
  vec3 n = vec3(nxy, nz);
  vec3 L = normalize(vec3(-0.45, -0.65, 0.62));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float diff = max(dot(n, L), 0.0);
  // la luz atraviesa la gelatina y se junta del lado opuesto
  float trans = pow(max(dot(n.xy, -L.xy) / max(length(L.xy), 1e-3), 0.0), 2.0) * (1.0 - nz * 0.5);
  vec3 body = mix(uColor * 0.50, uColor * 1.12, pow(depth, 0.7));
  vec3 col = body * (0.55 + 0.55 * diff);
  col += uColor * 0.55 * trans * (0.5 + 0.5 * depth);
  col += mix(uColor, vec3(1.0), 0.65) * pow(1.0 - nz, 2.6) * 0.55;
  float s1 = pow(max(dot(n, normalize(L + V)), 0.0), 90.0);
  float s2 = pow(max(dot(n, normalize(L + V)), 0.0), 16.0);
  col += vec3(1.0) * (s1 * 1.25 + s2 * 0.18);
  // reflejo de la ventana: pequeño punto suave arriba a la izquierda
  col += vec3(1.0) * 0.5 * pow(max(dot(n, normalize(vec3(-0.6, -0.7, 0.55))), 0.0), 40.0);
  vec4 gel = vec4(col * edge, edge);
  vec4 aura = vec4(uColor * halo * 0.20, halo * 0.20);
  gl_FragColor = gel + aura * (1.0 - gel.a);
}`;

/** Cursor de gelatina: una cadena de gotas con resortes encadenados, fundidas como metaballs con luz y brillo. */
export function GooCursor({
  color = "#4D7CFF",
  size = 14,
  drops = 8,
  hideCursor = true,
  global = false,
  autoplay = false,
  children,
  className = "",
  style,
}: GooCursorProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ color, size, drops, autoplay });
  live.current = { color, size, drops, autoplay };
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = document.createElement("canvas");
    canvas.className = `furin-goo-cursor__canvas${global ? " furin-goo-cursor__canvas--global" : ""}`;
    canvas.setAttribute("aria-hidden", "true");
    (global ? document.body : el).appendChild(canvas);
    const gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: true });
    if (!gl) {
      canvas.remove();
      return;
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error("[goo-cursor] shader:", gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error("[goo-cursor] link:", gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = { res: gl.getUniformLocation(prog, "uRes"), dpr: gl.getUniformLocation(prog, "uDpr"), b: gl.getUniformLocation(prog, "uB"), color: gl.getUniformLocation(prog, "uColor") };
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);

    // Cadena de gotas: cada una persigue a la anterior con un resorte más flojo.
    const K = [30, 24, 19, 15.5, 13, 11, 9.5, 8.2, 7, 6];
    const bx = new Float32Array(N);
    const by = new Float32Array(N);
    const buf = new Float32Array(N * 3);
    let W = 1, H = 1, dpr = 1, ox = 0, oy = 0;
    let tx = 0, ty = 0, inside = false, placed = false;
    let appear = live.current.autoplay && !reduce ? 1 : 0;
    let press = 1, pressV = 0, pressT = 1;
    let time = 0, last = 0, raf = 0, visible = true;
    let colKey = "", col: [number, number, number] = [0.3, 0.5, 1];
    let lastReal = -1e9;
    let drawn = false;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = global ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      canvas.width = Math.max(2, Math.round(W * dpr));
      canvas.height = Math.max(2, Math.round(H * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      drawn = false;
    };
    const origin = () => {
      if (global) {
        ox = 0;
        oy = 0;
      } else {
        const r = el.getBoundingClientRect();
        ox = r.left;
        oy = r.top;
      }
    };

    const draw = () => {
      if (colKey !== live.current.color) {
        colKey = live.current.color;
        col = rgb(colKey);
      }
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST);
      const R = live.current.size * appear * Math.max(0.2, press);
      if (R < 0.4) return;
      const nd = Math.max(0, Math.min(N - 1, Math.round(live.current.drops)));
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (let i = 0; i < N; i++) {
        let r = 0;
        if (i === 0) r = R;
        else if (i <= nd) {
          const dHead = Math.hypot(bx[i] - bx[0], by[i] - by[0]);
          // las gotas solo existen cuando se separan de la cabeza; pegadas, se funden con ella
          const s = Math.min(1, Math.max(0, (dHead - R * 0.15) / (R * 1.3)));
          r = R * (0.92 - i * 0.065) * s * s * (3 - 2 * s);
        }
        buf[i * 3] = bx[i];
        buf[i * 3 + 1] = by[i];
        buf[i * 3 + 2] = r;
        if (r > 0.2) {
          minX = Math.min(minX, bx[i] - r * 2.2);
          maxX = Math.max(maxX, bx[i] + r * 2.2);
          minY = Math.min(minY, by[i] - r * 2.2);
          maxY = Math.max(maxY, by[i] + r * 2.2);
        }
      }
      if (maxX < minX) return;
      const sx = Math.max(0, Math.floor(minX * dpr));
      const sy = Math.max(0, Math.floor((H - maxY) * dpr));
      const sw = Math.min(canvas.width - sx, Math.ceil((maxX - minX) * dpr) + 2);
      const sh = Math.min(canvas.height - sy, Math.ceil((maxY - minY) * dpr) + 2);
      if (sw <= 0 || sh <= 0) return;
      gl.scissor(sx, sy, sw, sh);
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.dpr, dpr);
      gl.uniform3fv(U.b, buf);
      gl.uniform3f(U.color, col[0], col[1], col[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      drawn = true;
    };

    const frame = (nowMs: number) => {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0.001, (nowMs - last) / 1000));
      last = nowMs;
      time += dt;
      const auto = live.current.autoplay && !reduce && (!inside || nowMs - lastReal > 2500);
      if (auto) {
        // paseo en ocho, para que la demo se entienda sola
        const t = time * 1.15;
        tx = W * (0.5 + 0.32 * Math.sin(t)) ;
        ty = H * (0.5 + 0.26 * Math.sin(t * 2 + 0.6));
        if (!placed) {
          for (let i = 0; i < N; i++) {
            bx[i] = tx;
            by[i] = ty;
          }
          placed = true;
        }
      }
      const show = inside || auto;
      appear += ((show ? 1 : 0) - appear) * (1 - Math.exp(-dt * (show ? 14 : 9)));
      if (Math.abs(appear - (show ? 1 : 0)) < 0.004) appear = show ? 1 : 0;
      // gelatina que rebota al presionar
      pressV += ((pressT - press) * 190 - pressV * 11) * dt;
      press += pressV * dt;
      if (reduce) {
        for (let i = 0; i < N; i++) {
          bx[i] = tx;
          by[i] = ty;
        }
      } else {
        bx[0] += (tx - bx[0]) * (1 - Math.exp(-dt * K[0]));
        by[0] += (ty - by[0]) * (1 - Math.exp(-dt * K[0]));
        for (let i = 1; i < N; i++) {
          bx[i] += (bx[i - 1] - bx[i]) * (1 - Math.exp(-dt * K[i]));
          by[i] += (by[i - 1] - by[i]) * (1 - Math.exp(-dt * K[i]));
        }
      }
      draw();
      let moving = Math.abs(press - pressT) > 0.003 || Math.abs(pressV) > 0.01 || Math.abs(appear - (show ? 1 : 0)) > 0.004;
      for (let i = 0; i < N && !moving; i++) if (Math.abs(bx[i] - tx) > 0.15 || Math.abs(by[i] - ty) > 0.15) moving = true;
      if ((moving || auto) && visible) raf = requestAnimationFrame(frame);
      else if (!show && drawn) {
        // todo quieto y escondido: deja el lienzo limpio
        gl.disable(gl.SCISSOR_TEST);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.SCISSOR_TEST);
        drawn = false;
      }
    };
    const wake = () => {
      if (raf || !visible) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    wakeRef.current = wake;

    const target: EventTarget = global ? window : el;
    const onMove = (e: Event) => {
      const pe = e as PointerEvent;
      origin();
      tx = pe.clientX - ox;
      ty = pe.clientY - oy;
      lastReal = performance.now();
      inside = true;
      if (!placed || appear < 0.05) {
        for (let i = 0; i < N; i++) {
          bx[i] = tx;
          by[i] = ty;
        }
        placed = true;
      }
      wake();
    };
    const onLeave = () => {
      inside = false;
      wake();
    };
    const onDown = (e: Event) => {
      onMove(e);
      pressT = 1.38;
      wake();
    };
    const onUp = () => {
      pressT = 1;
      wake();
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerdown", onDown);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onLeave);
    if (global) document.documentElement.addEventListener("pointerleave", onLeave);
    else el.addEventListener("pointerleave", onLeave);

    const io = new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
      if (visible) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    io.observe(el);
    const onResize = () => {
      resize();
      wake();
    };
    const ro = new ResizeObserver(onResize);
    if (global) window.addEventListener("resize", onResize);
    else ro.observe(el);
    resize();
    origin();
    if (live.current.autoplay && !reduce) wake();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerdown", onDown);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onLeave);
      if (global) document.documentElement.removeEventListener("pointerleave", onLeave);
      else el.removeEventListener("pointerleave", onLeave);
      wakeRef.current = () => {};
      gl.deleteBuffer(quad);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [global]);

  useEffect(() => {
    wakeRef.current();
  }, [color, size, drops, autoplay]);

  const cls = `furin-goo-cursor${hideCursor && !global ? " furin-goo-cursor--sin-cursor" : ""} ${className}`;
  return (
    <div ref={host} className={cls} style={style}>
      <div className="furin-goo-cursor__contenido">{children}</div>
    </div>
  );
}

export default GooCursor;
