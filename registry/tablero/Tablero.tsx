"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./Tablero.css";

export interface TableroProps {
  /** Frases que el tablero muestra en ciclo: un arreglo, o un solo texto con las frases separadas por "|". */
  phrases?: string[] | string;
  /** Texto fijo: si lo pasas, el tablero deja de ciclar y muestra este (vacío = usar las frases). */
  value?: string;
  /** Celdas por fila; las frases largas saltan de línea entre palabras. */
  columns?: number;
  /** Milisegundos que cada frase se queda quieta antes de cambiar a la siguiente. */
  interval?: number;
  /** Milisegundos que dura cada volteo de paleta. */
  flipSpeed?: number;
  /** Alto de cada celda en px a tamaño completo (se encoge si el tablero no cabe en su contenedor). */
  size?: number;
  /** Separación entre celdas en px. */
  gap?: number;
  /** Color de las paletas. */
  tileColor?: string;
  /** Color de las letras. */
  letterColor?: string;
  /** Clase CSS extra para el contenedor. */
  className?: string;
  /** Estilos en línea del contenedor. */
  style?: CSSProperties;
}

/** Piezas de una celda: dos mitades fijas y dos hojas que voltean sobre la bisagra del centro. */
interface Celda {
  /** Carácter que se ve ahora (ya asentado) o el que dejó el último volteo. */
  actual: string;
  /** Hacia dónde va el volteo en curso. */
  siguiente: string;
  /** Caracteres que faltan por pasar, el último es el de destino. */
  cola: string[];
  volteando: boolean;
  /** Avance del volteo en curso, de 0 a 1. */
  progreso: number;
  /** Segundos de espera antes de empezar a voltear (escalonan las celdas). */
  espera: number;
  fijaArriba: HTMLElement;
  fijaAbajo: HTMLElement;
  hojaCae: HTMLElement;
  hojaSube: HTMLElement;
  letras: HTMLElement[];
}

/** Lo que el efecto de las frases necesita del tablero. */
interface Control {
  /** Pone los caracteres de destino de cada celda; si `instantaneo`, sin animar. */
  mostrar: (destino: string[], instantaneo: boolean) => void;
  /** Se llama cada vez que todas las celdas quedan quietas. */
  alQuedarQuieto: (() => void) | null;
  visible: boolean;
}

/** El orden del tambor: las paletas pasan por los caracteres de en medio, como las de verdad. */
const TAMBOR = Array.from(" ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ÁÉÍÓÚÜÑ.,:-/&!?¿¡'+()%#$@");
/** Tope de volteos por celda: así un cambio largo no tarda una eternidad. */
const MAX_VOLTEOS = 14;
const MAX_COLUMNAS = 40;

const FRASES_POR_DEFECTO = ["Welcome to Furin", "The cursor is the wind", "Platform 3 at 18:45"];

function normalizarFrases(phrases: string[] | string): string[] {
  const lista = Array.isArray(phrases) ? phrases : phrases.split(/\||\n/);
  return lista.map((frase) => frase.trim()).filter(Boolean);
}

/** Parte el texto en filas de a lo más `columnas` caracteres, saltando entre palabras. */
function acomodar(texto: string, columnas: number): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  for (const palabra of texto.toLocaleUpperCase("es").split(/\s+/).filter(Boolean)) {
    let resto = Array.from(palabra);
    while (resto.length > columnas) {
      // Palabra más larga que la fila: se parte.
      if (fila.length) filas.push(fila);
      filas.push(resto.slice(0, columnas));
      fila = [];
      resto = resto.slice(columnas);
    }
    if (fila.length === 0) fila = resto;
    else if (fila.length + 1 + resto.length <= columnas) fila = [...fila, " ", ...resto];
    else {
      filas.push(fila);
      fila = resto;
    }
  }
  if (fila.length) filas.push(fila);
  return filas;
}

/** Una cuadrícula de filas × columnas con el texto centrado en cada fila; lo que sobra se queda en blanco. */
function distribuir(texto: string, columnas: number, filas: number): string[] {
  const destino: string[] = new Array(columnas * filas).fill(" ");
  acomodar(texto, columnas)
    .slice(0, filas)
    .forEach((fila, r) => {
      const inicio = Math.floor((columnas - fila.length) / 2);
      fila.forEach((letra, c) => {
        destino[r * columnas + inicio + c] = letra;
      });
    });
  return destino;
}

/** Los caracteres por los que pasa una celda para ir de `de` a `a` (el último es `a`). */
function planear(de: string, a: string): string[] {
  if (de === a) return [];
  const desde = TAMBOR.indexOf(de);
  const hasta = TAMBOR.indexOf(a);
  if (desde < 0 || hasta < 0) return [a]; // un carácter fuera del tambor: un solo volteo directo
  const pasos = (hasta - desde + TAMBOR.length) % TAMBOR.length;
  const cuantos = Math.min(pasos, MAX_VOLTEOS);
  return Array.from({ length: cuantos }, (_, k) => TAMBOR[(hasta - cuantos + 1 + k + TAMBOR.length) % TAMBOR.length]);
}

const escribir = (letras: HTMLElement[], caracter: string) => {
  for (const letra of letras) letra.textContent = caracter === " " ? "" : caracter;
};

/** Tablero de estación de tren: cada paleta voltea en 3D, pasando por los caracteres de en medio, hasta formar la frase. */
export function Tablero({
  phrases = FRASES_POR_DEFECTO,
  value,
  columns = 12,
  interval = 4200,
  flipSpeed = 70,
  size = 64,
  gap = 5,
  tileColor = "#111111",
  letterColor = "#FFFFFF",
  className = "",
  style,
}: TableroProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const control = useRef<Control | null>(null);
  const live = useRef({ interval, flipSpeed });
  const [leyendo, setLeyendo] = useState("");

  const cols = Math.round(Math.min(MAX_COLUMNAS, Math.max(3, columns)));
  const lista = useMemo(() => normalizarFrases(phrases), [phrases]);
  const fija = value ? value : null;
  const clave = fija ?? lista.join("\u0000");
  const textos = fija ? [fija] : lista;
  // Todas las frases comparten el mismo número de filas: el tablero no cambia de tamaño al cambiar de frase.
  const rows = Math.max(1, ...textos.map((texto) => acomodar(texto, cols).length));
  const cellCount = cols * rows;

  useEffect(() => {
    live.current = { interval, flipSpeed };
  }, [interval, flipSpeed]);

  // Motor del tablero: celdas, volteos y bucle de animación.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const celdas: Celda[] = Array.from(root.querySelectorAll<HTMLElement>(".furin-tablero__celda")).map((el) => {
      const [fijaArriba, fijaAbajo, hojaCae, hojaSube] = Array.from(el.children) as HTMLElement[];
      return {
        actual: " ",
        siguiente: " ",
        cola: [],
        volteando: false,
        progreso: 0,
        espera: 0,
        fijaArriba,
        fijaAbajo,
        hojaCae,
        hojaSube,
        letras: [fijaArriba, fijaAbajo, hojaCae, hojaSube].map((mitad) => mitad.firstElementChild as HTMLElement),
      };
    });

    let visible = true;
    let frameId = 0;
    let lastNow = 0;

    /** Deja la celda quieta mostrando `actual`, con las dos hojas escondidas. */
    const asentar = (celda: Celda) => {
      escribir(celda.letras, celda.actual);
      celda.hojaCae.style.visibility = "hidden";
      celda.hojaSube.style.visibility = "hidden";
      celda.fijaAbajo.style.removeProperty("--furin-tablero-sombra");
      celda.volteando = false;
      celda.progreso = 0;
    };

    /** Empieza un volteo hacia `siguiente`: la mitad de arriba cae mostrando lo viejo y revela lo nuevo. */
    const empezarVolteo = (celda: Celda, siguiente: string) => {
      celda.siguiente = siguiente;
      escribir([celda.fijaArriba.firstElementChild as HTMLElement, celda.hojaSube.firstElementChild as HTMLElement], siguiente);
      escribir([celda.fijaAbajo.firstElementChild as HTMLElement, celda.hojaCae.firstElementChild as HTMLElement], celda.actual);
      celda.hojaCae.style.transform = "rotateX(0deg)";
      celda.hojaCae.style.setProperty("--furin-tablero-sombra", "0");
      celda.hojaSube.style.transform = "rotateX(90deg)";
      celda.hojaCae.style.visibility = "visible";
      celda.hojaSube.style.visibility = "hidden";
      celda.volteando = true;
      celda.progreso = 0;
    };

    const pintar = (celda: Celda) => {
      const p = celda.progreso;
      if (p < 0.5) {
        // Primera mitad: la hoja de arriba cae hacia el frente (acelera, como por gravedad).
        const t = p * 2;
        celda.hojaCae.style.transform = `rotateX(${(-90 * t * t).toFixed(1)}deg)`;
        celda.hojaCae.style.setProperty("--furin-tablero-sombra", (t * 0.55).toFixed(2));
        celda.fijaAbajo.style.setProperty("--furin-tablero-sombra", (t * 0.4).toFixed(2));
      } else {
        // Segunda mitad: la hoja de abajo, con la letra nueva, termina de caer y frena al asentarse.
        if (celda.hojaCae.style.visibility !== "hidden") {
          celda.hojaCae.style.visibility = "hidden";
          celda.hojaSube.style.visibility = "visible";
          celda.fijaAbajo.style.removeProperty("--furin-tablero-sombra");
        }
        const t = (p - 0.5) * 2;
        const frenado = 1 - (1 - t) * (1 - t);
        celda.hojaSube.style.transform = `rotateX(${(90 * (1 - frenado)).toFixed(1)}deg)`;
        celda.hojaSube.style.setProperty("--furin-tablero-sombra", ((1 - frenado) * 0.5).toFixed(2));
      }
    };

    /** Avanza una celda `dt` segundos. Devuelve false cuando ya quedó quieta. */
    const avanzar = (celda: Celda, dt: number): boolean => {
      if (celda.espera > 0) {
        celda.espera -= dt;
        if (celda.espera > 0) return true;
        dt = -celda.espera;
        celda.espera = 0;
      }
      if (!celda.volteando) {
        if (celda.cola.length === 0) return false;
        empezarVolteo(celda, celda.cola.shift()!);
      }
      celda.progreso += dt / (Math.max(10, live.current.flipSpeed) / 1000);
      while (celda.progreso >= 1) {
        celda.actual = celda.siguiente;
        if (celda.cola.length === 0) {
          asentar(celda);
          return false;
        }
        const resto = celda.progreso - 1;
        empezarVolteo(celda, celda.cola.shift()!);
        celda.progreso = resto;
      }
      pintar(celda);
      return true;
    };

    const frame = (now: number) => {
      frameId = requestAnimationFrame(frame);
      const dt = Math.min((now - lastNow) / 1000, 0.05);
      lastNow = now;
      let busy = false;
      for (const celda of celdas) if (avanzar(celda, dt)) busy = true;
      if (!busy) {
        stop();
        api.alQuedarQuieto?.();
      }
    };
    const start = () => {
      if (frameId || !visible) return;
      lastNow = performance.now();
      frameId = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(frameId);
      frameId = 0;
    };

    const api: Control = {
      visible: true,
      alQuedarQuieto: null,
      mostrar: (destino, instantaneo) => {
        celdas.forEach((celda, i) => {
          const meta = destino[i] ?? " ";
          if (instantaneo || reducedMotion.matches) {
            celda.cola = [];
            celda.actual = celda.siguiente = meta;
            asentar(celda);
            return;
          }
          // Si ya va a medio volteo, termina ese y de ahí sigue hacia el nuevo destino.
          celda.cola = planear(celda.volteando ? celda.siguiente : celda.actual, meta);
          if (!celda.volteando && celda.cola.length) {
            // Las celdas arrancan una tras otra, de izquierda a derecha, con un poco de azar.
            const columna = i % cols;
            const fila = Math.floor(i / cols);
            celda.espera = columna * 0.02 + fila * 0.1 + Math.random() * 0.06;
          }
        });
        if (instantaneo || reducedMotion.matches) {
          stop();
          api.alQuedarQuieto?.();
        } else start();
      },
    };
    control.current = api;
    celdas.forEach(asentar); // arranca en blanco: la primera frase entra volteando

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = api.visible = entry.isIntersecting;
      if (!visible) return stop();
      if (celdas.some((celda) => celda.volteando || celda.cola.length)) start();
      else api.alQuedarQuieto?.();
    });
    visibilityObserver.observe(root);

    return () => {
      stop();
      visibilityObserver.disconnect();
      control.current = null;
    };
  }, [cellCount, cols]);

  // Qué frase se ve: una fija (value) o un ciclo por la lista.
  useEffect(() => {
    const motor = control.current;
    if (!motor) return;
    const cambio = (texto: string) => {
      setLeyendo(texto);
      motor.mostrar(distribuir(texto, cols, rows), false);
    };

    if (fija) {
      motor.alQuedarQuieto = null;
      cambio(fija);
      return () => {
        motor.alQuedarQuieto = null;
      };
    }

    let indice = 0;
    let temporizador = 0;
    const siguiente = () => {
      temporizador = 0;
      if (!motor.visible) return; // fuera de pantalla no avanza; al volver, alQuedarQuieto lo retoma
      indice = (indice + 1) % lista.length;
      cambio(lista[indice]);
    };
    motor.alQuedarQuieto =
      lista.length > 1
        ? () => {
            if (temporizador) return;
            temporizador = window.setTimeout(siguiente, Math.max(300, live.current.interval));
          }
        : null;
    cambio(lista[0] ?? "");
    return () => {
      clearTimeout(temporizador);
      motor.alQuedarQuieto = null;
    };
  }, [clave, cols, rows, cellCount]);

  const vars = {
    "--furin-tablero-columnas": cols,
    "--furin-tablero-tamano": `${size}px`,
    "--furin-tablero-hueco": `${gap}px`,
    "--furin-tablero-ficha": tileColor,
    "--furin-tablero-letra": letterColor,
  } as CSSProperties;

  const celdas = Array.from({ length: cellCount }, (_, i) => (
    <span key={i} className="furin-tablero__celda" aria-hidden="true">
      <span className="furin-tablero__mitad furin-tablero__mitad--arriba">
        <span className="furin-tablero__letra" />
      </span>
      <span className="furin-tablero__mitad furin-tablero__mitad--abajo">
        <span className="furin-tablero__letra" />
      </span>
      <span className="furin-tablero__mitad furin-tablero__mitad--arriba furin-tablero__hoja-cae">
        <span className="furin-tablero__letra" />
      </span>
      <span className="furin-tablero__mitad furin-tablero__mitad--abajo furin-tablero__hoja-sube">
        <span className="furin-tablero__letra" />
      </span>
    </span>
  ));

  return (
    <div ref={rootRef} className={`furin-tablero ${className}`.trim()} style={{ ...vars, ...style }}>
      {/* Texto real para lectores de pantalla: las celdas de abajo se ocultan. */}
      <span className="furin-tablero__lectura" aria-live={fija ? "polite" : "off"}>
        {leyendo || fija || lista[0] || ""}
      </span>
      {celdas}
    </div>
  );
}

export default Tablero;
