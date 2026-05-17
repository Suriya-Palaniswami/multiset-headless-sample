"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type FlowStatus = "idle" | "running" | "success" | "error";

type LiveRequestStatus = "idle" | "running" | "success" | "error";

type LiveRequestResult = {
  status: LiveRequestStatus;
  localEndpoint: string;
  upstreamEndpoint: string;
  method: string;
  durationMs?: number;
  httpStatus?: number;
  request?: unknown;
  response?: unknown;
  error?: string;
};

type FlowNode = {
  id: string;
  title: string;
  subtitle: string;
  method: "GET" | "POST" | "PUT" | "BUILD" | "SOLVE";
  endpoint: string;
  body: string[];
  response: string[];
  x: number;
  y: number;
  tone: "sky" | "amber" | "emerald" | "violet" | "rose";
  durationMs: number;
};

type FlowEdge = {
  from: string;
  to: string;
  label: string;
};

type FlowSection = {
  id: "authentication" | "map-management" | "localization";
  navLabel: string;
  eyebrow: string;
  title: string;
  description: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  initialZoom: number;
  initialOffset: Point;
};

type Point = {
  x: number;
  y: number;
};

type NodeDragState = {
  nodeId: string;
  pointerX: number;
  pointerY: number;
  x: number;
  y: number;
  moved: boolean;
};

const flowSections: FlowSection[] = [
  {
    id: "authentication",
    navLabel: "Authentication",
    eyebrow: "M2M auth",
    title: "Credential Model First",
    description:
      "Lead with the sandbox versus production credential distinction before showing any Multiset API call.",
    initialZoom: 0.62,
    initialOffset: { x: 40, y: 96 },
    nodes: [
      {
        id: "auth-boundary",
        title: "Sandbox vs Production Credentials",
        subtitle: "For demos, credentials may be shown as placeholders; in production, secrets stay server-side only.",
        method: "BUILD",
        endpoint: "credential boundary before API calls",
        body: ["Sandbox: demo values and redacted tokens are acceptable for narration", "Production: never ship clientSecret to browser or mobile app", "Browser calls your backend proxy, backend calls Multiset"],
        response: ["clear security boundary", "safe API demonstration"],
        x: 60,
        y: 230,
        tone: "violet",
        durationMs: 650,
      },
      {
        id: "auth-credentials",
        title: "Load Server Credentials",
        subtitle: "Credentials stay on the server; the browser never sees the client secret.",
        method: "BUILD",
        endpoint: "MULTISET_CLIENT_ID + MULTISET_CLIENT_SECRET",
        body: ["server-only environment variables", "clientId:clientSecret pair"],
        response: ["Basic auth material", "no browser exposure"],
        x: 510,
        y: 120,
        tone: "sky",
        durationMs: 650,
      },
      {
        id: "auth-token",
        title: "Request M2M Token",
        subtitle: "The server calls Multiset's token endpoint with Basic authentication.",
        method: "POST",
        endpoint: "https://api.multiset.ai/v1/m2m/token",
        body: ["Authorization: Basic base64(clientId:clientSecret)", "body: {}"],
        response: ["token", "expiresOn"],
        x: 970,
        y: 270,
        tone: "rose",
        durationMs: 950,
      },
      {
        id: "auth-cache",
        title: "Attach Bearer Token",
        subtitle: "The app caches the token briefly and retries once if Multiset returns 401.",
        method: "BUILD",
        endpoint: "Authorization: Bearer <access_token>",
        body: ["cached token", "target Multiset API request"],
        response: ["authorized map/list/query calls", "forced refresh on stale token"],
        x: 1420,
        y: 140,
        tone: "emerald",
        durationMs: 800,
      },
    ],
    edges: [
      { from: "auth-boundary", to: "auth-credentials", label: "server-only" },
      { from: "auth-credentials", to: "auth-token", label: "Basic auth" },
      { from: "auth-token", to: "auth-cache", label: "bearer token" },
    ],
  },
  {
    id: "map-management",
    navLabel: "Map Management",
    eyebrow: "Maps + files",
    title: "Map Management",
    description:
      "The complete upload path: create the map, PUT file parts to pre-signed URLs, hand the key/ETags back, then poll status until active.",
    initialZoom: 0.5,
    initialOffset: { x: 34, y: 76 },
    nodes: [
      {
        id: "map-create",
        title: "1. Create VPS Map",
        subtitle: "Multiset creates a map record and returns signed upload URLs for the source file.",
        method: "POST",
        endpoint: "https://api.multiset.ai/v2/vps/map",
        body: ["mapName", "fileSize", "coordinates", "source/provider"],
        response: ["mapCode", "mapId", "uploadUrls.uploadId", "uploadUrls.signedUrls[]", "key"],
        x: 80,
        y: 190,
        tone: "violet",
        durationMs: 1000,
      },
      {
        id: "map-upload",
        title: "2. PUT File Parts",
        subtitle: "The app uploads the map file parts to the signed URLs returned by Multiset.",
        method: "PUT",
        endpoint: "signedUrls[].signedUrl",
        body: ["zip/e57 file bytes", "one PUT per signedUrl", "do not send this PUT through Multiset API"],
        response: ["ETag per uploaded part", "PartNumber captured for complete-upload"],
        x: 520,
        y: 90,
        tone: "amber",
        durationMs: 1200,
      },
      {
        id: "map-complete",
        title: "3. Complete Upload",
        subtitle: "Send the uploadId, key, and captured ETags back to Multiset.",
        method: "POST",
        endpoint: "https://api.multiset.ai/v2/vps/map/complete-upload/{mapId}",
        body: ["uploadId", "key", "parts: [{ ETag, PartNumber }]"],
        response: ["message", "map enters processing queue"],
        x: 960,
        y: 220,
        tone: "emerald",
        durationMs: 950,
      },
      {
        id: "map-poll",
        title: "4. Poll Map Status",
        subtitle: "After completion, poll map details until the map moves from pending/processing to active.",
        method: "GET",
        endpoint: "https://api.multiset.ai/v1/vps/map/{mapCode}",
        body: ["Authorization: Bearer <token>", "mapCode from create response"],
        response: ["status: pending/processing", "status: active when query-ready"],
        x: 1380,
        y: 240,
        tone: "emerald",
        durationMs: 800,
      },
      {
        id: "map-list",
        title: "List Maps",
        subtitle: "The app refreshes available VPS maps from Multiset.",
        method: "GET",
        endpoint: "https://api.multiset.ai/v1/vps/map?page=1&limit=100",
        body: ["Authorization: Bearer <token>"],
        response: ["maps[]", "mapCode", "processing status"],
        x: 1800,
        y: 80,
        tone: "sky",
        durationMs: 800,
      },
      {
        id: "map-details",
        title: "Get Map Details",
        subtitle: "A selected map code resolves to metadata, status, and mesh links.",
        method: "GET",
        endpoint: "https://api.multiset.ai/v1/vps/map/{mapCode}",
        body: ["Authorization: Bearer <token>", "mapCode"],
        response: ["mapMesh", "texturedMesh.meshLink", "rawMesh.meshLink"],
        x: 1410,
        y: 540,
        tone: "violet",
        durationMs: 900,
      },
      {
        id: "map-file",
        title: "Create File Download URL",
        subtitle: "The mesh key is exchanged for a short-lived downloadable asset URL.",
        method: "GET",
        endpoint: "https://api.multiset.ai/v1/file?key=<meshKey>",
        body: ["Authorization: Bearer <token>", "mesh object key"],
        response: ["url", "short-lived presigned download"],
        x: 910,
        y: 650,
        tone: "rose",
        durationMs: 850,
      },
    ],
    edges: [
      { from: "map-create", to: "map-upload", label: "signed URLs" },
      { from: "map-upload", to: "map-complete", label: "ETags" },
      { from: "map-complete", to: "map-poll", label: "key + parts" },
      { from: "map-poll", to: "map-list", label: "active" },
      { from: "map-list", to: "map-details", label: "mapCode" },
      { from: "map-details", to: "map-file", label: "mesh key" },
    ],
  },
  {
    id: "localization",
    navLabel: "Map Query Localization",
    eyebrow: "VPS query",
    title: "Map / Query Localization",
    description:
      "The runtime path: capture one camera frame, package it with intrinsics, send it to Multiset's query-form endpoint, and use the returned pose.",
    initialZoom: 0.5,
    initialOffset: { x: 34, y: 70 },
    nodes: [
      {
        id: "loc-capture",
        title: "Capture Image + SLAM Pose",
        subtitle: "The image and the local SLAM pose must describe the same instant in time.",
        method: "BUILD",
        endpoint: "XRFrame -> pixels + local pose + intrinsics",
        body: ["image_data fields are local SLAM poses at capture time, not stored image references", "WebXR: getViewerPose(referenceSpace) gives local pose for the frame", "projectionMatrix / camera metadata gives intrinsics; JPEG max side <= 1280"],
        response: ["sharp, non-blurry frame", "T_world_camera / tracking pose", "fx/fy/px/py tied to encoded image size"],
        x: 80,
        y: 250,
        tone: "sky",
        durationMs: 850,
      },
      {
        id: "loc-prepare",
        title: "Prepare Query Form",
        subtitle: "The frame becomes a <=1280px JPEG with intrinsics matching the encoded image.",
        method: "BUILD",
        endpoint: "multipart/form-data",
        body: ["mapCode", "queryImage", "fx/fy/px/py", "width/height", "isRightHanded"],
        response: ["ready-to-send query payload"],
        x: 520,
        y: 110,
        tone: "amber",
        durationMs: 800,
      },
      {
        id: "loc-codes",
        title: "MapCode vs MapSetCode",
        subtitle: "Choose whether the query searches one map or a MapSet, and use hintMapCode only as a real map code hint.",
        method: "BUILD",
        endpoint: "mapCode / mapSetCode / hintMapCode",
        body: ["mapCode targets one VPS map", "mapSetCode targets a collection of maps; omit it for single-map query", "empty mapSetCode can be ambiguous; omit unused optional fields", "hintMapCode must be the actual MAP_ code, not the map name"],
        response: ["Use hintMapCode for venues >10,000 sq ft or similar-looking corridors/halls", "narrower search space and fewer false matches"],
        x: 880,
        y: 30,
        tone: "violet",
        durationMs: 700,
      },
      {
        id: "loc-proxy",
        title: "Server Proxy Receives Query",
        subtitle: "The browser posts to this app so Multiset secrets never leave the server.",
        method: "POST",
        endpoint: "/api/localize",
        body: ["multipart query fields", "queryImage file/blob"],
        response: ["server-side FormData", "Bearer token attached"],
        x: 1000,
        y: 360,
        tone: "violet",
        durationMs: 900,
      },
      {
        id: "loc-token",
        title: "Use M2M Bearer Token",
        subtitle: "The proxy uses the authentication flow to authorize the upstream query.",
        method: "POST",
        endpoint: "https://api.multiset.ai/v1/m2m/token",
        body: ["cached token or Basic auth refresh"],
        response: ["Authorization: Bearer <token>"],
        x: 1380,
        y: 160,
        tone: "rose",
        durationMs: 750,
      },
      {
        id: "loc-query",
        title: "Query Multiset Map",
        subtitle: "Multiset localizes the image against the selected VPS map.",
        method: "POST",
        endpoint: "https://api.multiset.ai/v1/vps/map/query-form",
        body: ["Authorization: Bearer <token>", "multipart/form-data", "queryImage"],
        response: ["poseFound", "position", "rotation", "confidence"],
        x: 1780,
        y: 290,
        tone: "emerald",
        durationMs: 1300,
      },
      {
        id: "loc-confidence",
        title: "Confidence + Re-localization",
        subtitle: "Use confidence to decide whether to accept the pose, and re-query in the background at a cost-aware interval.",
        method: "BUILD",
        endpoint: "client acceptance policy",
        body: ["Recommended high-accuracy floor: confidence >= 0.7", "Each localization query costs an API call", "10s background polling is usually too frequent"],
        response: ["Accept high-confidence poses", "poll every 30-60s when SLAM tracking remains good", "relocalize sooner only after tracking loss or large drift"],
        x: 1680,
        y: 660,
        tone: "amber",
        durationMs: 650,
      },
      {
        id: "loc-solve",
        title: "Apply Returned Pose",
        subtitle: "The app combines the Multiset map pose with WebXR local tracking.",
        method: "SOLVE",
        endpoint: "T_world_map = T_world_camera * inverse(T_map_camera)",
        body: ["T_world_camera from WebXR", "T_map_camera from Multiset"],
        response: ["localized mapRoot", "AR content aligned to map"],
        x: 1080,
        y: 690,
        tone: "sky",
        durationMs: 850,
      },
    ],
    edges: [
      { from: "loc-capture", to: "loc-prepare", label: "image + projection" },
      { from: "loc-prepare", to: "loc-codes", label: "target map" },
      { from: "loc-codes", to: "loc-proxy", label: "FormData" },
      { from: "loc-proxy", to: "loc-token", label: "needs token" },
      { from: "loc-token", to: "loc-query", label: "Bearer" },
      { from: "loc-query", to: "loc-confidence", label: "confidence" },
      { from: "loc-confidence", to: "loc-solve", label: "accepted pose" },
    ],
  },
];

const allFlowNodes = flowSections.flatMap((section) => section.nodes);

const statusLabels: Record<FlowStatus, string> = {
  idle: "ready",
  running: "processing",
  success: "success",
  error: "error",
};

const jsonPreviewLimit = 4200;

const toneClasses: Record<FlowNode["tone"], string> = {
  sky: "from-sky-500/20 to-cyan-400/5 border-sky-300/30",
  amber: "from-amber-400/20 to-orange-500/5 border-amber-300/30",
  emerald: "from-emerald-400/20 to-lime-400/5 border-emerald-300/30",
  violet: "from-violet-400/20 to-fuchsia-400/5 border-violet-300/30",
  rose: "from-rose-400/20 to-red-400/5 border-rose-300/30",
};

const initialNodePositions = Object.fromEntries(
  allFlowNodes.map((node) => [node.id, { x: node.x, y: node.y }]),
) as Record<string, Point>;

function getEdgePath(edge: FlowEdge, nodePositions: Record<string, Point>) {
  const from = nodePositions[edge.from];
  const to = nodePositions[edge.to];

  if (!from || !to) {
    return "";
  }

  const startX = from.x + 360;
  const startY = from.y + 120;
  const endX = to.x + 20;
  const endY = to.y + 120;
  const midX = (startX + endX) / 2;

  return `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
}

function getEdgeLabelPoint(edge: FlowEdge, nodePositions: Record<string, Point>) {
  const from = nodePositions[edge.from];
  const to = nodePositions[edge.to];

  if (!from || !to) {
    return { x: 0, y: 0 };
  }

  return {
    x: (from.x + to.x) / 2 + 190,
    y: (from.y + to.y) / 2 + 90,
  };
}

function getStatusClasses(status: FlowStatus) {
  if (status === "success") {
    return "border-emerald-300/80 bg-emerald-400/15 text-emerald-100 shadow-[0_0_36px_rgba(52,211,153,0.25)]";
  }

  if (status === "running") {
    return "border-yellow-200/80 bg-yellow-300/15 text-yellow-50 shadow-[0_0_42px_rgba(250,204,21,0.28)]";
  }

  if (status === "error") {
    return "border-red-300/80 bg-red-400/15 text-red-100 shadow-[0_0_36px_rgba(248,113,113,0.24)]";
  }

  return "border-white/15 bg-white/[0.06] text-zinc-200";
}

function stringifyPreview(value: unknown): string {
  if (value === undefined) {
    return "No response yet.";
  }

  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  if (text.length <= jsonPreviewLimit) {
    return text;
  }

  return `${text.slice(0, jsonPreviewLimit)}\n... truncated for display`;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function prepareQueryImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    throw new Error("Could not create canvas context for query image");
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
          return;
        }

        reject(new Error("Could not encode query image as JPEG"));
      },
      "image/jpeg",
      0.82,
    );
  });

  const verticalFovRadians = (60 * Math.PI) / 180;
  const fy = height / (2 * Math.tan(verticalFovRadians / 2));
  const fx = fy * (width / height);

  return {
    blob,
    intrinsics: {
      fx,
      fy,
      px: width / 2,
      py: height / 2,
    },
    resolution: { width, height },
  };
}

function getDemoLiveRequest(
  node: FlowNode,
  reason: string,
  startedAt: number,
  mapCode: string,
  queryImageName?: string,
): LiveRequestResult {
  const demoMapCode = mapCode.trim() || "MAP_DEMO_7F3A2C";
  const base = {
    status: "success" as const,
    method: node.method,
    httpStatus: 200,
    durationMs: Math.max(180, Math.round(performance.now() - startedAt)),
  };

  const demoEnvelope = {
    demoFallback: true,
    reason,
    note: "Demo response generated locally so the presentation flow can continue.",
  };

  switch (node.id) {
    case "auth-boundary":
      return {
        ...base,
        localEndpoint: "presentation setup",
        upstreamEndpoint: "no API call yet",
        request: {
          sandbox: "Use demo placeholders and redacted tokens for screen capture.",
          production: "Keep MULTISET_CLIENT_SECRET on the server only.",
        },
        response: {
          ...demoEnvelope,
          rule: "Lead with credential boundary before demonstrating API calls.",
          browserCanSee: ["mapCode", "query image", "intrinsics"],
          browserMustNotSee: ["clientSecret", "raw bearer token"],
        },
      };
    case "auth-credentials":
      return {
        ...base,
        localEndpoint: "server runtime environment",
        upstreamEndpoint: "not sent until token request",
        request: {
          MULTISET_CLIENT_ID: "m2m_demo_client_8d92",
          MULTISET_CLIENT_SECRET: "<redacted>",
        },
        response: {
          ...demoEnvelope,
          credentialsLoaded: true,
          clientId: "m2m_demo_client_8d92",
          secretScope: "server-only",
        },
      };
    case "auth-token":
    case "auth-cache":
    case "loc-token":
      return {
        ...base,
        method: "POST",
        localEndpoint: "/api/api-flow/token",
        upstreamEndpoint: "https://api.multiset.ai/v1/m2m/token",
        request: {
          Authorization: "Basic <MULTISET_CLIENT_ID:MULTISET_CLIENT_SECRET>",
          body: {},
        },
        response: {
          token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.demo-token-payload.signature",
          expiresOn: "2026-05-11T12:30:00.000Z",
        },
      };
    case "map-create":
      return {
        ...base,
        method: "POST",
        localEndpoint: "/api/maps/upload/start",
        upstreamEndpoint: "https://api.multiset.ai/v2/vps/map",
        request: {
          mapName: "Demo Office Scan",
          fileSize: 84239124,
          coordinates: { latitude: 51.5074, longitude: -0.1278, altitude: 42 },
          source: { provider: "unity", fileType: "zip", coordinateSystem: "RHS" },
        },
        response: {
          message: "VPS map created successfully",
          mapCode: demoMapCode,
          mapId: "67e12d4bff7ecf561f2f8a0c",
          uploadUrls: {
            uploadId: "upload_demo_7fb12",
            signedUrls: [
              { partNumber: 1, signedUrl: "https://multiset-upload.example/part-1?signature=demo" },
              { partNumber: 2, signedUrl: "https://multiset-upload.example/part-2?signature=demo" },
            ],
          },
          key: `vps-maps/${demoMapCode}/source.zip`,
        },
      };
    case "map-upload":
      return {
        ...base,
        method: "PUT",
        localEndpoint: "browser direct upload",
        upstreamEndpoint: "signedUrls[].signedUrl",
        request: {
          file: "DemoOfficeScan.zip",
          partsUploaded: 2,
          contentType: "application/zip",
        },
        response: {
          ...demoEnvelope,
          parts: [
            { ETag: "\"demo-etag-part-1\"", PartNumber: 1 },
            { ETag: "\"demo-etag-part-2\"", PartNumber: 2 },
          ],
        },
      };
    case "map-complete":
      return {
        ...base,
        method: "POST",
        localEndpoint: "/api/maps/upload/complete",
        upstreamEndpoint: "https://api.multiset.ai/v2/vps/map/complete-upload/map_01HXDEMO9NZ3",
        request: {
          uploadId: "upload_demo_7fb12",
          key: `vps-maps/${demoMapCode}/source.zip`,
          parts: [
            { ETag: "\"demo-etag-part-1\"", PartNumber: 1 },
            { ETag: "\"demo-etag-part-2\"", PartNumber: 2 },
          ],
        },
        response: {
          message: "VPS map multipart upload completed successfully",
        },
      };
    case "map-poll":
      return {
        ...base,
        method: "GET",
        localEndpoint: `/api/maps/${encodeURIComponent(demoMapCode)}`,
        upstreamEndpoint: `https://api.multiset.ai/v1/vps/map/${encodeURIComponent(demoMapCode)}`,
        request: {
          mapCode: demoMapCode,
          pollUntil: "status becomes active",
        },
        response: {
          ...demoEnvelope,
          attempts: [
            { attempt: 1, status: "pending", message: "Map uploaded; processing not started yet." },
            { attempt: 2, status: "processing", message: "Multiset is processing VPS data." },
            { attempt: 3, status: "active", message: "Map is ready for localization queries." },
          ],
          finalStatus: "active",
        },
      };
    case "map-list":
      return {
        ...base,
        method: "GET",
        localEndpoint: "/api/maps",
        upstreamEndpoint: "https://api.multiset.ai/v1/vps/map?page=1&limit=100",
        request: { Authorization: "Bearer <server token>" },
        response: {
          ...demoEnvelope,
          maps: [
            {
              mapCode: demoMapCode,
              mapName: "Demo Office Scan",
              status: "processed",
              createdAt: "2026-05-11T10:15:30.000Z",
            },
          ],
          page: 1,
          limit: 100,
        },
      };
    case "map-details":
      return {
        ...base,
        method: "GET",
        localEndpoint: `/api/maps/${encodeURIComponent(demoMapCode)}`,
        upstreamEndpoint: `https://api.multiset.ai/v1/vps/map/${encodeURIComponent(demoMapCode)}`,
        request: { mapCode: demoMapCode, Authorization: "Bearer <server token>" },
        response: {
          ...demoEnvelope,
          mapCode: demoMapCode,
          mapName: "Demo Office Scan",
          status: "processed",
          mapMesh: {
            texturedMesh: { meshLink: `vps-maps/${demoMapCode}/TexturedMesh.glb` },
            rawMesh: { meshLink: `vps-maps/${demoMapCode}/RawMesh.glb` },
          },
        },
      };
    case "map-file":
      return {
        ...base,
        method: "GET",
        localEndpoint: `/api/maps/${encodeURIComponent(demoMapCode)}/download-mesh-url`,
        upstreamEndpoint: "https://api.multiset.ai/v1/file?key=<meshKey>",
        request: { key: `vps-maps/${demoMapCode}/TexturedMesh.glb` },
        response: {
          ...demoEnvelope,
          meshKey: `vps-maps/${demoMapCode}/TexturedMesh.glb`,
          url: "https://prod-multiset.s3-accelerate.amazonaws.com/demo/TexturedMesh.glb?signature=demo",
          expiresInSeconds: 900,
        },
      };
    case "loc-capture":
      return {
        ...base,
        method: "BUILD",
        localEndpoint: "XR camera texture + local tracking",
        upstreamEndpoint: "not sent until query-form",
        request: { source: "WebXR XRFrame", cameraTexture: "current frame" },
        response: {
          ...demoEnvelope,
          frameCaptured: true,
          imageSize: { width: 1920, height: 1080 },
          frameQuality: {
            blur: "low",
            exposure: "balanced",
            textureDetail: "good",
          },
          image_dataClarification:
            "For multi-image query, image#_data is the local SLAM pose at capture time, not a stored image reference.",
          webXRExtraction: {
            pose: "frame.getViewerPose(referenceSpace)",
            intrinsics: "derive fx/fy/px/py from XRView.projectionMatrix for the encoded image size",
          },
          T_world_camera: { position: [0.18, 1.54, -0.42], rotation: [0.02, 0.71, 0.01, 0.7] },
        },
      };
    case "loc-prepare":
      return {
        ...base,
        method: "BUILD",
        localEndpoint: "multipart/form-data",
        upstreamEndpoint: "not sent until /api/localize",
        request: { sourceFile: queryImageName ?? "demo-frame.jpg" },
        response: {
          ...demoEnvelope,
          mapCode: demoMapCode,
          mapSetCode: "omitted for single-map query",
          hintMapCode: "MAP_RJFKKWQ1787J",
          queryImage: { filename: "query.jpg", mimeType: "image/jpeg", sizeBytes: 184206 },
          resolution: { width: 1280, height: 720 },
          cameraIntrinsics: { fx: 1108.5, fy: 623.5, px: 640, py: 360 },
          isRightHanded: true,
        },
      };
    case "loc-codes":
      return {
        ...base,
        method: "BUILD",
        localEndpoint: "query target selection",
        upstreamEndpoint: "fields on /vps/map/query-form",
        request: {
          mapCode: demoMapCode,
          mapSetCode: "omit when not querying a MapSet",
          hintMapCode: "MAP_RJFKKWQ1787J",
        },
        response: {
          ...demoEnvelope,
          mapCode: "single-map localization target",
          mapSetCode: "MapSet localization target; omit unused optional field rather than sending an empty string",
          hintMapCode:
            "Optional search hint for large venues or visually similar areas. Must be the actual MAP_ code, not the display name.",
          whenToUseHintMapCode: ["venues > 10,000 sq ft", "repeated corridors", "similar halls", "multi-map areas with ambiguous features"],
        },
      };
    case "loc-proxy":
    case "loc-query":
      return {
        ...base,
        method: "POST",
        localEndpoint: "/api/localize",
        upstreamEndpoint: "https://api.multiset.ai/v1/vps/map/query-form",
        request: {
          localProxy: "POST /api/localize",
          upstreamAuthorization: "Authorization: Bearer <M2M token>",
          mapCode: demoMapCode,
          mapSetCode: "omitted",
          hintMapCode: "MAP_RJFKKWQ1787J",
          queryImage: { filename: queryImageName ?? "demo-frame.jpg", sentAs: "query.jpg" },
          resolution: { width: 1280, height: 720 },
          cameraIntrinsics: { fx: 1108.5, fy: 623.5, px: 640, py: 360 },
          isRightHanded: true,
        },
        response: {
          poseFound: true,
          position: {
            x: -5.89516855615433,
            y: 1.225031596452081,
            z: 2.2112895596804227,
          },
          rotation: {
            x: -0.007873432249486393,
            y: 0.8212519784928444,
            z: 0.03204363652415735,
            w: 0.5696107462509017,
          },
          confidence: 0.46875,
          mapIds: ["67e12d4bff7ecf561f2f8a0c"],
          mapCodes: ["MAP_RJFKKWQ1787J"],
          responseTime: 2572,
        },
      };
    case "loc-confidence":
      return {
        ...base,
        method: "BUILD",
        localEndpoint: "client acceptance policy",
        upstreamEndpoint: "uses query-form confidence",
        request: {
          confidence: 0.46875,
          recommendedHighAccuracyFloor: 0.7,
        },
        response: {
          ...demoEnvelope,
          acceptForHighAccuracy: false,
          guidance:
            "For high-accuracy use cases, use confidence >= 0.7 as the floor. Continue SLAM tracking and re-query every 30-60s, not every 10s, unless tracking is lost or drift is visible.",
          backgroundRelocalizationIntervalSeconds: [30, 60],
        },
      };
    case "loc-result":
      return {
        ...base,
        method: "BUILD",
        localEndpoint: "query-form response JSON",
        upstreamEndpoint: "https://api.multiset.ai/v1/vps/map/query-form",
        request: {
          consume: ["poseFound", "confidence", "position", "rotation"],
        },
        response: {
          ...demoEnvelope,
          poseFound: true,
          confidence: 0.91,
          T_map_camera: {
            position: { x: 2.438, y: 1.126, z: -4.772 },
            rotation: { x: 0.011, y: 0.705, z: -0.018, w: 0.709 },
          },
        },
      };
    case "loc-solve":
      return {
        ...base,
        method: "SOLVE",
        localEndpoint: "client pose composition",
        upstreamEndpoint: "not sent; uses query-form response",
        request: {
          T_world_camera: "from WebXR capture",
          T_map_camera: "from Multiset query-form response",
        },
        response: {
          ...demoEnvelope,
          equation: "T_world_map = T_world_camera * inverse(T_map_camera)",
          mapRootAligned: true,
          placedObjectsVisible: true,
        },
      };
    default:
      return {
        ...base,
        localEndpoint: "demo-only",
        upstreamEndpoint: node.endpoint,
        request: { step: node.title },
        response: { ...demoEnvelope, success: true },
      };
  }
}

export default function ApiFlowPage() {
  const [activeSectionId, setActiveSectionId] = useState<FlowSection["id"]>("authentication");
  const [statuses, setStatuses] = useState<Record<string, FlowStatus>>(() =>
    Object.fromEntries(allFlowNodes.map((node) => [node.id, "idle"])),
  );
  const [activeNodeId, setActiveNodeId] = useState(flowSections[0].nodes[0].id);
  const [zoom, setZoom] = useState(flowSections[0].initialZoom);
  const [offset, setOffset] = useState(flowSections[0].initialOffset);
  const [nodePositions, setNodePositions] = useState<Record<string, Point>>(initialNodePositions);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [isRunningFlow, setIsRunningFlow] = useState(false);
  const [mapCode, setMapCode] = useState("");
  const [queryImageFile, setQueryImageFile] = useState<File | null>(null);
  const [liveRequests, setLiveRequests] = useState<Record<string, LiveRequestResult>>({});
  const dragStartRef = useRef({ pointerX: 0, pointerY: 0, x: 0, y: 0 });
  const nodeDragRef = useRef<NodeDragState | null>(null);
  const suppressClickRef = useRef<string | null>(null);

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;

    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
    };
  }, []);

  const activeSection = useMemo(
    () => flowSections.find((section) => section.id === activeSectionId) ?? flowSections[0],
    [activeSectionId],
  );

  const activeNode = useMemo(() => {
    return (
      activeSection.nodes.find((node) => node.id === activeNodeId) ??
      activeSection.nodes[0]
    );
  }, [activeNodeId, activeSection]);

  const activeLiveRequest = liveRequests[activeNode.id];

  const completedCount = activeSection.nodes.filter((node) => statuses[node.id] === "success").length;
  const activeEdges = new Set(
    activeSection.edges
      .filter((edge) => statuses[edge.from] === "success" && statuses[edge.to] !== "idle")
      .map((edge) => `${edge.from}-${edge.to}`),
  );

  const runNode = useCallback(async (node: FlowNode) => {
    setActiveNodeId(node.id);
    setStatuses((current) => ({ ...current, [node.id]: "running" }));
    await new Promise((resolve) => window.setTimeout(resolve, node.durationMs));
    setStatuses((current) => ({ ...current, [node.id]: "success" }));
  }, []);

  const runFlow = useCallback(async () => {
    setIsRunningFlow(true);
    setStatuses((current) => ({
      ...current,
      ...Object.fromEntries(activeSection.nodes.map((node) => [node.id, "idle"])),
    }));

    for (const node of activeSection.nodes) {
      await runNode(node);
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }

    setIsRunningFlow(false);
  }, [activeSection.nodes, runNode]);

  function resetFlow() {
    setIsRunningFlow(false);
    setStatuses((current) => ({
      ...current,
      ...Object.fromEntries(activeSection.nodes.map((node) => [node.id, "idle"])),
    }));
    setActiveNodeId(activeSection.nodes[0].id);
    setNodePositions(initialNodePositions);
    setZoom(activeSection.initialZoom);
    setOffset(activeSection.initialOffset);
  }

  function selectSection(section: FlowSection) {
    setActiveSectionId(section.id);
    setActiveNodeId(section.nodes[0].id);
    setIsRunningFlow(false);
    setDraggingNodeId(null);
    nodeDragRef.current = null;
    setZoom(section.initialZoom);
    setOffset(section.initialOffset);
  }

  async function sendLiveRequest(node: FlowNode) {
    setActiveNodeId(node.id);
    setStatuses((current) => ({ ...current, [node.id]: "running" }));

    const startedAt = performance.now();
    const setRunning = (localEndpoint: string, upstreamEndpoint = node.endpoint, method = node.method) => {
      setLiveRequests((current) => ({
        ...current,
        [node.id]: {
          status: "running",
          localEndpoint,
          upstreamEndpoint,
          method,
        },
      }));
    };

    try {
      let localEndpoint = "";
      let upstreamEndpoint = node.endpoint;
      let method = node.method;
      let requestSummary: unknown = undefined;
      let response: Response;

      if (node.id === "auth-token" || node.id === "auth-cache" || node.id === "loc-token") {
        localEndpoint = "/api/api-flow/token";
        upstreamEndpoint = "https://api.multiset.ai/v1/m2m/token";
        method = "POST";
        requestSummary = {
          Authorization: "Basic <MULTISET_CLIENT_ID:MULTISET_CLIENT_SECRET>",
          body: {},
          note: "Sent from server debug route; token is redacted before display.",
        };
        setRunning(localEndpoint, upstreamEndpoint, method);
        response = await fetch(localEndpoint, { method: "POST" });
      } else if (node.id === "map-list") {
        localEndpoint = "/api/maps";
        upstreamEndpoint = "https://api.multiset.ai/v1/vps/map?page=1&limit=100";
        method = "GET";
        requestSummary = { Authorization: "Bearer <server token>" };
        setRunning(localEndpoint, upstreamEndpoint, method);
        response = await fetch(localEndpoint);
      } else if (node.id === "map-details") {
        if (!mapCode.trim()) {
          throw new Error("Enter a mapCode first.");
        }

        const encodedMapCode = encodeURIComponent(mapCode.trim());
        localEndpoint = `/api/maps/${encodedMapCode}`;
        upstreamEndpoint = `https://api.multiset.ai/v1/vps/map/${encodedMapCode}`;
        method = "GET";
        requestSummary = { mapCode: mapCode.trim(), Authorization: "Bearer <server token>" };
        setRunning(localEndpoint, upstreamEndpoint, method);
        response = await fetch(localEndpoint);
      } else if (node.id === "map-file") {
        if (!mapCode.trim()) {
          throw new Error("Enter a mapCode first.");
        }

        const encodedMapCode = encodeURIComponent(mapCode.trim());
        localEndpoint = `/api/maps/${encodedMapCode}/download-mesh-url`;
        upstreamEndpoint = "https://api.multiset.ai/v1/file?key=<meshKey from map details>";
        method = "GET";
        requestSummary = {
          mapCode: mapCode.trim(),
          flow: "get map details -> extract mesh key -> request file URL",
        };
        setRunning(localEndpoint, upstreamEndpoint, method);
        response = await fetch(localEndpoint);
      } else if (node.id === "loc-proxy" || node.id === "loc-query") {
        if (!mapCode.trim()) {
          throw new Error("Enter a mapCode first.");
        }

        if (!queryImageFile) {
          throw new Error("Choose a query image first.");
        }

        const prepared = await prepareQueryImage(queryImageFile);
        const formData = new FormData();
        formData.append("mapCode", mapCode.trim());
        formData.append("fx", String(prepared.intrinsics.fx));
        formData.append("fy", String(prepared.intrinsics.fy));
        formData.append("px", String(prepared.intrinsics.px));
        formData.append("py", String(prepared.intrinsics.py));
        formData.append("width", String(prepared.resolution.width));
        formData.append("height", String(prepared.resolution.height));
        formData.append("isRightHanded", "true");
        formData.append("queryImage", prepared.blob, "query.jpg");

        localEndpoint = "/api/localize";
        upstreamEndpoint = "https://api.multiset.ai/v1/vps/map/query-form";
        method = "POST";
        requestSummary = {
          localProxy: "POST /api/localize",
          upstreamEndpoint,
          upstreamAuthorization: "Authorization: Bearer <M2M token>",
          mapCode: mapCode.trim(),
          mapSetCode: "omitted for single-map query",
          hintMapCode: "optional MAP_ code; not sent by this sample unless wired explicitly",
          queryImage: {
            sourceFile: queryImageFile.name,
            sentAs: "query.jpg",
            mimeType: prepared.blob.type,
            sizeBytes: prepared.blob.size,
          },
          resolution: prepared.resolution,
          cameraIntrinsics: prepared.intrinsics,
          isRightHanded: true,
        };
        setRunning(localEndpoint, upstreamEndpoint, method);
        response = await fetch(localEndpoint, {
          method: "POST",
          body: formData,
        });
      } else {
        const demoResult = getDemoLiveRequest(
          node,
          "This card is a local preparation/computation step, so it uses a demo success payload.",
          startedAt,
          mapCode,
          queryImageFile?.name,
        );

        setStatuses((current) => ({ ...current, [node.id]: "success" }));
        setLiveRequests((current) => ({
          ...current,
          [node.id]: demoResult,
        }));
        return;
      }

      const body = await readResponseBody(response);
      const durationMs = Math.round(performance.now() - startedAt);
      const wasSuccessful = response.ok;

      if (!wasSuccessful) {
        const demoResult = getDemoLiveRequest(
          node,
          `Real request returned HTTP ${response.status}; showing demo success data for recording.`,
          startedAt,
          mapCode,
          queryImageFile?.name,
        );
        setStatuses((current) => ({ ...current, [node.id]: "success" }));
        setLiveRequests((current) => ({
          ...current,
          [node.id]: {
            ...demoResult,
            response: {
              ...(typeof demoResult.response === "object" && demoResult.response !== null
                ? demoResult.response
                : { demoResponse: demoResult.response }),
              attemptedHttpStatus: response.status,
              attemptedResponse: body,
            },
          },
        }));
        return;
      }

      setStatuses((current) => ({ ...current, [node.id]: "success" }));
      setLiveRequests((current) => ({
        ...current,
        [node.id]: {
          status: "success",
          localEndpoint,
          upstreamEndpoint,
          method,
          httpStatus: response.status,
          durationMs,
          request: requestSummary,
          response: body,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown request error";
      const demoResult = getDemoLiveRequest(
        node,
        message,
        startedAt,
        mapCode,
        queryImageFile?.name,
      );
      setStatuses((current) => ({ ...current, [node.id]: "success" }));
      setLiveRequests((current) => ({
        ...current,
        [node.id]: demoResult,
      }));
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const nextZoom = Math.min(Math.max(zoom - event.deltaY * 0.0012, 0.36), 1.1);
    const zoomRatio = nextZoom / zoom;

    setZoom(nextZoom);
    setOffset((current) => ({
      x: pointerX - (pointerX - current.x) * zoomRatio,
      y: pointerY - (pointerY - current.y) * zoomRatio,
    }));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: offset.x,
      y: offset.y,
    };
    setIsDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging) {
      return;
    }

    const start = dragStartRef.current;
    setOffset({
      x: start.x + event.clientX - start.pointerX,
      y: start.y + event.clientY - start.pointerY,
    });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setIsDragging(false);
  }

  function handleNodePointerDown(event: React.PointerEvent<HTMLButtonElement>, node: FlowNode) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveNodeId(node.id);

    const position = nodePositions[node.id] ?? { x: node.x, y: node.y };
    nodeDragRef.current = {
      nodeId: node.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: position.x,
      y: position.y,
      moved: false,
    };
    setDraggingNodeId(node.id);
  }

  function handleNodePointerMove(event: React.PointerEvent<HTMLButtonElement>, node: FlowNode) {
    const drag = nodeDragRef.current;

    if (!drag || drag.nodeId !== node.id) {
      return;
    }

    event.stopPropagation();
    const deltaX = event.clientX - drag.pointerX;
    const deltaY = event.clientY - drag.pointerY;

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      drag.moved = true;
    }

    setNodePositions((current) => ({
      ...current,
      [node.id]: {
        x: drag.x + deltaX / zoom,
        y: drag.y + deltaY / zoom,
      },
    }));
  }

  function handleNodePointerUp(event: React.PointerEvent<HTMLButtonElement>, node: FlowNode) {
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (nodeDragRef.current?.moved) {
      suppressClickRef.current = node.id;
    }

    nodeDragRef.current = null;
    setDraggingNodeId(null);
  }

  return (
    <main className="h-screen overflow-hidden overscroll-none bg-[#07120f] text-zinc-50">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(45,212,191,0.24),transparent_32%),radial-gradient(circle_at_80%_12%,rgba(168,85,247,0.2),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.05)_0_1px,transparent_1px_22px)]" />
      <section className="relative z-10 flex h-screen overflow-hidden">
        <aside className="h-screen w-[390px] shrink-0 overflow-y-auto overscroll-contain border-r border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-8">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.35em] text-emerald-200/70">
              {activeSection.eyebrow}
            </p>
            <h1 className="text-4xl font-black leading-tight tracking-tight">
              {activeSection.title}
            </h1>
            <p className="mt-4 text-sm leading-6 text-zinc-300">
              {activeSection.description}
            </p>
          </div>

          <div className="mb-5 grid gap-2">
            {flowSections.map((section) => {
              const isActive = section.id === activeSection.id;

              return (
                <button
                  type="button"
                  key={section.id}
                  onClick={() => selectSection(section)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    isActive
                      ? "border-emerald-200/60 bg-emerald-300/15 text-emerald-50"
                      : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-black">{section.navLabel}</span>
                    <span className="font-mono text-xs text-zinc-400">
                      {section.nodes.length} requests
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mb-5 rounded-3xl border border-white/10 bg-white/[0.06] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-zinc-400">Section progress</span>
              <span className="font-mono text-sm text-emerald-200">
                {completedCount}/{activeSection.nodes.length}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-black/40">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-emerald-300 to-lime-200 transition-all duration-500"
                style={{ width: `${(completedCount / activeSection.nodes.length) * 100}%` }}
              />
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={runFlow}
              disabled={isRunningFlow}
              className="rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-black text-zinc-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run full flow
            </button>
            <button
              type="button"
              onClick={resetFlow}
              className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-bold text-zinc-100 transition hover:bg-white/15"
            >
              Reset
            </button>
          </div>

          <div className="mb-5 rounded-3xl border border-white/10 bg-white/[0.05] p-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Live request inputs
            </p>
            <label className="mb-3 block text-xs font-bold text-zinc-300">
              Map code
              <input
                value={mapCode}
                onChange={(event) => setMapCode(event.target.value)}
                placeholder="MAP_XXXXX"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/45 px-3 py-2 font-mono text-xs text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/60"
              />
            </label>
            <label className="block text-xs font-bold text-zinc-300">
              Query image for localization
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setQueryImageFile(event.target.files?.[0] ?? null)}
                className="mt-2 block w-full cursor-pointer rounded-2xl border border-white/10 bg-black/45 px-3 py-2 text-xs text-zinc-300 file:mr-3 file:rounded-xl file:border-0 file:bg-emerald-300 file:px-3 file:py-1 file:text-xs file:font-black file:text-zinc-950"
              />
            </label>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/70 p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Selected step</p>
                <h2 className="mt-1 text-xl font-black">{activeNode.title}</h2>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-bold ${getStatusClasses(statuses[activeNode.id])}`}>
                {statusLabels[statuses[activeNode.id]]}
              </span>
            </div>
            <p className="mb-4 text-sm leading-6 text-zinc-300">{activeNode.subtitle}</p>
            <div className="mb-4 rounded-2xl bg-black/45 p-4 font-mono text-xs text-emerald-100">
              <div className="mb-2 text-zinc-500">REQUEST</div>
              <div>
                {activeNode.method} {activeNode.endpoint}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void sendLiveRequest(activeNode)}
              disabled={activeLiveRequest?.status === "running"}
              className="mb-4 w-full rounded-2xl bg-cyan-200 px-4 py-3 text-sm font-black text-zinc-950 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {activeLiveRequest?.status === "running" ? "Sending real request..." : "Send real request"}
            </button>
            <div className="grid gap-3 text-xs">
              <div>
                <p className="mb-2 font-bold uppercase tracking-[0.18em] text-zinc-500">Payload</p>
                <ul className="space-y-1 text-zinc-300">
                  {activeNode.body.map((item) => (
                    <li key={item}>- {item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 font-bold uppercase tracking-[0.18em] text-zinc-500">Response</p>
                <ul className="space-y-1 text-zinc-300">
                  {activeNode.response.map((item) => (
                    <li key={item}>- {item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                  Actual response
                </p>
                {activeLiveRequest?.httpStatus ? (
                  <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 font-mono text-[10px] text-zinc-200">
                    HTTP {activeLiveRequest.httpStatus}
                  </span>
                ) : null}
              </div>
              {activeLiveRequest ? (
                <div className="space-y-3">
                  <div className="grid gap-1 font-mono text-[11px] text-zinc-300">
                    <span>Local: {activeLiveRequest.localEndpoint}</span>
                    <span>Upstream: {activeLiveRequest.upstreamEndpoint}</span>
                    {activeLiveRequest.durationMs ? (
                      <span>Time: {activeLiveRequest.durationMs}ms</span>
                    ) : null}
                  </div>
                  {activeLiveRequest.error ? (
                    <div className="rounded-xl border border-red-300/20 bg-red-400/10 p-3 text-xs text-red-100">
                      {activeLiveRequest.error}
                    </div>
                  ) : null}
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                      Request sent
                    </p>
                    <pre className="max-h-40 overflow-auto rounded-xl bg-zinc-950 p-3 text-[11px] leading-5 text-cyan-100">
                      {stringifyPreview(activeLiveRequest.request)}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                      Response body
                    </p>
                    <pre className="max-h-72 overflow-auto rounded-xl bg-zinc-950 p-3 text-[11px] leading-5 text-emerald-100">
                      {stringifyPreview(activeLiveRequest.response)}
                    </pre>
                  </div>
                </div>
              ) : (
                <p className="text-xs leading-5 text-zinc-400">
                  Select a request card and press Send real request to see the exact local proxy,
                  upstream Multiset endpoint, and returned JSON.
                </p>
              )}
            </div>
          </div>
        </aside>

        <div className="relative flex-1 overflow-hidden overscroll-none">
          <div className="absolute left-7 top-6 z-20 rounded-full border border-white/10 bg-black/40 px-5 py-3 text-sm text-zinc-300 backdrop-blur">
            {activeSection.navLabel}: scroll to zoom, drag canvas, or move cards.
          </div>

          <div
            className={`h-full w-full touch-none overscroll-none ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <div
              className="relative h-[1160px] w-[2240px] origin-top-left transition-transform duration-200"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              }}
            >
              <svg className="absolute inset-0 h-full w-full overflow-visible">
                <defs>
                  <marker
                    id="arrow"
                    markerHeight="10"
                    markerWidth="10"
                    orient="auto"
                    refX="8"
                    refY="3"
                  >
                    <path d="M0,0 L0,6 L9,3 z" fill="rgba(110,231,183,0.9)" />
                  </marker>
                </defs>
                {activeSection.edges.map((edge) => {
                  const key = `${edge.from}-${edge.to}`;
                  const isActive = activeEdges.has(key);
                  const point = getEdgeLabelPoint(edge, nodePositions);

                  return (
                    <g key={key}>
                      <path
                        d={getEdgePath(edge, nodePositions)}
                        fill="none"
                        markerEnd="url(#arrow)"
                        stroke={isActive ? "rgba(110,231,183,0.95)" : "rgba(255,255,255,0.18)"}
                        strokeDasharray={isActive ? "0" : "12 14"}
                        strokeLinecap="round"
                        strokeWidth={isActive ? 5 : 3}
                      />
                      <foreignObject x={point.x - 90} y={point.y - 18} width="180" height="38">
                        <div className="rounded-full border border-white/10 bg-black/70 px-3 py-2 text-center text-xs font-bold text-zinc-200 backdrop-blur">
                          {edge.label}
                        </div>
                      </foreignObject>
                    </g>
                  );
                })}
              </svg>

              {activeSection.nodes.map((node) => {
                const status = statuses[node.id];
                const isSelected = activeNodeId === node.id;
                const position = nodePositions[node.id] ?? { x: node.x, y: node.y };
                const isMoving = draggingNodeId === node.id;

                return (
                  <button
                    type="button"
                    key={node.id}
                    onPointerDown={(event) => handleNodePointerDown(event, node)}
                    onPointerMove={(event) => handleNodePointerMove(event, node)}
                    onPointerUp={(event) => handleNodePointerUp(event, node)}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (suppressClickRef.current === node.id) {
                        suppressClickRef.current = null;
                        return;
                      }
                      setActiveNodeId(node.id);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      void sendLiveRequest(node);
                    }}
                    className={`absolute w-[360px] cursor-grab rounded-[2rem] border bg-gradient-to-br p-5 text-left shadow-2xl transition duration-300 active:cursor-grabbing ${toneClasses[node.tone]} ${getStatusClasses(status)} ${
                      isSelected ? "ring-4 ring-white/25" : ""
                    } ${
                      isMoving ? "z-10 scale-[1.02] transition-none" : ""
                    }`}
                    style={{ left: position.x, top: position.y }}
                  >
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div>
                        <span className="mb-2 inline-flex rounded-full bg-black/45 px-3 py-1 font-mono text-xs font-black text-zinc-100">
                          {node.method}
                        </span>
                        <h3 className="text-2xl font-black tracking-tight">{node.title}</h3>
                      </div>
                      <span className="rounded-full border border-white/15 bg-black/35 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em]">
                        {statusLabels[status]}
                      </span>
                    </div>
                    <p className="mb-4 min-h-12 text-sm leading-5 text-zinc-200/90">{node.subtitle}</p>
                    <div className="mb-4 rounded-2xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-emerald-100">
                      {node.endpoint}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-zinc-300">
                        {status === "running" ? "Sending request..." : "Double-click to send request"}
                      </span>
                      <span
                        className={`h-4 w-4 rounded-full ${
                          status === "success"
                            ? "bg-emerald-300"
                            : status === "running"
                              ? "animate-pulse bg-yellow-200"
                              : status === "error"
                                ? "bg-red-300"
                                : "bg-zinc-500"
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
