"use client";
import { Children, useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import "./SpotlightCards.css";

export interface SpotlightCardsItem {
  /** Título de la tarjeta. */
  title: string;
  /** Texto de apoyo debajo del título. */
  text: string;
  /** Ícono opcional que se dibuja arriba del título. */
  icon?: ReactNode;
}

export interface SpotlightCardsProps {
  /** Tarjetas a mostrar. Si no hay `items` ni `children`, se muestran 6 de ejemplo. */
  items?: SpotlightCardsItem[];
  /** Título y texto de cada una de las 6 tarjetas de ejemplo (solo se ven si omites items y children). */
  sample?: { title?: string; text?: string }[];
  /** Cuántas columnas tiene la rejilla (en pantallas angostas se reducen solas). */
  columns?: number;
  /** Color de la luz (cualquier color CSS). */
  color?: string;
  /** Radio de la luz, en px. */
  radius?: number;
  /** Espacio entre tarjetas, en px. */
  gap?: number;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
  /** Tarjetas propias: cada hijo se envuelve en una tarjeta. Tiene prioridad menor que `items`. */
  children?: ReactNode;
}

/** Ícono de línea de 24 px; solo recibe el trazo. */
const Icon = ({ path }: { path: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
);

/** Contenido de una tarjeta hecha a partir de un item. */
const CardBody = ({ item }: { item: SpotlightCardsItem }) => (
  <>
    {item.icon && <span className="furin-spotlight-cards__icon">{item.icon}</span>}
    <h3 className="furin-spotlight-cards__title">{item.title}</h3>
    <p className="furin-spotlight-cards__text">{item.text}</p>
  </>
);

const DEFAULT_ITEMS: SpotlightCardsItem[] = [
  {
    title: "Zero dependencies",
    text: "Just React. No GSAP, no Three, and no surprises in your page weight.",
    icon: <Icon path="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Zm0 0v18M3 7.5l9 4.5 9-4.5" />,
  },
  {
    title: "Real TypeScript",
    text: "Typed props and code that's a pleasure to read.",
    icon: <Icon path="m8 8-4 4 4 4m8-8 4 4-4 4m-3-10-2 12" />,
  },
  {
    title: "Light on mobile",
    text: "It pauses off-screen and looks after your visitors' battery.",
    icon: <Icon path="M13 3 5 13.5h6L10 21l9-11h-6.5L13 3Z" />,
  },
  {
    title: "See it before you copy it",
    text: "Tweak every prop live and copy the code once you love it.",
    icon: <Icon path="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />,
  },
  {
    title: "Respects reduced motion",
    text: "Anyone who asks for it gets a still frame, just as pretty.",
    icon: <Icon path="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Zm-3 9 2 2 4-4" />,
  },
  {
    title: "Yours forever",
    text: "MIT license on the free ones and unlimited projects with Pro.",
    icon: <Icon path="M12 12c-2-2.5-3.5-4-5.5-4a4 4 0 1 0 0 8c2 0 3.5-1.5 5.5-4Zm0 0c2 2.5 3.5 4 5.5 4a4 4 0 1 0 0-8c-2 0-3.5 1.5-5.5 4Z" />,
  },
];

/** Rejilla de tarjetas con una sola luz compartida: el borde se ilumina donde está el cursor. */
export function SpotlightCards({ items, sample, columns = 3, color = "#7C8BFF", radius = 260, gap = 16, className = "", style, children }: SpotlightCardsProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // Última posición del puntero en la ventana; null mientras no hay puntero.
    let pointer: { x: number; y: number } | null = null;
    let frameId = 0;
    // La luz se nota un poco antes de que el cursor entre al componente.
    const reach = radius * 0.6;

    /** Calcula, para cada tarjeta, dónde cae la luz respecto a su esquina. */
    const paint = () => {
      frameId = 0;
      if (!pointer) return;
      const { x, y } = pointer;
      const area = root.getBoundingClientRect();
      const near = x > area.left - reach && x < area.right + reach && y > area.top - reach && y < area.bottom + reach;
      root.dataset.lit = String(near);
      if (!near) return;

      const cards = root.querySelectorAll<HTMLElement>(".furin-spotlight-cards__card");
      // Primero se leen todas las posiciones y después se escribe, para no forzar recálculos de más.
      const rects = Array.from(cards, (card) => card.getBoundingClientRect());
      cards.forEach((card, i) => {
        card.style.setProperty("--x", `${x - rects[i].left}px`);
        card.style.setProperty("--y", `${y - rects[i].top}px`);
      });
    };

    const schedule = () => {
      if (!frameId) frameId = requestAnimationFrame(paint);
    };
    const onPointerMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const turnOff = () => {
      pointer = null;
      root.dataset.lit = "false";
    };
    // Con el dedo, soltar apaga la luz; con el mouse solo cuenta salir de la ventana.
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") turnOff();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", turnOff);
    document.documentElement.addEventListener("pointerleave", turnOff);
    // Si la página se desplaza con el cursor quieto, las tarjetas se mueven bajo la luz.
    window.addEventListener("scroll", schedule, { passive: true, capture: true });

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", turnOff);
      document.documentElement.removeEventListener("pointerleave", turnOff);
      window.removeEventListener("scroll", schedule, { capture: true });
    };
  }, [radius]);

  const cssVars = {
    "--furin-spotlight-cards-color": color,
    "--furin-spotlight-cards-radius": `${radius}px`,
    "--furin-spotlight-cards-gap": `${gap}px`,
    "--furin-spotlight-cards-columns": Math.max(1, columns),
    "--furin-spotlight-cards-columns-medium": Math.max(1, Math.min(columns, 2)),
  } as CSSProperties;

  // Prioridad: items propios, luego children, y si no hay nada, los de ejemplo.
  const entries = items ?? (children === undefined ? DEFAULT_ITEMS.map((d, k) => ({ ...d, ...sample?.[k] })) : null);
  const cards: ReactNode[] = entries ? entries.map((item) => <CardBody item={item} />) : Children.toArray(children);

  return (
    <div ref={rootRef} className={`furin-spotlight-cards ${className}`.trim()} style={{ ...cssVars, ...style }}>
      <div className="furin-spotlight-cards__grid">
        {cards.map((content, i) => (
          <div key={i} className="furin-spotlight-cards__card">
            <div className="furin-spotlight-cards__content">{content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SpotlightCards;
