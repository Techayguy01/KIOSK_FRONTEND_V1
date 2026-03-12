const CLOUDINARY_KIOSK_TRANSFORM = "q_auto,f_auto,c_fill,w_1080,h_720";
const CLOUDINARY_SECURE_PREFIX = "https://res.cloudinary.com/";

export function optimizeCloudinaryUrl(url: string): string {
  if (!url || typeof url !== "string") return "";

  const trimmed = url.trim();
  if (!trimmed) return "";

  const normalized = trimmed.startsWith("http://res.cloudinary.com/")
    ? `https://${trimmed.slice("http://".length)}`
    : trimmed;

  if (!normalized.startsWith(CLOUDINARY_SECURE_PREFIX)) return normalized;

  const uploadMarker = "/upload/";
  const uploadIndex = normalized.indexOf(uploadMarker);
  if (uploadIndex < 0) return normalized;

  const existingSegment = `/upload/${CLOUDINARY_KIOSK_TRANSFORM}/`;
  if (normalized.includes(existingSegment)) return normalized;

  const insertAt = uploadIndex + uploadMarker.length;
  return `${normalized.slice(0, insertAt)}${CLOUDINARY_KIOSK_TRANSFORM}/${normalized.slice(insertAt)}`;
}
