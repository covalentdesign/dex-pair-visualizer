export interface StreamEvent {
  type: "new-pair" | "pair-update";
  chain: string;
  pairAddress: string;
  baseToken?: string;
  quoteToken?: string;
  baseTicker?: string;
  quoteTicker?: string;
  liquidity?: number;
  volumeUsd?: number;
  protocol?: string;
  timestamp: number;
}

export interface Cell {
  id: string;
  chain: string;
  pairAddress: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  targetRadius: number;
  color: string;
  wobblePhase: number;
  wobbleSpeed: number;
  born: number;
  lastUpdate: number;
  liquidity: number;
}

export interface Organ {
  chain: string;
  displayName: string;
  color: string;
  x: number;
  y: number;
  radius: number;
  wobblePhase: number;
  cellCount: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  dragging: boolean;
  dragStartX: number;
  dragStartY: number;
  camStartX: number;
  camStartY: number;
}
