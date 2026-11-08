"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./CopyMorph.css";

export interface CopyMorphProps {
  /** Texto que se copia al portapapeles. */
  text?: string;
  /** Texto del botón en reposo. */
  label?: string;
  /** Texto del botón después de copiar. */
  copiedLabel?: string;
  /** Texto del botón si la copia falla. */
  errorLabel?: string;
  /** "field" muestra el texto con el botón al lado; "button" solo el botón; "icon" solo el ícono. */
  variant?: "field" | "button" | "icon";
  /** Milisegundos que se queda la palomita antes de volver. */
  duration?: number;
  /** Color de la confirmación. */
  successColor?: string;
  /** Se llama después de copiar con éxito. */
  onCopy?: (text: string) => void;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

/* ---------- Morph de trazo: el contorno del ícono de copiar se convierte en la palomita ---------- */

type Pt = [number, number];
const N = 56;

/** Remuestrea una polilínea a n+1 puntos a igual distancia a lo largo del trazo. */
function remuestrea(pts: Pt[], n: number): Pt[] {
  const acum = [0];
  for (let i = 1; i < pts.length; i++) acum.push(acum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = acum[acum.length - 1];
  const out: Pt[] = [];
  let j = 1;
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * total;
    while (j < pts.length - 1 && acum[j] < d) j++;
    const seg = acum[j] - acum[j - 1] || 1;
    const t = (d - acum[j - 1]) / seg;
    out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * t]);
  }
  return out;
}

/** Rectángulo redondeado como polilínea cerrada, empezando en el borde derecho y bajando. */
function rectRedondeado(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const pts: Pt[] = [];
  const arco = (cx: number, cy: number, a0: number) => { for (let k = 0; k <= 6; k++) { const a = a0 + (k / 6) * (Math.PI / 2); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  arco(x + w - r, y + h - r, 0);          // esquina inferior derecha
  arco(x + r, y + h - r, Math.PI / 2);    // inferior izquierda
  arco(x + r, y + r, Math.PI);            // superior izquierda
  arco(x + w - r, y + r, Math.PI * 1.5);  // superior derecha
  pts.push([x + w, y + r]);               // cierra
  pts.unshift([x + w, y + r]);
  return pts;
}

let formas: { a: Pt[]; b: Pt[] } | null = null;
function getFormas() {
  // La palomita se recorre de arriba a la derecha hacia la izquierda, igual que el rectángulo recorre su perímetro.
  formas ??= {
    a: remuestrea(rectRedondeado(8.6, 8.6, 11, 11, 2.6), N),
    b: remuestrea([[18.6, 7.4], [10.2, 16.2], [5.4, 11.8]], N),
  };
  return formas;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function trazo(p: number): string {
  const { a, b } = getFormas();
  let d = "";
  for (let i = 0; i <= N; i++) {
    // Cada punto sale con un pequeño retraso: la forma "fluye" de un extremo al otro.
    const q = Math.min(1.1, Math.max(0, (p - (i / N) * 0.22) / 0.78));
    d += `${i ? "L" : "M"}${lerp(a[i][0], b[i][0], q).toFixed(2)} ${lerp(a[i][1], b[i][1], q).toFixed(2)}`;
  }
  return d;
}

/** Copia con respaldo: primero la API moderna y, si el navegador la niega, el método clásico con un textarea. */
async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texto); return true; }
  } catch { /* cae al respaldo */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, texto.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

/** Botón de copiar: el contorno del ícono se transforma en una palomita con un resorte y el texto se copia de verdad. */
export function CopyMorph({
  text = "npx furin add copy-morph",
  label = "Copy",
  copiedLabel = "Copied",
  errorLabel = "Copy failed",
  variant = "field",
  duration = 1900,
  successColor = "#6EE0A6",
  onCopy,
  className = "",
  style,
}: CopyMorphProps) {
  const [estado, setEstado] = useState<"idle" | "copiado" | "error">("idle");
  const trazoRef = useRef<SVGPathElement>(null);
  const codigo = useRef<HTMLElement>(null);
  const timer = useRef(0);
  const fis = useRef({ p: 0, v: 0, raf: 0, last: 0, to: 0 });
  const tick = useCallback((t: number) => {
    const f = fis.current;
    f.raf = 0;
    const dt = Math.min(0.032, Math.max(0.001, (t - f.last) / 1000));
    f.last = t;
    const k = 230, c = 2 * Math.sqrt(k) * 0.56;
    for (let i = 0; i < 3; i++) { f.v += (k * (f.to - f.p) - c * f.v) * (dt / 3); f.p += f.v * (dt / 3); }
    trazoRef.current?.setAttribute("d", trazo(f.p));
    if (Math.abs(f.to - f.p) < 0.0008 && Math.abs(f.v) < 0.004) { f.p = f.to; trazoRef.current?.setAttribute("d", trazo(f.p)); return; }
    f.raf = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const f = fis.current;
    f.to = estado === "copiado" ? 1 : 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { f.p = f.to; f.v = 0; trazoRef.current?.setAttribute("d", trazo(f.p)); return; }
    if (!f.raf) { f.last = performance.now(); f.raf = requestAnimationFrame(tick); }
  }, [estado, tick]);

  useEffect(() => () => { window.clearTimeout(timer.current); cancelAnimationFrame(fis.current.raf); }, []);

  const alPulsar = async () => {
    window.clearTimeout(timer.current);
    const ok = await copiar(text);
    if (ok) {
      setEstado("copiado");
      onCopy?.(text);
    } else {
      // Si no hay manera de copiar, deja el texto seleccionado para que la persona use ⌘C.
      setEstado("error");
      const el = codigo.current;
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); }
    }
    timer.current = window.setTimeout(() => setEstado("idle"), duration);
  };

  const vars = { "--furin-copy-ok": successColor } as CSSProperties;
  const msg = estado === "copiado" ? copiedLabel : estado === "error" ? errorLabel : "";
  const boton = (
    <button type="button" className={`furin-copy-morph__boton is-${estado}`} onClick={alPulsar} aria-label={variant === "icon" ? `${label}: ${text}` : undefined}>
      <svg className="furin-copy-morph__icono" viewBox="0 0 24 24" aria-hidden="true">
        <path className="furin-copy-morph__atras" d="M15.4 8.6V7.1A2.6 2.6 0 0 0 12.8 4.5H7.1A2.6 2.6 0 0 0 4.5 7.1v5.7a2.6 2.6 0 0 0 2.6 2.6h1.5" />
        <path ref={trazoRef} className="furin-copy-morph__frente" d={trazo(0)} />
      </svg>
      {variant !== "icon" ? (
        <span className="furin-copy-morph__etq">
          <span className={estado === "idle" ? "is-on" : ""} aria-hidden={estado !== "idle"}>{label}</span>
          <span className={estado === "copiado" ? "is-on" : ""} aria-hidden={estado !== "copiado"}>{copiedLabel}</span>
          <span className={estado === "error" ? "is-on" : ""} aria-hidden={estado !== "error"}>{errorLabel}</span>
        </span>
      ) : null}
    </button>
  );
  return (
    <div className={`furin-copy-morph furin-copy-morph--${variant} ${className}`} style={{ ...vars, ...style }}>
      {variant === "field" ? (
        <div className="furin-copy-morph__campo">
          <code ref={codigo} className="furin-copy-morph__texto"><span className="furin-copy-morph__prompt" aria-hidden="true">$</span>{text}</code>
          {boton}
        </div>
      ) : (
        boton
      )}
      <span className="furin-copy-morph__sr" role="status" aria-live="polite">{msg}</span>
    </div>
  );
}

export default CopyMorph;
