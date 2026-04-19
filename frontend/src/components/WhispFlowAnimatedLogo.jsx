import { useId } from 'react';
import { motion } from 'motion/react';

const transition = {
  duration: 7,
  repeat: Infinity,
  ease: 'easeInOut',
  times: [0, 0.2, 0.35, 0.65, 0.8, 1],
};

export function WhispFlowAnimatedLogo({ className, scale = 1, surface = 'dark' }) {
  const uid = useId().replace(/:/g, '');
  const gW = `wf-grad-${uid}`;
  const gF = `wf-grad-f-${uid}`;

  const textColor = surface === 'dark' ? '#ffffff' : '#18181b';

  return (
    <div
      dir="ltr"
      lang="en"
      style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', direction: 'ltr' }}
      aria-hidden
    >
      <div
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `skewX(-12deg) scale(${scale})`,
        }}
      >
        <svg width="76" height="60" viewBox="0 0 76 60" fill="none" style={{ flexShrink: 0, filter: 'drop-shadow(0 0 8px rgba(34,197,94,0.4))' }}>
          <defs>
            <linearGradient id={gW} x1="0" y1="0" x2="76" y2="60" gradientUnits="userSpaceOnUse">
              <stop stopColor="#22c55e" />
              <stop offset="1" stopColor="#15803d" />
            </linearGradient>
          </defs>
          <motion.path
            d="M 10 4 L 25 56 L 40 20 L 55 56 L 70 4"
            stroke={`url(#${gW})`}
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={{ pathLength: [0, 1, 1, 1, 1, 0] }}
            transition={transition}
          />
        </svg>

        <motion.div
          style={{ overflow: 'hidden', display: 'flex', flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}
          animate={{ width: ['0px', '0px', '170px', '170px', '0px', '0px'], opacity: [0, 0, 1, 1, 0, 0] }}
          transition={transition}
        >
          <div style={{ paddingRight: 4, paddingLeft: 4, width: 'max-content' }}>
            <span
              style={{
                fontSize: 80,
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: '-0.05em',
                display: 'block',
                transform: 'translateY(-4px)',
                color: textColor,
              }}
              lang="en"
              dir="ltr"
            >
              hisp
            </span>
          </div>
        </motion.div>

        <svg width="50" height="60" viewBox="0 0 50 60" fill="none" style={{ flexShrink: 0, filter: 'drop-shadow(0 0 8px rgba(34,197,94,0.4))' }}>
          <defs>
            <linearGradient id={gF} x1="0" y1="0" x2="50" y2="60" gradientUnits="userSpaceOnUse">
              <stop stopColor="#22c55e" />
              <stop offset="1" stopColor="#15803d" />
            </linearGradient>
          </defs>
          <motion.path
            d="M 10 56 L 10 4 L 45 4 M 10 30 L 35 30"
            stroke={`url(#${gF})`}
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={{ pathLength: [0, 1, 1, 1, 1, 0] }}
            transition={transition}
          />
        </svg>

        <motion.div
          style={{ overflow: 'hidden', display: 'flex', flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}
          animate={{ width: ['0px', '0px', '140px', '140px', '0px', '0px'], opacity: [0, 0, 1, 1, 0, 0] }}
          transition={transition}
        >
          <div style={{ paddingRight: 8, paddingLeft: 4, width: 'max-content' }}>
            <span
              style={{
                fontSize: 80,
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: '-0.05em',
                display: 'block',
                transform: 'translateY(-4px)',
                color: textColor,
              }}
              lang="en"
              dir="ltr"
            >
              low
            </span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
