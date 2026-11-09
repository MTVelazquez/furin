"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as PunteroReact } from "react";
import "./ChimeBell.css";

export interface ChimeBellProps {
  /** Color del vidrio de la campana. */
  glass?: string;
  /** Color de la pintura del borde de la campana (y del número de la tira). */
  paint?: string;
  /** Color de la tira de papel (tanzaku) que cuelga del badajo. */
  strip?: string;
  /** Número de avisos que se muestra en la tira (0 la deja en blanco); si sube, la campana suena sola. */
  count?: number;
  /** Si es true, la campana suena; si es false, solo se mueve. El audio arranca tras la primera interacción de la persona. */
  sound?: boolean;
  /** Volumen del tintineo, de 0 a 1. */
  volume?: number;
  /** Intensidad de la brisa que la mece sola, de 0 (quieta) a 1. */
  breeze?: number;
  /** Qué tanto empuja el viento del cursor: 0 lo ignora, 1 es normal, 2 es un vendaval. */
  wind?: number;
  /** Alto de la campana en px (el ancho se calcula solo). */
  size?: number;
  /** Se llama cada vez que suena, con la intensidad del golpe de 0 a 1. */
  onRing?: (intensity: number) => void;
  /** Clase CSS extra para el contenedor. */
  className?: string;
  /** Estilos en línea del contenedor. */
  style?: CSSProperties;
}

/* ---------- Geometría del dibujo (viewBox de 240 x 360) ---------- */

const ANCHO_DIBUJO = 240;
const ALTO_DIBUJO = 360;
/** Punto del que cuelga todo. */
const PIVOTE = { x: 120, y: 20 };
/** Del pivote a la cúspide de la campana (largo de la cuerda). */
const CUERDA = 44;
/** De la cúspide al nudo donde se ata la tira: el brazo del badajo. */
const HILO = 150;
/** Distancia de la cúspide al badajo (la bolita), y su radio. */
const BADAJO = { y: 114, radio: 8.5 };
/** Mitad del ancho interior de la boca, donde el badajo choca. */
const MITAD_BOCA = 56;
const TIRA = { ancho: 40, alto: 112 };

/* ---------- Física ---------- */

/** El péndulo doble se integra en pasos fijos para que sea estable y no dependa de los fps. */
const PASO = 1 / 240;
const DT_MAXIMO = 1 / 30;
/** Gravedad en unidades del dibujo por s². Más alta que la real: el mecimiento se ve más vivo. */
const G = 1800;
/** Masas y largos del péndulo doble: m1 = campana (pesada), m2 = badajo con tira (ligera). */
const M1 = 3;
const M2 = 1;
const L1 = CUERDA;
const L2 = 190;
/** Ángulo (rad) entre el badajo y el eje de la campana al que choca contra el borde de vidrio. */
const ANGULO_CHOQUE = Math.asin((MITAD_BOCA - BADAJO.radio) / BADAJO.y);
/** Cuánta energía conserva el badajo al rebotar en el vidrio. */
const REBOTE = 0.5;
/** Ángulo máximo permitido para cualquiera de las dos partes (rad). */
const LIMITE = 1.2;
/** Pausa mínima entre dos sonidos (s): evita ametrallar el tintineo. */
const PAUSA_SONIDO = 0.07;

const limitar = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/* ---------- Audio: tintineo de vidrio sintetizado con WebAudio ---------- */

interface Parcial {
  /** Razón respecto a la frecuencia base: los parciales de una campana de vidrio no son armónicos. */
  razon: number;
  /** Volumen relativo. */
  nivel: number;
  /** Segundos que dura el parcial. */
  duracion: number;
}

const PARCIALES: Parcial[] = [
  { razon: 1, nivel: 1, duracion: 1.9 },
  { razon: 2.32, nivel: 0.5, duracion: 1.1 },
  { razon: 4.25, nivel: 0.3, duracion: 0.65 },
  { razon: 6.63, nivel: 0.17, duracion: 0.4 },
  { razon: 9.38, nivel: 0.09, duracion: 0.25 },
];

interface Motor {
  contexto: AudioContext;
  /** Volumen general: todo lo que suena pasa por aquí. */
  salida: GainNode;
  /** Entrada del eco corto que da "aire" al tintineo. */
  eco: DelayNode;
  /** Cuántos golpes están sonando ahora (se limita para no saturar). */
  voces: number;
}

/** Crea el contexto de audio con un poco de "aire" (un eco corto y apagado). Solo se llama tras un gesto. */
function crearMotor(): Motor | null {
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const contexto = new Ctor();
  const salida = contexto.createGain();
  salida.connect(contexto.destination);

  const eco = contexto.createDelay(0.5);
  eco.delayTime.value = 0.115;
  const realimentacion = contexto.createGain();
  realimentacion.gain.value = 0.32;
  const apagado = contexto.createBiquadFilter();
  apagado.type = "lowpass";
  apagado.frequency.value = 3800;
  const mezclaEco = contexto.createGain();
  mezclaEco.gain.value = 0.26;
  eco.connect(apagado);
  apagado.connect(realimentacion);
  realimentacion.connect(eco);
  apagado.connect(mezclaEco);
  mezclaEco.connect(salida);
  return { contexto, salida, eco, voces: 0 };
}

/** Un golpe de vidrio: parciales inarmónicos con decaimiento, un clic de ataque y algo de azar por golpe. */
function tintinear(motor: Motor, intensidad: number, volumen: number) {
  const { contexto, salida, eco } = motor;
  if (motor.voces > 7) return;
  const t0 = contexto.currentTime + 0.005;
  const base = 1900 + Math.random() * 1000;
  const fuerza = 0.05 + 0.2 * limitar(intensidad, 0, 1) ** 1.2;

  const mezcla = contexto.createGain();
  mezcla.gain.value = limitar(volumen, 0, 1);
  const paneo = contexto.createStereoPanner?.();
  if (paneo) {
    paneo.pan.value = (Math.random() - 0.5) * 0.7;
    mezcla.connect(paneo);
    paneo.connect(salida);
  } else {
    mezcla.connect(salida);
  }
  mezcla.connect(eco);

  let ultimoFin = t0;
  const voz = (frecuencia: number, nivel: number, duracion: number) => {
    const osc = contexto.createOscillator();
    const env = contexto.createGain();
    osc.type = "sine";
    osc.frequency.value = frecuencia;
    // Ataque casi instantáneo y caída exponencial: así suena el vidrio al golpearlo.
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(fuerza * nivel, t0 + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duracion);
    osc.connect(env);
    env.connect(mezcla);
    osc.start(t0);
    osc.stop(t0 + duracion + 0.05);
    ultimoFin = Math.max(ultimoFin, t0 + duracion + 0.05);
  };

  motor.voces += 1;
  PARCIALES.forEach((p, i) => {
    // Cada golpe desafina un poco los parciales: nunca suena dos veces igual.
    const desafine = 1 + (Math.random() - 0.5) * 0.014;
    voz(base * p.razon * desafine, p.nivel, p.duracion * (0.75 + 0.5 * intensidad));
    if (i === 0) {
      // Un gemelo apenas desafinado crea el "batido" brillante del vidrio.
      voz(base * desafine + 2.5 + Math.random() * 3, p.nivel * 0.55, p.duracion * 0.9);
    }
  });

  // Clic de ataque: un soplo de ruido filtrado, cortísimo.
  const largo = Math.floor(contexto.sampleRate * 0.02);
  const buffer = contexto.createBuffer(1, largo, contexto.sampleRate);
  const datos = buffer.getChannelData(0);
  for (let i = 0; i < largo; i++) datos[i] = (Math.random() * 2 - 1) * (1 - i / largo);
  const ruido = contexto.createBufferSource();
  ruido.buffer = buffer;
  const filtro = contexto.createBiquadFilter();
  filtro.type = "highpass";
  filtro.frequency.value = 4200;
  const envRuido = contexto.createGain();
  envRuido.gain.value = 0.35 * fuerza;
  ruido.connect(filtro);
  filtro.connect(envRuido);
  envRuido.connect(mezcla);
  ruido.start(t0);

  window.setTimeout(
    () => {
      motor.voces = Math.max(0, motor.voces - 1);
      mezcla.disconnect();
    },
    (ultimoFin - contexto.currentTime) * 1000 + 100,
  );
}

/** Número de avisos tal como cabe en la tira. */
function textoAvisos(n: number): string {
  return n > 99 ? "99+" : String(Math.max(0, Math.round(n)));
}

/** Elige el color del número según qué tan clara es la tira (solo entiende #rgb y #rrggbb). */
function colorLegible(tira: string, pintura: string): string {
  const hex = tira.trim().replace("#", "");
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return pintura;
  const completo = hex.length === 3 ? hex.replace(/./g, "$&$&") : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(completo.slice(i, i + 2), 16));
  const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminancia > 0.6 ? pintura : "#ffffff";
}

/** Franja de triángulos pintados (uroko) sobre el borde: se calcula una vez, es siempre igual. */
const ESCAMAS = (() => {
  const lineaBase = (x: number) => 141 + 11 * Math.sqrt(Math.max(0, 1 - ((x - 120) / 63) ** 2));
  let d = "";
  for (let x = 57; x < 183; x += 14) {
    d += `M${x} ${lineaBase(x).toFixed(1)}L${x + 7} ${(lineaBase(x + 7) - 12).toFixed(1)}L${x + 14} ${lineaBase(x + 14).toFixed(1)}Z`;
  }
  return d;
})();

/** Silueta del vidrio: cúpula con un reborde que se abre hacia la boca. */
const SILUETA = "M60 168C60 110 84 70 120 64C156 70 180 110 180 168C181 174 184 177 186 180A66 11 0 0 1 54 180C56 177 59 174 60 168Z";

export function ChimeBell({
  glass: vidrio = "#9ED8FF",
  paint: pintura = "#E8452C",
  strip: tira = "#FFFFFF",
  count: contador = 0,
  sound: sonido = true,
  volume: volumen = 0.7,
  breeze: brisa = 0.4,
  wind: viento = 1,
  size: tamano = 380,
  onRing: alSonar,
  className = "",
  style,
}: ChimeBellProps) {
  const raiz = useRef<HTMLDivElement>(null);
  const dibujo = useRef<SVGSVGElement>(null);
  const campanaAtras = useRef<SVGGElement>(null);
  const campanaFrente = useRef<SVGGElement>(null);
  const brazo = useRef<SVGGElement>(null);
  const tiraGrupo = useRef<SVGGElement>(null);
  const motor = useRef<Motor | null>(null);
  /** Puente hacia la simulación, que vive dentro del efecto. */
  const api = useRef<{ golpear: (intensidad: number, direccion: number) => void; sobre: (parte: string, dentro: boolean) => void } | null>(null);
  const [ecos, setEcos] = useState(0);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");

  // Los ajustes se leen dentro del bucle: cambiarlos en vivo no reinicia la campana.
  const ajustes = useRef({ sonido, volumen, brisa, viento, alSonar });
  useEffect(() => {
    ajustes.current = { sonido, volumen, brisa, viento, alSonar };
  }, [sonido, volumen, brisa, viento, alSonar]);

  /** Crea (o reanuda) el audio. Solo se llama dentro de un gesto de la persona: así el navegador lo permite. */
  const arrancarAudio = () => {
    if (!ajustes.current.sonido) return;
    if (!motor.current) motor.current = crearMotor();
    void motor.current?.contexto.resume();
  };

  // Audio: el contexto solo nace después de que la persona toca o teclea algo en la página.
  useEffect(() => {
    if (!sonido) return;
    window.addEventListener("pointerdown", arrancarAudio, { passive: true });
    window.addEventListener("keydown", arrancarAudio, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", arrancarAudio);
      window.removeEventListener("keydown", arrancarAudio);
      if (motor.current) {
        void motor.current.contexto.close();
        motor.current = null;
      }
    };
  }, [sonido]);

  // ChimeBell de avisos: cuando el contador sube, suena sola.
  const contadorPrevio = useRef(contador);
  useEffect(() => {
    if (contador > contadorPrevio.current) api.current?.golpear(0.85, Math.random() < 0.5 ? -1 : 1);
    contadorPrevio.current = contador;
  }, [contador]);

  useEffect(() => {
    const caja = raiz.current;
    const svg = dibujo.current;
    const atras = campanaAtras.current;
    const frente = campanaFrente.current;
    const brazoEl = brazo.current;
    const tiraEl = tiraGrupo.current;
    if (!caja || !svg || !atras || !frente || !brazoEl || !tiraEl) return;

    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Estado: ángulos desde la vertical (positivo = hacia la derecha) y sus velocidades.
    let th1 = 0;
    let w1 = 0;
    let th2 = 0;
    let w2 = 0;
    let th3 = 0; // la tira respecto al brazo
    let w3 = 0;
    let brillo = 0; // destello del vidrio tras un golpe, de 1 a 0
    let ultimoGolpe = -10;
    let tiempo = 0;
    let acumulado = 0;
    let ultimoCuadro = 0;
    let cuadro = 0;
    let visible = true;
    /** Viento del cursor: velocidad horizontal suavizada (unidades del dibujo por s) y último punto. */
    let vientoX = 0;
    let ultimoPunto: { x: number; y: number; t: number } | null = null;
    /** Posición del cursor en unidades del dibujo, para saber qué tan cerca sopla. */
    let cursor: { x: number; y: number } | null = null;
    const sobre = { campana: false, tira: false };
    let asentado = 0; // 0 a 1: cuánto se está "sujetando" la campana por tener el cursor encima

    const sonar = (intensidad: number) => {
      const t = tiempo;
      if (t - ultimoGolpe < PAUSA_SONIDO) return;
      ultimoGolpe = t;
      brillo = 1;
      setEcos((n) => n + 1);
      const { sonido: activo, volumen: vol, alSonar: aviso } = ajustes.current;
      if (activo && motor.current) {
        if (motor.current.contexto.state === "suspended") void motor.current.contexto.resume();
        tintinear(motor.current, intensidad, vol);
      }
      aviso?.(intensidad);
      pintar();
      despertar();
    };

    /** Golpe directo (toque, tecla o aviso): empuja el badajo y suena al instante. */
    const golpear = (intensidad: number, direccion: number) => {
      w2 += direccion * (3.5 + 3 * intensidad);
      w1 -= direccion * 0.5 * intensidad;
      sonar(intensidad);
    };

    const pintar = () => {
      // En SVG un ángulo positivo gira a las agujas del reloj; aquí positivo es hacia la derecha: se invierte.
      const grados = (rad: number) => (-rad * 180) / Math.PI;
      const giro1 = `rotate(${grados(th1).toFixed(3)} ${PIVOTE.x} ${PIVOTE.y})`;
      atras.setAttribute("transform", giro1);
      frente.setAttribute("transform", giro1);
      const cuspideX = PIVOTE.x + L1 * Math.sin(th1);
      const cuspideY = PIVOTE.y + L1 * Math.cos(th1);
      brazoEl.setAttribute("transform", `translate(${cuspideX.toFixed(2)} ${cuspideY.toFixed(2)}) rotate(${grados(th2).toFixed(3)})`);
      tiraEl.setAttribute("transform", `translate(0 ${HILO}) rotate(${grados(th3).toFixed(3)})`);
      svg.style.setProperty("--furin-chime-bell-brillo", brillo.toFixed(3));
    };

    /** Un paso de física: péndulo doble (campana + badajo con tira), viento, choque con el vidrio. */
    const simular = (h: number) => {
      tiempo += h;
      const { brisa: suave, viento: fuerzaViento } = ajustes.current;

      // Brisa ambiente: suma de ondas lentas, con más efecto sobre la tira (que es una vela).
      const aire =
        suave *
        (0.55 * Math.sin(tiempo * 0.7) + 0.38 * Math.sin(tiempo * 1.93 + 1.3) + 0.22 * Math.sin(tiempo * 3.3 + 0.4)) *
        (1 - 0.95 * asentado);

      // Viento del cursor: cuanto más cerca de cada pieza, más la empuja.
      vientoX *= Math.exp(-h / 0.14);
      let cursor1 = 0;
      let cursor2 = 0;
      if (cursor && vientoX !== 0) {
        const c1x = PIVOTE.x + (L1 + 52) * Math.sin(th1);
        const c1y = PIVOTE.y + (L1 + 52) * Math.cos(th1);
        const c2x = PIVOTE.x + L1 * Math.sin(th1) + 205 * Math.sin(th2);
        const c2y = PIVOTE.y + L1 * Math.cos(th1) + 205 * Math.cos(th2);
        cursor1 = Math.exp(-(((cursor.x - c1x) / 82) ** 2 + ((cursor.y - c1y) / 82) ** 2));
        cursor2 = Math.exp(-(((cursor.x - c2x) / 86) ** 2 + ((cursor.y - c2y) / 100) ** 2));
      }
      const empuje = vientoX * fuerzaViento;

      // Ecuaciones del péndulo doble (θ medido desde la vertical).
      const d = th1 - th2;
      const den = 2 * M1 + M2 - M2 * Math.cos(2 * d);
      let a1 =
        (-G * (2 * M1 + M2) * Math.sin(th1) -
          M2 * G * Math.sin(th1 - 2 * th2) -
          2 * Math.sin(d) * M2 * (w2 * w2 * L2 + w1 * w1 * L1 * Math.cos(d))) /
        (L1 * den);
      let a2 =
        (2 * Math.sin(d) * (w1 * w1 * L1 * (M1 + M2) + G * (M1 + M2) * Math.cos(th1) + w2 * w2 * L2 * M2 * Math.cos(d))) /
        (L2 * den);

      a1 += aire * 0.7 + empuje * cursor1 * 0.0026;
      a2 += aire * 3.2 + empuje * cursor2 * 0.023;

      // Fricción del aire; al sujetarla con el cursor encima (y sin golpe reciente) se asienta rápido.
      const c1 = 1.3 + 22 * asentado;
      const c2 = 0.5 + 18 * asentado;
      w1 += a1 * h;
      w2 += a2 * h;
      w1 *= Math.exp(-c1 * h);
      w2 *= Math.exp(-c2 * h);
      th1 += w1 * h;
      th2 += w2 * h;

      // Choque del badajo contra el borde de vidrio: rebota y suena.
      const relativo = th2 - th1;
      if (Math.abs(relativo) >= ANGULO_CHOQUE) {
        const lado = Math.sign(relativo);
        th2 = th1 + lado * ANGULO_CHOQUE;
        const velocidad = (w2 - w1) * lado; // positivo = se acerca al vidrio
        if (velocidad > 0) {
          const cambio = -(1 + REBOTE) * velocidad * lado;
          w2 += cambio * (M1 / (M1 + M2));
          w1 -= cambio * (M2 / (M1 + M2));
          if (velocidad > 0.45) sonar(limitar(velocidad / 3.5, 0.25, 1));
        }
      }

      // Topes suaves: ninguna parte da la vuelta.
      if (Math.abs(th1) > LIMITE) {
        th1 = Math.sign(th1) * LIMITE;
        if (w1 * th1 > 0) w1 = 0;
      }
      if (Math.abs(th2) > LIMITE) {
        th2 = Math.sign(th2) * LIMITE;
        if (w2 * th2 > 0) w2 = 0;
      }

      // La tira cuelga de un nudo: se retrasa respecto al brazo y aletea con el viento.
      const a3 = -26 * th3 - 3.2 * w3 - 0.32 * a2 + (aire * 1.4 + empuje * cursor2 * 0.004);
      w3 += a3 * h;
      th3 = limitar(th3 + w3 * h, -0.75, 0.75);

      // El destello del vidrio se apaga solo.
      brillo *= Math.exp(-h / 0.45);
      // El asentado sube con el cursor encima y baja sin él.
      const sujeta = (sobre.campana || sobre.tira) && Math.abs(vientoX) < 380 && tiempo - ultimoGolpe > 0.55;
      asentado += ((sujeta ? 1 : 0) - asentado) * (1 - Math.exp(-h / 0.12));
    };

    const energia = () =>
      Math.abs(th1) + Math.abs(th2) + Math.abs(th3) + Math.abs(w1) * 0.2 + Math.abs(w2) * 0.2 + Math.abs(w3) * 0.2 + brillo + Math.abs(vientoX) * 0.001;

    const paso = (ahora: number) => {
      const dt = Math.min((ahora - ultimoCuadro) / 1000, DT_MAXIMO);
      ultimoCuadro = ahora;
      acumulado += dt;
      while (acumulado >= PASO) {
        simular(PASO);
        acumulado -= PASO;
      }
      pintar();
      // Se duerme cuando está quieta y no hay brisa; se despierta con el cursor o un golpe.
      const sigue = visible && (ajustes.current.brisa > 0 || energia() > 0.004);
      cuadro = sigue ? requestAnimationFrame(paso) : 0;
    };

    function despertar() {
      if (cuadro !== 0 || !visible || reducido) return;
      ultimoCuadro = performance.now();
      cuadro = requestAnimationFrame(paso);
    }

    api.current = {
      golpear,
      sobre: (parte, dentro) => {
        if (parte === "chime-bell") sobre.campana = dentro;
        else sobre.tira = dentro;
      },
    };

    // El viento: cada movimiento del cursor deja una velocidad que decae en una fracción de segundo.
    const alMover = (e: PointerEvent) => {
      const caja_ = svg.getBoundingClientRect();
      if (caja_.width === 0) return;
      const escala = ANCHO_DIBUJO / caja_.width;
      const x = (e.clientX - caja_.left) * escala;
      const y = (e.clientY - caja_.top) * escala;
      const t = e.timeStamp;
      if (ultimoPunto && t > ultimoPunto.t) {
        const dt = (t - ultimoPunto.t) / 1000;
        const v = limitar((x - ultimoPunto.x) / dt, -3200, 3200);
        // Suavizado: un solo evento suelto no manda un golpe enorme.
        vientoX += (v - vientoX) * 0.45;
      }
      ultimoPunto = { x, y, t };
      cursor = x > -150 && x < ANCHO_DIBUJO + 150 && y > -100 && y < ALTO_DIBUJO + 150 ? { x, y } : null;
      if (cursor && Math.abs(vientoX) > 20) despertar();
    };
    const alSalir = () => {
      cursor = null;
      ultimoPunto = null;
    };

    const observador = new IntersectionObserver(([entrada]) => {
      visible = entrada.isIntersecting;
      if (visible) despertar();
    });
    observador.observe(caja);

    pintar();
    if (!reducido) {
      window.addEventListener("pointermove", alMover, { passive: true });
      document.documentElement.addEventListener("pointerleave", alSalir, { passive: true });
      despertar();
    }

    return () => {
      cancelAnimationFrame(cuadro);
      observador.disconnect();
      window.removeEventListener("pointermove", alMover);
      document.documentElement.removeEventListener("pointerleave", alSalir);
      api.current = null;
    };
  }, []);

  /** Toque o clic sobre la campana o la tira: empuja hacia el lado contrario y suena. */
  const alTocar = (e: PunteroReact<SVGElement>) => {
    const zona = e.currentTarget.getBoundingClientRect();
    const lado = e.clientX < zona.left + zona.width / 2 ? 1 : -1;
    arrancarAudio(); // el primer toque ya suena: React atiende este evento antes que el de la ventana
    api.current?.golpear(0.9, lado);
  };

  const cuenta = Math.max(0, Math.round(contador));
  const textoCuenta = textoAvisos(cuenta);
  const colorNumero = colorLegible(tira, pintura);
  const tamanoNumero = textoCuenta.length >= 3 ? 20 : textoCuenta.length === 2 ? 29 : 38;

  const variables = {
    height: tamano,
    width: Math.round((tamano * ANCHO_DIBUJO) / ALTO_DIBUJO),
    "--furin-chime-bell-vidrio": vidrio,
    "--furin-chime-bell-pintura": pintura,
    "--furin-chime-bell-tira": tira,
    "--furin-chime-bell-numero": colorNumero,
    ...style,
  } as CSSProperties;

  return (
    <div ref={raiz} className={`furin-chime-bell ${className}`.trim()} style={variables}>
      {/* Para teclado y lectores de pantalla: el dibujo es solo visual. */}
      <button
        type="button"
        className="furin-chime-bell__tocar"
        aria-label={cuenta > 0 ? `Bell, ${cuenta} ${cuenta === 1 ? "notification" : "notifications"}. Tap to ring` : "Bell. Tap to ring"}
        onClick={() => {
          arrancarAudio();
          api.current?.golpear(0.9, Math.random() < 0.5 ? -1 : 1);
        }}
      />
      <span className="furin-chime-bell__aviso" role="status" aria-live="polite">
        {cuenta > 0 ? `${cuenta} ${cuenta === 1 ? "notification" : "notifications"}` : ""}
      </span>

      <svg
        ref={dibujo}
        className="furin-chime-bell__dibujo"
        viewBox={`0 0 ${ANCHO_DIBUJO} ${ALTO_DIBUJO}`}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <radialGradient id={`${id}-vidrio`} cx="0.36" cy="0.34" r="0.85">
            <stop offset="0" className="furin-chime-bell__tono-claro" />
            <stop offset="0.42" className="furin-chime-bell__tono-vidrio furin-chime-bell__tono-vidrio--suave" />
            <stop offset="1" className="furin-chime-bell__tono-vidrio" />
          </radialGradient>
          <radialGradient id={`${id}-metal`} cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#ffeeb4" />
            <stop offset="1" stopColor="#cf9a2e" />
          </radialGradient>
          <clipPath id={`${id}-recorte`}>
            <path d={SILUETA} />
          </clipPath>
        </defs>

        {/* Soporte fijo: una varilla y el aro del que cuelga todo. */}
        <g className="furin-chime-bell__soporte">
          <rect x="56" y="2" width="128" height="7" rx="3.5" />
          <circle cx={PIVOTE.x} cy={PIVOTE.y - 6} r="5" fill="none" strokeWidth="2" />
        </g>

        {/* Parte trasera: cuerda, cúpula vista por dentro y boca. */}
        <g ref={campanaAtras}>
          <line className="furin-chime-bell__cuerda" x1={PIVOTE.x} y1={PIVOTE.y - 1} x2={PIVOTE.x} y2={PIVOTE.y + CUERDA} />
          <path className="furin-chime-bell__interior" d={SILUETA} />
          <ellipse className="furin-chime-bell__boca" cx="120" cy="180" rx="66" ry="11" />
        </g>

        {/* Badajo e hilo con la tira: cuelgan de la cúspide y se ven a través del vidrio. */}
        <g ref={brazo}>
          <line className="furin-chime-bell__hilo" x1="0" y1="0" x2="0" y2={HILO + 9} />
          <circle cx="0" cy={BADAJO.y} r={BADAJO.radio} fill={`url(#${id}-metal)`} />
          <circle className="furin-chime-bell__brillo-badajo" cx="-2.6" cy={BADAJO.y - 2.8} r="2.2" />
          <g ref={tiraGrupo} transform={`translate(0 ${HILO})`}>
            <g className="furin-chime-bell__tira" onPointerDown={alTocar} onPointerEnter={() => api.current?.sobre("tira", true)} onPointerLeave={() => api.current?.sobre("tira", false)}>
              <rect className="furin-chime-bell__papel" x={-TIRA.ancho / 2} y="0" width={TIRA.ancho} height={TIRA.alto} rx="2" />
              <rect className="furin-chime-bell__marco" x={-TIRA.ancho / 2 + 3.5} y="3.5" width={TIRA.ancho - 7} height={TIRA.alto - 7} rx="1" />
              <line className="furin-chime-bell__cabecera" x1={-TIRA.ancho / 2 + 3.5} y1="21" x2={TIRA.ancho / 2 - 3.5} y2="21" />
              <circle className="furin-chime-bell__agujero" cx="0" cy="9" r="2.6" />
              {cuenta > 0 ? (
                <text className="furin-chime-bell__numero" x="0" y="70" textAnchor="middle" fontSize={tamanoNumero} fontWeight="800">
                  {textoCuenta}
                </text>
              ) : (
                <g className="furin-chime-bell__adorno">
                  <circle cx="0" cy="48" r="3" />
                  <circle cx="0" cy="62" r="3" />
                  <circle cx="0" cy="76" r="3" />
                </g>
              )}
            </g>
          </g>
        </g>

        {/* Parte delantera: cristal, reflejos, pintura y borde. */}
        <g ref={campanaFrente}>
          <path
            className="furin-chime-bell__cristal"
            d={SILUETA}
            fill={`url(#${id}-vidrio)`}
            onPointerDown={alTocar}
            onPointerEnter={() => api.current?.sobre("chime-bell", true)}
            onPointerLeave={() => api.current?.sobre("chime-bell", false)}
          />
          {/* Luz de borde: el vidrio es más claro hacia el contorno, donde es más grueso. */}
          <g clipPath={`url(#${id}-recorte)`} className="furin-chime-bell__pintura">
            <path className="furin-chime-bell__luz-borde" d={SILUETA} />
            <path className="furin-chime-bell__banda" d="M57 141A63 11 0 0 0 183 141L184 153A64 11 0 0 1 56 153Z" />
            <path className="furin-chime-bell__escamas" d={ESCAMAS} />
          </g>
          {/* Reflejos: se encienden más cuando suena. */}
          <g className="furin-chime-bell__reflejos">
            <path className="furin-chime-bell__reflejo-largo" d="M70 152C70 118 82 92 100 78" />
            <ellipse className="furin-chime-bell__reflejo-mancha" cx="91" cy="106" rx="7.5" ry="21" transform="rotate(24 91 106)" />
            <circle className="furin-chime-bell__reflejo-punto" cx="108" cy="80" r="3" />
            <path className="furin-chime-bell__reflejo-borde" d="M171 112C176 128 178 144 177 158" />
          </g>
          <path className="furin-chime-bell__labio-trasero" d="M54 180A66 11 0 0 1 186 180" />
          <path className="furin-chime-bell__labio-pintado" d="M186 180A66 11 0 0 1 54 180" />
          <path className="furin-chime-bell__labio" d="M184 178A64 10 0 0 1 56 178" />
          <path className="furin-chime-bell__tapa" d="M107 66C108 58 112 55 120 55C128 55 132 58 133 66C128 71 112 71 107 66Z" fill={`url(#${id}-metal)`} />
          {/* Ondas de sonido: aparecen al sonar y se desvanecen. */}
          <g key={ecos} className={ecos > 0 ? "furin-chime-bell__ecos furin-chime-bell__ecos--activos" : "furin-chime-bell__ecos"}>
            <path d="M44 100Q26 128 44 156" />
            <path d="M30 88Q6 128 30 168" />
            <path d="M196 100Q214 128 196 156" />
            <path d="M210 88Q234 128 210 168" />
          </g>
        </g>
      </svg>
    </div>
  );
}

export default ChimeBell;
