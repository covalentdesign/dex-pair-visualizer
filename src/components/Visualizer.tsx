"use client";

import { useEffect, useRef, useCallback } from "react";
import { Cell, Organ, Camera, StreamEvent } from "@/lib/types";
import { CHAINS, CHAIN_MAP, PHYSICS } from "@/lib/constants";
import { stepPhysics, liquidityToRadius, volumeToRadiusMultiplier } from "@/lib/physics";
import { render } from "@/lib/renderer";
import { createPostProcessor, PostProcessor } from "@/lib/postprocess";

export default function Visualizer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const cellsRef = useRef<Cell[]>([]);
  const organsRef = useRef<Map<string, Organ>>(new Map());
  const cameraRef = useRef<Camera>({
    x: 0,
    y: 0,
    zoom: 1,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    camStartX: 0,
    camStartY: 0,
  });
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const logicalSizeRef = useRef({ w: 0, h: 0 });
  const eventSourceRef = useRef<EventSource | null>(null);
  const postRef = useRef<PostProcessor | null>(null);
  const selectedCellRef = useRef<Cell | null>(null);

  // Initialize organs randomly but all touching — circle packing from center
  const initOrgans = useCallback((width: number, height: number) => {
    const organs = new Map<string, Organ>();
    const placed: { x: number; y: number; r: number }[] = [];
    const r = PHYSICS.ORGAN_BASE_RADIUS;
    const cx = width / 2;
    const cy = height / 2;

    CHAINS.forEach((chain, i) => {
      let ox: number, oy: number;

      if (i === 0) {
        ox = cx;
        oy = cy;
      } else {
        let bestX = cx, bestY = cy;
        let found = false;

        for (let attempt = 0; attempt < 100 && !found; attempt++) {
          const parent = placed[Math.floor(Math.random() * placed.length)];
          const angle = Math.random() * Math.PI * 2;
          const wobbleFactor = 1.15;
          const dist = parent.r * wobbleFactor + r * wobbleFactor + 10;
          const tx = parent.x + Math.cos(angle) * dist;
          const ty = parent.y + Math.sin(angle) * dist;

          let overlaps = false;
          for (const p of placed) {
            const dx = tx - p.x;
            const dy = ty - p.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < p.r * wobbleFactor + r * wobbleFactor + 10) {
              overlaps = true;
              break;
            }
          }

          if (!overlaps) {
            bestX = tx;
            bestY = ty;
            found = true;
          }
        }

        ox = bestX;
        oy = bestY;
      }

      placed.push({ x: ox, y: oy, r });
      organs.set(chain.name, {
        chain: chain.name,
        displayName: chain.displayName,
        color: chain.color,
        x: ox,
        y: oy,
        radius: r,
        wobblePhase: Math.random() * Math.PI * 2,
        cellCount: 0,
      });
    });

    organsRef.current = organs;
  }, []);

  // Handle incoming stream events
  const handleEvent = useCallback((event: StreamEvent) => {
    const cells = cellsRef.current;
    const organs = organsRef.current;
    const chainConfig = CHAIN_MAP.get(event.chain);
    if (!chainConfig) return;

    if (event.type === "new-pair") {
      if (cells.some((c) => c.pairAddress === event.pairAddress)) return;

      const organ = organs.get(event.chain);
      if (!organ) return;

      const chainCells = cells.filter((c) => c.chain === event.chain);
      if (chainCells.length >= PHYSICS.MAX_CELLS_PER_CHAIN) {
        const oldest = chainCells.reduce((a, b) =>
          a.born < b.born ? a : b
        );
        const idx = cells.indexOf(oldest);
        if (idx !== -1) cells.splice(idx, 1);
      }

      const radius = liquidityToRadius(event.liquidity ?? 0);
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * organ.radius * 0.6;

      const cell: Cell = {
        id: `${event.chain}-${event.pairAddress}`,
        chain: event.chain,
        pairAddress: event.pairAddress,
        label: `${event.baseTicker ?? "?"}/${event.quoteTicker ?? "?"}`,
        x: organ.x + Math.cos(angle) * dist,
        y: organ.y + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        radius: 2,
        targetRadius: radius,
        color: chainConfig.color,
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleSpeed: PHYSICS.MIN_CELL_RADIUS / radius + Math.random() * 0.3,
        born: Date.now(),
        lastUpdate: Date.now(),
        liquidity: event.liquidity ?? 0,
      };

      cells.push(cell);
    } else if (event.type === "pair-update") {
      const cell = cells.find((c) => c.pairAddress === event.pairAddress);
      if (!cell) return;

      const baseRadius = liquidityToRadius(event.liquidity ?? 0);
      const multiplier = volumeToRadiusMultiplier(event.volumeUsd ?? 0);
      cell.targetRadius = Math.min(
        PHYSICS.MAX_CELL_RADIUS,
        baseRadius * multiplier
      );
      cell.liquidity = event.liquidity ?? cell.liquidity;
      cell.lastUpdate = Date.now();
    }
  }, []);

  // Animation loop
  const animate = useCallback((time: number) => {
    const offscreen = offscreenRef.current;
    if (!offscreen) return;

    const ctx = offscreen.getContext("2d");
    if (!ctx) return;

    const dt = lastTimeRef.current
      ? (time - lastTimeRef.current) / 1000
      : 0.016;
    lastTimeRef.current = time;

    stepPhysics(cellsRef.current, organsRef.current, dt);

    const { w, h } = logicalSizeRef.current;
    // Clear selected cell if it was removed
    if (selectedCellRef.current && !cellsRef.current.includes(selectedCellRef.current)) {
      selectedCellRef.current = null;
    }

    render(
      ctx,
      w || offscreen.width,
      h || offscreen.height,
      cellsRef.current,
      organsRef.current,
      cameraRef.current,
      time,
      selectedCellRef.current
    );

    // Post-process: upload 2D canvas to WebGL and apply effects
    const post = postRef.current;
    if (post) {
      post.process(offscreen, time);
    }

    animRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create offscreen 2D canvas (not added to DOM)
    const offscreen = document.createElement("canvas");
    offscreenRef.current = offscreen;

    // Create WebGL post-processor
    const post = createPostProcessor();
    postRef.current = post;

    // The visible canvas is the WebGL one (or fallback to offscreen if WebGL fails)
    const visibleCanvas = post ? post.canvas : offscreen;
    visibleCanvas.style.display = "block";
    visibleCanvas.style.width = "100vw";
    visibleCanvas.style.height = "100vh";
    visibleCanvas.style.cursor = "grab";
    visibleCanvas.style.touchAction = "none";
    container.appendChild(visibleCanvas);

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;

      // Offscreen 2D canvas at full DPR
      offscreen.width = w * dpr;
      offscreen.height = h * dpr;
      const ctx = offscreen.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);

      // WebGL canvas
      if (post) {
        post.resize(w, h);
      } else {
        // Fallback: style the offscreen canvas directly
        offscreen.style.width = `${w}px`;
        offscreen.style.height = `${h}px`;
      }

      logicalSizeRef.current = { w, h };
      initOrgans(w, h);
    };

    resize();
    window.addEventListener("resize", resize);

    animRef.current = requestAnimationFrame(animate);

    // SSE
    const es = new EventSource("/api/stream");
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const event: StreamEvent = JSON.parse(e.data);
        handleEvent(event);
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      console.warn("[SSE] Connection error, will auto-reconnect");
    };

    // Mouse drag for panning
    const cam = cameraRef.current;

    const onMouseDown = (e: MouseEvent) => {
      cam.dragging = true;
      cam.dragStartX = e.clientX;
      cam.dragStartY = e.clientY;
      cam.camStartX = cam.x;
      cam.camStartY = cam.y;
      visibleCanvas.style.cursor = "grabbing";
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!cam.dragging) return;
      cam.x = cam.camStartX - (e.clientX - cam.dragStartX);
      cam.y = cam.camStartY - (e.clientY - cam.dragStartY);
    };

    const onMouseUp = (e: MouseEvent) => {
      const dx = e.clientX - cam.dragStartX;
      const dy = e.clientY - cam.dragStartY;
      const wasDrag = Math.abs(dx) > 3 || Math.abs(dy) > 3;

      if (!wasDrag) {
        // Click — find cell under cursor
        const { w, h } = logicalSizeRef.current;
        const worldX = cam.x + w / 2 + (e.clientX - w / 2) / cam.zoom;
        const worldY = cam.y + h / 2 + (e.clientY - h / 2) / cam.zoom;

        let closest: Cell | null = null;
        let closestDist = Infinity;
        for (const cell of cellsRef.current) {
          const cdx = cell.x - worldX;
          const cdy = cell.y - worldY;
          const d = Math.sqrt(cdx * cdx + cdy * cdy);
          if (d < cell.radius * 1.5 && d < closestDist) {
            closest = cell;
            closestDist = d;
          }
        }
        selectedCellRef.current = closest;
      }

      cam.dragging = false;
      visibleCanvas.style.cursor = "grab";
    };

    // Touch
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      cam.dragging = true;
      cam.dragStartX = t.clientX;
      cam.dragStartY = t.clientY;
      cam.camStartX = cam.x;
      cam.camStartY = cam.y;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!cam.dragging) return;
      const t = e.touches[0];
      cam.x = cam.camStartX - (t.clientX - cam.dragStartX);
      cam.y = cam.camStartY - (t.clientY - cam.dragStartY);
      e.preventDefault();
    };

    const onTouchEnd = () => {
      cam.dragging = false;
    };

    // Scroll wheel zoom
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const oldZoom = cam.zoom;
      const newZoom = Math.max(0.2, Math.min(5, oldZoom * zoomFactor));

      const mouseX = e.clientX;
      const mouseY = e.clientY;
      const { w, h } = logicalSizeRef.current;

      const worldX = cam.x + w / 2 + (mouseX - w / 2) / oldZoom;
      const worldY = cam.y + h / 2 + (mouseY - h / 2) / oldZoom;

      cam.x = worldX - w / 2 - (mouseX - w / 2) / newZoom;
      cam.y = worldY - h / 2 - (mouseY - h / 2) / newZoom;
      cam.zoom = newZoom;
    };

    visibleCanvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    visibleCanvas.addEventListener("wheel", onWheel, { passive: false });
    visibleCanvas.addEventListener("touchstart", onTouchStart, { passive: false });
    visibleCanvas.addEventListener("touchmove", onTouchMove, { passive: false });
    visibleCanvas.addEventListener("touchend", onTouchEnd);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animRef.current);
      es.close();
      visibleCanvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      visibleCanvas.removeEventListener("wheel", onWheel);
      visibleCanvas.removeEventListener("touchstart", onTouchStart);
      visibleCanvas.removeEventListener("touchmove", onTouchMove);
      visibleCanvas.removeEventListener("touchend", onTouchEnd);
      if (post) post.destroy();
      container.removeChild(visibleCanvas);
    };
  }, [animate, handleEvent, initOrgans]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    />
  );
}
