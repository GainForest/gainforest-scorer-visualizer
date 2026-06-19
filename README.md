# GainForest Scorer Visualizer

Simple React/Vite app for browsing scored GraphQL records.

## Run

```bash
npm install
cp .env.example .env.local
# edit .env.local and set VITE_INDEXER_URL
npm run dev
```

The app expects the indexer GraphQL endpoint in `VITE_INDEXER_URL`.
For one-off local runs:

```bash
VITE_INDEXER_URL=https://your-host/graphql npm run dev
```
