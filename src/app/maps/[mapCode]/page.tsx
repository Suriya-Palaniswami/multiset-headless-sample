import { Suspense } from "react";
import MapDetailClient from "./MapDetailClient";

export default function MapDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-zinc-500">Loading map…</div>
      }
    >
      <MapDetailClient />
    </Suspense>
  );
}
