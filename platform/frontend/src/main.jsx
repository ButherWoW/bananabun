import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import App from './App.jsx';
import LoginPage from './pages/Login.jsx';
import RegisterPage from './pages/Register.jsx';
import Toaster, { toast, errorText } from './components/Toaster.jsx';
import './index.css';
import './theme.css';
import { applyTheme, getTheme } from './store/theme.js';

applyTheme(getTheme());

// Old links (/products, /login…) still reach this build through nginx's fallback: move them under /banana/.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
if (BASE && !window.location.pathname.startsWith(BASE + '/') && window.location.pathname !== BASE) {
  window.location.replace(BASE + window.location.pathname + window.location.search + window.location.hash);
}

// Every failed action surfaces its message, unless the mutation shows it inline (meta.inlineError).
const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (!mutation.meta?.inlineError) toast(errorText(err));
    },
  }),
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={qc}>
    <Toaster />
    <BrowserRouter basename={BASE || undefined}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);
