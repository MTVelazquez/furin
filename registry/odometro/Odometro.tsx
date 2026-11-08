"use client";
import { useLayoutEffect, useState } from "react";
import type { CSSProperties } from "react";
import "./Odometro.css";

export interface OdometroProps {
  /** Número que se muestra; si cambia, las columnas ruedan hasta el nuevo valor. */
  value?: number;
  /** Texto antes del número, por ejemplo "$". */
  prefix?: string;
  /** Texto después del número, por ejemplo " MXN" o "%". */
  suffix?: string;
  /** Separador de miles ("" para no separar). */
  separator?: string;
  /** Separador decimal. */
  decimalSeparator?: string;
  /** Cuántos decimales se muestran. */
  decimals?: number;
  /** Duración del giro de cada columna, en milisegundos. */
  duration?: number;
  /** Retraso extra entre una columna y la siguiente (de izquierda a derecha), en milisegundos. */
  stagger?: number;
  /** Curva de la animación (cualquier valor válido de transition-timing-function). */
  easing?: string;
  /** Si es true, al montar rueda desde cero hasta el valor. */
  animateOnMount?: boolean;
  /** Color de los dígitos (por defecto hereda el del texto). */
  color?: string;
  /** Color del prefijo y el sufijo (por defecto, el del texto atenuado). */
  affixColor?: string;
  /** Clase CSS extra para el contenedor. */
  className?: string;
  /** Estilos en línea del contenedor (aquí va el tamaño y la fuente). */
  style?: CSSProperties;
}

const DIGITOS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Da formato al número: miles agrupados, decimales fijos y signo. */
function formatear(valor: number, decimales: number, separador: string, decimal: string): string {
  const seguro = Number.isFinite(valor) ? valor : 0;
  const [entero, fraccion] = Math.abs(seguro).toFixed(Math.max(0, Math.min(decimales, 20))).split(".");
  const agrupado = entero.replace(/\B(?=(\d{3})+(?!\d))/g, separador);
  const signo = seguro < 0 && Number(Math.abs(seguro).toFixed(decimales)) !== 0 ? "-" : "";
  return signo + agrupado + (fraccion ? decimal + fraccion : "");
}

/** Una columna con los dígitos del 0 al 9; solo se ve uno a la vez. */
function Columna({ digito, retraso }: { digito: number; retraso: number }) {
  return (
    <span className="furin-odometro__columna">
      <span
        className="furin-odometro__tira"
        // Cada dígito mide el 10 % de la tira, así que subir "n" dígitos es -10 % × n.
        style={{ transform: `translateY(${digito * -10}%)`, transitionDelay: `${retraso}ms` }}
      >
        {DIGITOS.map((d) => (
          <span key={d} className="furin-odometro__digito">
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

export function Odometro({
  value = 0,
  prefix = "",
  suffix = "",
  separator = ",",
  decimalSeparator = ".",
  decimals = 0,
  duration = 1800,
  stagger = 90,
  easing = "cubic-bezier(0.16, 1, 0.3, 1)",
  animateOnMount = true,
  color,
  affixColor,
  className = "",
  style,
}: OdometroProps) {
  // enCeros: las columnas se muestran en 0 antes de rodar hacia el valor.
  // animar: las transiciones solo se activan después de montar, para que el
  // salto inicial a ceros no se vea (ni con el HTML que llega del servidor).
  const [enCeros, setEnCeros] = useState(false);
  const [animar, setAnimar] = useState(false);

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (animateOnMount) setEnCeros(true);

    // Se espera a que el navegador pinte los ceros antes de pedir el giro.
    let segundo = 0;
    const primero = requestAnimationFrame(() => {
      segundo = requestAnimationFrame(() => {
        setAnimar(true);
        setEnCeros(false);
      });
    });
    return () => {
      cancelAnimationFrame(primero);
      cancelAnimationFrame(segundo);
    };
  }, [animateOnMount]);

  const texto = formatear(value, decimals, separator, decimalSeparator);
  const simbolos = Array.from(texto);

  const variables = {
    "--furin-odometro-color": color,
    "--furin-odometro-afijo": affixColor,
    "--furin-odometro-duracion": `${duration}ms`,
    "--furin-odometro-curva": easing,
    ...style,
  } as CSSProperties;

  return (
    <span className={`furin-odometro${animar ? " furin-odometro--animado" : ""} ${className}`.trim()} style={variables}>
      {/* Lo que leen los lectores de pantalla: el valor final, y avisa solo cuando cambia. */}
      <span className="furin-odometro__lectura" aria-live="polite" aria-atomic="true">
        {prefix}
        {texto}
        {suffix}
      </span>
      <span className="furin-odometro__visual" aria-hidden="true">
        {prefix && <span className="furin-odometro__afijo">{prefix}</span>}
        {simbolos.map((simbolo, i) => {
          // La clave cuenta desde la derecha: si el número gana una cifra, las
          // columnas existentes conservan su identidad y ruedan en lugar de reiniciarse.
          const desdeLaDerecha = simbolos.length - 1 - i;
          if (!/\d/.test(simbolo)) {
            return (
              <span key={`s${desdeLaDerecha}`} className="furin-odometro__simbolo">
                {simbolo}
              </span>
            );
          }
          return (
            <Columna
              key={`d${desdeLaDerecha}`}
              digito={enCeros ? 0 : Number(simbolo)}
              retraso={i * stagger}
            />
          );
        })}
        {suffix && <span className="furin-odometro__afijo">{suffix}</span>}
      </span>
    </span>
  );
}

export default Odometro;
