import { NextResponse } from "next/server";
import { createVpsMap, type CreateVpsMapBody } from "@/lib/server/multisetMapUpload";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<CreateVpsMapBody> & Record<string, unknown>;
    if (!body.mapName || typeof body.mapName !== "string") {
      return NextResponse.json({ error: "mapName is required" }, { status: 400 });
    }
    if (typeof body.fileSize !== "number" || body.fileSize < 1) {
      return NextResponse.json({ error: "fileSize (bytes) must be a positive number" }, { status: 400 });
    }
    const coords = body.coordinates as CreateVpsMapBody["coordinates"] | undefined;
    if (
      !coords ||
      typeof coords.latitude !== "number" ||
      typeof coords.longitude !== "number" ||
      typeof coords.altitude !== "number"
    ) {
      return NextResponse.json(
        { error: "coordinates.latitude, coordinates.longitude, coordinates.altitude are required" },
        { status: 400 }
      );
    }

    const payload: CreateVpsMapBody = {
      mapName: body.mapName.trim(),
      fileSize: body.fileSize,
      coordinates: {
        latitude: coords.latitude,
        longitude: coords.longitude,
        altitude: coords.altitude,
      },
    };
    if (typeof body.heading === "number") payload.heading = body.heading;
    if (body.source && typeof body.source === "object") {
      const s = body.source as Record<string, unknown>;
      payload.source = {
        provider: String(s.provider ?? "unity"),
        fileType: String(s.fileType ?? "zip"),
        coordinateSystem: String(s.coordinateSystem ?? "RHS"),
      };
    }

    const result = await createVpsMap(payload);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
