"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./InkTrail.css";

export interface InkTrailProps {
  /** Color de la tinta. */
  color?: string;
  /** Color del brillo húmedo sobre la tinta. */
  sheen?: string;
  /** Grosor del trazo. */
  size?: number;
  /** Segundos que tarda la tinta en secarse y desaparecer. */
  lifetime?: number;
  /** Dibuja solo un trazo cuando nadie mueve el cursor. */
  autoplay?: boolean;
  /** Contenido opcional debajo de la estela. */
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
uniform sampler2D uD;
uniform vec2 uRes, uTexel;
uniform vec3 uInk, uSheen;
uniform float uAsp;

float h2(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float D(vec2 p){ return texture2D(uD, p).r; }

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 t = vec2(uv.x, 1.0 - uv.y);
  float d = D(t);
  vec2 q5 = uTexel * 5.0;
  float fresh = max(max(D(t + vec2(q5.x, 0.0)), D(t - vec2(q5.x, 0.0))), max(D(t + vec2(0.0, q5.y)), D(t - vec2(0.0, q5.y))));
  fresh = max(fresh, d);
  float old = 1.0 - smoothstep(0.5, 0.95, fresh);
  // al secarse, el borde se come con ruido y la tinta se vuelve agua: hebras translúcidas
  float n = noise(uv * vec2(uAsp, 1.0) * 26.0) * 0.6 + noise(uv * vec2(uAsp, 1.0) * 70.0) * 0.4 - 0.5;
  float thr = 0.42 + n * (0.07 + 0.12 * old);
  float sw = 0.035 + 0.09 * old;
  float cov = smoothstep(thr - sw, thr + sw, d);
  float body = mix(0.97, 0.30, old);
  // sombra de contacto sobre el papel
  vec2 off = vec2(1.5, 2.5) * uTexel;
  float sh = smoothstep(0.25, 0.7, D(t - off) ) * 0.14;
  if (cov < 0.004 && sh < 0.004) { gl_FragColor = vec4(0.0); return; }
  vec2 e = uTexel * 1.6;
  float gx = D(t + vec2(e.x, 0.0)) - D(t - vec2(e.x, 0.0));
  float gy = D(t + vec2(0.0, e.y)) - D(t - vec2(0.0, e.y));
  vec3 nrm = normalize(vec3(-gx * 2.4, gy * 2.4, 1.0));
  vec3 L = normalize(vec3(-0.5, 0.6, 0.65));
  float wet = smoothstep(0.55, 1.0, d);
  float spec = pow(max(dot(nrm, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 38.0) * (0.35 + 0.65 * wet);
  float rim = 1.0 - smoothstep(0.0, 0.16, d - thr);
  vec3 col = uInk * (0.92 + 0.25 * (1.0 - wet));
  col += uSheen * (spec * 0.75 + rim * 0.08 * wet);
  col += vec3(1.0) * pow(spec, 2.0) * 0.28;
  float al = cov * body;
  gl_FragColor = vec4(col * al, max(al, sh));
}`;

interface Pt { x: number; y: number; r: number; born: number; life: number }

/** Estela de tinta: trazo húmedo y brillante que se ensancha, se deshace en hebras y se seca. */
export function InkTrail({
  color = "#12162B",
  sheen = "#9DB4FF",
  size = 1,
  lifetime = 1.9,
  autoplay = false,
  children,
  className = "",
  style,
}: InkTrailProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ color, sheen, size, lifetime, autoplay });
  live.current = { color, sheen, size, lifetime, autoplay };
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = document.createElement("canvas");
    canvas.className = "furin-ink-trail__canvas";
    canvas.setAttribute("aria-hidden", "true");
    el.appendChild(canvas);
    const gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: true });
    if (!gl) {
      canvas.remove();
      return;
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error("[ink-trail] shader:", gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error("[ink-trail] link:", gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const U = { d: u("uD"), res: u("uRes"), texel: u("uTexel"), ink: u("uInk"), sheen: u("uSheen"), asp: u("uAsp") };
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(U.d, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Sprite suave de una gota de tinta; se acumula con "lighter" para formar el cuerpo del trazo.
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 64;
    {
      const sc = sprite.getContext("2d")!;
      const g = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.45, "rgba(255,255,255,0.9)");
      g.addColorStop(0.8, "rgba(255,255,255,0.25)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      sc.fillStyle = g;
      sc.fillRect(0, 0, 64, 64);
    }
    const dcv = document.createElement("canvas");
    const dctx = dcv.getContext("2d")!;

    const pts: Pt[] = [];
    let W = 1, H = 1, dW = 1, dH = 1;
    let time = 0, last = 0, raf = 0, visible = true;
    let ink = rgb(color), shn = rgb(sheen);
    let inkKey = color, shnKey = sheen;
    const ptr = { x: 0, y: 0, t: 0, has: false, r: 7, lastReal: -1e9 };
    let ap = 0; // fase del trazo automático
    let apPos: { x: number; y: number } | null = null;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = el.clientWidth || 300;
      H = el.clientHeight || 300;
      canvas.width = Math.max(2, Math.round(W * dpr));
      canvas.height = Math.max(2, Math.round(H * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      dW = Math.max(2, Math.ceil(W / 2));
      dH = Math.max(2, Math.ceil(H / 2));
      dcv.width = dW;
      dcv.height = dH;
      draw();
    };

    const draw = () => {
      if (inkKey !== live.current.color) {
        inkKey = live.current.color;
        ink = rgb(inkKey);
      }
      if (shnKey !== live.current.sheen) {
        shnKey = live.current.sheen;
        shn = rgb(shnKey);
      }
      dctx.setTransform(1, 0, 0, 1, 0, 0);
      dctx.globalCompositeOperation = "source-over";
      dctx.clearRect(0, 0, dW, dH);
      dctx.fillStyle = "#000";
      dctx.fillRect(0, 0, dW, dH);
      dctx.globalCompositeOperation = "lighter";
      for (const p of pts) {
        const f = (time - p.born) / p.life;
        if (f >= 1) continue;
        // la tinta fresca es densa; al secarse pierde cuerpo y se ensancha un poco, como si sangrara
        const a = Math.pow(1 - f, 0.9);
        const rr = p.r * (1 + 0.5 * f) * 2.3;
        dctx.globalAlpha = Math.min(1, a * 0.46);
        dctx.drawImage(sprite, (p.x - rr) / 2, (p.y - rr) / 2, rr, rr);
      }
      dctx.globalAlpha = 1;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, dcv);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform2f(U.texel, 1 / dW, 1 / dH);
      gl.uniform3f(U.ink, ink[0], ink[1], ink[2]);
      gl.uniform3f(U.sheen, shn[0], shn[1], shn[2]);
      gl.uniform1f(U.asp, canvas.width / canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const life = () => (reduce ? Math.min(live.current.lifetime, 0.6) : live.current.lifetime);

    const stroke = (x: number, y: number, tNow: number) => {
      if (!ptr.has) {
        ptr.x = x;
        ptr.y = y;
        ptr.t = tNow;
        ptr.has = true;
        pts.push({ x, y, r: Math.max(2.2, ptr.r) * live.current.size, born: time, life: life() });
        return;
      }
      const dx = x - ptr.x;
      const dy = y - ptr.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.5) return;
      const dtMs = Math.max(1, tNow - ptr.t);
      const v = dist / dtMs; // px/ms
      // rápido = trazo fino, lento = trazo grueso (como un pincel cargado)
      const target = 9.5 - Math.min(v * 3.0, 6.0);
      const steps = Math.max(1, Math.ceil(dist / 2.2));
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        ptr.r += (target - ptr.r) * 0.12;
        const jitter = 1 + (Math.random() - 0.5) * 0.08;
        pts.push({ x: ptr.x + dx * k, y: ptr.y + dy * k, r: Math.max(2.0, ptr.r) * live.current.size * jitter, born: time, life: life() });
      }
      // salpicaduras en los movimientos rápidos
      if (v > 1.1 && Math.random() < 0.55) {
        const nx = -dy / dist;
        const ny = dx / dist;
        const off = (Math.random() - 0.5) * 34;
        pts.push({ x: x + nx * off, y: y + ny * off, r: (1.2 + Math.random() * 2.2) * live.current.size, born: time, life: life() * 0.7 });
      }
      ptr.x = x;
      ptr.y = y;
      ptr.t = tNow;
      if (pts.length > 900) pts.splice(0, pts.length - 900);
    };

    const autoStep = (dt: number) => {
      ap += dt;
      const t = ap * 1.25;
      const x = W * (0.5 + 0.36 * Math.sin(t * 0.9 + 0.6 * Math.sin(t * 0.37)));
      const y = H * (0.5 + 0.30 * Math.sin(t * 1.35 + 1.1));
      const now = performance.now();
      if (apPos) stroke(x, y, now);
      else {
        ptr.has = false;
        stroke(x, y, now);
      }
      apPos = { x, y };
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      time += dt;
      const realIdle = performance.now() - ptr.lastReal > 1800;
      if (live.current.autoplay && !reduce && realIdle) autoStep(dt);
      else apPos = null;
      while (pts.length && time - pts[0].born >= pts[0].life) pts.shift();
      draw();
      const active = pts.length > 0 || (live.current.autoplay && !reduce);
      if (active && visible) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (raf || !visible) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    wakeRef.current = () => {
      draw();
      wake();
    };

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ptr.lastReal = performance.now();
      if (apPos) {
        apPos = null;
        ptr.has = false;
      }
      stroke(e.clientX - r.left, e.clientY - r.top, e.timeStamp);
      wake();
    };
    const onLeave = () => {
      ptr.has = false;
      ptr.r = 7;
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
    if (live.current.autoplay && !reduce) wake();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onMove);
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
  }, [color, sheen, size, lifetime, autoplay]);

  return (
    <div ref={host} className={`furin-ink-trail ${className}`} style={style}>
      {children ? <div className="furin-ink-trail__contenido">{children}</div> : null}
    </div>
  );
}

export default InkTrail;
