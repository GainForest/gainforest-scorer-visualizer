// ---------------------------------------------------------------------------
// Data layer — GraphQL client, types, queries and filter construction.
// The scorer service exposes a single `records` query with a rich
// `RecordFilter` (textSearch, statuses, collections, score ranges, hasBlobs).
// ---------------------------------------------------------------------------

const indexerUrl = import.meta.env.VITE_INDEXER_URL;

if (!indexerUrl) {
  throw new Error('Missing VITE_INDEXER_URL environment variable');
}

export const GRAPHQL_URL = indexerUrl;

export const PAGE_SIZE = 24;

export type BlobData = {
  aiComment: string | null;
  cid: string | null;
  id: string;
  lastEvaluationScore: number | null;
  mimeType: string | null;
  sizeBytes: number | null;
};

export type RecordNode = {
  aiComment: string | null;
  aiLabels: string[] | null;
  aiModel: string | null;
  blobs: BlobData[] | null;
  cid: string | null;
  collection: string;
  createdAt: string | null;
  currentStatus: string | null;
  did: string | null;
  errorMessage: string | null;
  id: string;
  lastEvaluatedAt: string | null;
  lastEvaluationScore: number | null;
  recordJson: string | null;
  rkey: string | null;
  updatedAt: string | null;
  uri: string;
};

export type RecordsResponse = {
  records: {
    totalCount: number;
    pageInfo: {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      limit: number;
      offset: number;
    } | null;
    nodes: RecordNode[];
  };
};

export type RecordFilters = {
  search: string;
  collection: string; // '' = all
  statuses: string[]; // [] = all
  minScore: number; // 0 = no lower bound
  maxScore: number; // 100 = no upper bound
  onlyWithMedia: boolean;
};

export const EMPTY_FILTERS: RecordFilters = {
  search: '',
  collection: '',
  statuses: [],
  minScore: 0,
  maxScore: 100,
  onlyWithMedia: false,
};

const RECORD_FIELDS = `
  totalCount
  pageInfo { hasNextPage hasPreviousPage limit offset }
  nodes {
    id
    uri
    cid
    did
    rkey
    collection
    createdAt
    updatedAt
    currentStatus
    errorMessage
    lastEvaluatedAt
    lastEvaluationScore
    aiComment
    aiLabels
    aiModel
    recordJson
    blobs {
      id
      cid
      mimeType
      sizeBytes
      lastEvaluationScore
      aiComment
    }
  }
`;

export async function graphql<T>(
  query: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    // Only `Content-Type` is on the endpoint's CORS allow-headers list — adding
    // anything else (e.g. ngrok-skip-browser-warning) trips the preflight and
    // the browser blocks the request. ngrok's interstitial only affects GET
    // navigations, not JSON POSTs, so this is all we need.
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Request failed — the scorer service returned ${response.status}.`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e: { message: string }) => e.message).join('\n'));
  }
  return payload.data as T;
}

/** Translate the UI filter state into a `RecordFilter` input object. */
export function buildFilter(filters: RecordFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const search = filters.search.trim();
  if (search) out.textSearch = search;
  if (filters.collection) out.collections = [filters.collection];
  if (filters.statuses.length) out.statuses = filters.statuses;
  if (filters.minScore > 0) out.scoreGte = filters.minScore;
  if (filters.maxScore < 100) out.scoreLte = filters.maxScore;
  if (filters.onlyWithMedia) out.hasBlobs = true;
  return out;
}

export async function fetchRecords(
  filters: RecordFilters,
  offset: number,
  signal?: AbortSignal,
): Promise<{ nodes: RecordNode[]; totalCount: number }> {
  const data = await graphql<RecordsResponse>(
    `query Records($filter: RecordFilter, $limit: Int, $offset: Int) {
      records(filter: $filter, limit: $limit, offset: $offset) {
        ${RECORD_FIELDS}
      }
    }`,
    { filter: buildFilter(filters), limit: PAGE_SIZE, offset },
    signal,
  );
  return {
    nodes: data.records.nodes ?? [],
    totalCount: data.records.totalCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Identity — records only store a DID; the human-readable handle is resolved
// from the PLC directory (did:plc) or derived from the DID itself (did:web).
// Results are memoised per-DID and in-flight requests are de-duplicated, since
// many records share the same creator.
// ---------------------------------------------------------------------------

const handleCache = new Map<string, string | null>();
const handleInflight = new Map<string, Promise<string | null>>();

/** Synchronous cache peek — lets components render a handle without a flash. */
export function peekHandle(did: string | null): string | null | undefined {
  if (!did) return null;
  return handleCache.get(did);
}

export async function resolveHandle(did: string | null): Promise<string | null> {
  if (!did) return null;
  if (handleCache.has(did)) return handleCache.get(did)!;
  if (handleInflight.has(did)) return handleInflight.get(did)!;

  const job = (async () => {
    try {
      // did:web encodes the host directly: did:web:example.com → example.com
      if (did.startsWith('did:web:')) {
        const handle = decodeURIComponent(did.slice('did:web:'.length)).split(':')[0];
        handleCache.set(did, handle || null);
        return handle || null;
      }
      const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
      if (!res.ok) throw new Error(String(res.status));
      const doc: { alsoKnownAs?: string[] } = await res.json();
      const aka = (doc.alsoKnownAs ?? []).find((a) => a.startsWith('at://'));
      const handle = aka ? aka.slice('at://'.length) : null;
      handleCache.set(did, handle);
      return handle;
    } catch {
      handleCache.set(did, null);
      return null;
    } finally {
      handleInflight.delete(did);
    }
  })();

  handleInflight.set(did, job);
  return job;
}

// ---------------------------------------------------------------------------
// Collections — the authoritative list comes from the published lexicon
// schemas, not from sampling records (which only surfaces collections that
// happen to have records, and misses empty ones). Each of these ATProto
// accounts publishes its lexicons as `com.atproto.lexicon.schema` records
// whose record key IS the collection NSID.
// ---------------------------------------------------------------------------

const LEXICON_ACCOUNTS = ['hypercerts.org', 'certified.app', 'gainforest.earth'];

// The scorer has no status enum to introspect; these are its lifecycle states.
// The toolbar also merges in any status seen on loaded records, so it self-heals.
export const BASE_STATUSES = ['pending', 'evaluating', 'scored', 'error'];

const didByHandle = new Map<string, string | null>();
const pdsByDid = new Map<string, string | null>();

async function resolveDid(handle: string, signal?: AbortSignal): Promise<string | null> {
  if (didByHandle.has(handle)) return didByHandle.get(handle)!;
  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
      { signal },
    );
    const did = res.ok ? ((await res.json()).did ?? null) : null;
    didByHandle.set(handle, did);
    return did;
  } catch {
    didByHandle.set(handle, null);
    return null;
  }
}

async function resolvePds(did: string, signal?: AbortSignal): Promise<string | null> {
  if (pdsByDid.has(did)) return pdsByDid.get(did)!;
  try {
    const res = await fetch(`https://plc.directory/${encodeURIComponent(did)}`, { signal });
    if (!res.ok) throw new Error(String(res.status));
    const doc: { service?: { id?: string; type?: string; serviceEndpoint?: string }[] } = await res.json();
    const svc = (doc.service ?? []).find(
      (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer',
    );
    const pds = svc?.serviceEndpoint ?? null;
    pdsByDid.set(did, pds);
    return pds;
  } catch {
    pdsByDid.set(did, null);
    return null;
  }
}

/** List the lexicon NSIDs published by one account (paginating the repo). */
async function listLexicons(handle: string, signal?: AbortSignal): Promise<string[]> {
  const did = await resolveDid(handle, signal);
  if (!did) return [];
  const pds = await resolvePds(did, signal);
  if (!pds) return [];

  const nsids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set('repo', did);
    url.searchParams.set('collection', 'com.atproto.lexicon.schema');
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url, { signal });
    if (!res.ok) break;
    const data: { records?: { uri?: string; value?: { id?: string } }[]; cursor?: string } = await res.json();
    for (const r of data.records ?? []) {
      const nsid = r.uri?.split('/').pop() || r.value?.id;
      if (nsid) nsids.push(nsid);
    }
    cursor = data.cursor;
    if (!cursor || !data.records?.length) break;
  }
  return nsids;
}

/**
 * Authoritative collection list, gathered from the lexicon schemas of the
 * known ATProto accounts. Definition-only lexicons (`*.defs`) are dropped since
 * they never hold records. Best-effort: a failing account is simply skipped.
 */
export async function fetchCollections(signal?: AbortSignal): Promise<string[]> {
  const lists = await Promise.all(
    LEXICON_ACCOUNTS.map((handle) => listLexicons(handle, signal).catch(() => [] as string[])),
  );
  const set = new Set<string>();
  for (const list of lists) {
    for (const nsid of list) {
      if (nsid.endsWith('.defs')) continue;
      set.add(nsid);
    }
  }
  return [...set].sort();
}
