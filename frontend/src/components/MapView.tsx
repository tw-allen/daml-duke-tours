import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Navigation, Compass } from "lucide-react";

const MapView = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    
    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([48.8566, 2.3522], 13); // Paris default

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    // Add a pulsing marker via CSS class
    const icon = L.divIcon({
      className: "custom-marker",
      html: `<div class="marker-ping"></div><div class="marker-dot"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    const marker = L.marker([48.8566, 2.3522], { icon }).addTo(map);
    markerRef.current = marker;

    map.on("locationfound", (e: L.LocationEvent) => {
      const { lat, lng } = e.latlng;
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      }
    });
    mapInstanceRef.current = map;
    
    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  const handleLocate = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.locate({ watch: true, setView: true, maxZoom: 16 });
  };

  const handleResetNorth = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.setView(map.getCenter(), map.getZoom());
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="absolute inset-0 z-0" />

      {/* Map controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 z-[1000]">
        <button
          onClick={handleLocate}
          className="w-10 h-10 rounded-lg bg-card shadow-md flex items-center justify-center text-foreground hover:bg-secondary transition-colors"
        >
          <Navigation className="w-4 h-4" />
        </button>
        <button
          onClick={handleResetNorth}
          className="w-10 h-10 rounded-lg bg-card shadow-md flex items-center justify-center text-foreground hover:bg-secondary transition-colors"
        >
          <Compass className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default MapView;
