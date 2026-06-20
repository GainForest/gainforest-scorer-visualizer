// ---------------------------------------------------------------------------
// Blob preview helpers — classify blobs, build fetchable URLs, and detect
// geospatial payloads that can be rendered as thumbnails.
// ---------------------------------------------------------------------------

import type { BlobData, RecordNode } from './api';
import { findImageUrl } from './format';

export type BlobKind =
  | 'image'
  | 'geojson'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'json'
  | 'text'
  | 'csv'
  | 'archive'
  | 'binary';

export type GeoPoint = { lat: number; lon: number };

export type BlobPreviewSource = {
  kind: BlobKind;
  label: string;
  detail: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  url: string | null;
  blob: BlobData | null;
  geoJson?: unknown;
  point?: GeoPoint;
};

const MIME_LABELS: Record<BlobKind, string> = {
  image: 'Image',
  geojson: 'Map',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  json: 'JSON',
  text: 'Text',
  csv: 'Table',
  archive: 'Archive',
  binary: 'File',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function validPoint(lat: number | null, lon: number | null): GeoPoint | null {
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function pointFromRecord(obj: Record<string, unknown>): GeoPoint | null {
  return (
    validPoint(numeric(obj.decimalLatitude), numeric(obj.decimalLongitude)) ??
    validPoint(numeric(obj.latitude), numeric(obj.longitude)) ??
    validPoint(numeric(obj.lat), numeric(obj.lng)) ??
    validPoint(numeric(obj.lat), numeric(obj.lon))
  );
}

function looksLikeGeoJson(obj: Record<string, unknown>): boolean {
  const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
  return [
    'featurecollection',
    'feature',
    'point',
    'multipoint',
    'linestring',
    'multilinestring',
    'polygon',
    'multipolygon',
    'geometrycollection',
  ].includes(type);
}

export function findGeoJson(value: unknown, depth = 0): unknown | null {
  if (!value || depth > 8) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      return findGeoJson(JSON.parse(trimmed), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findGeoJson(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = asRecord(value);
  if (!obj) return null;
  if (looksLikeGeoJson(obj)) return obj;
  for (const key of ['geojson', 'geoJson', 'geometry', 'location', 'geolocation', 'spatial']) {
    const found = findGeoJson(obj[key], depth + 1);
    if (found) return found;
  }
  for (const item of Object.values(obj)) {
    const found = findGeoJson(item, depth + 1);
    if (found) return found;
  }
  return null;
}

export function findGeoPoint(value: unknown, depth = 0, allowTuple = false): GeoPoint | null {
  if (!value || depth > 8) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      return findGeoPoint(JSON.parse(trimmed), depth + 1, allowTuple);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    if (allowTuple && value.length >= 2) {
      // GeoJSON coordinate order is longitude, latitude.
      const point = validPoint(numeric(value[1]), numeric(value[0]));
      if (point) return point;
    }
    for (const item of value) {
      const found = findGeoPoint(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = asRecord(value);
  if (!obj) return null;
  const direct = pointFromRecord(obj);
  if (direct) return direct;
  if (Array.isArray(obj.coordinates)) {
    const fromCoords = findGeoPoint(obj.coordinates, depth + 1, true);
    if (fromCoords) return fromCoords;
  }
  for (const key of ['geojson', 'geoJson', 'geometry', 'location', 'geolocation', 'spatial']) {
    const found = findGeoPoint(obj[key], depth + 1);
    if (found) return found;
  }
  for (const item of Object.values(obj)) {
    const found = findGeoPoint(item, depth + 1);
    if (found) return found;
  }
  return null;
}

export function classifyBlob(mimeType: string | null | undefined): BlobKind {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.includes('geo+json') || mime.includes('geojson')) return 'geojson';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || mime.endsWith('/pdf')) return 'pdf';
  if (mime.includes('json')) return 'json';
  if (mime.includes('csv') || mime.includes('tab-separated-values')) return 'csv';
  if (mime.startsWith('text/') || mime.includes('xml') || mime.includes('yaml')) return 'text';
  if (/(zip|gzip|tar|rar|7z|compressed|archive)/.test(mime)) return 'archive';
  return 'binary';
}

export function blobUrl(record: RecordNode, blob: BlobData | null | undefined): string | null {
  if (!blob?.cid || !record.did) return null;
  const url = new URL('https://public.api.bsky.app/xrpc/com.atproto.sync.getBlob');
  url.searchParams.set('did', record.did);
  url.searchParams.set('cid', blob.cid);
  return url.toString();
}

function preferredBlob(blobs: BlobData[]): BlobData | null {
  const priority: BlobKind[] = ['image', 'geojson', 'video', 'audio', 'pdf', 'json', 'csv', 'text', 'archive', 'binary'];
  return [...blobs].sort((a, b) => priority.indexOf(classifyBlob(a.mimeType)) - priority.indexOf(classifyBlob(b.mimeType)))[0] ?? null;
}

export function blobKindLabel(kind: BlobKind): string {
  return MIME_LABELS[kind];
}

export function buildBlobPreview(record: RecordNode, parsed: unknown, options: { includeImage?: boolean } = {}): BlobPreviewSource | null {
  const { includeImage = true } = options;

  if (includeImage) {
    const image = findImageUrl(parsed);
    if (image) {
      return {
        kind: 'image',
        label: MIME_LABELS.image,
        detail: 'Record image',
        mimeType: 'image/*',
        sizeBytes: null,
        url: image,
        blob: null,
      };
    }
  }

  const blobs = record.blobs ?? [];
  const blob = preferredBlob(blobs);
  if (blob) {
    const kind = classifyBlob(blob.mimeType);
    return {
      kind,
      label: MIME_LABELS[kind],
      detail: blob.mimeType,
      mimeType: blob.mimeType,
      sizeBytes: blob.sizeBytes,
      url: blobUrl(record, blob),
      blob,
    };
  }

  const geoJson = findGeoJson(parsed);
  if (geoJson) {
    return {
      kind: 'geojson',
      label: MIME_LABELS.geojson,
      detail: 'Record geometry',
      mimeType: 'application/geo+json',
      sizeBytes: null,
      url: null,
      blob: null,
      geoJson,
    };
  }

  const point = findGeoPoint(parsed);
  if (point) {
    return {
      kind: 'geojson',
      label: MIME_LABELS.geojson,
      detail: `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`,
      mimeType: 'application/geo+json',
      sizeBytes: null,
      url: null,
      blob: null,
      point,
    };
  }

  return null;
}
