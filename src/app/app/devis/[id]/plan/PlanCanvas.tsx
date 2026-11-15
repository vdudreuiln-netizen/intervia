"use client";

import { useRef, useState, type ReactNode } from "react";
import type { Pt } from "@/lib/plans/geometry";

/**
 * Plan affiché en SVG (coordonnées = pixels de l'image), zoom par boutons,
 * défilement au doigt. `onPoint` reçoit les coordonnées du plan du point touché.
 */
export function PlanCanvas({
  imageUrl,
  width,
  height,
  onPoint,
  onMove,
  onUp,
  dragging = false,
  children,
  cursor = "default",
}: {
  imageUrl: string;
  width: number;
  height: number;
  onPoint?: (p: Pt) => void;
  /** Déplacement au doigt d'un repère (pendant `dragging`). */
  onMove?: (p: Pt) => void;
  onUp?: () => void;
  dragging?: boolean;
  children?: ReactNode;
  cursor?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const svg = useRef<SVGSVGElement>(null);
  const toPlan = (clientX: number, clientY: number): Pt | null => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2" role="group" aria-label="Zoom du plan">
        {[1, 1.5, 2, 3].map((z) => (
          <button key={z} type="button" onClick={() => setZoom(z)} aria-pressed={zoom === z} className={`min-h-10 rounded-lg border-2 px-3 text-sm font-bold ${zoom === z ? "border-brand bg-brand text-white" : "border-slate-300 bg-white"}`}>
            {z === 1 ? "Ajusté" : `×${z.toLocaleString("fr-FR")}`}
          </button>
        ))}
      </div>
      <div className="max-h-[75vh] overflow-auto rounded-xl border-2 border-slate-300 bg-white">
        <svg
          ref={svg}
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: `${zoom * 100}%`, cursor, touchAction: dragging ? "none" : zoom > 1 ? "pan-x pan-y" : "auto" }}
          className="block h-auto select-none"
          onPointerMove={(e) => {
            if (!dragging || !onMove) return;
            const p = toPlan(e.clientX, e.clientY);
            if (p) onMove(p);
          }}
          onPointerUp={() => dragging && onUp?.()}
          onPointerLeave={() => dragging && onUp?.()}
          onClick={(e) => {
            if (!onPoint || dragging) return;
            const p = toPlan(e.clientX, e.clientY);
            if (p) onPoint(p);
          }}
        >
          <image href={imageUrl} x={0} y={0} width={width} height={height} preserveAspectRatio="none" />
          {children}
        </svg>
      </div>
    </div>
  );
}

/** Taille des repères proportionnelle au plan (lisible quel que soit le zoom). */
export const unit = (w: number, h: number) => Math.max(w, h) / 120;

export function NorthArrow({ deg, width, height }: { deg: number; width: number; height: number }) {
  const u = unit(width, height);
  const cx = width - u * 4;
  const cy = u * 4;
  return (
    <g transform={`rotate(${deg} ${cx} ${cy})`} pointerEvents="none">
      <circle cx={cx} cy={cy} r={u * 3} fill="white" fillOpacity={0.85} stroke="#111827" strokeWidth={u / 5} />
      <path d={`M ${cx} ${cy - u * 2.4} L ${cx + u} ${cy + u * 1.4} L ${cx} ${cy + u * 0.6} L ${cx - u} ${cy + u * 1.4} Z`} fill="#B91C1C" />
      <text x={cx} y={cy - u * 2.6} fontSize={u * 1.6} textAnchor="middle" fontWeight="bold" fill="#111827">
        N
      </text>
    </g>
  );
}
