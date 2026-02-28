import { useState, useRef, useCallback, useEffect } from "react";
import { MapPin } from "lucide-react";
import Chat from "./ui/Chat";

const SNAP_POINTS = [148, 355, window.innerHeight * 0.92];

function closestSnap(y: number) {
  let closest = SNAP_POINTS[0];
  let minDist = Infinity;
  for (const s of SNAP_POINTS) {
    const d = Math.abs(y - s);
    if (d < minDist) {
      minDist = d;
      closest = s;
    }
  }
  return closest;
}

const BottomSheet = () => {
  const [height, setHeight] = useState(SNAP_POINTS[0]);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = height;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [height]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = startY.current - e.clientY;
    const newH = Math.max(80, Math.min(window.innerHeight * 0.96, startH.current + delta));
    setHeight(newH);
  }, []);

  const onPointerUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setHeight(closestSnap(height));
  }, [height]);

  // Update max snap on resize
  useEffect(() => {
    const onResize = () => {
      SNAP_POINTS[2] = window.innerHeight * 0.92;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isFullScreen = height > SNAP_POINTS[1] + 50;

  return (
    <div
      ref={sheetRef}
      className="absolute bottom-0 left-0 right-0 z-50 bg-card rounded-t-2xl border-t border-border flex flex-col"
      style={{
        height: `${height}px`,
        transition: dragging.current ? "none" : "height 0.3s cubic-bezier(0.32, 0.72, 0, 1)",
        boxShadow: "var(--panel-shadow)",
      }}
    >
      {/* Drag handle */}
      <div
        className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="w-10 h-1.5 rounded-full" style={{ background: "hsl(var(--handle-bg))" }} />
      </div>

      {/* Content */}
      <div
        className="flex-1 px-4 pb-4 min-h-0"
        style={{ overflowY: isFullScreen ? "auto" : "hidden" }}
      >
        {/* Search bar */}
        <div className="bg-secondary rounded-xl px-4 py-3 flex items-center gap-3 mb-4">
          <MapPin className="w-4 h-4 text-primary shrink-0" />
          <span className="text-muted-foreground text-sm">Search a place to explore...</span>
        </div>

        {/* chatbox */}
        <Chat />

        {/* Placeholder content */} {/*
        <div className="space-y-3">
          {["", "", ""].map((title) => (
            <div key={title} className="rounded-xl bg-secondary/50 p-4">
              <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-display)" }}>{title}</h3>
            </div>
          ))}
        </div> */}
      </div>
    </div>
  );
};

export default BottomSheet;
