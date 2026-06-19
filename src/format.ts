// ---------------------------------------------------------------------------
// Domain helpers — turn raw scorer records into display-ready specimen data.
// ---------------------------------------------------------------------------

import type { RecordNode } from './api';

export function parseJson(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Some payloads nest a stringified JSON object (e.g. `dynamicProperties`). */
function parseMaybeJson(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asRecord(value);
}

// --- Image discovery -------------------------------------------------------

export function findImageUrl(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const isUrl = /^https?:\/\//i.test(value);
    const looksImage = /\.(avif|gif|jpe?g|png|svg|webp)(\?|$)/i.test(value);
    const knownAsset = /gainforest|s3\.amazonaws|cloudfront|ipfs|images?/i.test(value);
    return isUrl && (looksImage || knownAsset) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageUrl(item);
      if (found) return found;
    }
    return null;
  }
  const obj = asRecord(value);
  if (obj) {
    for (const key of ['accessUri', 'image', 'imageUrl', 'thumbnail', 'thumbnailUrl', 'url', 'uri', 'src']) {
      const found = findImageUrl(obj[key]);
      if (found) return found;
    }
    for (const item of Object.values(obj)) {
      const found = findImageUrl(item);
      if (found) return found;
    }
  }
  return null;
}

// --- Specimen extraction ---------------------------------------------------

export type Specimen = {
  title: string; // primary heading (scientific name when present)
  isBinomial: boolean; // render the title in italic serif
  subtitle: string | null; // vernacular / common name
  kingdom: string | null;
  iucn: string | null; // IUCN category code, e.g. "LC"
  source: string | null;
  group: string | null;
  basisOfRecord: string | null;
  recordType: string | null; // the lexicon `$type`
  facts: { label: string; value: string }[];
};

/**
 * Pull a human-friendly summary out of a parsed record. Built around the
 * Darwin-Core occurrence shape but degrades gracefully for any collection.
 */
export function extractSpecimen(record: RecordNode, parsed: unknown): Specimen {
  const obj = asRecord(parsed) ?? {};
  const dynamic = parseMaybeJson(obj.dynamicProperties) ?? {};
  const conservation = asRecord(obj.conservationStatus);

  const scientificName = str(obj.scientificName);
  const vernacular = str(obj.vernacularName);
  const recordType = str(obj['$type']);

  const fallbackTitle =
    str(obj.occurrenceID) ??
    str(obj.displayName) ??
    str(obj.name) ??
    str(obj.title) ??
    record.rkey ??
    `Record ${record.id}`;

  const title = scientificName ?? fallbackTitle;
  const isBinomial = Boolean(scientificName);

  const iucn = conservation ? str(conservation.iucnCategory) : null;
  const kingdom = str(obj.kingdom);
  const source = str(dynamic.source);
  const group = str(dynamic.group);
  const basisOfRecord = str(obj.basisOfRecord);

  const facts: { label: string; value: string }[] = [];
  const gbif = str(obj.gbifTaxonKey);
  if (gbif) facts.push({ label: 'GBIF taxon', value: gbif });
  const dataType = str(dynamic.dataType);
  if (dataType) facts.push({ label: 'Data type', value: dataType });
  const traits = asRecord(obj.plantTraits);
  if (traits && Array.isArray(traits.edibleParts) && traits.edibleParts.length) {
    facts.push({ label: 'Edible parts', value: (traits.edibleParts as string[]).join(', ') });
  }

  return {
    title,
    isBinomial,
    subtitle: vernacular,
    kingdom,
    iucn,
    source,
    group,
    basisOfRecord,
    recordType,
    facts,
  };
}

// --- Scores ----------------------------------------------------------------

export type ScoreBucket = {
  label: string;
  // hsl components for the accent — used for ring stroke + tinted chips
  color: string;
  soft: string;
};

// oklch ramp tuned to the GainForest sage system: a calm sage at the top
// grading down through amber to a muted terracotta, so the score reads as
// meaningful without clashing with the white/ink surfaces.
const SCORE_BUCKETS: { min: number; label: string; l: number; c: number; h: number }[] = [
  { min: 90, label: 'Excellent', l: 0.5, c: 0.108, h: 157 },
  { min: 75, label: 'Strong', l: 0.58, c: 0.11, h: 150 },
  { min: 60, label: 'Fair', l: 0.7, c: 0.13, h: 95 },
  { min: 40, label: 'Weak', l: 0.66, c: 0.16, h: 56 },
  { min: 0, label: 'Poor', l: 0.62, c: 0.19, h: 28 },
];

export function scoreBucket(score: number | null | undefined): ScoreBucket {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return { label: 'Unscored', color: 'oklch(0.7 0.01 264)', soft: 'oklch(0.97 0.003 264)' };
  }
  const b = SCORE_BUCKETS.find((x) => score >= x.min) ?? SCORE_BUCKETS[SCORE_BUCKETS.length - 1];
  return {
    label: b.label,
    color: `oklch(${b.l} ${b.c} ${b.h})`,
    soft: `oklch(${b.l} ${b.c} ${b.h} / 0.12)`,
  };
}

export function scoreText(score: number | null | undefined): string {
  return typeof score === 'number' && !Number.isNaN(score)
    ? String(Math.round(score * 100) / 100)
    : '—';
}

// --- IUCN Red List categories ----------------------------------------------

const IUCN_TABLE: Record<string, { name: string; tone: string }> = {
  EX: { name: 'Extinct', tone: 'crit' },
  EW: { name: 'Extinct in the Wild', tone: 'crit' },
  CR: { name: 'Critically Endangered', tone: 'crit' },
  EN: { name: 'Endangered', tone: 'high' },
  VU: { name: 'Vulnerable', tone: 'mid' },
  NT: { name: 'Near Threatened', tone: 'low' },
  LC: { name: 'Least Concern', tone: 'safe' },
  DD: { name: 'Data Deficient', tone: 'muted' },
  NE: { name: 'Not Evaluated', tone: 'muted' },
};

export function iucnInfo(code: string | null): { code: string; name: string; tone: string } | null {
  if (!code) return null;
  const key = code.toUpperCase();
  const entry = IUCN_TABLE[key];
  return entry ? { code: key, ...entry } : { code: key, name: key, tone: 'muted' };
}

// --- Status ----------------------------------------------------------------

export function statusTone(status: string | null): string {
  switch ((status ?? '').toLowerCase()) {
    case 'scored':
      return 'ok';
    case 'evaluating':
    case 'queued':
    case 'pending':
      return 'pending';
    case 'error':
    case 'failed':
      return 'error';
    default:
      return 'neutral';
  }
}

// --- Misc formatting -------------------------------------------------------

export function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000000],
    ['month', 2592000000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

export function formatBytes(bytes: number | null): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/** Trim the lexicon namespace into something readable for chips/tabs. */
export function collectionLabel(collection: string): string {
  const parts = collection.split('.');
  const tail = parts.slice(-2).join(' · ');
  return tail || collection;
}

/** The namespace authority of an NSID, e.g. `app.gainforest.dwc.x` → `app.gainforest`. */
export function collectionAuthority(collection: string): string {
  return collection.split('.').slice(0, 2).join('.');
}

const AUTHORITY_LABELS: Record<string, string> = {
  'app.gainforest': 'GainForest',
  'app.certified': 'Certified',
  'org.hypercerts': 'Hypercerts',
  'org.hyperboards': 'Hyperboards',
  'org.simocracy': 'Simocracy',
  'org.impactindexer': 'Impact Indexer',
};

export function authorityLabel(authority: string): string {
  if (AUTHORITY_LABELS[authority]) return AUTHORITY_LABELS[authority];
  const name = authority.split('.').slice(-1)[0] || authority;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The NSID with its authority stripped, e.g. `app.gainforest.dwc.x` → `dwc · x`. */
export function collectionLeaf(collection: string, authority: string): string {
  const leaf = collection.startsWith(authority + '.') ? collection.slice(authority.length + 1) : collection;
  return leaf.replace(/\./g, ' · ');
}

/** Group a flat NSID list by authority for an <optgroup> dropdown. */
export function groupCollections(collections: string[]): { authority: string; items: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const c of collections) {
    const authority = collectionAuthority(c);
    const bucket = groups.get(authority);
    if (bucket) bucket.push(c);
    else groups.set(authority, [c]);
  }
  return [...groups.entries()]
    .map(([authority, items]) => ({ authority, items }))
    .sort((a, b) => authorityLabel(a.authority).localeCompare(authorityLabel(b.authority)));
}

export function shortDid(did: string | null): string {
  if (!did) return '—';
  return did.length > 24 ? `${did.slice(0, 16)}…${did.slice(-6)}` : did;
}
