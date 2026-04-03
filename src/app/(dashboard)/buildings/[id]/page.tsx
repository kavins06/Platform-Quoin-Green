import { BuildingDetail } from "@/components/building/building-detail";

export default async function BuildingPage({
 params,
}: {
 params: Promise<{ id: string }>;
}) {
 const { id } = await params;
 return <BuildingDetail buildingId={id} />;
}
