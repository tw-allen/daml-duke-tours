// Haversine formula - returns distance in meters
// Accounts for Earth's curvature — accurate to ~0.5% for campus-scale distances
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6_371_000; // Earth's mean radius in meters

  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Estimate walking time in minutes
// Default speed: 1.4 m/s (~3.1 mph) — standard average walking pace
export function calculateWalkingTime(distanceMeters: number): string {
  const avgWalkingSpeedMps = 1.4;
  const minutes = Math.round((distanceMeters / avgWalkingSpeedMps) / 60);
  if (minutes < 1) return "< 1 min";
  return `${minutes} min`;
}

// Convert meters to miles
export function metersToMiles(meters: number): number {
  return meters / 1609.34;
}

export interface BuildingLocation {
  id: string;
  name: string;
  lat: number;
  long: number;
}

export function getUserLocation(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      (error) => {
        reject(error);
      }
    );
  });
}
