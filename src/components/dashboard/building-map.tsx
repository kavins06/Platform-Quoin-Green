"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Map, { Marker, Popup, NavigationControl } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { getPrimaryComplianceStatusDisplay } from "@/components/internal/status-helpers";

const STATUS_COLORS: Record<string, string> = {
 DATA_INCOMPLETE: "#9ca3af",
 READY: "#2563eb",
 COMPLIANT: "#16a34a",
 NON_COMPLIANT: "#dc2626",
};

interface Snapshot {
 energyStarScore: number | null;
}

interface BuildingPin {
 id: string;
 name: string;
 latitude: number | null;
 longitude: number | null;
 latestSnapshot: Snapshot | null;
 governedSummary: {
 complianceSummary: {
 primaryStatus: string | null;
 };
 };
}

interface BuildingMapProps {
 buildings: BuildingPin[];
}

const MAPBOX_TOKEN = process.env["NEXT_PUBLIC_MAPBOX_TOKEN"];

export function BuildingMap({ buildings }: BuildingMapProps) {
 const router = useRouter();
 const [selectedId, setSelectedId] = useState<string | null>(null);
 const [hoveredId, setHoveredId] = useState<string | null>(null);

 const handleMarkerClick = useCallback((id: string) => {
 setSelectedId((prev) => (prev === id ? null : id));
 }, []);

 if (!MAPBOX_TOKEN) {
 return (
 <div
 className="flex items-center justify-center rounded border border-dashed border-zinc-300 bg-zinc-50"
 style={{ height: "calc(100vh - 280px)", minHeight: "400px" }}
 >
 <p className="text-sm text-zinc-500">
 Map unavailable - add MAPBOX_TOKEN to .env
 </p>
 </div>
 );
 }

 const pins = buildings.filter(
 (b): b is BuildingPin & { latitude: number; longitude: number } =>
 b.latitude != null && b.longitude != null,
 );

 const selected = pins.find((b) => b.id === selectedId) ?? null;

 return (
 <div style={{ height: "calc(100vh - 280px)", minHeight: "400px" }}>
 <Map
 mapboxAccessToken={MAPBOX_TOKEN}
 initialViewState={{
 latitude: 38.9072,
 longitude: -77.0369,
 zoom: 12,
 }}
 mapStyle="mapbox://styles/mapbox/light-v11"
 dragRotate={false}
 pitchWithRotate={false}
 touchPitch={false}
 style={{ width: "100%", height: "100%" }}
 >
 <NavigationControl position="top-right" showCompass={false} />

 {pins.map((b) => {
 const status = b.governedSummary.complianceSummary.primaryStatus ?? "DATA_INCOMPLETE";
 const color = STATUS_COLORS[status] ?? "#9ca3af";
 return (
 <Marker
 key={b.id}
 latitude={b.latitude}
 longitude={b.longitude}
 anchor="center"
 onClick={(e) => {
 e.originalEvent.stopPropagation();
 handleMarkerClick(b.id);
 }}
 >
 <div
 onMouseEnter={() => setHoveredId(b.id)}
 onMouseLeave={() => setHoveredId(null)}
 style={{
 width: 10,
 height: 10,
 borderRadius: "50%",
 backgroundColor: color,
 cursor: "pointer",
 transition: "transform 150ms ease",
 transform: hoveredId === b.id ? "scale(1.3)" : "scale(1)",
 }}
 />
 </Marker>
 );
 })}

 {selected && (
 <Popup
 latitude={selected.latitude}
 longitude={selected.longitude}
 anchor="bottom"
 onClose={() => setSelectedId(null)}
 closeOnClick={false}
 maxWidth="200px"
 className="building-popup"
 >
 <div className="p-1">
 <p className="text-sm font-medium text-zinc-900">{selected.name}</p>
 <p className="mt-0.5 text-xs text-zinc-500">
 Score:{" "}
 {selected.latestSnapshot?.energyStarScore != null
 ? selected.latestSnapshot.energyStarScore
 : "-"}
 <span className="mx-1">·</span>
 {getPrimaryComplianceStatusDisplay(
 selected.governedSummary.complianceSummary.primaryStatus,
 ).label.toLowerCase()}
 </p>
 <button
 onClick={() => router.push(`/buildings/${selected.id}`)}
 className="mt-1 text-xs text-zinc-500 hover:text-zinc-900"
 >
 View details -&gt;
 </button>
 </div>
 </Popup>
 )}
 </Map>
 </div>
 );
}
