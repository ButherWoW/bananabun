import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './store/auth.js';
import { useRole } from './hooks/useRole.js';

function RoleRoute({ roles, element }) {
  const { role } = useRole();
  return roles.includes(role) ? element : <Navigate to="/products" replace />;
}
import Layout from './components/layout/Layout.jsx';
import ProductsPage from './pages/Products.jsx';
import CreativesPage from './pages/Creatives.jsx';
import AnalyticsPage from './pages/Analytics.jsx';
import CampaignsPage from './pages/Campaigns.jsx';
import SearchPage from './pages/Search.jsx';
import TeamPage from './pages/Team.jsx';
import AdsPowerPage from './pages/AdsPower.jsx';
import SettingsPage from './pages/Settings.jsx';
import AccountsPage from './pages/Accounts.jsx';
import LandingsPage from './pages/Landings.jsx';
import AdPresetsPage from './pages/AdPresets.jsx';
import PushesPage from './pages/Pushes.jsx';
import AdminPage from './pages/Admin.jsx';
import AdSettingsPage from './pages/AdSettings.jsx';
import TwoFaPage from './pages/TwoFa.jsx';

export default function App() {
  const { user, loading, loadMe } = useAuth();

  useEffect(() => { loadMe(); }, []);

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-[color:var(--c0f1117)] text-gray-400">
      Загрузка...
    </div>
  );

  if (!user) return <Navigate to="/login" replace />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/products" replace />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/:folderId" element={<ProductsPage />} />
        <Route path="/creatives" element={<CreativesPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/campaigns" element={<CampaignsPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/team" element={<RoleRoute roles={['owner', 'lead']} element={<TeamPage />} />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/adspower" element={<AdsPowerPage />} />
        <Route path="/settings" element={<RoleRoute roles={['owner']} element={<SettingsPage />} />} />
        <Route path="/landings" element={<LandingsPage />} />
        <Route path="/ad-presets" element={<AdPresetsPage />} />
        <Route path="/pushes" element={<PushesPage />} />
        <Route path="/admin" element={<RoleRoute roles={['owner', 'lead']} element={<AdminPage />} />} />
        <Route path="/ad-settings" element={<AdSettingsPage />} />
        <Route path="/2fa" element={<TwoFaPage />} />
      </Routes>
    </Layout>
  );
}
