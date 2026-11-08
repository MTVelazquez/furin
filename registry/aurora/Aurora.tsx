"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./Aurora.css";

export interface AuroraProps {
  /** Color de la cortina más baja (cualquier color CSS, sin variables). */
  color1?: string;
  /** Color de la cortina intermedia. */
  color2?: string;
  /** Color de la cortina más alta. */
  color3?: string;
  /** Color del cielo que hay detrás de las cortinas. */
  background?: string;
  /** Velocidad de la ondulación: 1 es lenta y relajada, 0 la congela. */
  speed?: number;
  /** Brillo de las cortinas: menos de 1 las apaga, más de 1 las enciende. */
  intensity?: number;
  /** Cuánto se agitan las cortinas hacia arriba y abajo. */
  amplitude?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
  /** Contenido que se dibuja encima de la aurora, centrado. */
  children?: ReactNode;
}

type Rgb = [number, number, number];

/** Valores que el bucle de dibujo lee en cada cuadro (así cambiar una prop no reinicia WebGL). */
interface LiveValues {
  colors: [Rgb, Rgb, Rgb];
  background: Rgb;
  speed: number;
  intensity: number;
  amplitude: number;
}

/** Con la aurora quieta (movimiento reducido) se muestra este instante, que es uno bonito. */
const STILL_TIME = 21;
/** La aurora es suave: más resolución que esto solo gasta batería. */
const MAX_DPR = 1.5;

// ───────────────────────── Shaders ─────────────────────────

const VERTEX_SHADER = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;
uniform float uTime;
uniform float uIntensity;
uniform float uAmplitude;
uniform vec3 uBg;
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform vec3 uColor2;

// Dirección pseudoaleatoria para cada vértice de la rejilla simplex.
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}

// Ruido simplex 2D: devuelve valores suaves entre -1 y 1.
float simplex(vec2 p) {
  const float F2 = 0.3660254;  // (sqrt(3) - 1) / 2
  const float G2 = 0.2113249;  // (3 - sqrt(3)) / 6
  vec2 cell = floor(p + (p.x + p.y) * F2);
  vec2 a = p - cell + (cell.x + cell.y) * G2;
  vec2 step1 = a.x > a.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 b = a - step1 + G2;
  vec2 c = a - 1.0 + 2.0 * G2;
  vec3 w = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
  w = w * w * w * w;
  vec3 g = vec3(
    dot(a, hash2(cell)),
    dot(b, hash2(cell + step1)),
    dot(c, hash2(cell + 1.0))
  );
  return 70.0 * dot(w, g);
}

// Ruido fractal: suma capas de simplex, cada una más fina y más débil.
float fbm(vec2 p) {
  float sum = 0.0;
  float gain = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += gain * simplex(p);
    p = p * 2.03 + vec2(11.7, 5.3);
    gain *= 0.5;
  }
  return sum;
}

// Una cortina: borde ondulante abajo, luz que se desvanece hacia arriba y rayos verticales.
float curtain(vec2 uv, float aspect, float t, float seed, float base, float reach) {
  float x = uv.x * aspect;
  float wave = fbm(vec2(x * 0.75 + seed * 7.0, t * 0.16 + seed));
  float edge = base + wave * 0.34 * uAmplitude;
  float d = uv.y - edge;

  // Debajo del borde la luz muere rápido; arriba se apaga despacio.
  float fall = d < 0.0 ? exp(d * 17.0) : exp(-d / reach);

  // Rayos: ruido muy estirado en vertical, más marcado mientras más arriba.
  float rays = simplex(vec2(x * 4.5 + wave * 1.6 + seed * 13.0, t * 0.22 + d * 0.9)) * 0.5 + 0.5;
  rays = mix(0.8, 0.12 + 1.7 * rays * rays, smoothstep(-0.02, 0.3, d));

  // Respiración lenta de toda la cortina.
  float pulse = 0.78 + 0.22 * sin(t * 0.5 + seed * 6.0);
  return fall * rays * pulse;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;

  float a0 = curtain(uv, aspect, uTime, 0.0, 0.30, 0.20);
  float a1 = curtain(uv, aspect, uTime * 1.15, 1.7, 0.47, 0.19);
  float a2 = curtain(uv, aspect, uTime * 0.85, 3.4, 0.63, 0.17);

  vec3 light = (uColor0 * a0 + uColor1 * a1 + uColor2 * a2) * uIntensity;

  // Mezcla tipo "screen": la luz suma sin pasarse de blanco y conserva el tono.
  vec3 col = 1.0 - (1.0 - uBg) * exp(-light * 1.4);

  // Ruido mínimo para que los degradados oscuros no se vean en escalones.
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dither - 0.5) / 255.0;

  gl_FragColor = vec4(col, 1.0);
}`;

// ───────────────────────── Color ─────────────────────────

let colorContext: CanvasRenderingContext2D | null = null;

/** Convierte cualquier color CSS a [r, g, b] entre 0 y 1 (el navegador hace el trabajo). */
function toRgb(color: string): Rgb {
  colorContext ??= document.createElement("canvas").getContext("2d");
  if (!colorContext) return [0, 0, 0];
  colorContext.fillStyle = "#000000";
  colorContext.fillStyle = color; // si el color no es válido se queda en negro
  const normalized = colorContext.fillStyle; // "#rrggbb" o "rgba(r, g, b, a)"
  if (normalized.startsWith("#")) {
    const n = parseInt(normalized.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const [r, g, b] = normalized.match(/[\d.]+/g)!.map(Number);
  return [r / 255, g / 255, b / 255];
}

// ───────────────────────── WebGL ─────────────────────────

interface Renderer {
  resize(width: number, height: number): void;
  draw(time: number, values: LiveValues): void;
  dispose(): void;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Crea el contexto y el programa. Devuelve null si el navegador no puede con WebGL. */
function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const options: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, stencil: false };
  const gl = (canvas.getContext("webgl", options) ?? canvas.getContext("experimental-webgl", options)) as WebGLRenderingContext | null;
  if (!gl) return null;

  const uniformNames = ["uRes", "uTime", "uIntensity", "uAmplitude", "uBg", "uColor0", "uColor1", "uColor2"] as const;
  let program: WebGLProgram | null = null;
  let uniforms = {} as Record<(typeof uniformNames)[number], WebGLUniformLocation | null>;
  let buffer: WebGLBuffer | null = null;

  /** Compila los shaders y sube un triángulo que cubre toda la pantalla. */
  const build = (): boolean => {
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    program = gl.createProgram();
    if (!vertex || !fragment || !program) return false;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;

    gl.useProgram(program);
    uniforms = Object.fromEntries(uniformNames.map((name) => [name, gl.getUniformLocation(program!, name)])) as typeof uniforms;

    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    return true;
  };

  let ready = build();
  if (!ready) return null;

  // Si el navegador pierde el contexto (p. ej. demasiados WebGL abiertos) se reconstruye al volver.
  const onLost = (event: Event) => {
    event.preventDefault();
    ready = false;
  };
  const onRestored = () => {
    ready = build();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  return {
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
    },
    draw(time, values) {
      if (!ready || gl.isContextLost()) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
      gl.uniform1f(uniforms.uTime, time);
      gl.uniform1f(uniforms.uIntensity, values.intensity);
      gl.uniform1f(uniforms.uAmplitude, values.amplitude);
      gl.uniform3fv(uniforms.uBg, values.background);
      gl.uniform3fv(uniforms.uColor0, values.colors[0]);
      gl.uniform3fv(uniforms.uColor1, values.colors[1]);
      gl.uniform3fv(uniforms.uColor2, values.colors[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      // Libera la memoria de la GPU de inmediato en lugar de esperar al recolector de basura.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

// ───────────────────────── Componente ─────────────────────────

/** Fondo de cortinas de aurora que ondulan lento (WebGL). Llena a su padre, que debe tener position: relative. */
export function Aurora({
  color1 = "#2BFFB0",
  color2 = "#2D7BFF",
  color3 = "#A45CFF",
  background = "#0B0B0F",
  speed = 1,
  intensity = 1,
  amplitude = 1,
  className = "",
  style,
  children,
}: AuroraProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // "pending": aún no se sabe si hay WebGL (el servidor y el primer render pintan el fondo estático).
  const [mode, setMode] = useState<"pending" | "webgl" | "static">("pending");
  const live = useRef<LiveValues>({ colors: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], background: [0, 0, 0], speed, intensity, amplitude });
  const redraw = useRef<() => void>(() => {});

  // Pasa las props actuales al bucle de dibujo.
  useEffect(() => {
    live.current = {
      colors: [toRgb(color1), toRgb(color2), toRgb(color3)],
      background: toRgb(background),
      speed,
      intensity,
      amplitude,
    };
    redraw.current();
  }, [color1, color2, color3, background, speed, intensity, amplitude]);

  useEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    if (!root || !host) return;

    // El canvas se crea aquí (no en el JSX) para que un nuevo montaje siempre estrene su propio contexto.
    const canvas = document.createElement("canvas");
    canvas.className = "furin-aurora__canvas";
    const renderer = createRenderer(canvas);
    if (!renderer) {
      setMode("static");
      return;
    }
    host.appendChild(canvas);
    setMode("webgl");

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let time = STILL_TIME;
    let lastNow = 0;
    let frameId = 0;
    let visible = true;

    const draw = () => renderer.draw(time, live.current);
    redraw.current = draw;

    const frame = (now: number) => {
      frameId = requestAnimationFrame(frame);
      const elapsed = Math.min((now - lastNow) / 1000, 0.1);
      lastNow = now;
      time += elapsed * live.current.speed;
      draw();
    };
    const start = () => {
      if (frameId || !visible || reducedMotion.matches) return;
      lastNow = performance.now();
      frameId = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(frameId);
      frameId = 0;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      renderer.resize(Math.max(1, Math.round(root.clientWidth * dpr)), Math.max(1, Math.round(root.clientHeight * dpr)));
      draw();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);

    // Fuera de pantalla no se gasta GPU.
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    });
    visibilityObserver.observe(root);

    const onMotionPreferenceChange = () => {
      if (reducedMotion.matches) stop();
      else start();
    };
    reducedMotion.addEventListener("change", onMotionPreferenceChange);

    resize();
    start();

    return () => {
      stop();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      reducedMotion.removeEventListener("change", onMotionPreferenceChange);
      redraw.current = () => {};
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  const colorVars = { "--furin-aurora-c1": color1, "--furin-aurora-c2": color2, "--furin-aurora-c3": color3, "--furin-aurora-bg": background } as CSSProperties;

  return (
    <div ref={rootRef} className={`furin-aurora ${className}`.trim()} style={{ ...colorVars, ...style }}>
      {/* Sin WebGL (o antes de saberlo) se ve un fondo estático con los mismos colores. */}
      {mode !== "webgl" && <div className="furin-aurora__fallback" />}
      <div ref={hostRef} className="furin-aurora__host" />
      {children !== undefined && <div className="furin-aurora__content">{children}</div>}
    </div>
  );
}

export default Aurora;
