import { useState, useRef, useCallback, useEffect } from "react";
import { MapPin, Navigation } from "lucide-react";
import Chat from "./ui/Chat";
import { calculateDistance, calculateWalkingTime, getUserLocation, metersToMiles } from "../lib/location";

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

  const [buildingSlug, setBuildingSlug] = useState<string | null>(null);
  const [nearestBuilding, setNearestBuilding] = useState<{
    name: string;
    distanceMeters: number;
    walkingTime: string;
  } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
  const checkSlug = () => {
    const slug = localStorage.getItem("pending_slug");
    if (slug) {
      setBuildingSlug(slug);
      localStorage.removeItem("pending_slug");
    }
  };

  checkSlug(); // check on mount
  window.addEventListener("storage", checkSlug); // check if Camera sets it while mounted
  return () => window.removeEventListener("storage", checkSlug);
  }, []);

  // Find nearest building
  useEffect(() => {
    const findNearestBuilding = async () => {
      try {
        // Get user's location
        const userLocation = await getUserLocation();
        
        // Fetch buildings from backend
        const buildingsResponse = await fetch(
          "https://daml-duke-tours-fibm.onrender.com/buildings"
        );
        
        if (!buildingsResponse.ok) {
          setLocationError("Could not fetch building data");
          return;
        }

        const buildingsData = await buildingsResponse.json();
        
        // Calculate distances and find nearest
        let nearest = null;
        let minDistance = Infinity;
        const maxRadiusMeters = 1500; // Only show buildings within 1500m (~0.93 mi)

        for (const building of buildingsData.buildings) {
          if (building.lat && building.long) {
            const distanceMeters = calculateDistance(
              userLocation.lat,
              userLocation.lon,
              building.lat,
              building.long
            );
            
            // Only consider buildings within max radius
            if (distanceMeters <= maxRadiusMeters && distanceMeters < minDistance) {
              minDistance = distanceMeters;
              nearest = {
                name: building.name,
                distanceMeters: distanceMeters,
                walkingTime: calculateWalkingTime(distanceMeters),
              };
            }
          }
        }

        if (nearest) {
          setNearestBuilding(nearest);
        }
      } catch (error) {
        console.error("Geolocation error:", error);
        setLocationError("Enable location access to see nearest building");
      }
    };

    findNearestBuilding();
  }, []);

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

        {/* Nearest Building Info */}
        {nearestBuilding && (
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 mb-4 flex items-start gap-3">
            <Navigation className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-blue-900 dark:text-blue-200">Nearest Building</p>
              <p className="text-sm font-medium text-blue-800 dark:text-blue-300 truncate">{nearestBuilding.name}</p>
              <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                {nearestBuilding.distanceMeters < 1000
                  ? `${nearestBuilding.distanceMeters}m`
                  : `${metersToMiles(nearestBuilding.distanceMeters).toFixed(2)} mi`
                } • {nearestBuilding.walkingTime} walk
              </p>
            </div>
          </div>
        )}
        {locationError && (
          <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 mb-4 text-xs text-gray-600 dark:text-gray-400">
            {locationError}
          </div>
        )}

        {/* chatbox */}
        <Chat buildingSlug={buildingSlug} />

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
