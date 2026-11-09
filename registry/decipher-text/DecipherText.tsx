"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./DecipherText.css";

export type DecipherDirection = "left" | "right" | "center" | "random";
export type DecipherTrigger = "mount" | "cursor" | "both";

export interface DecipherTextProps {
  /** Texto final que se revela. */
  text?: string;
  /** Letras que se asientan por segundo. */
  speed?: number;
  /** Milisegundos de desorden antes de que se asiente la primera letra. */
  delay?: number;
  /** Alfabeto del que salen los caracteres aleatorios. */
  scrambleChars?: string;
  /** Por dónde empiezan a asentarse las letras. */
  revealDirection?: DecipherDirection;
  /** Cuándo se descifra: al montar, al pasar el cursor, o ambos. */
  trigger?: DecipherTrigger;
  /** Color de las letras ya asentadas (por defecto hereda el del texto). */
  color?: string;
  /** Color de las letras que aún se mezclan (por defecto, el mismo texto atenuado). */
  scrambleColor?: string;
  /** Clase CSS extra para el contenedor. */
  className?: string;
  /** Estilos en línea del contenedor (aquí va el tamaño y la fuente). */
  style?: CSSProperties;
}

const ALFABETO_POR_DEFECTO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+<>/?!";
/** Cada cuántos milisegundos cambian los caracteres que aún no se asientan. */
const REFRESCO_MS = 45;

/** Para cada posición del texto: en qué turno se asienta (0 = la primera en asentarse). */
function calcularTurnos(letras: string[], direccion: DecipherDirection): number[] {
  const posiciones: number[] = [];
  letras.forEach((letra, i) => {
    if (letra.trim() !== "") posiciones.push(i);
  });

  const centro = (letras.length - 1) / 2;
  if (direccion === "right") posiciones.reverse();
  if (direccion === "center") posiciones.sort((a, b) => Math.abs(a - centro) - Math.abs(b - centro));
  if (direccion === "random") {
    for (let i = posiciones.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [posiciones[i], posiciones[j]] = [posiciones[j], posiciones[i]];
    }
  }

  const turnos: number[] = letras.map(() => -1); // los espacios nunca se mezclan
  posiciones.forEach((posicion, turno) => {
    turnos[posicion] = turno;
  });
  return turnos;
}

export function DecipherText({
  text = "Decipher the message",
  speed = 16,
  delay = 0,
  scrambleChars = ALFABETO_POR_DEFECTO,
  revealDirection = "left",
  trigger = "both",
  color,
  scrambleColor,
  className = "",
  style,
}: DecipherTextProps) {
  // null = todo asentado; si no, un arreglo con el carácter aleatorio de cada
  // posición (null en las letras que ya quedaron en su lugar).
  const [mezcla, setMezcla] = useState<(string | null)[] | null>(null);
  const cuadro = useRef(0);

  const detener = useCallback(() => {
    cancelAnimationFrame(cuadro.current);
    cuadro.current = 0;
  }, []);

  const descifrar = useCallback(() => {
    detener();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMezcla(null);
      return;
    }

    const letras = Array.from(text);
    const turnos = calcularTurnos(letras, revealDirection);
    const alfabeto = Array.from(scrambleChars.length > 0 ? scrambleChars : ALFABETO_POR_DEFECTO);
    const porLetra = 1000 / Math.max(speed, 0.1);
    const mezclables = turnos.filter((turno) => turno >= 0).length;
    const inicio = performance.now() + delay;
    let ultimoRefresco = -Infinity;
    let ultimasAsentadas = -1;

    const aleatorio = () => alfabeto[Math.floor(Math.random() * alfabeto.length)];

    const paso = (ahora: number) => {
      const asentadas = Math.max(0, Math.floor((ahora - inicio) / porLetra));
      if (asentadas >= mezclables) {
        cuadro.current = 0;
        setMezcla(null);
        return;
      }
      // Solo se vuelve a dibujar cuando toca refrescar o se asentó una letra nueva.
      if (ahora - ultimoRefresco >= REFRESCO_MS || asentadas !== ultimasAsentadas) {
        ultimoRefresco = ahora;
        ultimasAsentadas = asentadas;
        setMezcla(turnos.map((turno) => (turno < 0 || turno < asentadas ? null : aleatorio())));
      }
      cuadro.current = requestAnimationFrame(paso);
    };

    // Primer cuadro ya mezclado para que no se vea el texto final antes de empezar.
    setMezcla(turnos.map((turno) => (turno < 0 ? null : aleatorio())));
    cuadro.current = requestAnimationFrame(paso);
  }, [text, speed, delay, scrambleChars, revealDirection, detener]);

  // useLayoutEffect para empezar mezclado antes del primer dibujo (React 19 no avisa en SSR).
  useLayoutEffect(() => {
    if (trigger !== "cursor") descifrar();
    else setMezcla(null);
    return detener;
  }, [trigger, descifrar, detener]);

  const alEntrarElCursor = () => {
    if (trigger !== "mount" && cuadro.current === 0) descifrar();
  };

  // Se parte en palabras para que el texto largo pueda saltar de línea entre palabras.
  const piezas = text.split(/(\s+)/).filter((pieza) => pieza !== "");
  let indice = 0;

  const variables = {
    "--furin-decipher-text-color": color,
    "--furin-decipher-text-mezcla": scrambleColor,
    ...style,
  } as CSSProperties;

  return (
    <span className={`furin-decipher-text ${className}`.trim()} style={variables} onPointerEnter={alEntrarElCursor}>
      <span className="furin-decipher-text__lectura">{text}</span>
      <span aria-hidden="true">
        {piezas.map((pieza, k) => {
          const letras = Array.from(pieza);
          const primera = indice;
          indice += letras.length;
          if (pieza.trim() === "") return pieza;
          return (
            <span key={k} className="furin-decipher-text__palabra">
              {letras.map((letra, j) => (
                <span key={j} className="furin-decipher-text__letra" data-mezcla={mezcla?.[primera + j] ?? undefined}>
                  {letra}
                </span>
              ))}
            </span>
          );
        })}
      </span>
    </span>
  );
}

export default DecipherText;
