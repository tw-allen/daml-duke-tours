import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/iamges/marker-shadow.png';

const DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

interface MapProps {
    center: [number, number]
}

function MapController({ center }: MapProps) {
    const map = useMap();
    useEffect(() => {
        map.invalidateSize();
        map.setView(center);
    }, [center, map]);
    return null;
}

export function MapModule({ center }: MapProps) {
    return (
        <div style={{height: '100%', width: '100%'}}>
            <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <Marker position={center} icon={DefaultIcon} />
                <MapController center={center} />
            </MapContainer>
        </div>
    )
}