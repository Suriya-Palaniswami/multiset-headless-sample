/**
 * Client-side S3 multipart part uploads using Multiset presigned URLs.
 */

export type SignedUrlPart = { partNumber: number; signedUrl: string };

export async function uploadFilePartsToS3(
  file: File,
  signedUrls: SignedUrlPart[],
  onProgress?: (done: number, total: number) => void
): Promise<Array<{ ETag: string; PartNumber: number }>> {
  const sorted = [...signedUrls].filter((s) => s.signedUrl).sort((a, b) => a.partNumber - b.partNumber);
  if (sorted.length === 0) {
    throw new Error("No signed URLs to upload");
  }
  const n = sorted.length;
  const totalBytes = file.size;
  const parts: Array<{ ETag: string; PartNumber: number }> = [];

  for (let i = 0; i < n; i++) {
    const start = Math.floor((i * totalBytes) / n);
    const end = Math.floor(((i + 1) * totalBytes) / n);
    const chunk = file.slice(start, end);
    onProgress?.(i + 1, n);

    const res = await fetch(sorted[i].signedUrl, {
      method: "PUT",
      body: chunk,
      headers: { "Content-Type": "application/octet-stream" },
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`S3 part ${sorted[i].partNumber} failed (${res.status}): ${t.slice(0, 200)}`);
    }

    const raw = res.headers.get("etag") || res.headers.get("ETag");
    if (!raw) {
      throw new Error(`No ETag header for part ${sorted[i].partNumber}`);
    }
    const etag = raw.replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
    parts.push({ ETag: etag, PartNumber: sorted[i].partNumber });
  }

  return parts;
}
