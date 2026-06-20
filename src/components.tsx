// ---------------------------------------------------------------------------
// Presentational components for the herbarium specimen archive.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RecordNode, RecordFilters } from './api';
import { peekHandle, resolveHandle } from './api';
import {
  blobKindLabel,
  blobUrl,
  buildBlobPreview,
  classifyBlob,
  parseCoordinateText,
  resolveBlobUrl,
  type BlobPreviewSource,
} from './blobPreview';
import {
  collectionLabel,
  extractSpecimen,
  formatDate,
  formatRelative,
  formatBytes,
  iucnInfo,
  parseJson,
  scoreBucket,
  scoreText,
  shortDid,
  statusTone,
} from './format';

// --- icons (inline, no dependency) -----------------------------------------

const Icon = {
  Leaf: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6" />
    </svg>
  ),
  Search: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  ),
  X: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  ),
  ArrowRight: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  ),
  ChevronLeft: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
  ),
  ChevronRight: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
  ),
  Alert: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
  ),
  At: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" /></svg>
  ),
  Herbarium: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22V8M12 8c0-3 2-5 5-5 0 3-2 5-5 5ZM12 12c0-2.5-2-4.5-4.5-4.5 0 2.5 2 4.5 4.5 4.5Z" /><path d="M5 22h14" /></svg>
  ),
  Sun: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
  ),
  Moon: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
  ),
};

// --- theme toggle ----------------------------------------------------------

const THEME_KEY = 'gf-scorer-theme';

export function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  const toggle = () => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      try {
        localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
      } catch {
        /* storage unavailable; the in-memory toggle still works */
      }
      return next;
    });
  };
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      {dark ? <Icon.Sun /> : <Icon.Moon />}
    </button>
  );
}

// --- creator handle --------------------------------------------------------

/** Resolve a DID to its handle, rendering the cached value immediately. */
function useHandle(did: string | null): string | null {
  const [handle, setHandle] = useState<string | null>(() => peekHandle(did) ?? null);
  useEffect(() => {
    let alive = true;
    const cached = peekHandle(did);
    if (cached !== undefined) {
      setHandle(cached);
      return;
    }
    setHandle(null);
    resolveHandle(did).then((h) => {
      if (alive) setHandle(h);
    });
    return () => {
      alive = false;
    };
  }, [did]);
  return handle;
}

function CreatorHandle({ did }: { did: string | null }) {
  const handle = useHandle(did);
  if (!handle) return null;
  return (
    <span className="creator" title={did ?? undefined}>
      <Icon.At />
      <span className="creator-name">{handle}</span>
    </span>
  );
}

// --- score ring ------------------------------------------------------------

const R = 24;
const CIRC = 2 * Math.PI * R;

export function ScoreRing({ score, size = 46 }: { score: number | null; size?: number }) {
  const bucket = scoreBucket(score);
  const pct = typeof score === 'number' ? Math.max(0, Math.min(100, score)) / 100 : 0;
  const offset = CIRC * (1 - pct);
  const has = typeof score === 'number' && !Number.isNaN(score);
  return (
    <div className="score-stamp" style={{ width: size, height: size, ['--accent' as string]: bucket.color }} title={`${bucket.label} — score ${scoreText(score)}/100`}>
      <svg width={size} height={size} viewBox="0 0 60 60">
        <circle className="ring-track" cx="30" cy="30" r={R} fill="none" strokeWidth="5" />
        {has && (
          <circle className="ring-value" cx="30" cy="30" r={R} fill="none" strokeWidth="5" strokeDasharray={CIRC} strokeDashoffset={offset} />
        )}
      </svg>
      <span className={has ? 'score-stamp-num' : 'score-stamp-num unscored'}>{has ? Math.round(score!) : '–'}</span>
    </div>
  );
}

// --- small badges ----------------------------------------------------------

export function StatusBadge({ status }: { status: string | null }) {
  const tone = statusTone(status);
  return (
    <span className={`status-badge tone-${tone}`}>
      <span className="chip-dot" />
      {status ?? 'unknown'}
    </span>
  );
}

export function IucnBadge({ code }: { code: string | null }) {
  const info = iucnInfo(code);
  if (!info) return null;
  return (
    <span className={`iucn iucn-${info.tone}`} title={`IUCN Red List · ${info.name}`}>
      <code>{info.code}</code>
      <span>{info.name}</span>
    </span>
  );
}

// --- blob thumbnails -------------------------------------------------------

function makePointFeature(point: { lat: number; lon: number }) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Point' as const, coordinates: [point.lon, point.lat] },
  };
}

function GeoJsonMapPreview({ source, compact = false }: { source: BlobPreviewSource; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove: () => void; invalidateSize: () => void } | null>(null);
  const [geoJson, setGeoJson] = useState<unknown | null>(() => source.geoJson ?? (source.point ? makePointFeature(source.point) : null));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setGeoJson(source.geoJson ?? (source.point ? makePointFeature(source.point) : null));
    if (!source.geoJson && !source.point && source.url) {
      fetch(source.url)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((json) => { if (alive) setGeoJson(json); })
        .catch(() => { if (alive) setFailed(true); });
    }
    return () => { alive = false; };
  }, [source.geoJson, source.point, source.url]);

  useEffect(() => {
    if (!ref.current || !geoJson) return;
    let cancelled = false;
    let map: { remove: () => void; invalidateSize: () => void } | null = null;

    import('leaflet').then(({ default: L }) => {
      if (cancelled || !ref.current) return;
      mapRef.current?.remove();
      const next = L.map(ref.current, {
        zoomControl: !compact,
        attributionControl: false,
        dragging: !compact,
        scrollWheelZoom: false,
        doubleClickZoom: !compact,
        boxZoom: !compact,
        keyboard: !compact,
      }).setView([0, 0], 1);
      map = next;
      mapRef.current = next;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        className: 'leaflet-muted-tiles',
      }).addTo(next);

      const layer = L.geoJSON(geoJson as GeoJSON.GeoJsonObject, {
        style: () => ({ color: 'var(--primary)', weight: compact ? 2 : 3, opacity: 0.9, fillOpacity: 0.24 }),
        pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
          radius: compact ? 6 : 8,
          color: 'var(--primary)',
          weight: 2,
          fillColor: 'var(--primary)',
          fillOpacity: 0.9,
        }),
      }).addTo(next);

      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        next.fitBounds(bounds.pad(compact ? 0.65 : 0.25), { maxZoom: compact ? 8 : 12, animate: false });
      } else if (source.point) {
        next.setView([source.point.lat, source.point.lon], compact ? 7 : 10);
      }
      setTimeout(() => next.invalidateSize(), 0);
    }).catch(() => setFailed(true));

    return () => {
      cancelled = true;
      map?.remove();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [compact, geoJson, source.point]);

  if (failed) {
    return <BlobFallback source={source} note="Could not load map" />;
  }

  return (
    <div className="map-preview">
      {!geoJson && <div className="map-loading">Loading map…</div>}
      <div ref={ref} className="map-canvas" aria-label="GeoJSON map preview" />
    </div>
  );
}

function TextBlobPreview({ source }: { source: BlobPreviewSource }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setText(null);
    if (!source.url) return () => { alive = false; };
    fetch(source.url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((body) => { if (alive) setText(body.slice(0, 900)); })
      .catch(() => { if (alive) setText(''); });
    return () => { alive = false; };
  }, [source.url]);

  const point = text && source.kind === 'text' ? parseCoordinateText(text) : null;
  const sample = text && source.kind === 'json'
    ? (() => {
        try { return JSON.stringify(JSON.parse(text), null, 2).slice(0, 900); }
        catch { return text; }
      })()
    : text;

  if (point) {
    return <GeoJsonMapPreview source={{ ...source, kind: 'geojson', label: 'Map', point }} compact />;
  }

  return (
    <div className={`text-preview text-preview-${source.kind}`}>
      <div className="text-preview-head">
        <span>{blobKindLabel(source.kind)}</span>
        <code>{source.mimeType ?? 'text'}</code>
      </div>
      <pre>{sample || source.detail || 'Preview unavailable'}</pre>
    </div>
  );
}

function BlobFallback({ source, note }: { source: BlobPreviewSource; note?: string }) {
  return (
    <div className={`blob-fallback blob-fallback-${source.kind}`}>
      <div className="blob-glyph" aria-hidden="true">{source.kind === 'archive' ? 'zip' : source.kind}</div>
      <div>
        <strong>{source.label}</strong>
        <span>{note ?? source.detail ?? source.mimeType ?? 'Blob'}</span>
      </div>
    </div>
  );
}

function BlobThumbnail({ source, title, onImageError, compact = true }: { source: BlobPreviewSource; title: string; onImageError?: () => void; compact?: boolean }) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(source.url);
  const meta = [source.label, source.mimeType, formatBytes(source.sizeBytes)].filter((v) => v && v !== '—').join(' · ');

  useEffect(() => {
    const ac = new AbortController();
    setResolvedUrl(source.url);
    if (!source.url && source.blob?.cid && source.did) {
      resolveBlobUrl(source, ac.signal).then((url) => {
        if (!ac.signal.aborted) setResolvedUrl(url);
      });
    }
    return () => ac.abort();
  }, [source]);

  const resolvedSource = resolvedUrl === source.url ? source : { ...source, url: resolvedUrl };

  return (
    <div className={`specimen-plate specimen-plate-${source.kind}`} title={meta || source.label}>
      {source.kind === 'image' && resolvedUrl ? (
        <img src={resolvedUrl} alt={title} loading="lazy" onError={onImageError} />
      ) : source.kind === 'geojson' ? (
        <GeoJsonMapPreview source={resolvedSource} compact={compact} />
      ) : source.kind === 'video' && resolvedUrl ? (
        <video src={resolvedUrl} preload="metadata" muted playsInline aria-label={`${title} video preview`} />
      ) : source.kind === 'audio' && resolvedUrl && !compact ? (
        <div className="audio-preview"><BlobFallback source={resolvedSource} /><audio src={resolvedUrl} controls preload="metadata" /></div>
      ) : ['json', 'text', 'csv'].includes(source.kind) ? (
        <TextBlobPreview source={resolvedSource} />
      ) : source.kind === 'pdf' && resolvedUrl && !compact ? (
        <iframe className="pdf-preview" src={resolvedUrl} title={`${title} PDF preview`} />
      ) : (
        <BlobFallback source={resolvedSource} note={!resolvedUrl && source.blob?.cid ? 'Resolving blob…' : undefined} />
      )}
      <span className="blob-kind-pill">{source.label}</span>
    </div>
  );
}

// --- specimen card ---------------------------------------------------------

export function SpecimenCard({ record, index, onOpen }: { record: RecordNode; index: number; onOpen: (r: RecordNode) => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const parsed = parseJson(record.recordJson);
  const specimen = extractSpecimen(record, parsed);
  const bucket = scoreBucket(record.lastEvaluationScore);
  const preview = useMemo(() => buildBlobPreview(record, parsed, { includeImage: !imgFailed }), [record, parsed, imgFailed]);
  const comment = record.aiComment ?? record.blobs?.find((b) => b.aiComment)?.aiComment ?? null;
  const labels = (record.aiLabels ?? []).slice(0, 4);

  return (
    <article
      className="specimen"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms`, ['--accent' as string]: bucket.color }}
      onClick={() => onOpen(record)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(record);
        }
      }}
    >
      {preview && <BlobThumbnail source={preview} title={specimen.title} onImageError={() => setImgFailed(true)} />}

      <div className="specimen-body">
        <div className="specimen-head">
          <span className="collection-tag" title={record.collection}>{collectionLabel(record.collection)}</span>
          <StatusBadge status={record.currentStatus} />
        </div>

        <div className="specimen-title-row">
          <div className="specimen-titles">
            <h3 className={specimen.isBinomial ? 'specimen-title binomial' : 'specimen-title'}>{specimen.title}</h3>
            {specimen.subtitle && <p className="specimen-vernacular">{specimen.subtitle}</p>}
          </div>
          <ScoreRing score={record.lastEvaluationScore} />
        </div>

        {(specimen.iucn || specimen.kingdom || specimen.source || specimen.facts.length > 0) && (
          <div className="fact-row">
            {specimen.iucn && <IucnBadge code={specimen.iucn} />}
            {specimen.kingdom && <span className="fact"><span className="k">Kingdom</span><span className="v">{specimen.kingdom}</span></span>}
            {specimen.source && <span className="fact"><span className="k">Source</span><span className="v">{specimen.source}</span></span>}
            {specimen.facts.slice(0, 2).map((f) => (
              <span className="fact" key={f.label}><span className="k">{f.label}</span><span className="v">{f.value}</span></span>
            ))}
          </div>
        )}

        {labels.length > 0 && (
          <div className="label-chips">
            {labels.map((l) => <span className="label-chip" key={l}>{l}</span>)}
          </div>
        )}

        <p className={comment ? 'ai-comment' : 'ai-comment empty'}>{comment ?? 'No evaluation comment recorded.'}</p>

        <div className="specimen-foot">
          <span className="foot-meta">
            <CreatorHandle did={record.did} />
            {record.did && record.lastEvaluatedAt && <span className="dot-sep">·</span>}
            {record.lastEvaluatedAt ? formatRelative(record.lastEvaluatedAt) : 'not evaluated'}
          </span>
          <span className="view-btn">View <Icon.ArrowRight /></span>
        </div>
      </div>
    </article>
  );
}

// --- skeleton --------------------------------------------------------------

export function SkeletonCard() {
  return (
    <div className="skeleton">
      <div className="sk-line sm" />
      <div className="sk-line title" />
      <div className="sk-line full" />
      <div className="sk-line full w80" />
      <div className="sk-line full w80" style={{ width: '55%' }} />
    </div>
  );
}

// --- empty / error ---------------------------------------------------------

export function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="empty">
      <Icon.Herbarium />
      <h3>No specimens match</h3>
      <p>
        Nothing in the archive fits these filters.{' '}
        <button className="reset" onClick={onReset}>Clear filters</button>
      </p>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <Icon.Alert />
      <div>
        <strong>Could not reach the scorer service.</strong>
        <pre>{message}</pre>
      </div>
      <button onClick={onRetry}>Retry</button>
    </div>
  );
}

// --- masthead --------------------------------------------------------------

export function Masthead({
  totalCount,
  endpoint,
  state,
}: {
  totalCount: number;
  endpoint: string;
  state: 'ok' | 'loading' | 'error';
}) {
  let host = endpoint;
  try {
    host = new URL(endpoint).host;
  } catch {
    /* keep raw */
  }
  return (
    <header className="masthead">
      <div className="masthead-brand">
        <span className="masthead-mark"><Icon.Leaf /></span>
        <div>
          <p className="masthead-eyebrow">GainForest · Scoring Service</p>
          <h1 className="masthead-title">Specimen <em>Archive</em></h1>
        </div>
      </div>
      <div className="masthead-meta">
        <span className="endpoint">
          <span className={`endpoint-dot ${state === 'error' ? 'is-error' : state === 'loading' ? 'is-loading' : ''}`} />
          {host}
        </span>
        <div className="count-stat">
          <b>{totalCount.toLocaleString()}</b>
          <span>records</span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

// --- toolbar ---------------------------------------------------------------

export function Toolbar({
  searchInput,
  onSearchInput,
  filters,
  setFilters,
  onReset,
  isDirty,
}: {
  searchInput: string;
  onSearchInput: (v: string) => void;
  filters: RecordFilters;
  setFilters: (next: Partial<RecordFilters>) => void;
  onReset: () => void;
  isDirty: boolean;
}) {
  const setMinScore = (value: number) => setFilters({ minScore: Math.min(value, filters.maxScore) });
  const setMaxScore = (value: number) => setFilters({ maxScore: Math.max(value, filters.minScore) });

  return (
    <div className="toolbar">
      <div className="search">
        <Icon.Search />
        <input
          type="search"
          placeholder="Search names, comments, labels…"
          value={searchInput}
          onChange={(e) => onSearchInput(e.target.value)}
          aria-label="Search records"
        />
        {searchInput && (
          <button className="search-clear" onClick={() => onSearchInput('')} aria-label="Clear search"><Icon.X /></button>
        )}
      </div>

      <div
        className="score-filter"
        style={{
          ['--range-start' as string]: `${filters.minScore}%`,
          ['--range-end' as string]: `${filters.maxScore}%`,
        }}
      >
        <label id="scoreRangeLabel">Score</label>
        <div className="score-range" role="group" aria-labelledby="scoreRangeLabel">
          <div className="score-range-track" aria-hidden="true" />
          <input
            className="score-range-input score-range-min"
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            aria-label="Minimum score"
          />
          <input
            className="score-range-input score-range-max"
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.maxScore}
            onChange={(e) => setMaxScore(Number(e.target.value))}
            aria-label="Maximum score"
          />
        </div>
        <b>{filters.minScore}–{filters.maxScore}</b>
      </div>

      <button
        className={filters.onlyWithMedia ? 'toggle is-on' : 'toggle'}
        onClick={() => setFilters({ onlyWithMedia: !filters.onlyWithMedia })}
        aria-pressed={filters.onlyWithMedia}
      >
        <span className="box">{filters.onlyWithMedia && <Icon.Check />}</span>
        Has media
      </button>

      <div className="toolbar-spacer" />
      {isDirty && <button className="reset" onClick={onReset}>Reset all</button>}
    </div>
  );
}

// --- collection tabs -------------------------------------------------------

export function CollectionTabs({
  collections,
  collectionCounts,
  active,
  onSelect,
}: {
  collections: string[];
  collectionCounts: Record<string, number>;
  active: string;
  onSelect: (collection: string) => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q
    ? collections.filter(
        (c) => c.toLowerCase().includes(q) || collectionLabel(c).toLowerCase().includes(q),
      )
    : collections;
  // Keep the active collection visible even when it doesn't match the filter.
  const shown = active && !filtered.includes(active) ? [active, ...filtered] : filtered;

  return (
    <div className="coltabs">
      <div className="coltabs-strip" role="tablist" aria-label="Collections">
        <button
          className={active ? 'coltab' : 'coltab is-on'}
          onClick={() => onSelect('')}
          role="tab"
          aria-selected={!active}
        >
          All
          <span className="coltab-n">{collections.length}</span>
        </button>
        {shown.map((c) => {
          const count = collectionCounts[c];
          const countLabel = typeof count === 'number' ? count.toLocaleString() : null;
          return (
            <button
              key={c}
              className={active === c ? 'coltab is-on' : 'coltab'}
              onClick={() => onSelect(c)}
              title={countLabel ? `${c} · ${countLabel} indexed records` : c}
              role="tab"
              aria-selected={active === c}
            >
              {collectionLabel(c)}
              {countLabel && <span className="coltab-n">{countLabel}</span>}
            </button>
          );
        })}
        {q && filtered.length === 0 && <span className="coltabs-empty">no match for “{query}”</span>}
      </div>

      <div className="coltabs-search field">
        <Icon.Search />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter collections"
          aria-label="Filter collections"
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear collection filter">
            <Icon.X />
          </button>
        )}
      </div>
    </div>
  );
}

// --- pager -----------------------------------------------------------------

export function Pager({
  page,
  totalPages,
  onPrev,
  onNext,
  disabled,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  disabled: boolean;
}) {
  return (
    <nav className="pager" aria-label="Pagination">
      <button onClick={onPrev} disabled={disabled || page <= 1}><Icon.ChevronLeft /> Previous</button>
      <span className="pager-info">Page <b>{page}</b> of <b>{totalPages}</b></span>
      <button onClick={onNext} disabled={disabled || page >= totalPages}>Next <Icon.ChevronRight /></button>
    </nav>
  );
}

// --- record drawer ---------------------------------------------------------

function highlightJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'jn';
      if (/^"/.test(match)) cls = /:$/.test(match) ? 'jk' : 'js';
      else if (/true|false|null/.test(match)) cls = 'jb';
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

function DrawerCreator({ did }: { did: string | null }) {
  const handle = useHandle(did);
  if (handle) {
    return (
      <a href={`https://bsky.app/profile/${handle}`} target="_blank" rel="noreferrer">
        @{handle}
      </a>
    );
  }
  return <span className="mono">{shortDid(did)}</span>;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={done ? 'copy-btn done' : 'copy-btn'}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export function RecordDrawer({ record, onClose }: { record: RecordNode; onClose: () => void }) {
  const parsed = parseJson(record.recordJson);
  const specimen = extractSpecimen(record, parsed);
  const bucket = scoreBucket(record.lastEvaluationScore);
  const primaryPreview = useMemo(() => buildBlobPreview(record, parsed), [record, parsed]);
  const comment = record.aiComment ?? record.blobs?.find((b) => b.aiComment)?.aiComment ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" style={{ ['--accent' as string]: bucket.color }} role="dialog" aria-modal="true" aria-label="Record detail">
        <div className="drawer-head">
          <div className="drawer-headline">
            <div>
              <p className="collection-tag" title={record.collection}>{collectionLabel(record.collection)}</p>
              <h2 className={specimen.isBinomial ? 'specimen-title binomial' : 'specimen-title'}>{specimen.title}</h2>
              {specimen.subtitle && <p className="specimen-vernacular">{specimen.subtitle}</p>}
            </div>
            <button className="drawer-close" onClick={onClose} aria-label="Close"><Icon.X /></button>
          </div>
          <div className="drawer-badges">
            <ScoreRing score={record.lastEvaluationScore} size={52} />
            <StatusBadge status={record.currentStatus} />
            {specimen.iucn && <IucnBadge code={specimen.iucn} />}
          </div>
        </div>

        <div className="drawer-body">
          {primaryPreview && <BlobThumbnail source={primaryPreview} title={specimen.title} compact={false} />}

          {(comment || record.aiModel) && (
            <section className="drawer-section">
              <h4>AI Evaluation</h4>
              {comment ? <p className="drawer-comment">{comment}</p> : <p className="drawer-comment" style={{ fontStyle: 'italic', color: 'var(--faint)' }}>No comment recorded.</p>}
              {(record.aiLabels?.length ?? 0) > 0 && (
                <div className="label-chips" style={{ marginTop: '0.7rem' }}>
                  {record.aiLabels!.map((l) => <span className="label-chip" key={l}>{l}</span>)}
                </div>
              )}
              {record.aiModel && <p className="drawer-model">Model · {record.aiModel}</p>}
            </section>
          )}

          {record.errorMessage && (
            <section className="drawer-section">
              <h4>Error</h4>
              <div className="error-banner" style={{ margin: 0 }}>
                <Icon.Alert />
                <div><pre>{record.errorMessage}</pre></div>
              </div>
            </section>
          )}

          <section className="drawer-section">
            <h4>Metadata</h4>
            <dl className="kv">
              <dt>Score</dt><dd><strong style={{ color: bucket.color }}>{scoreText(record.lastEvaluationScore)}</strong> / 100 · {bucket.label}</dd>
              {specimen.recordType && (<><dt>Type</dt><dd className="mono">{specimen.recordType}</dd></>)}
              {specimen.basisOfRecord && (<><dt>Basis</dt><dd>{specimen.basisOfRecord}</dd></>)}
              {specimen.group && (<><dt>Group</dt><dd>{specimen.group}</dd></>)}
              {specimen.facts.map((f) => (
                <React.Fragment key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></React.Fragment>
              ))}
              <dt>Creator</dt><dd><DrawerCreator did={record.did} /></dd>
              <dt>Collection</dt><dd className="mono">{record.collection}</dd>
              <dt>Evaluated</dt><dd>{formatDate(record.lastEvaluatedAt)}</dd>
              <dt>Created</dt><dd>{formatDate(record.createdAt)}</dd>
              <dt>DID</dt><dd className="mono" title={record.did ?? ''}>{shortDid(record.did)}</dd>
              <dt>URI</dt>
              <dd className="copy-row">
                <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{record.uri}</span>
                <CopyButton text={record.uri} />
              </dd>
            </dl>
          </section>

          {(record.blobs?.length ?? 0) > 0 && (
            <section className="drawer-section">
              <h4>Blobs · {record.blobs!.length}</h4>
              {record.blobs!.map((b) => {
                const kind = classifyBlob(b.mimeType);
                const source: BlobPreviewSource = {
                  kind,
                  label: blobKindLabel(kind),
                  detail: b.mimeType,
                  mimeType: b.mimeType,
                  sizeBytes: b.sizeBytes,
                  url: blobUrl(record, b),
                  did: record.did,
                  blob: b,
                };
                return (
                  <div className="blob-row" key={b.id} style={{ ['--accent' as string]: scoreBucket(b.lastEvaluationScore).color }}>
                    <BlobThumbnail source={source} title={`${specimen.title} ${blobKindLabel(kind)}`} />
                    <div className="blob-row-meta">
                      <span className="mime">{b.mimeType ?? 'unknown'}</span>
                      <span className="size">{formatBytes(b.sizeBytes)}</span>
                    </div>
                    {typeof b.lastEvaluationScore === 'number' && <span className="blob-score">{scoreText(b.lastEvaluationScore)}</span>}
                  </div>
                );
              })}
            </section>
          )}

          {parsed != null && (
            <section className="drawer-section">
              <h4>
                Raw record
                <CopyButton text={JSON.stringify(parsed, null, 2)} />
              </h4>
              <pre className="json-block" dangerouslySetInnerHTML={{ __html: highlightJson(parsed) }} />
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
