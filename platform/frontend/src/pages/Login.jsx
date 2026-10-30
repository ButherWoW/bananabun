import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../store/auth.js';
import './Login.css';


export default function LoginPage() {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const played = useRef(false);
  const audioRef = useRef(null);

  useEffect(() => {
    const audio = new Audio(`${import.meta.env.BASE_URL}login.mp3`);
    audio.volume = 0.7;
    audioRef.current = audio;

    const play = () => {
      if (played.current) return;
      played.current = true;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    };

    const EVENTS = ['click', 'keydown', 'touchstart', 'touchend', 'pointerdown'];
    const cleanup = () => EVENTS.forEach(e => document.removeEventListener(e, play));

    // Try autoplay; Safari will reject — then wait for any gesture
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(() => { played.current = true; }).catch(() => {
        EVENTS.forEach(e => document.addEventListener(e, play, { once: true, passive: true }));
      });
    }

    return () => {
      cleanup();
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  const nextStep = (e) => {
    e.preventDefault();
    if (!email) return;
    setError('');
    setStep('password');
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await login(email, password);
      navigate('/products');
    } catch (err) {
      setError(err.error || 'Login failed');
      setStep('email');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full rounded-xl px-4 py-3 text-sm text-white placeholder-[#4a7a78] focus:outline-none transition-all duration-200"
    + " bg-[#0d2524] border border-[#1a4a47] focus:border-[#81D8D0] focus:shadow-[0_0_0_3px_rgba(129,216,208,0.15)]";

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #071a19 0%, #0b2422 50%, #071a19 100%)' }}>
      <div className="login-money-rain" aria-hidden="true">
        {Array.from({ length: 26 }, (_, i) => (
          <span className="login-money-bill" key={i} style={{
            left: `${(i * 37) % 100}%`,
            '--duration': `${11 + (i % 7) * 1.4}s`,
            '--delay': `${-i * 2.7}s`,
            '--drift': `${(i % 2 ? 1 : -1) * (35 + i % 5 * 18)}px`,
            '--turn': `${(i % 2 ? 1 : -1) * (90 + i * 13)}deg`,
            '--size': `${48 + i % 4 * 12}px`,
          }}>
            <svg viewBox="0 0 120 54" fill="none">
              <rect x="1" y="1" width="118" height="52" rx="4" fill="#9fc4a2" stroke="#477a61" strokeWidth="2" />
              <rect x="7" y="7" width="106" height="40" rx="2" stroke="#477a61" />
              <ellipse cx="60" cy="27" rx="18" ry="19" fill="#78a584" stroke="#477a61" />
              <text x="60" y="36" textAnchor="middle" fill="#244e3b" fontSize="29" fontFamily="Georgia, serif" fontWeight="bold">$</text>
              <text x="13" y="23" fill="#244e3b" fontSize="12" fontFamily="Georgia, serif">100</text>
              <text x="85" y="40" fill="#244e3b" fontSize="12" fontFamily="Georgia, serif">100</text>
            </svg>
          </span>
        ))}
      </div>
      {/* Tiffany glow orb */}
      <div style={{ position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(129,216,208,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: 380, padding: '0 16px', position: 'relative' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 44, marginBottom: 12, filter: 'drop-shadow(0 0 20px rgba(129,216,208,0.6))' }}>💵</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#81D8D0', letterSpacing: '-0.5px', margin: '0 0 6px', textShadow: '0 0 40px rgba(129,216,208,0.4)' }}>
            Делай Деньги!
          </h1>
          <p style={{ fontSize: 13, color: '#4a9e9a', margin: 0 }}>
            {step === 'email' ? 'Представьтесь' : email}
          </p>
        </div>

        {step === 'email' ? (
          <form onSubmit={nextStep} style={{ background: 'rgba(13,37,36,0.8)', border: '1px solid rgba(129,216,208,0.2)', borderRadius: 20, padding: 28, backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
              <div style={{ background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff8080', fontSize: 13, borderRadius: 10, padding: '10px 14px' }}>{error}</div>
            )}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#4a9e9a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Email</label>
              <input
                type="text" value={email} onChange={e => setEmail(e.target.value)}
                required autoFocus className={inputCls} placeholder="логин или email"
                autoComplete="username"
              />
            </div>
            <button type="submit" style={{ width: '100%', background: 'linear-gradient(135deg, #0ABAB5, #81D8D0)', color: '#071a19', fontWeight: 700, padding: '12px', borderRadius: 12, fontSize: 14, border: 'none', cursor: 'pointer', letterSpacing: '0.02em', transition: 'opacity 0.2s, box-shadow 0.2s', boxShadow: '0 4px 24px rgba(129,216,208,0.35)' }}
              onMouseEnter={e => e.target.style.opacity = '0.88'} onMouseLeave={e => e.target.style.opacity = '1'}>
              Далее →
            </button>
            <p style={{ textAlign: 'center', fontSize: 12, color: '#2d6663', margin: 0 }}>
              Нет аккаунта?{' '}
              <Link to="/register" style={{ color: '#81D8D0', textDecoration: 'none' }}>Зарегистрироваться</Link>
            </p>
          </form>
        ) : (
          <form onSubmit={submit} style={{ background: 'rgba(13,37,36,0.8)', border: '1px solid rgba(129,216,208,0.2)', borderRadius: 20, padding: 28, backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
              <div style={{ background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff8080', fontSize: 13, borderRadius: 10, padding: '10px 14px' }}>{error}</div>
            )}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#4a9e9a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Пароль</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                required autoFocus className={inputCls} placeholder="••••••••"
              />
            </div>
            <button type="submit" disabled={loading} style={{ width: '100%', background: loading ? 'rgba(129,216,208,0.3)' : 'linear-gradient(135deg, #0ABAB5, #81D8D0)', color: '#071a19', fontWeight: 700, padding: '12px', borderRadius: 12, fontSize: 14, border: 'none', cursor: loading ? 'default' : 'pointer', letterSpacing: '0.02em', boxShadow: loading ? 'none' : '0 4px 24px rgba(129,216,208,0.35)', transition: 'all 0.2s' }}>
              {loading ? 'Входим...' : 'Войти'}
            </button>
            <button type="button" onClick={() => setStep('email')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#2d6663', padding: '4px 0', transition: 'color 0.2s' }}
              onMouseEnter={e => e.target.style.color = '#4a9e9a'} onMouseLeave={e => e.target.style.color = '#2d6663'}>
              ← Изменить email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
