"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./OrbitText.css";

export interface OrbitTextProps {
  /** El texto del anillo exterior; se repite hasta cerrar el círculo. */
  children?: string;
  /** Texto del anillo interior, que gira al revés (déjalo vacío para ocultarlo). */
  innerText?: string;
  /** Diámetro del conjunto, en px. */
  size?: number;
  /** Grados por segundo en reposo. */
  speed?: number;
  /** Cuántas veces más rápido gira con el cursor encima. */
  boost?: number;
  /** Símbolo que separa las repeticiones del texto. */
  separator?: string;
  /** Color del texto. */
  color?: string;
  /** Color del separador y del centro. */
  accent?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const C0 = 200; // centro del lienzo (viewBox 400×400)
interface Anillo { r: number; fs: number; texto: string; ls: number }
interface Ajuste { str: string; ls: number }

const circ = (r: number) => 2 * Math.PI * r;

/** Estimación inicial (antes de medir la fuente): sirve para el primer pintado y para SSR. */
function estimar(texto: string, sep: string, r: number, fs: number): Ajuste {
  const unidad = `${texto} ${sep} `;
  const w = unidad.length * fs * 0.66;
  const n = Math.max(1, Math.round(circ(r) / w));
  return { str: unidad.repeat(n), ls: 0 };
}

/** Texto en círculo que gira despacio y se acelera, con inercia, cuando el cursor se acerca. */
export function OrbitText({
  children = "Design in motion",
  innerText = "furin · animated · components",
  size = 340,
  speed = 12,
  boost = 8,
  separator = "•",
  color = "#F4F5F7",
  accent = "#7CF5C6",
  className = "",
  style,
}: OrbitTextProps) {
  const uid = useId().replace(/:/g, "");
  const rootRef = useRef<HTMLDivElement>(null);
  const medidor = useRef<SVGTextElement>(null);
  const gExt = useRef<SVGGElement>(null);
  const gInt = useRef<SVGGElement>(null);
  const centro = useRef<SVGCircleElement>(null);
  const halo = useRef<SVGCircleElement>(null);
  const cfg = useRef({ speed, boost });
  cfg.current = { speed, boost };

  const sep = separator || "•";
  const ext = children.toUpperCase();
  const int = innerText.toUpperCase();
  const A: Anillo = { r: 158, fs: 25, texto: ext, ls: 0 };
  const B: Anillo = { r: 100, fs: 15, texto: int, ls: 0 };
  const [aj, setAj] = useState<{ a: Ajuste; b: Ajuste }>(() => ({ a: estimar(ext, sep, A.r, A.fs), b: estimar(int, sep, B.r, B.fs) }));

  // Mide el texto real con la fuente ya cargada y reparte el espacio sobrante entre las letras para que el círculo cierre exacto.
  useEffect(() => {
    const m = medidor.current;
    if (!m) return;
    const ajustar = () => {
      const hacer = (an: Anillo): Ajuste => {
        if (!an.texto.trim()) return { str: "", ls: 0 };
        m.style.fontSize = `${an.fs}px`;
        m.textContent = `${an.texto} ${sep} `;
        const w = m.getComputedTextLength();
        if (!w) return estimar(an.texto, sep, an.r, an.fs);
        const unidad = `${an.texto} ${sep} `;
        const n = Math.max(1, Math.round(circ(an.r) / w));
        const total = unidad.length * n;
        return { str: unidad.repeat(n), ls: (circ(an.r) - w * n) / total };
      };
      setAj({ a: hacer(A), b: hacer(B) });
    };
    ajustar();
    document.fonts?.ready.then(ajustar);
    document.fonts?.addEventListener?.("loadingdone", ajustar);
    return () => document.fonts?.removeEventListener?.("loadingdone", ajustar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext, int, sep]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const E = { a1: -20, a2: 40, v: 1, prox: 0, ultimo: 0 };
    let visible = true, raf = 0, muerto = false;
    const pintar = () => {
      gExt.current?.setAttribute("transform", `rotate(${E.a1.toFixed(2)} ${C0} ${C0})`);
      gInt.current?.setAttribute("transform", `rotate(${E.a2.toFixed(2)} ${C0} ${C0})`);
      // El centro late más fuerte cuanto más rápido gira.
      const k = Math.min(1, (E.v - 1) / 5);
      centro.current?.setAttribute("r", (4 + k * 3).toFixed(2));
      halo.current?.setAttribute("r", (13 + k * 15).toFixed(2));
      halo.current?.setAttribute("opacity", (0.25 + k * 0.6).toFixed(3));
    };
    pintar();
    if (reducido) return;
    const paso = (now: number) => {
      raf = 0;
      if (muerto || !visible) return;
      const dt = Math.min(0.05, (now - (E.ultimo || now)) / 1000 || 0.016);
      E.ultimo = now;
      const { speed: s, boost: b } = cfg.current;
      const objetivo = 1 + (b - 1) * E.prox;
      // Entra rápido y se suelta despacio: tiene inercia, como un volante.
      const tau = objetivo > E.v ? 0.45 : 1.3;
      E.v += (objetivo - E.v) * (1 - Math.exp(-dt / tau));
      E.a1 += s * E.v * dt;
      E.a2 -= s * 0.72 * E.v * dt;
      pintar();
      raf = requestAnimationFrame(paso);
    };
    const wake = () => { if (!raf && visible && !muerto) { E.ultimo = 0; raf = requestAnimationFrame(paso); } };
    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      const rad = r.width / 2;
      // Dentro del círculo: aceleración completa; hasta 0.5 radios afuera se desvanece.
      E.prox = Math.max(0, Math.min(1, 1 - (d - rad) / (rad * 0.5)));
    };
    const onFuera = () => { E.prox = 0; };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    const onUp = (e: PointerEvent) => { if (e.pointerType !== "mouse") onFuera(); };
    window.addEventListener("pointerup", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", onFuera);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { rootMargin: "60px" });
    io.observe(root);
    wake();
    return () => {
      muerto = true; cancelAnimationFrame(raf); io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onFuera);
    };
  }, []);

  const trazo = (r: number) => `M ${C0} ${C0 - r} A ${r} ${r} 0 1 1 ${C0} ${C0 + r} A ${r} ${r} 0 1 1 ${C0} ${C0 - r}`;
  /** Reparte el texto en tramos para pintar el separador con el color de acento. */
  const tramos = (str: string) => str.split(sep).map((t, i, arr) => (
    <tspan key={i}>{t}{i < arr.length - 1 ? <tspan className="furin-orbit-text__sep">{sep}</tspan> : null}</tspan>
  ));
  const vars = { "--furin-ot-color": color, "--furin-ot-accent": accent, width: size, height: size } as CSSProperties;

  return (
    <div ref={rootRef} className={`furin-orbit-text ${className}`} style={{ ...vars, ...style }}>
      <svg viewBox="0 0 400 400" role="img" aria-label={`${children}${innerText ? `, ${innerText}` : ""}`}>
        <defs>
          <path id={`${uid}-a`} d={trazo(A.r)} />
          <path id={`${uid}-b`} d={trazo(B.r)} />
          <radialGradient id={`${uid}-g`}>
            <stop offset="0" stopColor={accent} stopOpacity="0.55" />
            <stop offset="1" stopColor={accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle className="furin-orbit-text__aro" cx={C0} cy={C0} r={A.r - 22} />
        <circle className="furin-orbit-text__aro furin-orbit-text__aro--fino" cx={C0} cy={C0} r={B.r - 18} />
        <g ref={gExt}>
          <text className="furin-orbit-text__texto" fontSize={A.fs} style={{ letterSpacing: `${aj.a.ls.toFixed(3)}px` }}>
            <textPath href={`#${uid}-a`}>{tramos(aj.a.str)}</textPath>
          </text>
        </g>
        <g ref={gInt}>
          <text className="furin-orbit-text__texto furin-orbit-text__texto--interior" fontSize={B.fs} style={{ letterSpacing: `${aj.b.ls.toFixed(3)}px` }}>
            <textPath href={`#${uid}-b`}>{tramos(aj.b.str)}</textPath>
          </text>
        </g>
        <circle ref={halo} cx={C0} cy={C0} r="13" fill={`url(#${uid}-g)`} opacity="0.25" />
        <circle ref={centro} className="furin-orbit-text__centro" cx={C0} cy={C0} r="4" />
        <text ref={medidor} className="furin-orbit-text__texto" x="0" y="0" visibility="hidden" aria-hidden="true" />
      </svg>
    </div>
  );
}

export default OrbitText;
