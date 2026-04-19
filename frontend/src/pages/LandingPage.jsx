import { useEffect, useRef, useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sun, Moon, Languages } from 'lucide-react';
import { WhispFlowAnimatedLogo } from '../components/WhispFlowAnimatedLogo';
import { WhispFlowWfMark } from '../components/WhispFlowWfMark';
import { useTheme } from '../contexts/ThemeContext';
import { landingCopy } from './landingCopy';
import api from '../api/client';
import './landing.css';

// Mirrors helpers/seedPlans.js — used as a fallback if /api/plans is offline.
const FALLBACK_PLANS = [
  {
    code:     'free_trial',
    label:    'Free Trial',
    blurb:    '20 credits to try the platform. No card required, never renews.',
    priceUsd: 0,
    priceTnd: 0,
    credits:  20,
    isCustom: false,
    oneTime:  true,
    features: [
      '20 credits total (one-time)',
      '20 lead extractions OR 40 messages',
      'Full access to all features',
      'No payment method required',
    ],
  },
  {
    code:     'basic',
    label:    'Basic',
    blurb:    'For solo operators and small teams getting started with outreach.',
    priceUsd: 29,
    priceTnd: 90,
    credits:  1500,
    isCustom: false,
    oneTime:  false,
    features: [
      '1,500 credits per pack',
      '1,500 extractions OR 3,000 messages',
      '1 connected WhatsApp number',
      'Standard rate limits',
      'Email support',
    ],
  },
  {
    code:     'pro',
    label:    'Pro',
    blurb:    'Agencies and sales teams running daily campaigns at scale.',
    priceUsd: 79,
    priceTnd: 245,
    credits:  6000,
    isCustom: false,
    oneTime:  false,
    features: [
      '6,000 credits per pack',
      '6,000 extractions OR 12,000 messages',
      'Up to 3 WhatsApp numbers',
      'Higher rate limits & priority queue',
      'Priority email support',
    ],
  },
  {
    code:     'enterprise',
    label:    'Enterprise',
    blurb:    'High-volume outbound, custom limits, dedicated support.',
    priceUsd: 0,
    priceTnd: 0,
    credits:  0,
    isCustom: true,
    oneTime:  false,
    features: [
      'Custom credit pack & pricing',
      'Unlimited connected numbers',
      'Custom rate limits',
      'Dedicated account manager',
      'SLA & onboarding support',
    ],
  },
];

function useDocumentDark() {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsDark(el.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

function CampaignFeatureD({ text }) {
  const parts = text.split(/(\{\{name\}\}|\{\{city\}\}|\{\{business\}\})/);
  return (
    <>
      {parts.map((p, i) =>
        p === '{{name}}' || p === '{{city}}' || p === '{{business}}' ? (
          <span key={i} style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--g)' }}>{p}</span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export default function LandingPage() {
  const { setTheme } = useTheme();
  const isDark = useDocumentDark();
  const navigate = useNavigate();

  const [lang, setLang] = useState(() => {
    try {
      const s = localStorage.getItem('language') || localStorage.getItem('whispflow-landing-lang');
      if (s === 'ar' || s === 'en' || s === 'fr' || s === 'it') return s;
    } catch { /* ignore */ }
    return 'en';
  });

  const setLandingLang = (next) => {
    setLang(next);
    try {
      localStorage.setItem('whispflow-landing-lang', next);
      localStorage.setItem('language', next);
    } catch { /* ignore */ }
  };

  const t = landingCopy[lang];
  const [plans, setPlans] = useState(FALLBACK_PLANS);
  const [heroEmail, setHeroEmail] = useState('');
  const ctrRef = useRef(null);
  const numsRef = useRef(null);
  const hasAnimated = useRef(false);

  function submitHeroEmail(e) {
    e?.preventDefault?.();
    const email = String(heroEmail || '').trim();
    if (email && /\S+@\S+\.\S+/.test(email)) {
      navigate(`/register?email=${encodeURIComponent(email)}`);
    } else {
      navigate('/register');
    }
  }

  useEffect(() => {
    let cancelled = false;
    api.get('/plans')
      .then((res) => {
        const list = Array.isArray(res?.data?.plans) ? res.data.plans : [];
        if (!cancelled && list.length) setPlans(list);
      })
      .catch(() => { /* keep fallback */ });
    return () => { cancelled = true; };
  }, []);

  const plansToRender = plans;

  const countUp = useCallback((el, end, suffix, dur = 1600) => {
    let start = null;
    function step(ts) {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(ease * end) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => { entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in'); }); },
      { threshold: 0.08 }
    );
    const els = document.querySelectorAll('.landing .rv, .landing .rv2');
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const numsEl = numsRef.current;
    if (!numsEl) return;
    const numObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !hasAnimated.current) {
            hasAnimated.current = true;
            if (ctrRef.current) countUp(ctrRef.current, 98, '%');
            numObs.disconnect();
          }
        });
      },
      { threshold: 0.3 }
    );
    numObs.observe(numsEl);
    return () => numObs.disconnect();
  }, [countUp]);

  const logoSurface = isDark ? 'dark' : 'light';

  // Build FAQ structured data once per render
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: (t.faq?.items || []).map((it) => ({
      '@type': 'Question',
      name: it.q,
      acceptedAnswer: { '@type': 'Answer', text: it.a },
    })),
  };
  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'WhispFlow',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.8', reviewCount: '212' },
  };

  return (
    <div className="landing" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
      {/* SEO structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />

      {/* NAV */}
      <nav className="lnav">
        <div className="nav-logo">
          <WhispFlowWfMark height={36} />
        </div>
        <ul className="nav-links">
          <li><a href="#how">{t.nav.how}</a></li>
          <li><a href="#features">{t.nav.features}</a></li>
          <li><a href="#pricing">{t.nav.pricing}</a></li>
        </ul>
        <div className="nav-r landing-nav-tools">
          <div style={{ marginRight: 'clamp(12px,3vw,24px)', display: 'flex', alignItems: 'center' }}>
            <img
              src="/Madein-Tunisia-Logo1.png"
              alt="Made in Tunisia"
              style={{
                height: 'clamp(50px,8vh,64px)',
                width: 'auto',
                maxWidth: 180,
                objectFit: 'contain',
                transform: 'scale(1.3)',
                transformOrigin: 'center right',
                filter: isDark
                  ? 'drop-shadow(0 0 12px rgba(255,255,255,0.3)) brightness(1.1)'
                  : 'drop-shadow(0 2px 8px rgba(0,0,0,0.15))',
              }}
            />
          </div>
          <button
            type="button"
            className="btn-ghost landing-icon-btn"
            aria-label={isDark ? 'Light mode' : 'Dark mode'}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <div className="btn-ghost landing-icon-btn landing-lang-wrap">
            <Languages size={16} className="landing-lang-icon" aria-hidden />
            <select
              className="landing-lang-select"
              aria-label="Language"
              value={lang}
              onChange={(e) => setLandingLang(e.target.value)}
            >
              <option value="en">EN</option>
              <option value="fr">FR</option>
              <option value="it">IT</option>
              <option value="ar">عربي</option>
            </select>
          </div>
          <Link to="/login" className="btn-ghost">{t.nav.signIn}</Link>
          <Link to="/register" className="btn-green">{t.nav.getStarted}</Link>
        </div>
      </nav>

      {/* HERO */}
      <div style={{ position: 'relative', zIndex: 1, paddingTop: 66 }}>
        <div className="hero">
          <div className="hero-l">
            <div className="landing-hero-logo-slot" aria-hidden>
              <div className="landing-hero-logo-inner">
                <WhispFlowAnimatedLogo scale={0.38} surface={logoSurface} />
              </div>
            </div>
            <div className="hero-badge">
              <span className="badge-dot"></span>
              {t.hero.badge}
            </div>
            <h1>
              {t.hero.h1a}<br />
              {t.hero.h1Line2Prefix}<em>{t.hero.h1b}</em><br />
              {t.hero.h1c} <span className="stroke">{t.hero.h1d}</span>
            </h1>
            <p className="hero-p">{t.hero.p}</p>

            {/* Inline email capture — converts much better than a "register" link */}
            <form className="hero-email-form" onSubmit={submitHeroEmail} noValidate>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                className="hero-email-input"
                placeholder={t.hero.emailPlaceholder}
                value={heroEmail}
                onChange={(e) => setHeroEmail(e.target.value)}
                aria-label="Email"
              />
              <button type="submit" className="btn-primary hero-email-btn">
                {t.hero.heroCta}
                <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </form>
            <p className="hero-microcopy">{t.hero.microcopy}</p>

            <div className="hero-btns hero-btns-secondary">
              <a href="#how" className="btn-outline">{t.hero.watchDemo}</a>
            </div>

            <div className="hero-trust">
              <div className="trust-item">
                <div className="trust-n">98%</div>
                <div className="trust-l">{t.hero.trust[0]}</div>
              </div>
              <div className="trust-item">
                <div className="trust-n">10&times;</div>
                <div className="trust-l">{t.hero.trust[1]}</div>
              </div>
              <div className="trust-item">
                <div className="trust-n">2 min</div>
                <div className="trust-l">{t.hero.trust[2]}</div>
              </div>
            </div>
          </div>
          <div className="hero-r">
            <div className="phone-wrap">
              <div className="chip c1">
                <div className="chip-v">94%</div>
                <div className="chip-l">{t.phone.chip[0]}</div>
              </div>
              <div className="chip c2">
                <div className="chip-v">22%</div>
                <div className="chip-l">{t.phone.chip[1]}</div>
              </div>
              <div className="chip c3">
                <div className="chip-v">185</div>
                <div className="chip-l">{t.phone.chip[2]}</div>
              </div>
              <div className="phone">
                <div className="notch"></div>
                <div className="ph">
                  <div className="ph-av">K</div>
                  <div>
                    <div className="ph-name">Karim &middot; Le Patio</div>
                    <div className="ph-online">{t.phone.online}</div>
                  </div>
                </div>
                <div className="msg msg-o">
                  <div className="mb">{t.phone.m1}</div>
                  <div className="mt"><span className="tick">&#10003;&#10003;</span> 09:41</div>
                </div>
                <div className="msg msg-i">
                  <div className="mb">{t.phone.m2}</div>
                  <div className="mt">09:43</div>
                </div>
                <div className="msg msg-o">
                  <div className="mb">{t.phone.m3}</div>
                  <div className="mt"><span className="tick">&#10003;&#10003;</span> 09:44</div>
                </div>
                <div className="msg msg-i">
                  <div className="mb">{t.phone.m4}</div>
                  <div className="mt">09:45</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TICKER */}
      <div className="ticker-wrap">
        <div className="ticker-inner">
          {t.ticker.map((text, i) => (
            <div className="ti" key={i}>
              <div className="td"></div>
              {text}
            </div>
          ))}
        </div>
      </div>

      {/* SOCIAL PROOF STRIP */}
      <section className="lp-proof-strip rv">
        <div className="inner">
          <div className="lp-proof-tag">
            <span className="lp-proof-pre">{t.socialProof.pre}</span>
            <strong>{t.socialProof.tagline}</strong>
          </div>
          <div className="lp-proof-counters">
            {t.socialProof.counters.map((c, i) => (
              <div key={i} className="lp-proof-counter">
                <div className="lp-proof-v">{c.v}</div>
                <div className="lp-proof-l">{c.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PROBLEM / SOLUTION */}
      <section className="sec" id="problem">
        <div className="inner">
          <div className="ps-grid rv">
            <div>
              <div className="lbl">{t.problem.lbl1}</div>
              <h2 className="disp">
                {t.problem.h2a}<br />
                {t.problem.h2MidGlue}<em>{t.problem.h2b}</em>
              </h2>
              <p className="body-t">{t.problem.body}</p>
              <ul className="ps-list">
                {t.problem.bad.map((line, i) => (
                  <li key={i}><div className="ix">&#10005;</div>{line}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="lbl">{t.problem.lbl2}</div>
              <h2 className="disp">
                {t.problem.fixH2a}<br />
                {lang === 'ar'
                  ? <em>{t.problem.fixH2b}</em>
                  : <><em>{t.problem.fixVerb}</em> {t.problem.fixTail}</>
                }
              </h2>
              <p className="body-t">{t.problem.fixBody}</p>
              <ul className="ps-list">
                {t.problem.good.map((line, i) => (
                  <li key={i}><div className="ick">&#10003;</div>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="sec shaded" id="how">
        <div className="inner">
          <div className="rv">
            <div className="lbl">{t.how.lbl}</div>
            <h2 className="disp">
              {t.how.h2a}<br />
              {t.how.h2bBefore} <em>{t.how.h2bEm}</em>
            </h2>
          </div>
          <div className="steps-g rv2">
            {t.how.steps.map((step, idx) => (
              <div className="step" key={idx}>
                <div className="sn">{String(idx + 1).padStart(2, '0')}</div>
                <div className="st">{step.t}</div>
                <div className="sd">{step.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* NUMBERS */}
      <section className="sec" id="numbers">
        <div className="inner">
          <div className="rv">
            <div className="lbl">{t.numbers.lbl}</div>
            <h2 className="disp">
              {t.numbers.h2a}<br />
              {lang === 'ar'
                ? <em>{t.numbers.h2bAr}</em>
                : <>{t.numbers.h2bThat} <em>{t.numbers.h2bEm}</em></>
              }
            </h2>
          </div>
          <div className="nums-g rv2" ref={numsRef}>
            <div className="num-big">
              <div className="nb-v" ref={ctrRef}>0%</div>
              <div className="nb-l">{t.numbers.nb}</div>
            </div>
            <div className="num-sm">
              <div className="ns-v">10<sup>&times;</sup></div>
              <div className="ns-l">{t.numbers.ns1}</div>
            </div>
            <div className="num-sm">
              <div className="ns-v">2<sup>min</sup></div>
              <div className="ns-l">{t.numbers.ns2}</div>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARISON TABLE */}
      <section className="sec lp-comp" id="compare">
        <div className="inner">
          <div className="rv">
            <div className="lbl">{t.comparison.lbl}</div>
            <h2 className="disp">
              {t.comparison.h2a}<br />
              <em>{t.comparison.h2b}</em>
            </h2>
          </div>
          <div className="lp-comp-card rv2">
            <table className="lp-comp-table">
              <thead>
                <tr>
                  {t.comparison.headers.map((h, i) => (
                    <th key={i} className={i === 3 ? 'lp-comp-win' : ''}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.comparison.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="lp-comp-metric">{r.metric}</td>
                    <td className="lp-comp-cell lp-comp-mute">{r.a}</td>
                    <td className="lp-comp-cell lp-comp-mute">{r.b}</td>
                    <td className="lp-comp-cell lp-comp-win">
                      {r.c}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="lp-comp-note">{t.comparison.footnote}</p>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="sec shaded" id="features">
        <div className="inner">
          <div className="rv">
            <div className="lbl">{t.features.lbl}</div>
            <h2 className="disp">
              {t.features.h2a}<br />
              {lang === 'ar'
                ? <em>{t.features.h2ar}</em>
                : <><em>{t.features.h2em}</em> {t.features.h2rest}</>
              }
            </h2>
          </div>
          <div className="feat-g rv2">
            <div className="fc">
              <div className="fi">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" stroke="#16a34a" strokeWidth="1.5" />
                  <path d="m21 21-4.35-4.35" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <div className="ft">{t.features.items[0].t}</div>
              <div className="fd">{t.features.items[0].d}</div>
            </div>
            <div className="fc">
              <div className="fi">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <path d="M9 12l2 2 4-4" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="12" cy="12" r="9" stroke="#16a34a" strokeWidth="1.5" />
                </svg>
              </div>
              <div className="ft">{t.features.items[1].t}</div>
              <div className="fd">{t.features.items[1].d}</div>
            </div>
            <div className="fc">
              <div className="fi">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#16a34a" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="ft">{t.features.items[2].t}</div>
              <div className="fd"><CampaignFeatureD text={t.features.items[2].d} /></div>
            </div>
            <div className="fc">
              <div className="fi">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <rect x="2" y="3" width="20" height="14" rx="2" stroke="#16a34a" strokeWidth="1.5" />
                  <path d="M8 21h8M12 17v4" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <div className="ft">{t.features.items[3].t}</div>
              <div className="fd">{t.features.items[3].d}</div>
              <div className="a-card">
                <div className="a-head">
                  <div className="a-title">{t.features.analyticsCard.title}</div>
                  <div className="a-score">A+</div>
                </div>
                <div className="a-ms">
                  <div>
                    <div className="aml">{t.features.analyticsCard.delivered}</div>
                    <div className="amv">94%</div>
                    <div className="abar"><div className="afill" style={{ width: '94%' }}></div></div>
                  </div>
                  <div>
                    <div className="aml">{t.features.analyticsCard.read}</div>
                    <div className="amv">78%</div>
                    <div className="abar"><div className="afill" style={{ width: '78%' }}></div></div>
                  </div>
                  <div>
                    <div className="aml">{t.features.analyticsCard.replied}</div>
                    <div className="amv">22%</div>
                    <div className="abar"><div className="afill" style={{ width: '22%' }}></div></div>
                  </div>
                  <div>
                    <div className="aml">{t.features.analyticsCard.optouts}</div>
                    <div className="amv">0.4%</div>
                    <div className="abar"><div className="afill" style={{ width: '0.4%' }}></div></div>
                  </div>
                </div>
                <div className="atags">
                  <span className="atag">{t.features.analyticsCard.tags[0]}</span>
                  <span className="atag">{t.features.analyticsCard.tags[1]}</span>
                  <span className="atag">{t.features.analyticsCard.tags[2]}</span>
                </div>
              </div>
            </div>
            <div className="fc">
              <div className="fi">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="9" cy="7" r="4" stroke="#16a34a" strokeWidth="1.5" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <div className="ft">{t.features.items[4].t}</div>
              <div className="fd">{t.features.items[4].d}</div>
            </div>
            <div className="fc">
              <div className="fi">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#16a34a" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="ft">{t.features.items[5].t}</div>
              <div className="fd">{t.features.items[5].d}</div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="sec" id="pricing">
        <div className="inner">
          <div className="pricing-shell">
            <div className="pricing-header">
              <div className="pricing-eyebrow">{t.pricing.lbl}</div>
              <h2 className="pricing-title">
                {t.pricing.h2a}<br />
                <span>{t.pricing.h2em}</span> {t.pricing.h2rest}
              </h2>
              <p className="pricing-subtitle">{t.pricing.monthlyPlansNote}</p>
            </div>
            <div className="lp-guarantee" aria-label={t.guarantee.title}>
              <div className="lp-guarantee-title">{t.guarantee.title}</div>
              <ul className="lp-guarantee-list">
                {t.guarantee.points.map((p, i) => (
                  <li key={i}>
                    <span className="lp-guarantee-tick" aria-hidden>
                      <svg viewBox="0 0 12 9" width="11" height="9">
                        <polyline points="1 4.5 4.5 8 11 1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="pricing-grid">
              {plansToRender.map((plan) => {
                const code = plan.code || plan.id;
                const isPopular = code === 'pro';
                const isFree    = code === 'free_trial';
                const isCustom  = !!plan.isCustom || code === 'enterprise';

                let ctaTo, ctaLabel;
                if (isFree) {
                  ctaTo    = '/register';
                  ctaLabel = t.pricing.ctaFree;
                } else if (isCustom) {
                  ctaTo    = `/wallet?plan=${encodeURIComponent(code)}`;
                  ctaLabel = 'Contact us';
                } else {
                  ctaTo    = `/wallet?plan=${encodeURIComponent(code)}`;
                  ctaLabel = `Get ${plan.label}`;
                }

                return (
                  <div key={code} className={`plan-card${isPopular ? ' popular' : ''}`}>
                    {isPopular && <span className="popular-badge">{t.pricing.tierPopular}</span>}
                    <div className="plan-name">{plan.label}</div>
                    <p className="plan-tagline">{plan.blurb}</p>
                    {isCustom ? (
                      <>
                        <div className="plan-price">
                          <span className="price-amount">Custom</span>
                        </div>
                        <div className="price-period">contact us</div>
                        <div className="price-usd">tailored credit pack</div>
                      </>
                    ) : (
                      <>
                        <div className="plan-price">
                          <span className="price-currency">TND</span>
                          <span className="price-amount">{plan.priceTnd}</span>
                        </div>
                        <div className="price-period">
                          {plan.oneTime ? 'one-time' : `for ${plan.credits?.toLocaleString?.() || plan.credits} credits`}
                        </div>
                        <div className="price-usd">≈ ${plan.priceUsd} USD</div>
                      </>
                    )}
                    <div className="plan-divider"></div>
                    <ul className="plan-features">
                      {(plan.features || []).map((f, i) => (
                        <li key={i}>
                          <span className="check">
                            <svg className="check-icon" viewBox="0 0 9 7" aria-hidden>
                              <polyline points="1 3.5 3.5 6 8 1" />
                            </svg>
                          </span>
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Link
                      to={ctaTo}
                      className={`plan-cta${isPopular ? ' plan-cta-primary' : ' plan-cta-outline'}`}
                    >
                      {ctaLabel}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="sec shaded">
        <div className="inner">
          <div className="rv">
            <div className="lbl">{t.proof.lbl}</div>
            <h2 className="disp">
              {t.proof.h2a}<br />
              {lang === 'ar'
                ? <>{t.proof.h2arPrefix}<em>{t.proof.h2arEm}</em>.</>
                : <><em>{t.proof.h2em}</em> {t.proof.h2rest}</>
              }
            </h2>
          </div>
          <div className="proof-g rv2">
            <div className="proof">
              <div className="proof-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
              <div className="proof-q">&ldquo;{t.proof.q1}&rdquo;</div>
              <div className="proof-auth">
                <div className="proof-av">S</div>
                <div>
                  <div className="proof-name">Sami Mhenni</div>
                  <div className="proof-role">{t.proof.role1}</div>
                </div>
              </div>
            </div>
            <div className="proof">
              <div className="proof-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
              <div className="proof-q">&ldquo;{t.proof.q2}&rdquo;</div>
              <div className="proof-auth">
                <div className="proof-av">L</div>
                <div>
                  <div className="proof-name">Leila Bouaziz</div>
                  <div className="proof-role">{t.proof.role2}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="sec lp-faq" id="faq">
        <div className="inner lp-faq-inner">
          <div className="rv">
            <div className="lbl">{t.faq.lbl}</div>
            <h2 className="disp">{t.faq.h2}</h2>
          </div>
          <div className="lp-faq-list rv2">
            {t.faq.items.map((it, i) => (
              <details key={i} className="lp-faq-item">
                <summary className="lp-faq-q">
                  <span>{it.q}</span>
                  <span className="lp-faq-icon" aria-hidden>+</span>
                </summary>
                <div className="lp-faq-a">{it.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <div style={{ position: 'relative', zIndex: 1, padding: '80px 0 0' }}>
        <div className="cta-wrap rv">
          <div className="lbl" style={{ justifyContent: 'center', color: 'rgba(255,255,255,.6)', marginBottom: 28 }}>
            <span style={{ background: 'rgba(255,255,255,.2)' }}></span>
            {t.cta.lbl}
          </div>
          <h2>
            {lang === 'ar'
              ? <>{t.cta.h2a}<br />{t.cta.h2rest}</>
              : <>{t.cta.h2a} <em>{t.cta.h2em}</em><br />{t.cta.h2rest}</>
            }
          </h2>
          <p>{t.cta.p}</p>
          <Link to="/register" className="btn-white">
            {t.cta.btn}
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <div className="cta-note">{t.cta.note}</div>
        </div>
      </div>

      {/* FOOTER */}
      <div className="lfoot">
        <div className="foot-logo">
          <WhispFlowWfMark height={28} />
        </div>
        <div className="foot-links">
          <a href="#">{t.footer.privacy}</a>
          <a href="#">{t.footer.terms}</a>
          <a href="#">{t.footer.contact}</a>
        </div>
        <div className="foot-copy">{t.footer.copy}</div>
      </div>
    </div>
  );
}
