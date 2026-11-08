"use client";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import "./StickerPeel.css";

export interface StickerPeelProps {
  /** Texto grande de la calcomanía. */
  children?: string;
  /** Texto pequeño bajo el principal. */
  subtitle?: string;
  /** Primer color del degradado de la calcomanía. */
  colorA?: string;
  /** Segundo color del degradado de la calcomanía. */
  colorB?: string;
  /** Esquina desde la que se despega. */
  corner?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  /** Brillo holográfico del vinilo (0 a 1.5). */
  gloss?: number;
  /** Cuánto se puede despegar (0.2 a 0.8 del diámetro). */
  maxPeel?: number;
  /** Si no hay cursor, se levanta sola la esquina de vez en cuando. */
  autoplay?: boolean;
  /** Clase extra para el contenedor. */
  className?: string;
  /** Estilos extra para el contenedor. */
  style?: CSSProperties;
}

const CORNERS = { "bottom-right": [1, 1], "bottom-left": [-1, 1], "top-right": [1, -1], "top-left": [-1, -1] } as const;

/** Calcomanía de vinilo troquelada que se despega desde la esquina siguiendo al cursor, con curvatura, reverso de papel y sombra. */
export function StickerPeel({
  children = "hello",
  subtitle = "SUPER PRO · 2026",
  colorA = "#ff5d8f",
  colorB = "#5b3dff",
  corner = "bottom-right",
  gloss = 1,
  maxPeel = 0.62,
  autoplay = true,
  className = "",
  style,
}: StickerPeelProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const opts = useRef({ children, subtitle, colorA, colorB, corner, gloss, maxPeel, autoplay });
  opts.current = { children, subtitle, colorA, colorB, corner, gloss, maxPeel, autoplay };

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mk = () => { const c = document.createElement("canvas"); return [c, c.getContext("2d")!] as const; };
    const [art, ax] = mk(), [front, fx] = mk(), [back, bx] = mk(), [blk, kx] = mk(), [wht, wx] = mk(), [sh, shx] = mk(), [smallC, sx] = mk();
    const nativeBlur = typeof (ctx as CanvasRenderingContext2D & { filter?: string }).filter === "string";
    let W = 0, H = 0, dpr = 1, R = 100, A = 240, theta = Math.PI / 4;
    let raf = 0, visible = true, last = 0, time = 0, built = "";
    const st = { c: 100, v: 0, tc: 100 };
    const ptr = { x: 0, y: 0, inside: false };

    // Dibuja la calcomanía derecha (upright) y la gira al marco (u,v) del despegue.
    const build = () => {
      const o = opts.current;
      const key = [o.children, o.subtitle, o.colorA, o.colorB, o.corner, R, dpr].join("|");
      if (key === built) return;
      built = key;
      A = Math.ceil(R * 2 + 10);
      const px = Math.round(A * dpr);
      for (const c of [art, front, back, blk, wht, sh]) { c.width = px; c.height = px; }
      smallC.width = Math.max(2, Math.round(A / 4)); smallC.height = smallC.width;
      const [dx, dy] = CORNERS[o.corner];
      theta = Math.atan2(dy, dx);
      const up = document.createElement("canvas"); up.width = px; up.height = px;
      const g = up.getContext("2d")!;
      g.scale(dpr, dpr);
      g.translate(A / 2, A / 2);
      // Contorno troquelado: sello con 16 ondas suaves.
      const seal = (r: number) => { g.beginPath(); for (let i = 0; i <= 360; i++) { const a = (i / 360) * Math.PI * 2; const rr = r * (1 + 0.022 * Math.cos(a * 16)); g.lineTo(rr * Math.cos(a), rr * Math.sin(a)); } g.closePath(); };
      seal(R);
      g.fillStyle = "#fbfaf6"; g.fill();                   // borde blanco del troquel
      g.save(); seal(R - 11); g.clip();
      const bg = g.createLinearGradient(-R, -R, R, R);
      bg.addColorStop(0, o.colorA); bg.addColorStop(1, o.colorB);
      g.fillStyle = bg; g.fillRect(-R, -R, R * 2, R * 2);
      // Rayos de sol procedimentales.
      g.globalAlpha = 0.13; g.fillStyle = "#fff";
      for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R * 1.3, a, a + Math.PI / 22); g.closePath(); g.fill(); }
      g.globalAlpha = 1;
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.9);
      rg.addColorStop(0, "rgba(255,255,255,0.28)"); rg.addColorStop(0.55, "rgba(255,255,255,0)"); rg.addColorStop(1, "rgba(0,0,0,0.28)");
      g.fillStyle = rg; g.fillRect(-R, -R, R * 2, R * 2);
      // Anillo fino.
      g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, R * 0.78, 0, Math.PI * 2); g.stroke();
      g.restore();
      // Texto.
      g.textAlign = "center"; g.textBaseline = "middle";
      const fs = Math.min(R * 0.62, (R * 1.35) / Math.max(2.2, o.children.length * 0.62));
      g.font = `800 ${fs}px Geist, "Inter", system-ui, sans-serif`;
      g.shadowColor = "rgba(30,10,80,0.45)"; g.shadowBlur = 10; g.shadowOffsetY = 4;
      g.fillStyle = "#fff"; g.fillText(o.children, 0, -R * 0.04);
      g.shadowColor = "transparent";
      g.font = `600 ${Math.max(8, R * 0.085)}px "JetBrains Mono", ui-monospace, monospace`;
      g.fillStyle = "rgba(255,255,255,0.85)";
      g.fillText(o.subtitle, 0, R * 0.36);
      // Al marco del despegue: eje u a lo largo de la esquina.
      ax.setTransform(1, 0, 0, 1, 0, 0);
      ax.clearRect(0, 0, px, px);
      ax.translate(px / 2, px / 2); ax.rotate(-theta); ax.drawImage(up, -px / 2, -px / 2);
      ax.setTransform(1, 0, 0, 1, 0, 0);
      // Reverso (papel siliconado), y siluetas negra/blanca para sombrear por franjas.
      const tint = (c: HTMLCanvasElement, cx: CanvasRenderingContext2D, fill: string | CanvasGradient) => {
        cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = "source-over"; cx.clearRect(0, 0, px, px);
        cx.drawImage(art, 0, 0); cx.globalCompositeOperation = "source-in"; cx.fillStyle = fill; cx.fillRect(0, 0, px, px); cx.globalCompositeOperation = "source-over";
        void c;
      };
      const bgd = bx.createLinearGradient(0, 0, px, px);
      bgd.addColorStop(0, "#f3f2ed"); bgd.addColorStop(1, "#dedcd4");
      tint(back, bx, bgd);
      bx.globalCompositeOperation = "source-atop"; bx.fillStyle = "rgba(120,116,104,0.10)";
      for (let k = -px; k < px * 2; k += 7 * dpr) { bx.fillRect(k, 0, 1 * dpr, px); }
      bx.globalCompositeOperation = "source-over";
      tint(blk, kx, "#000");
      tint(wht, wx, "#fff");
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = Math.max(2, Math.round(W * dpr)); cv.height = Math.max(2, Math.round(H * dpr));
      R = Math.max(60, Math.min(W, H) * 0.3);
      st.c = st.tc = R;
      build();
    };

    const draw = () => {
      build();
      const o = opts.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;
      const c = Math.min(R, st.c);
      const peel = Math.max(0, (R - c) / (R * 2));
      const Rc = 9 + peel * 40;
      const px = Math.round(A * dpr);
      // Relleno holográfico que se desplaza con el cursor y con el despegue.
      fx.setTransform(1, 0, 0, 1, 0, 0);
      fx.globalCompositeOperation = "source-over"; fx.clearRect(0, 0, px, px);
      fx.drawImage(art, 0, 0);
      fx.globalCompositeOperation = "source-atop";
      const u0 = (-0.1 + 0.7 * Math.max(-1, Math.min(1, st.c / R))) * R + (A / 2);
      const sg = fx.createLinearGradient((u0 - R * 0.7) * dpr, 0, (u0 + R * 0.7) * dpr, px * 0.35);
      const ga = 0.5 * o.gloss;
      sg.addColorStop(0, "rgba(255,255,255,0)"); sg.addColorStop(0.36, `rgba(160,255,230,${0.16 * ga})`); sg.addColorStop(0.5, `rgba(255,255,255,${0.42 * ga})`); sg.addColorStop(0.64, `rgba(255,170,230,${0.16 * ga})`); sg.addColorStop(1, "rgba(255,255,255,0)");
      fx.fillStyle = sg; fx.fillRect(0, 0, px, px);
      fx.globalCompositeOperation = "source-over";

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(theta);
      const half = A / 2;
      // Parte pegada: sombra de contacto muy corta.
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
      const flatW = Math.max(0, c + half);
      if (flatW > 0.5) ctx.drawImage(front, 0, 0, flatW * dpr, px, -half, -half, flatW, A);
      ctx.restore();

      if (c < R - 0.6) {
        const du = 1;
        const L = [-0.3, 1];
        const ln = Math.hypot(L[0], L[1]);
        const Lu = L[0] / ln, Lz = L[1] / ln;
        type Strip = { x: number; w: number; srcX: number; sw: number; back: boolean; shade: number; spec: number; z: number };
        const strips: Strip[] = [];
        for (let u = c; u < R + du; u += du) {
          const s = u - c;
          const th = s / Rc;
          let x: number, z: number, w: number, nu: number, nz: number;
          if (th <= Math.PI) { x = c + Rc * Math.sin(th); z = Rc * (1 - Math.cos(th)); w = Math.max(0.35, Math.abs(Math.cos(th)) * du); nu = -Math.sin(th); nz = Math.cos(th); }
          else { x = c - (s - Math.PI * Rc); z = 2 * Rc; w = du; nu = 0; nz = -1; }
          const isBack = th > Math.PI / 2;
          if (isBack) { nu = -nu; nz = -nz; }
          const D = Math.max(0, nu * Lu + nz * Lz);
          const rr = [-Lu + 2 * (nu * Lu + nz * Lz) * nu, -Lz + 2 * (nu * Lu + nz * Lz) * nz];
          const spec = Math.pow(Math.max(0, rr[1]), isBack ? 14 : 34);
          strips.push({ x: isBack && th > Math.PI ? x - du : x, w: isBack && th <= Math.PI ? w : isBack ? du : w, srcX: Math.round((u + half) * dpr), sw: Math.max(1, Math.round(du * dpr)), back: isBack, shade: 1 - (0.5 + 0.5 * D), spec, z });
        }
        // Sombra proyectada de la solapa sobre la parte pegada, desenfocada.
        shx.setTransform(1, 0, 0, 1, 0, 0); shx.clearRect(0, 0, px, px);
        shx.setTransform(dpr, 0, 0, dpr, 0, 0);
        shx.fillStyle = "rgba(0,0,0,0.5)";
        for (const t of strips) shx.fillRect(t.x + half - t.z * 0.5 - 1, 0, t.w + 1.5, A);
        shx.setTransform(1, 0, 0, 1, 0, 0);
        // Recorta la sombra a una banda de la solapa usando la silueta de la calcomanía.
        shx.globalCompositeOperation = "destination-in"; shx.drawImage(blk, 0, 0); shx.globalCompositeOperation = "source-over";
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        if (nativeBlur) {
          (ctx as CanvasRenderingContext2D & { filter: string }).filter = "blur(5px)";
          ctx.globalAlpha = 0.6;
          ctx.drawImage(sh, -half + 5, -half + 4, A, A);
          (ctx as CanvasRenderingContext2D & { filter: string }).filter = "none";
        } else {
          sx.clearRect(0, 0, smallC.width, smallC.height); sx.drawImage(sh, 0, 0, smallC.width, smallC.height);
          ctx.globalAlpha = 0.6; ctx.drawImage(smallC, -half + 5, -half + 4, A, A);
        }
        ctx.restore();
        // Mancha de adhesivo limpio donde estaba pegada.
        ctx.save(); ctx.globalAlpha = 0.018;
        const cleanW = Math.max(0, half - c);
        if (cleanW > 0) ctx.drawImage(wht, (c + half) * dpr, 0, cleanW * dpr, px, c, -half, cleanW, A);
        ctx.restore();
        // Franjas de la solapa, de abajo hacia arriba.
        for (const t of strips) {
          const srcImg = t.back ? back : front;
          const sw = t.sw, w = t.w + 0.7; // un poco de traslape evita rendijas entre franjas
          ctx.drawImage(srcImg, t.srcX, 0, sw, px, t.x, -half, w, A);
          if (t.shade > 0.02) { ctx.globalAlpha = t.shade * (t.back ? 0.55 : 0.75); ctx.drawImage(blk, t.srcX, 0, sw, px, t.x, -half, w, A); }
          if (t.spec > 0.02) { ctx.globalAlpha = Math.min(1, t.spec * (t.back ? 0.5 : 0.8) * (0.6 + 0.4 * o.gloss)); ctx.drawImage(wht, t.srcX, 0, sw, px, t.x, -half, w, A); }
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    };

    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(0.04, (now - (last || now)) / 1000);
      last = now;
      time += dt;
      const o = opts.current;
      const [dx, dy] = CORNERS[o.corner];
      const dl = Math.SQRT2;
      let target = R;
      if (ptr.inside) {
        const u = ((ptr.x - W / 2) * dx + (ptr.y - H / 2) * dy) / dl;
        target = Math.min(R, Math.max(R * (1 - o.maxPeel * 2 * 0.62 - 0.0), u));
        target = Math.max(target, R - 2 * R * o.maxPeel);
      } else if (o.autoplay) {
        const p = (time % 4.6) / 4.6;
        const k = Math.sin(Math.min(1, p * 1.7) * Math.PI);
        target = R - R * 0.62 * k * k;
      }
      const k = 230, dmp = 17;
      st.v += ((target - st.c) * k - st.v * dmp) * dt;
      st.c += st.v * dt;
      draw();
      const busy = Math.abs(target - st.c) > 0.05 || Math.abs(st.v) > 0.05 || o.autoplay || ptr.inside;
      if (visible && busy) raf = requestAnimationFrame(tick); else last = 0;
    };
    const wake = () => { if (!raf && visible && !reduce) raf = requestAnimationFrame(tick); };
    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top;
      ptr.inside = Math.hypot(ptr.x - W / 2, ptr.y - H / 2) < R * 1.08;
      wake();
    };
    const onLeave = () => { ptr.inside = false; wake(); };
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerdown", onMove);
    cv.addEventListener("pointerleave", onLeave);
    const ro = new ResizeObserver(() => { built = ""; resize(); st.c = st.tc = R * (reduce ? 0.55 : 1); draw(); });
    ro.observe(cv);
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); }, { threshold: 0.01 });
    io.observe(cv);
    resize();
    if (reduce) st.c = R * 0.55;
    draw();
    wake();
    // Si la tipografía web llega tarde, se vuelve a dibujar el arte.
    document.fonts?.ready.then(() => { built = ""; draw(); });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerdown", onMove);
      cv.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} className={`furin-sticker-peel ${className}`} style={style} role="img" aria-label={`Sticker: ${children}`} />;
}

export default StickerPeel;
