import React from 'react';
import { createRoot } from 'react-dom/client';
import JsBarcode from 'jsbarcode';
import './styles.css';
window.__JsBarcode = JsBarcode;

const root = createRoot(document.getElementById('root'));
const live = !!import.meta.env.VITE_SUPABASE_URL;

if (live && window.location.pathname.startsWith('/verify')) {
  import('./PublicVerify.jsx').then(({ default: V }) => root.render(<V />));
} else if (live) {
  import('./ProdRoot.jsx').then(({ default: P }) => root.render(<P />));
} else {
  // No database configured: run the self-contained demo with sample data.
  import('./App.jsx').then(({ default: App }) => root.render(<App />));
}
