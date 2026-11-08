"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./CodeRain.css";

export interface CodeRainProps {
  /** Contenido que va encima de la lluvia. */
  children?: ReactNode;
  /** Color del código (el cuerpo de cada columna). */
  color?: string;
  /** Color de la punta que va cayendo. */
  headColor?: string;
  /** Color del fondo. */
  background?: string;
  /** Velocidad de caída (1 = normal). */
  speed?: number;
  /** Cuántas columnas caen a la vez (1 = normal). */
  density?: number;
  /** Tamaño de la letra del plano principal, en px. */
  fontSize?: number;
  /** Tiñe palabras clave, cadenas y signos como un editor de código. */
  syntax?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

// Fragmentos de código real (JSX/TS) que bajan, un carácter por fila.
const SNIPPETS = [
  "const [open, setOpen] = useState(false);",
  "export default function Hero() {",
  "useEffect(() => { ref.current?.focus(); }, []);",
  "<div className=\"grid place-items-center\">",
  "return <Button onClick={toggle}>Ship it</Button>;",
  "import { motion } from \"framer-motion\";",
  "interface Props { title: string; items: Item[] }",
  "const res = await fetch(\"/api/user\", { cache: \"no-store\" });",
  "items.map((item) => <Card key={item.id} {...item} />)",
  "type State = \"idle\" | \"loading\" | \"error\";",
  "export const metadata: Metadata = { title: \"Furin\" };",
  "if (!user) return redirect(\"/login\");",
  "const ctx = canvas.getContext(\"2d\")!;",
  "requestAnimationFrame(loop);",
  "await Promise.all(tasks.map(run));",
  "const total = useMemo(() => sum(rows), [rows]);",
  "</section>",
  "npm run build && npm run start",
  "git commit -m \"feat: add hero\"",
  "export function cn(...c: string[]) { return c.join(\" \"); }",
  "const router = useRouter();",
  "async function load(id: number): Promise<Post> {",
  "<Suspense fallback={<Spinner />}>",
  "setCount((n) => n + 1);",
  "throw new Error(\"not implemented\");",
  "export type { ComponentMeta } from \"./types\";",
  "ref.current.style.transform = `translateY(${y}px)`;",
  "const observer = new IntersectionObserver(cb);",
];

const KEYWORDS = new Set(["const", "let", "return", "import", "export", "from", "default", "function", "async", "await", "if", "type", "interface", "new", "throw", "typeof"]);
// Clases de color: 0 cuerpo, 1 palabra clave, 2 cadena, 3 signo.
function clasificar(s: string): Uint8Array {
  const cls = new Uint8Array(s.length);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "`") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) j++;
      for (let k = i; k <= Math.min(j, s.length - 1); k++) cls[k] = 2;
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      if (KEYWORDS.has(s.slice(i, j))) for (let k = i; k < j; k++) cls[k] = 1;
      i = j;
    } else {
      if (/[{}()[\]<>;,=:.|&!?/+\-*$]/.test(c)) cls[i] = 3;
      i++;
    }
  }
  return cls;
}
const SNIP_CLS = SNIPPETS.map(clasificar);

let colorCtx: CanvasRenderingContext2D | null = null;
const RGB_CACHE = new Map<string, [number, number, number]>();
function rgb(css: string, def: [number, number, number]): [number, number, number] {
  const hit = RGB_CACHE.get(css);
  if (hit) return hit;
  try {
    colorCtx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    colorCtx.clearRect(0, 0, 1, 1);
    colorCtx.fillStyle = "#010203";
    colorCtx.fillStyle = css;
    colorCtx.fillRect(0, 0, 1, 1);
    const d = colorCtx.getImageData(0, 0, 1, 1).data;
    const out: [number, number, number] = [d[0], d[1], d[2]];
    if (RGB_CACHE.size > 64) RGB_CACHE.clear();
    RGB_CACHE.set(css, out);
    return out;
  } catch {
    return def;
  }
}

interface Columna { x: number; snip: number; ini: number; cabeza: number; vel: number; cola: number; espera: number; }
interface Capa {
  cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  tam: number; velMul: number; alfaMul: number; densMul: number; colW: number; lineH: number;
  cols: Columna[];
}

const NIV = 9;
const FUENTE = `"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

/** Fondo de lluvia de código: columnas de fragmentos reales de JSX/TS que caen en tres planos de profundidad, con la punta brillante. */
export function CodeRain({
  children,
  color = "#8fb0c4",
  headColor = "#eaf6ff",
  background = "#07090c",
  speed = 1,
  density = 1,
  fontSize = 14,
  syntax = true,
  className = "",
  style,
}: CodeRainProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const props = useRef({ color, headColor, speed, density, fontSize, syntax });
  props.current = { color, headColor, speed, density, fontSize, syntax };
  const wakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mk = (mod: string) => {
      const cv = document.createElement("canvas");
      cv.className = `furin-code-rain__lienzo ${mod}`;
      cv.setAttribute("aria-hidden", "true");
      return cv;
    };
    const cvLejos = mk("furin-code-rain__lienzo--lejos"), cvMedio = mk(""), cvCerca = mk("furin-code-rain__lienzo--cerca");
    const c0 = cvLejos.getContext("2d"), c1 = cvMedio.getContext("2d"), c2 = cvCerca.getContext("2d");
    if (!c0 || !c1 || !c2) return;
    root.insertBefore(cvCerca, root.firstChild);
    root.insertBefore(cvMedio, root.firstChild);
    root.insertBefore(cvLejos, root.firstChild);

    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, muerto = false, ult = 0;
    const ptr = { x: -999, y: -999, k: 0, kObj: 0 };
    let capas: Capa[] = [];
    let sprite: HTMLCanvasElement | null = null;
    let spriteClave = "";

    const nuevaCapa = (cv: HTMLCanvasElement, ctx: CanvasRenderingContext2D, k: number, velMul: number, alfaMul: number, densMul: number): Capa => ({ cv, ctx, tam: 0, velMul, alfaMul, densMul, colW: 0, lineH: 0, cols: [], ...{ _k: k } as object });

    const reciclar = (c: Columna, cap: Capa, inicial: boolean) => {
      c.snip = Math.floor(Math.random() * SNIPPETS.length);
      const largo = SNIPPETS[c.snip].length;
      const filas = h / cap.lineH;
      c.cola = 12 + Math.random() * 16;
      c.vel = (5 + Math.random() * 7) * cap.velMul;
      // El texto empieza en una fila aleatoria superior; al inicio las columnas ya están repartidas por la pantalla.
      c.ini = -Math.floor(Math.random() * Math.min(8, filas * 0.3));
      c.cabeza = inicial ? c.ini + Math.random() * (largo + c.cola) : c.ini - 1;
      c.espera = inicial ? 0 : Math.random() * 4;
    };

    const armar = () => {
      const p = props.current;
      const tamBase = Math.max(8, p.fontSize);
      const defs: [HTMLCanvasElement, CanvasRenderingContext2D, number, number, number, number][] = [
        [cvLejos, c0, tamBase * 0.66, 0.6, 0.55, 1],
        [cvMedio, c1, tamBase, 1, 1, 0.85],
        [cvCerca, c2, tamBase * 2.3, 1.7, 0.6, 0.16],
      ];
      capas = defs.map(([cv, ctx, tam, velMul, alfaMul, dens]) => {
        const cap = nuevaCapa(cv, ctx, 0, velMul, alfaMul, dens);
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        cap.tam = tam;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = `500 ${tam}px ${FUENTE}`;
        cap.colW = Math.max(4, ctx.measureText("M").width * 1.12);
        cap.lineH = tam * 1.32;
        const n = Math.floor(w / cap.colW);
        for (let i = 0; i < n; i++) {
          if (Math.random() > Math.min(1, cap.densMul * p.density)) continue;
          const col: Columna = { x: i * cap.colW + cap.colW / 2, snip: 0, ini: 0, cabeza: 0, vel: 0, cola: 0, espera: 0 };
          reciclar(col, cap, true);
          cap.cols.push(col);
        }
        return cap;
      });
    };

    const armarSprite = () => {
      const [r, g, b] = rgb(props.current.color, [143, 176, 196]);
      const clave = `${r},${g},${b}`;
      if (sprite && spriteClave === clave) return;
      spriteClave = clave;
      sprite = document.createElement("canvas");
      sprite.width = sprite.height = 64;
      const sc = sprite.getContext("2d")!;
      const gr = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, "rgba(255,255,255,0.4)");
      gr.addColorStop(0.3, `rgba(${r},${g},${b},0.16)`);
      gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      sc.fillStyle = gr; sc.fillRect(0, 0, 64, 64);
    };

    const pintarCapa = (cap: Capa, dt: number) => {
      const p = props.current;
      const ctx = cap.ctx;
      const base = rgb(p.color, [143, 176, 196]);
      const cabC = rgb(p.headColor, [234, 246, 255]);
      // Paleta por clase: cuerpo, palabra clave, cadena, signo.
      const paleta: [number, number, number][] = p.syntax
        ? [base, [base[0] * 0.55 + 190 * 0.45, base[1] * 0.55 + 150 * 0.45, base[2] * 0.55 + 235 * 0.45], [base[0] * 0.5 + 232 * 0.5, base[1] * 0.5 + 190 * 0.5, base[2] * 0.5 + 130 * 0.5], [base[0] * 0.55, base[1] * 0.55, base[2] * 0.6]]
        : [base, base, base, [base[0] * 0.7, base[1] * 0.7, base[2] * 0.7]];

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cap.cv.width, cap.cv.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `500 ${cap.tam}px ${FUENTE}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const buckets: { x: number; y: number; ch: string }[][] = Array.from({ length: 4 * NIV }, () => []);
      const heads: { x: number; y: number; a: number; ch: string }[] = [];
      const filas = h / cap.lineH;

      for (const col of cap.cols) {
        if (col.espera > 0) { col.espera -= dt; continue; }
        // El cursor acelera y enciende las columnas que toca.
        const cerca = ptr.k > 0.02 ? Math.max(0, 1 - Math.abs(col.x - ptr.x) / 110) * ptr.k : 0;
        col.cabeza += col.vel * p.speed * (1 + cerca * 0.9) * dt;
        const txt = SNIPPETS[col.snip], cls = SNIP_CLS[col.snip];
        const fin = col.ini + txt.length;
        if (col.cabeza - col.cola > Math.max(fin, filas + 1)) { reciclar(col, cap, false); continue; }
        const hi = Math.min(Math.floor(col.cabeza), fin - 1);
        const lo = Math.max(Math.ceil(col.cabeza - col.cola), col.ini, Math.floor(-1));
        for (let r = hi; r >= lo; r--) {
          const y = r * cap.lineH + cap.lineH / 2;
          if (y < -cap.lineH || y > h + cap.lineH) continue;
          const dist = col.cabeza - r;
          let a = Math.pow(Math.max(0, 1 - dist / col.cola), 1.25);
          a = a * (0.2 + 0.8 * cap.alfaMul) + cerca * 0.35 * a;
          if (a < 0.03) continue;
          const nivel = Math.min(NIV - 1, Math.floor(Math.min(1, a) * NIV));
          const ch = txt[r - col.ini];
          if (ch === " ") continue;
          buckets[cls[r - col.ini] * NIV + nivel].push({ x: col.x, y, ch });
        }
        // La punta: carácter blanco con su halo.
        const rh = Math.floor(col.cabeza);
        if (rh >= col.ini && rh < fin) {
          const y = rh * cap.lineH + cap.lineH / 2;
          if (y > -cap.lineH && y < h + cap.lineH) heads.push({ x: col.x, y, a: 0.45 + 0.55 * cap.alfaMul, ch: txt[rh - col.ini] });
        }
      }

      for (let cl = 0; cl < 4; cl++) {
        const [r, g, b] = paleta[cl];
        for (let n = 0; n < NIV; n++) {
          const arr = buckets[cl * NIV + n];
          if (!arr.length) continue;
          const a = ((n + 0.5) / NIV) * (cl === 3 ? 0.8 : 1);
          ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`;
          for (const q of arr) ctx.fillText(q.ch, q.x, q.y);
        }
      }
      if (heads.length && sprite) {
        ctx.globalCompositeOperation = "lighter";
        const sz = cap.tam * 2.4;
        for (const hd of heads) { ctx.globalAlpha = hd.a; ctx.drawImage(sprite, hd.x - sz / 2, hd.y - sz / 2, sz, sz); }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = `rgba(${cabC[0]},${cabC[1]},${cabC[2]},0.95)`;
        for (const hd of heads) {
          if (hd.ch && hd.ch !== " ") { ctx.globalAlpha = Math.min(1, hd.a + 0.15); ctx.fillText(hd.ch, hd.x, hd.y); }
        }
        ctx.globalAlpha = 1;
      }
    };

    const pintar = (dt: number) => {
      for (const cap of capas) pintarCapa(cap, dt);
    };

    const paso = (ts: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.05, ult ? (ts - ult) / 1000 : 0.016);
      ult = ts;
      ptr.k += (ptr.kObj - ptr.k) * (1 - Math.exp(-dt * 6));
      pintar(dt);
      raf = requestAnimationFrame(paso);
    };
    const wake = () => { if (reducido) return; if (!raf && visible && !muerto) { ult = 0; raf = requestAnimationFrame(paso); } };

    let claveGeom = "";
    const medir = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = root.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      claveGeom = `${props.current.fontSize}|${props.current.density}`;
      armarSprite();
      armar();
      if (reducido) { pintar(0.016); } else wake();
    };
    wakeRef.current = () => {
      armarSprite();
      if (claveGeom !== `${props.current.fontSize}|${props.current.density}`) { claveGeom = `${props.current.fontSize}|${props.current.density}`; armar(); }
      if (reducido) pintar(0.016); else wake();
    };
    const ro = new ResizeObserver(medir);
    ro.observe(root);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "80px" });
    io.observe(root);

    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top; ptr.kObj = 1;
    };
    const onLeave = () => { ptr.kObj = 0; };
    if (!reducido) {
      root.addEventListener("pointermove", onMove, { passive: true });
      root.addEventListener("pointerdown", onMove, { passive: true });
      root.addEventListener("pointerleave", onLeave);
    }
    medir();

    return () => {
      muerto = true;
      wakeRef.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onMove);
      root.removeEventListener("pointerleave", onLeave);
      cvLejos.remove(); cvMedio.remove(); cvCerca.remove();
    };
  }, []);

  useEffect(() => { wakeRef.current?.(); }, [color, headColor, speed, density, fontSize, syntax]);

  const vars = { "--furin-code-rain-bg": background } as CSSProperties;
  return (
    <div ref={rootRef} className={`furin-code-rain ${className}`} style={{ ...vars, ...style }}>
      <span className="furin-code-rain__vineta" aria-hidden="true" />
      {children != null ? <div className="furin-code-rain__contenido">{children}</div> : null}
    </div>
  );
}

export default CodeRain;
