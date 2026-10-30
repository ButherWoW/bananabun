import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { folders as foldersApi } from '../../api/client.js';
import { useAuth } from '../../store/auth.js';
import { getTheme, setTheme } from '../../store/theme.js';
import clsx from 'clsx';
import PushWizard from '../PushWizard.jsx';
import PushPresetsPanel from '../PushPresetsPanel.jsx';
import Tour, { TourButton } from '../tour/Tour.jsx';

// Same three top-level sections as the original; the rest stays reachable under «Ещё».
const NAV_MAIN = [
  { path: '/dashboard', label: 'Дашборд', icon: '📊' },
  { path: '/products', label: 'Связки', icon: '⚡' },
  { path: '/campaigns', label: 'Залив', icon: '🚀' },
  { path: '/accounts', label: 'Аккаунты', icon: '👤' },
];
const NAV_ADS = [
  { path: '/tiktok', label: 'TikTok Ads', icon: '🎵' },
  { path: '/google', label: 'Google Ads', icon: '🔷' },
];
const NAV_MORE = [
  { path: '/creatives', label: 'Креативы', icon: '🎨' },
  { path: '/pushes', label: 'Журнал заливов', icon: '📜' },
  { path: '/landings', label: 'Лендинги', icon: '🌐' },
  { path: '/ad-settings', label: 'Пресеты рекламы', icon: '📣' },
  { path: '/ad-presets', label: 'Пресеты (старые)', icon: '⚙️' },
  { path: '/analytics', label: 'Аналитика', icon: '📈' },
  { path: '/search', label: 'Поиск на Amazon', icon: '🔍' },
  { path: '/2fa', label: 'Коды 2FA', icon: '🔐' },
];
// Public demo build: a strip over the whole panel so nobody mistakes it for the real one.
const DEMO = import.meta.env.MODE === 'demo';

function DemoBanner() {
  return (
    <div role="status" className="flex-shrink-0 bg-amber-400 text-black text-xs sm:text-sm font-semibold text-center px-3 py-1.5 leading-snug">
      ДЕМО-РЕЖИМ — данные выдуманные, изменения не сохраняются
    </div>
  );
}

const USER_MENU = [
  { path: '/admin', label: 'Команда', roles: ['owner', 'lead'] },
  { path: '/settings', label: 'Настройки', roles: ['owner'] },
  { path: '/mcp', label: 'Подключение ИИ (MCP)' },
];

function NavLink({ item, active }) {
  return (
    <Link
      to={item.path}
      data-tour={`nav-${item.path.slice(1)}`}
      className={clsx(
        'flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors',
        active ? 'bg-indigo-600/20 text-indigo-300 font-medium' : 'text-gray-400 hover:text-white hover:bg-[color:var(--c1a1d35)]'
      )}
    >
      <span className="text-base leading-none">{item.icon}</span>
      {item.label}
    </Link>
  );
}

function FolderRow({ icon, name, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg transition-colors text-left',
        active ? 'bg-[color:var(--c1e2240)] text-white' : 'text-gray-500 hover:text-white hover:bg-[color:var(--c1a1d35)]'
      )}
    >
      <span className="flex items-center gap-2 truncate text-xs">
        <span>{icon}</span>
        <span className="truncate">{name}</span>
      </span>
      <span className="text-[10px] text-gray-600 flex-shrink-0">{count}</span>
    </button>
  );
}

function NewFolderForm({ shared, onDone }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => foldersApi.create({ name: name.trim(), shared }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['folders'] }); onDone(); },
  });
  return (
    <form onSubmit={e => { e.preventDefault(); if (name.trim()) create.mutate(); }} className="mb-2 px-1">
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder={shared ? 'Общая папка' : 'Название папки'}
        className="w-full bg-[color:var(--c0f1117)] border border-indigo-500/50 rounded px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none"
        onKeyDown={e => e.key === 'Escape' && onDone()}
        onBlur={() => !name.trim() && onDone()}
      />
    </form>
  );
}

export default function Layout({ children }) {
  const location = useLocation();
  const { user, workspace, logout } = useAuth();
  const [newFolderKind, setNewFolderKind] = useState(null);
  const [showMore, setShowMore] = useState(() => NAV_MORE.some(i => location.pathname.startsWith(i.path)));
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [theme, setThemeState] = useState(getTheme);
  const toggleTheme = () => { const next = theme === 'light' ? 'dark' : 'light'; setTheme(next); setThemeState(next); };
  const [showPresets, setShowPresets] = useState(false);
  const [pushPreset, setPushPreset] = useState(undefined); // undefined = wizard closed, null = no preset
  const navigate = useNavigate();
  // The tour and links may land on a page under «Ещё»; keep its menu item visible.
  useEffect(() => {
    if (NAV_MORE.some(i => location.pathname.startsWith(i.path))) setShowMore(true);
  }, [location.pathname]);

  const { data: folderList = [] } = useQuery({ queryKey: ['folders'], queryFn: foldersApi.list });
  const { data: counts } = useQuery({ queryKey: ['folders', 'counts'], queryFn: foldersApi.counts });

  const onProducts = location.pathname.startsWith('/products');
  const currentFolder = onProducts ? (location.pathname.split('/')[2] || null) : undefined;
  const personalFolders = folderList.filter(f => !f.shared);
  const sharedFolders = folderList.filter(f => f.shared);
  const allowed = item => !item.roles || item.roles.includes(user?.role);

  const shell = (
    <div className={DEMO ? 'flex flex-1 min-h-0 overflow-hidden' : 'flex h-screen overflow-hidden'}>
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-[color:var(--c0d0f1e)] border-r border-[color:var(--c1e2240)] flex flex-col">
        {/* Logo */}
        <div className="px-4 pt-4 pb-3 flex flex-col items-center gap-2 text-center">
          <img src={`${import.meta.env.BASE_URL}logo-320.png`} alt="Banana Platform" className="w-40 h-40 rounded-2xl object-cover flex-shrink-0" />
          <div className="min-w-0 max-w-full">
            <div className="text-base font-bold text-yellow-400 leading-tight tracking-wide">Banana Platform</div>
            <div className="text-[10px] text-gray-600 truncate">{workspace?.name}</div>
          </div>
        </div>

        <div className="px-2 pb-2">
          <button
            data-tour="push-open"
            onClick={() => setShowPresets(true)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            🚀 Залить рекламу
          </button>
          <div className="mt-1.5"><TourButton /></div>
        </div>

        <div className="px-2 pb-1">
          {NAV_MAIN.map(item => <NavLink key={item.path} item={item} active={location.pathname.startsWith(item.path)} />)}
          <div className="px-2 pt-3 pb-0.5 flex items-center gap-2">
            <span className="text-[10px] text-gray-600 uppercase tracking-wider font-medium">Кабинеты</span>
          </div>
          {NAV_ADS.map(item => <NavLink key={item.path} item={item} active={location.pathname.startsWith(item.path)} />)}
          <button
            onClick={() => setShowMore(v => !v)}
            className="w-full flex items-center justify-between px-2 py-1.5 mt-1 text-[11px] text-gray-600 hover:text-gray-300 uppercase tracking-wider"
          >
            Ещё <span>{showMore ? '▴' : '▾'}</span>
          </button>
          {showMore && NAV_MORE.filter(allowed).map(item => (
            <NavLink key={item.path} item={item} active={location.pathname.startsWith(item.path)} />
          ))}
        </div>

        {/* Folders — on Связки, like the original's second column */}
        <div className={clsx('flex-1 overflow-y-auto border-t border-[color:var(--c1e2240)] mt-1', !onProducts && 'invisible')}>
          <div className="px-2 pt-3">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] text-gray-600 uppercase tracking-wider">Папки</span>
              <button
                onClick={() => setNewFolderKind(newFolderKind === 'personal' ? null : 'personal')}
                className="text-[10px] text-gray-500 hover:text-indigo-400 transition-colors border border-[color:var(--c2d3148)] hover:border-indigo-500/50 px-1.5 py-0.5 rounded"
              >+ Папка</button>
            </div>
            {newFolderKind === 'personal' && <NewFolderForm shared={false} onDone={() => setNewFolderKind(null)} />}
            <FolderRow icon="📂" name="Все папки" count={counts?.total ?? ''} active={currentFolder === null} onClick={() => navigate('/products')} />
            <FolderRow icon="🗂" name="Без папки" count={counts?.unfiled ?? ''} active={currentFolder === 'none'} onClick={() => navigate('/products/none')} />
            {personalFolders.map(folder => (
              <FolderRow key={folder.id} icon="📁" name={folder.name} count={folder.product_count || 0}
                active={currentFolder === folder.id} onClick={() => navigate(`/products/${folder.id}`)} />
            ))}
          </div>

          <div className="px-2 pt-3 mt-1 border-t border-[color:var(--c1e2240)]">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] text-gray-600 uppercase tracking-wider">Shared</span>
              <button
                onClick={() => setNewFolderKind(newFolderKind === 'shared' ? null : 'shared')}
                className="text-[10px] text-gray-500 hover:text-indigo-400 transition-colors border border-[color:var(--c2d3148)] hover:border-indigo-500/50 px-1.5 py-0.5 rounded"
              >+ Папка</button>
            </div>
            {newFolderKind === 'shared' && <NewFolderForm shared onDone={() => setNewFolderKind(null)} />}
            {sharedFolders.map(folder => (
              <FolderRow key={folder.id} icon="🌐" name={folder.name} count={folder.product_count || 0}
                active={currentFolder === folder.id} onClick={() => navigate(`/products/${folder.id}`)} />
            ))}
            {!sharedFolders.length && <div className="px-2 py-1 text-[11px] text-gray-700">Общих папок нет</div>}
          </div>
        </div>

        {/* User menu */}
        <div className="relative border-t border-[color:var(--c1e2240)]">
          {showUserMenu && (
            <div className="absolute bottom-full left-2 right-2 mb-1 bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg py-1 shadow-xl">
              {USER_MENU.filter(allowed).map(item => (
                <Link key={item.path} to={item.path} onClick={() => setShowUserMenu(false)}
                  className="block px-3 py-2 text-sm text-gray-300 hover:bg-[color:var(--c1a1d35)] hover:text-white">{item.label}</Link>
              ))}
              <button onClick={toggleTheme} className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-300 hover:bg-[color:var(--c1a1d35)] hover:text-white">
                <span>Тема</span>
                <span className="text-xs text-gray-500">{theme === 'light' ? '☀️ Светлая' : '🌙 Тёмная'}</span>
              </button>
              <button onClick={logout} className="w-full text-left px-3 py-2 text-sm text-red-300 hover:bg-[color:var(--c1a1d35)]">Выйти</button>
            </div>
          )}
          <button onClick={() => setShowUserMenu(v => !v)} className="w-full p-3 flex items-center gap-2 hover:bg-[color:var(--c13162b)]">
            <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-xs text-white font-bold flex-shrink-0">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <div className="text-xs text-gray-400 truncate flex-1 text-left">{user?.name}</div>
            <span className="text-[10px] text-gray-600">{showUserMenu ? '▾' : '▴'}</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-hidden bg-[color:var(--c0a0c18)] flex flex-col">
        {children}
      </main>

      {showPresets && (
        <PushPresetsPanel
          onClose={() => setShowPresets(false)}
          onPick={(preset) => { setShowPresets(false); setPushPreset(preset); }}
        />
      )}
      {pushPreset !== undefined && (
        <PushWizard
          initialPreset={pushPreset || undefined}
          onClose={() => setPushPreset(undefined)}
          onSuccess={() => navigate('/pushes')}
        />
      )}
      <Tour />
    </div>
  );

  if (!DEMO) return shell;
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <DemoBanner />
      {shell}
    </div>
  );
}


