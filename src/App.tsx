// ---------------------------------------------------------------------------
// App — state, data loading and composition of the specimen archive.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPTY_FILTERS,
  GRAPHQL_URL,
  PAGE_SIZE,
  fetchCollectionCounts,
  fetchCollections,
  fetchRecords,
  type RecordFilters,
  type RecordNode,
} from './api';
import {
  CollectionTabs,
  ErrorBanner,
  Masthead,
  Pager,
  RecordDrawer,
  SkeletonCard,
  SpecimenCard,
  Toolbar,
  EmptyState,
} from './components';

export default function App() {
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFiltersState] = useState<RecordFilters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);

  const [records, setRecords] = useState<RecordNode[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [collections, setCollections] = useState<string[]>([]);
  const [collectionCounts, setCollectionCounts] = useState<Record<string, number>>({});
  const [active, setActive] = useState<RecordNode | null>(null);

  // Debounce the free-text search into the committed filter state.
  useEffect(() => {
    const id = setTimeout(() => {
      setFiltersState((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
      setOffset(0);
    }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Mutate filters and always reset to the first page.
  const setFilters = useCallback((next: Partial<RecordFilters>) => {
    setFiltersState((f) => ({ ...f, ...next }));
    setOffset(0);
  }, []);

  const resetAll = useCallback(() => {
    setSearchInput('');
    setFiltersState(EMPTY_FILTERS);
    setOffset(0);
  }, []);

  // Load the authoritative collection list (from published lexicon schemas) once.
  // Counts come from the indexer and only include indexed collections, so both
  // sources are intentionally kept and merged for the tab bar.
  useEffect(() => {
    const ac = new AbortController();
    fetchCollections(ac.signal)
      .then(setCollections)
      .catch(() => {/* best-effort; the tabs degrade to "All collections" */});
    fetchCollectionCounts(ac.signal)
      .then((counts) => {
        const next: Record<string, number> = {};
        for (const { collection, count } of counts) next[collection] = count;
        setCollectionCounts(next);
      })
      .catch(() => {/* best-effort; tabs still render without indexed counts */});
    return () => ac.abort();
  }, []);

  const orderedCollections = useMemo(() => {
    const all = new Set(collections);
    for (const collection of Object.keys(collectionCounts)) all.add(collection);

    return [...all].sort((a, b) => {
      const aCount = collectionCounts[a];
      const bCount = collectionCounts[b];
      const aHasCount = typeof aCount === 'number';
      const bHasCount = typeof bCount === 'number';

      if (aHasCount && bHasCount && aCount !== bCount) return bCount - aCount;
      if (aHasCount !== bHasCount) return aHasCount ? -1 : 1;
      return a.localeCompare(b);
    });
  }, [collections, collectionCounts]);

  // Load the current page of records.
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchRecords(filters, offset, ac.signal)
      .then(({ nodes, totalCount }) => {
        setRecords(nodes);
        setTotalCount(totalCount);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setRecords([]);
        setTotalCount(0);
        setError(err instanceof Error ? err.message : 'Unknown error');
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [filters, offset, reloadKey]);

  // Scroll back to top when the page changes.
  const gridRef = useRef<HTMLDivElement>(null);
  const goToOffset = useCallback((next: number) => {
    setOffset(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const isDirty = useMemo(
    () =>
      searchInput !== '' ||
      filters.collection !== '' ||
      filters.minScore > 0 ||
      filters.maxScore < 100 ||
      filters.onlyWithMedia,
    [searchInput, filters],
  );

  const headState = error ? 'error' : loading ? 'loading' : 'ok';

  return (
    <div className="app">
      <Masthead totalCount={totalCount} endpoint={GRAPHQL_URL} state={headState} />

      <div className="controlbar">
        <Toolbar
          searchInput={searchInput}
          onSearchInput={setSearchInput}
          filters={filters}
          setFilters={setFilters}
          onReset={resetAll}
          isDirty={isDirty}
        />
        {orderedCollections.length > 0 && (
          <CollectionTabs
            collections={orderedCollections}
            collectionCounts={collectionCounts}
            active={filters.collection}
            onSelect={(c) => setFilters({ collection: c })}
          />
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => setReloadKey((k) => k + 1)} />}

      <div className="specimen-grid" ref={gridRef}>
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
        ) : records.length > 0 ? (
          records.map((r, i) => <SpecimenCard key={r.id} record={r} index={i} onOpen={setActive} />)
        ) : (
          !error && <EmptyState onReset={resetAll} />
        )}
      </div>

      {totalCount > PAGE_SIZE && (
        <Pager
          page={page}
          totalPages={totalPages}
          disabled={loading}
          onPrev={() => goToOffset(Math.max(0, offset - PAGE_SIZE))}
          onNext={() => goToOffset(offset + PAGE_SIZE)}
        />
      )}

      {active && <RecordDrawer record={active} onClose={() => setActive(null)} />}
    </div>
  );
}
