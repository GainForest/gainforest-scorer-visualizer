// ---------------------------------------------------------------------------
// App — state, data loading and composition of the specimen archive.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createParser, parseAsBoolean, parseAsString, useQueryStates, type UrlKeys } from 'nuqs';
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

const scoreParser = createParser({
  parse(value) {
    const score = Number(value);
    if (!Number.isFinite(score)) return null;
    return Math.max(0, Math.min(100, Math.round(score)));
  },
  serialize: String,
});

const pageParser = createParser({
  parse(value) {
    const page = Number(value);
    if (!Number.isFinite(page) || page < 1) return null;
    return Math.floor(page);
  },
  serialize: String,
});

const queryParsers = {
  search: parseAsString.withDefault(''),
  collection: parseAsString.withDefault(''),
  collectionSearch: parseAsString.withDefault(''),
  minScore: scoreParser.withDefault(0),
  maxScore: scoreParser.withDefault(100),
  onlyWithMedia: parseAsBoolean.withDefault(false),
  page: pageParser.withDefault(1),
};

const queryUrlKeys: UrlKeys<typeof queryParsers> = {
  search: 'q',
  collection: 'collection',
  collectionSearch: 'collectionSearch',
  minScore: 'minScore',
  maxScore: 'maxScore',
  onlyWithMedia: 'media',
  page: 'page',
};

export default function App() {
  const [query, setQuery] = useQueryStates(queryParsers, {
    history: 'replace',
    urlKeys: queryUrlKeys,
  });
  const [searchInput, setSearchInput] = useState(() => query.search);

  const filters = useMemo<RecordFilters>(() => {
    const minScore = Math.min(query.minScore, query.maxScore);
    const maxScore = Math.max(query.minScore, query.maxScore);
    return {
      search: query.search,
      collection: query.collection,
      minScore,
      maxScore,
      onlyWithMedia: query.onlyWithMedia,
    };
  }, [query.collection, query.maxScore, query.minScore, query.onlyWithMedia, query.search]);
  const page = query.page;
  const offset = (page - 1) * PAGE_SIZE;

  const [records, setRecords] = useState<RecordNode[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [collections, setCollections] = useState<string[]>([]);
  const [collectionCounts, setCollectionCounts] = useState<Record<string, number>>({});
  const [active, setActive] = useState<RecordNode | null>(null);

  // Keep the text field in sync when browser navigation changes the query.
  useEffect(() => {
    setSearchInput(query.search);
  }, [query.search]);

  // Debounce the free-text search into the URL-backed committed filter state.
  useEffect(() => {
    const id = setTimeout(() => {
      if (query.search !== searchInput) {
        void setQuery({ search: searchInput, page: 1 });
      }
    }, 350);
    return () => clearTimeout(id);
  }, [query.search, searchInput, setQuery]);

  // Mutate filters and always reset to the first page.
  const setFilters = useCallback((next: Partial<RecordFilters>) => {
    void setQuery({ ...next, page: 1 });
  }, [setQuery]);

  const resetAll = useCallback(() => {
    setSearchInput('');
    void setQuery({
      search: null,
      collection: null,
      collectionSearch: null,
      minScore: null,
      maxScore: null,
      onlyWithMedia: null,
      page: null,
    });
  }, [setQuery]);

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
  const goToPage = useCallback((next: number) => {
    void setQuery({ page: next });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setQuery]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    if (query.minScore > query.maxScore) {
      void setQuery({ minScore: query.maxScore, maxScore: query.minScore });
    }
  }, [query.maxScore, query.minScore, setQuery]);

  useEffect(() => {
    if (!loading && page > totalPages) {
      void setQuery({ page: totalPages });
    }
  }, [loading, page, setQuery, totalPages]);

  const isDirty = useMemo(
    () =>
      searchInput !== '' ||
      query.collectionSearch !== '' ||
      filters.collection !== '' ||
      filters.minScore > EMPTY_FILTERS.minScore ||
      filters.maxScore < EMPTY_FILTERS.maxScore ||
      filters.onlyWithMedia,
    [filters, query.collectionSearch, searchInput],
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
            query={query.collectionSearch}
            onQuery={(collectionSearch) => void setQuery({ collectionSearch })}
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
          onPrev={() => goToPage(Math.max(1, page - 1))}
          onNext={() => goToPage(page + 1)}
        />
      )}

      {active && <RecordDrawer record={active} onClose={() => setActive(null)} />}
    </div>
  );
}
