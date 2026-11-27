import { createRoot } from 'react-dom/client';
import { Journey } from './Journey';
import { UniqueCatalogBoundary } from './UniqueCatalogBoundary';
import { catalogModeFromSearch } from './journey/uniqueCatalogGate';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
// Opt-in candidate only; no query = the accepted runtime, unchanged (no listener, no admission).
root.render(catalogModeFromSearch(window.location.search) === 'unique' ? <UniqueCatalogBoundary /> : <Journey />);
