"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./Estanque.css";

export interface EstanqueProps {
  /** Color del agua (cualquier color CSS, sin variables). */
  color?: string;
  /** Color de la luz que se refleja en las ondas. */
  lightColor?: string;
  /** Viscosidad: 0 es agua que no deja de ondular, 1 es aceite que apaga las ondas enseguida. */
  viscosity?: number;
  /** Gotas que caen solas por segundo; 0 deja el agua quieta hasta que la toques. */
  dropRate?: number;
  /** Fuerza de las ondas que deja el cursor; 0 las apaga. */
  cursorForce?: number;
  /** Si es true, una cuadrícula bajo el agua se deforma con las ondas (refracción). */
  grid?: boolean;
  /** Separación de la cuadrícula en px. */
  gridSize?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
  /** Contenido que se dibuja encima del agua, centrado. */
  children?: ReactNode;
}

type Rgb = [number, number, number];

/** Valores que el bucle lee en cada cuadro (así cambiar una prop no reinicia WebGL). */
interface LiveValues {
  water: Rgb;
  light: Rgb;
  /** Cuánto de la onda sobrevive en cada paso de la simulación (0 a 1). */
  damping: number;
  dropRate: number;
  cursorForce: number;
  /** Separación de la cuadrícula en px; 0 si está apagada. */
  gridSize: number;
}

const MAX_DPR = 1.5;
/** Tamaño de cada celda de la simulación en px: más grande es más barato, más chico es más fino. */
const CELL_SIZE = 2.6;
const MAX_SIMULATION_SIDE = 520;
/** Pasos de simulación por segundo, iguales en cualquier pantalla. */
const STEPS_PER_SECOND = 80;
/** Cuántas gotas caben en un solo paso de la simulación. */
const MAX_DROPS = 8;
const MAX_QUEUED_DROPS = 48;

// ───────────────────────── Shaders ─────────────────────────

const VERTEX_SHADER = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/**
 * Un paso de la simulación. La textura guarda por cada punto del agua:
 * r = altura, g = velocidad vertical, b y a = inclinación de la superficie (para el sombreado).
 */
const UPDATE_SHADER = `${PRECISION}
#define MAX_DROPS ${MAX_DROPS}
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uDamping;
uniform vec4 uDrops[MAX_DROPS]; // x, y (0 a 1), radio en celdas, fuerza
varying vec2 vUv;

void main() {
  vec4 here = texture2D(uState, vUv);
  float left = texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r;
  float right = texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r;
  float down = texture2D(uState, vUv - vec2(0.0, uTexel.y)).r;
  float up = texture2D(uState, vUv + vec2(0.0, uTexel.y)).r;

  // Ecuación de onda: el punto se acelera hacia el promedio de sus vecinos.
  float average = (left + right + up + down) * 0.25;
  float velocity = here.g + (average - here.r) * 1.8;

  // En los bordes el agua amortigua más: así las ondas no rebotan contra el marco.
  float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  velocity *= uDamping * mix(0.9, 1.0, smoothstep(0.0, 0.04, edge));
  // Un poco de difusión apaga las ondas más finas, que en una rejilla tan gruesa solo se verían como ruido.
  float height = mix(here.r + velocity, average, 0.04);

  // Gotas y toques del cursor: una joroba suave (coseno) alrededor de su centro.
  for (int i = 0; i < MAX_DROPS; i++) {
    vec4 drop = uDrops[i];
    if (drop.w != 0.0) {
      float cells = length((vUv - drop.xy) / uTexel);
      float falloff = max(0.0, 1.0 - cells / drop.z);
      height += drop.w * (0.5 - 0.5 * cos(falloff * 3.14159265));
    }
  }

  gl_FragColor = vec4(height, velocity, (right - left) * 0.5, (up - down) * 0.5);
}`;

const DISPLAY_SHADER = `${PRECISION}
uniform sampler2D uState;
uniform vec2 uSimSize;
uniform vec3 uWater;
uniform vec3 uLight;
uniform float uGridCell;   // separación de la cuadrícula en píxeles del canvas; 0 = sin cuadrícula
uniform float uPixelRatio;
varying vec2 vUv;

// La simulación es de baja resolución: se interpola a mano (las texturas float no siempre filtran).
vec4 stateAt(vec2 uv) {
  vec2 point = uv * uSimSize - 0.5;
  vec2 mixAmount = fract(point);
  vec2 base = (floor(point) + 0.5) / uSimSize;
  vec2 dx = vec2(1.0 / uSimSize.x, 0.0);
  vec2 dy = vec2(0.0, 1.0 / uSimSize.y);
  return mix(
    mix(texture2D(uState, base), texture2D(uState, base + dx), mixAmount.x),
    mix(texture2D(uState, base + dy), texture2D(uState, base + dx + dy), mixAmount.x),
    mixAmount.y
  );
}

void main() {
  vec2 uv = vUv;
  vec2 slope = stateAt(uv).zw * 4.5;
  vec3 normal = normalize(vec3(-slope, 1.0));

  // Agua: algo más clara arriba (cielo) que abajo (fondo).
  vec3 color = uWater * mix(0.62, 1.14, uv.y);

  // Luz desde arriba a la izquierda: las pendientes que miran a ella se aclaran y las otras se oscurecen.
  vec3 lightDirection = normalize(vec3(-0.45, 0.6, 0.66));
  color *= 1.0 + (dot(normal, lightDirection) - lightDirection.z) * 3.6;

  // Reflejo especular (destellos en las crestas) y un brillo suave en las pendientes fuertes.
  vec3 halfway = normalize(lightDirection + vec3(0.0, 0.0, 1.0));
  float glint = pow(max(dot(normal, halfway), 0.0), 70.0);
  color += uLight * glint * 1.5;
  color += uLight * (1.0 - normal.z) * 1.4;

  // Cuadrícula en el fondo: se ve a través del agua, así que las ondas la desplazan (refracción).
  if (uGridCell > 0.0) {
    vec2 seen = gl_FragCoord.xy + slope * 90.0 * uPixelRatio;
    vec2 distanceToLine = abs(fract(seen / uGridCell - 0.5) - 0.5) * uGridCell;
    float width = 1.1 * uPixelRatio;
    float line = 1.0 - smoothstep(width - 0.7, width + 0.7, min(distanceToLine.x, distanceToLine.y));
    color = mix(color, mix(uLight, uWater, 0.35), line * 0.3);
  }

  // Viñeta suave y un ruido mínimo para que los degradados no se vean en escalones.
  vec2 centered = uv - 0.5;
  color *= 1.0 - 0.38 * dot(centered, centered);
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  color += (dither - 0.5) / 255.0;

  gl_FragColor = vec4(color, 1.0);
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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const random = (min: number, max: number) => min + Math.random() * (max - min);

/** Viscosidad (0 a 1) → fracción de la onda que sobrevive a cada paso. */
const dampingFor = (viscosity: number) => 1 - (0.0006 + clamp(viscosity, 0, 1) * 0.02);

// ───────────────────────── WebGL ─────────────────────────

interface Program {
  handle: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

interface Renderer {
  /** Tamaño del canvas (px del dispositivo), razón de píxeles y tamaño de la simulación (celdas). */
  resize(width: number, height: number, pixelRatio: number, simWidth: number, simHeight: number): void;
  /** Un paso de la simulación con hasta MAX_DROPS gotas [x, y, radio, fuerza, …]. */
  step(drops: number[], damping: number): void;
  draw(values: LiveValues): void;
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

function link(gl: WebGLRenderingContext, fragmentSource: string, uniformNames: string[]): Program | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const handle = gl.createProgram();
  if (!vertex || !fragment || !handle) return null;
  gl.attachShader(handle, vertex);
  gl.attachShader(handle, fragment);
  gl.bindAttribLocation(handle, 0, "aPos"); // los dos programas usan el mismo triángulo
  gl.linkProgram(handle);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) return null;
  const uniforms = Object.fromEntries(uniformNames.map((name) => [name, gl.getUniformLocation(handle, name)]));
  return { handle, uniforms };
}

/** Prepara una textura donde dibujar con tamaño y tipo dados; devuelve null si el navegador no puede dibujar en ella. */
function createTarget(gl: WebGLRenderingContext, width: number, height: number, type: number): Target | null {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, type, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteTexture(texture);
    gl.deleteFramebuffer(framebuffer);
    return null;
  }
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { texture, framebuffer };
}

function deleteTarget(gl: WebGLRenderingContext, target: Target) {
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.framebuffer);
}

/** Busca un formato con decimales donde se pueda dibujar: half float (el que más aceptan los celulares) o float. */
function findTextureType(gl: WebGLRenderingContext): number | null {
  const half = gl.getExtension("OES_texture_half_float");
  gl.getExtension("EXT_color_buffer_half_float");
  const full = gl.getExtension("OES_texture_float");
  gl.getExtension("WEBGL_color_buffer_float");
  const candidates = [half ? half.HALF_FLOAT_OES : null, full ? gl.FLOAT : null];
  for (const type of candidates) {
    if (type === null) continue;
    const test = createTarget(gl, 4, 4, type);
    if (test) {
      deleteTarget(gl, test);
      return type;
    }
  }
  return null;
}

/** Crea el contexto, los dos programas y las dos texturas de la simulación. Devuelve null si no hay WebGL suficiente. */
function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const options: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, stencil: false };
  const gl = (canvas.getContext("webgl", options) ?? canvas.getContext("experimental-webgl", options)) as WebGLRenderingContext | null;
  if (!gl) return null;
  const textureType = findTextureType(gl);
  if (textureType === null) return null;

  let update: Program | null = null;
  let display: Program | null = null;
  let buffer: WebGLBuffer | null = null;
  // Las dos texturas de la simulación: en cada paso se lee de una y se escribe en la otra (ping-pong).
  let targets: Target[] = [];
  let current = 0;
  let size = { width: 0, height: 0, pixelRatio: 1, simWidth: 0, simHeight: 0 };
  const dropData = new Float32Array(MAX_DROPS * 4);

  const allocate = () => {
    targets.forEach((target) => deleteTarget(gl, target));
    const a = createTarget(gl, size.simWidth, size.simHeight, textureType);
    const b = createTarget(gl, size.simWidth, size.simHeight, textureType);
    targets = a && b ? [a, b] : [];
    current = 0;
  };

  /** Compila los shaders y sube un triángulo que cubre toda la pantalla. */
  const build = (): boolean => {
    update = link(gl, UPDATE_SHADER, ["uState", "uTexel", "uDamping", "uDrops[0]"]);
    display = link(gl, DISPLAY_SHADER, ["uState", "uSimSize", "uWater", "uLight", "uGridCell", "uPixelRatio"]);
    if (!update || !display) return false;
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return true;
  };

  let ready = build();
  if (!ready) return null;

  // Si el navegador pierde el contexto (p. ej. demasiados WebGL abiertos) se reconstruye todo al volver.
  const onLost = (event: Event) => {
    event.preventDefault();
    ready = false;
  };
  const onRestored = () => {
    ready = build();
    allocate();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  return {
    resize(width, height, pixelRatio, simWidth, simHeight) {
      canvas.width = width;
      canvas.height = height;
      const simChanged = simWidth !== size.simWidth || simHeight !== size.simHeight;
      size = { width, height, pixelRatio, simWidth, simHeight };
      if (simChanged || targets.length === 0) allocate();
    },
    step(drops, damping) {
      if (!ready || gl.isContextLost() || !update || targets.length === 0) return;
      dropData.fill(0);
      for (let i = 0; i < Math.min(drops.length, MAX_DROPS * 4); i++) dropData[i] = drops[i];

      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[1 - current].framebuffer);
      gl.viewport(0, 0, size.simWidth, size.simHeight);
      gl.useProgram(update.handle);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets[current].texture);
      gl.uniform1i(update.uniforms.uState, 0);
      gl.uniform2f(update.uniforms.uTexel, 1 / size.simWidth, 1 / size.simHeight);
      gl.uniform1f(update.uniforms.uDamping, damping);
      gl.uniform4fv(update.uniforms["uDrops[0]"], dropData);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      current = 1 - current;
    },
    draw(values) {
      if (!ready || gl.isContextLost() || !display || targets.length === 0) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, size.width, size.height);
      gl.useProgram(display.handle);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets[current].texture);
      gl.uniform1i(display.uniforms.uState, 0);
      gl.uniform2f(display.uniforms.uSimSize, size.simWidth, size.simHeight);
      gl.uniform3fv(display.uniforms.uWater, values.water);
      gl.uniform3fv(display.uniforms.uLight, values.light);
      gl.uniform1f(display.uniforms.uGridCell, values.gridSize * size.pixelRatio);
      gl.uniform1f(display.uniforms.uPixelRatio, size.pixelRatio);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      targets.forEach((target) => deleteTarget(gl, target));
      if (update) gl.deleteProgram(update.handle);
      if (display) gl.deleteProgram(display.handle);
      if (buffer) gl.deleteBuffer(buffer);
      // Libera la memoria de la GPU de inmediato en lugar de esperar al recolector de basura.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

// ───────────────────────── Componente ─────────────────────────

/** Superficie de agua con ondas (WebGL): el cursor y las gotas la agitan y la luz se refleja en las crestas. Llena a su padre. */
export function Estanque({
  color = "#1B2A8C",
  lightColor = "#C9DAFF",
  viscosity = 0.3,
  dropRate = 0.8,
  cursorForce = 1,
  grid = true,
  gridSize = 44,
  className = "",
  style,
  children,
}: EstanqueProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // "pending": aún no se sabe si hay WebGL (el servidor y el primer render pintan el agua quieta).
  const [mode, setMode] = useState<"pending" | "webgl" | "static">("pending");
  const live = useRef<LiveValues>({ water: [0, 0, 0], light: [1, 1, 1], damping: dampingFor(viscosity), dropRate, cursorForce, gridSize: grid ? gridSize : 0 });
  const refresh = useRef<() => void>(() => {});

  // Pasa las props actuales al bucle de dibujo.
  useEffect(() => {
    live.current = {
      water: toRgb(color),
      light: toRgb(lightColor),
      damping: dampingFor(viscosity),
      dropRate,
      cursorForce,
      gridSize: grid ? gridSize : 0,
    };
    refresh.current();
  }, [color, lightColor, viscosity, dropRate, cursorForce, grid, gridSize]);

  useEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    if (!root || !host) return;

    // El canvas se crea aquí (no en el JSX) para que un nuevo montaje siempre estrene su propio contexto.
    const canvas = document.createElement("canvas");
    canvas.className = "furin-estanque__canvas";
    const renderer = createRenderer(canvas);
    if (!renderer) {
      setMode("static");
      return;
    }
    host.appendChild(canvas);
    setMode("webgl");

    // Los eventos se escuchan en el padre: así reacciona aunque haya contenido encima.
    const listener = root.parentElement ?? root;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const step = 1 / STEPS_PER_SECOND;
    let clock = 0;
    let accumulator = 0;
    let lastNow = 0;
    let frameId = 0;
    let sleepTimer = 0;
    let visible = true;
    /** Segundos que faltan para la próxima gota automática. */
    let nextDrop = 0.4;
    /** Momento (en `clock`) a partir del cual las ondas ya se apagaron y el bucle puede dormir. */
    let calmAt = 0;
    let simWidth = 1;
    let simHeight = 1;

    // Gotas en espera, en la forma que pide el shader: x, y, radio, fuerza.
    const queue: number[] = [];
    const pointer = { x: 0, y: 0, time: 0, active: false };

    /** Segundos que tarda una onda en volverse invisible con la viscosidad actual. */
    const calmTime = () => Math.log(0.01) / Math.log(live.current.damping) / STEPS_PER_SECOND;

    const addDrop = (x: number, y: number, radius: number, strength: number) => {
      if (queue.length >= MAX_QUEUED_DROPS * 4) queue.splice(0, 4);
      queue.push(x, y, radius, strength);
      calmAt = clock + calmTime();
    };

    const addRandomDrop = () => {
      // Gotas de distinto tamaño: las grandes hacen ondas anchas y lentas; las chicas, finas.
      addDrop(random(0.1, 0.9), random(0.12, 0.88), random(4, 8), random(0.5, 0.9) * (Math.random() < 0.25 ? 1.4 : 1));
    };

    const draw = () => renderer.draw(live.current);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const cssWidth = Math.max(1, root.clientWidth);
      const cssHeight = Math.max(1, root.clientHeight);
      // La simulación usa celdas de ~2.6 px, con tope para que un escenario enorme no la encarezca.
      const cell = Math.max(CELL_SIZE, Math.max(cssWidth, cssHeight) / MAX_SIMULATION_SIDE);
      simWidth = Math.max(16, Math.round(cssWidth / cell));
      simHeight = Math.max(16, Math.round(cssHeight / cell));
      renderer.resize(Math.round(cssWidth * dpr), Math.round(cssHeight * dpr), dpr, simWidth, simHeight);
      if (reducedMotion.matches) drawStill();
      else draw();
    };

    /** Con movimiento reducido: un cuadro quieto con tres gotas a medio camino, siempre las mismas. */
    const drawStill = () => {
      const drops = [
        [0.3, 0.56, 8, -0.9],
        [0.68, 0.4, 7, -0.8],
        [0.5, 0.78, 5, -0.6],
      ];
      for (let i = 0; i < 70; i++) {
        const now = i === 0 ? drops.flat() : i === 24 ? [0.2, 0.3, 5, -0.6] : [];
        renderer.step(now, dampingFor(0.25));
      }
      draw();
    };

    // ───────────────────────── Bucle ─────────────────────────

    const frame = (now: number) => {
      frameId = requestAnimationFrame(frame);
      // El primer cuadro puede traer una marca de tiempo anterior a la de arranque: el tiempo nunca retrocede.
      const dt = clamp((now - lastNow) / 1000, 0, 0.1);
      lastNow = now;
      clock += dt;
      accumulator += dt;

      const { dropRate } = live.current;
      if (dropRate > 0) {
        nextDrop -= dt;
        if (nextDrop <= 0) {
          addRandomDrop();
          nextDrop = random(0.5, 1.5) / dropRate;
        }
      }

      let steps = 0;
      while (accumulator >= step && steps < 3) {
        renderer.step(queue.splice(0, MAX_DROPS * 4), live.current.damping);
        accumulator -= step;
        steps++;
      }
      if (accumulator > step) accumulator = 0; // si la pantalla va lenta, no se acumula atraso
      if (steps > 0) draw();

      // Con las ondas apagadas y nada en espera no hay nada que animar: el bucle duerme.
      if (clock > calmAt && queue.length === 0) {
        stop();
        if (dropRate > 0) sleepTimer = window.setTimeout(wakeUp, Math.max(0, nextDrop) * 1000);
      }
    };
    const wakeUp = () => {
      sleepTimer = 0;
      nextDrop = 0;
      start();
    };
    const start = () => {
      if (frameId || !visible || reducedMotion.matches) return;
      window.clearTimeout(sleepTimer);
      sleepTimer = 0;
      lastNow = performance.now();
      frameId = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(frameId);
      frameId = 0;
      window.clearTimeout(sleepTimer);
      sleepTimer = 0;
    };

    // ───────────────────────── Puntero ─────────────────────────

    const onPointerMove = (event: PointerEvent) => {
      if (reducedMotion.matches) return;
      const rect = root.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = 1 - (event.clientY - rect.top) / rect.height; // la textura tiene el origen abajo
      const now = performance.now();
      if (pointer.active && now - pointer.time < 250) {
        // Una gota cada ~9 px del recorrido: así el trazo es continuo aunque el cursor vaya rápido.
        const distance = Math.hypot((x - pointer.x) * rect.width, (y - pointer.y) * rect.height);
        const speed = distance / Math.max((now - pointer.time) / 1000, 0.008);
        const strength = clamp(speed / 1500, 0.08, 1) * live.current.cursorForce * 0.2;
        const count = Math.min(Math.ceil(distance / 9), 6);
        if (distance > 0.5 && strength > 0) {
          for (let i = 1; i <= count; i++) {
            const t = i / count;
            addDrop(pointer.x + (x - pointer.x) * t, pointer.y + (y - pointer.y) * t, 3.8, -strength);
          }
        }
      }
      pointer.x = x;
      pointer.y = y;
      pointer.time = now;
      pointer.active = true;
      start();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (reducedMotion.matches || live.current.cursorForce <= 0) return;
      const rect = root.getBoundingClientRect();
      // Un toque o clic es una gota gorda.
      addDrop((event.clientX - rect.left) / rect.width, 1 - (event.clientY - rect.top) / rect.height, 6, -0.7 * live.current.cursorForce);
      start();
    };
    const onPointerLeave = () => {
      pointer.active = false;
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
      if (reducedMotion.matches) {
        stop();
        drawStill();
      } else start();
    };
    reducedMotion.addEventListener("change", onMotionPreferenceChange);

    listener.addEventListener("pointermove", onPointerMove);
    listener.addEventListener("pointerdown", onPointerDown);
    listener.addEventListener("pointerleave", onPointerLeave);
    listener.addEventListener("pointercancel", onPointerLeave);

    // Cuando cambian los colores u otras props: se repinta (si el bucle duerme) y se retoma el ritmo de las gotas.
    refresh.current = () => {
      if (reducedMotion.matches) return drawStill();
      calmAt = Math.max(calmAt, clock + 0.5);
      nextDrop = Math.min(nextDrop, live.current.dropRate > 0 ? 1.2 / live.current.dropRate : nextDrop);
      draw();
      start();
    };

    resize();
    start();

    return () => {
      stop();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      reducedMotion.removeEventListener("change", onMotionPreferenceChange);
      listener.removeEventListener("pointermove", onPointerMove);
      listener.removeEventListener("pointerdown", onPointerDown);
      listener.removeEventListener("pointerleave", onPointerLeave);
      listener.removeEventListener("pointercancel", onPointerLeave);
      refresh.current = () => {};
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  const colorVars = { "--furin-estanque-water": color, "--furin-estanque-light": lightColor } as CSSProperties;

  return (
    <div ref={rootRef} className={`furin-estanque ${className}`.trim()} style={{ ...colorVars, ...style }}>
      {/* Sin WebGL (o antes de saberlo) se ve el agua quieta, con los mismos colores. */}
      {mode !== "webgl" && <div className="furin-estanque__fallback" />}
      <div ref={hostRef} className="furin-estanque__host" />
      {children !== undefined && <div className="furin-estanque__content">{children}</div>}
    </div>
  );
}

export default Estanque;
