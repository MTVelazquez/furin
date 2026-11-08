"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import "./Typewriter.css";

export interface TypewriterProps {
  /** Frases separadas por "|" (alternativa a `phrases`). */
  children?: string;
  /** Lista de frases que se escriben una tras otra. */
  phrases?: string[];
  /** Texto fijo que precede a la frase que se escribe. */
  prefix?: string;
  /** Tamaño de la letra, en px. */
  size?: number;
  /** Milisegundos por letra al escribir (el ritmo humano varía alrededor de este valor). */
  speed?: number;
  /** Milisegundos por letra al borrar. */
  deleteSpeed?: number;
  /** Milisegundos que descansa la frase completa antes de borrarse. */
  hold?: number;
  /** Probabilidad (0 a 0.2) de equivocarse de tecla, notarlo y corregir. */
  mistakes?: number;
  /** Repite las frases sin parar. */
  loop?: boolean;
  /** Forma del cursor. */
  cursor?: "bar" | "block" | "underscore";
  /** Color de la frase escrita. */
  color?: string;
  /** Color del cursor y del prefijo resaltado. */
  accent?: string;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const VECINAS: Record<string, string> = {
  q: "wa", w: "qes", e: "wrd", r: "etf", t: "ryg", y: "tuh", u: "yij", i: "uok", o: "ipl", p: "ol",
  a: "qsz", s: "adw", d: "sfe", f: "dgr", g: "fht", h: "gjy", j: "hku", k: "jli", l: "kop", z: "asx",
  x: "zc", c: "xv", v: "cb", b: "vn", n: "bm", m: "n",
};

/** Una letra vecina en el teclado, respetando mayúsculas. */
function tecla(ch: string): string {
  const base = ch.toLowerCase();
  const v = VECINAS[base];
  if (!v) return ch;
  const m = v[Math.floor(Math.random() * v.length)];
  return ch === base ? m : m.toUpperCase();
}

/** Número casi gaussiano (−1 a 1), para que el ritmo no sea metronómico. */
const ruido = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1;

/** Escribe, se equivoca (si se le pide), corrige, descansa, borra y reescribe frases con ritmo humano. */
export function Typewriter({
  children = "interfaces that breathe.|software with craft.|brands people remember.",
  phrases,
  prefix = "We create",
  size = 40,
  speed = 62,
  deleteSpeed = 30,
  hold = 1700,
  mistakes = 0.04,
  loop = true,
  cursor = "bar",
  color = "#F4F5F7",
  accent = "#7CF5C6",
  className = "",
  style,
}: TypewriterProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const textoRef = useRef<HTMLSpanElement>(null);
  const lista = (phrases && phrases.length ? phrases : String(children ?? "").split("|")).map((s) => s.trim()).filter(Boolean);
  const clave = lista.join("\u0001");
  const cfg = useRef({ speed, deleteSpeed, hold, mistakes, loop });
  cfg.current = { speed, deleteSpeed, hold, mistakes, loop };

  useEffect(() => {
    const root = rootRef.current, out = textoRef.current;
    if (!root || !out || !lista.length) return;
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const escribir = (s: string) => { out.textContent = s; };
    out.textContent = "";
    if (reducido) { escribir(lista[0]); root.dataset.estado = "quieto"; return; }

    const S = { fase: "escribe" as "escribe" | "descansa" | "borra", p: 0, i: 0, mal: 0, visto: "", inicio: 0, firme: false };
    let timer = 0, visible = true, muerto = false, dormido = false;
    const espera = (ms: number) => { timer = window.setTimeout(tick, Math.max(0, ms)); };

    // Retraso de cada tecla: ritmo base con jitter, pausas con la puntuación y algún titubeo.
    const retraso = (ch: string, prev: string) => {
      let d = cfg.current.speed * Math.exp(ruido() * 0.45);
      if (ch === " ") d *= 1.25;
      if (/[,;:]/.test(prev)) d += 170 + Math.random() * 140;
      if (/[.!?…]/.test(prev)) d += 320 + Math.random() * 200;
      if (Math.random() < 0.035) d += 180 + Math.random() * 260;
      return d;
    };

    function tick() {
      timer = 0;
      if (muerto) return;
      if (!visible) { dormido = true; return; }
      const frase = lista[S.p];
      const c = cfg.current;
      if (S.fase === "escribe") {
        root!.dataset.estado = "escribe";
        if (S.mal > 0) {
          // Corrige: borra la tecla equivocada y retoma.
          S.visto = S.visto.slice(0, -1); S.mal--; escribir(S.visto);
          S.firme = true; // la tecla que sigue a una corrección sale bien
          return espera(S.mal > 0 ? 55 : 130 + Math.random() * 90);
        }
        if (S.i >= frase.length) {
          S.fase = "descansa";
          return espera(0);
        }
        const ch = frase[S.i];
        if (c.mistakes > 0 && !S.firme && S.i > 1 && /[a-záéíóúñ]/i.test(ch) && Math.random() < c.mistakes) {
          S.visto += tecla(ch); S.mal = 1; escribir(S.visto);
          return espera(260 + Math.random() * 280); // el momento de darse cuenta
        }
        S.firme = false;
        S.visto += ch; S.i++; escribir(S.visto);
        return espera(retraso(ch, frase[S.i - 2] ?? ""));
      }
      if (S.fase === "descansa") {
        root!.dataset.estado = "descansa";
        const ultima = S.p === lista.length - 1;
        if (!c.loop && ultima) return; // se queda con la última frase escrita
        if (lista.length === 1 && !c.loop) return;
        S.fase = "borra"; S.inicio = S.visto.length;
        return espera(c.hold);
      }
      // Borra: arranca con calma y acelera, como quien mantiene la tecla.
      root!.dataset.estado = "escribe";
      if (!S.visto.length) {
        S.p = (S.p + 1) % lista.length; S.i = 0; S.fase = "escribe";
        return espera(380 + Math.random() * 200);
      }
      S.visto = S.visto.slice(0, -1); escribir(S.visto);
      const prog = 1 - S.visto.length / Math.max(1, S.inicio);
      return espera(c.deleteSpeed * (1.5 - Math.min(1, prog * 2.2) * 0.9) * (0.85 + Math.random() * 0.3));
    }

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && dormido && !timer) { dormido = false; espera(0); }
    }, { rootMargin: "40px" });
    io.observe(root);
    espera(450);
    return () => { muerto = true; clearTimeout(timer); io.disconnect(); };
  }, [clave]);

  const vars = { "--furin-tw-size": `${size}px`, "--furin-tw-color": color, "--furin-tw-accent": accent } as CSSProperties;
  const total = lista.map((s) => `${prefix} ${s}`.trim()).join(" ");

  return (
    <span ref={rootRef} className={`furin-typewriter ${className}`} data-cursor={cursor} data-estado="escribe" style={{ ...vars, ...style }}>
      <span className="furin-typewriter__sr">{total}</span>
      <span className="furin-typewriter__visible" aria-hidden="true">
        {prefix ? <span className="furin-typewriter__prefijo">{prefix}</span> : null}
        <span className="furin-typewriter__linea">
          <span ref={textoRef} className="furin-typewriter__texto" />
          <span className="furin-typewriter__cursor" />
        </span>
      </span>
    </span>
  );
}

export default Typewriter;
