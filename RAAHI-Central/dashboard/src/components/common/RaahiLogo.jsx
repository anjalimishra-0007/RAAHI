import React from 'react';

/**
 * RaahiLogo — Futuristic Municipal Technology Brand Mark
 * 
 * Scalable, theme-reactive RAAHI brand logo with frosted glass squircle housing
 * and dynamic spectral glow. Adapts instantly to Tactical Dark, OLED Dark, and
 * Light Console themes via CSS custom properties without requiring page reloads.
 *
 * @param {Object} props
 * @param {'xs'|'sm'|'md'|'lg'|'xl'} [props.size='md'] - Visual size tier
 * @param {string} [props.className] - Additional CSS class names
 * @param {boolean} [props.showText=false] - Whether to render brand typography
 * @param {boolean} [props.animated=true] - Whether to enable subtle micro-interactions
 * @param {string} [props.title] - Accessible title for brand mark
 */
export default function RaahiLogo({
  size = 'md',
  className = '',
  showText = false,
  animated = true,
  title = 'RAAHI Central Command',
  style = {}
}) {
  const sizeClass = `raahi-logo-${size}`;

  return (
    <div
      className={`raahi-logo-container ${sizeClass} ${animated ? 'raahi-logo-interactive' : ''} ${className}`}
      style={style}
      role="img"
      aria-label={title}
      title={title}
    >
      {/* 1. Dynamic Theme-Reactive Ambient Glow Layer (CSS custom properties) */}
      <div className="raahi-logo-glow" aria-hidden="true" />

      {/* 2. Frosted Glass Squircle Frame with Refraction and Specular Highlight */}
      <div className="raahi-logo-glass">
        <div className="raahi-logo-sheen" aria-hidden="true" />

        {/* 3. Scalable Vector Brand Mark (Dual Luminous Glass Fins) */}
        <svg
          className="raahi-logo-mark"
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            {/* Left Fin: Violet to Cyan Luminous Core */}
            <linearGradient id="raahiLeftGrad" x1="18%" y1="82%" x2="56%" y2="20%">
              <stop offset="0%" stopColor="#b052ff" />
              <stop offset="35%" stopColor="#8b5cf6" />
              <stop offset="70%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#38bdf8" />
            </linearGradient>

            {/* Left Fin: Specular Glass Refraction Sheen */}
            <linearGradient id="raahiLeftSheen" x1="25%" y1="75%" x2="52%" y2="25%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="45%" stopColor="#ffffff" stopOpacity="0.35" />
              <stop offset="75%" stopColor="#ffffff" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.95" />
            </linearGradient>

            {/* Right Fin: Deep Cyan to Aquamarine/Mint Luminous Core */}
            <linearGradient id="raahiRightGrad" x1="55%" y1="85%" x2="70%" y2="18%">
              <stop offset="0%" stopColor="#0284c7" />
              <stop offset="30%" stopColor="#06b6d4" />
              <stop offset="70%" stopColor="#00f5c4" />
              <stop offset="100%" stopColor="#3ee2a2" />
            </linearGradient>

            {/* Right Fin: Specular Glass Refraction Sheen */}
            <linearGradient id="raahiRightSheen" x1="56%" y1="75%" x2="68%" y2="20%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="50%" stopColor="#ffffff" stopOpacity="0.35" />
              <stop offset="85%" stopColor="#ffffff" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.95" />
            </linearGradient>

            {/* Left Fin: Rim Light Neon Edge */}
            <linearGradient id="raahiLeftRim" x1="15%" y1="80%" x2="55%" y2="20%">
              <stop offset="0%" stopColor="#f0abfc" stopOpacity="0.9" />
              <stop offset="50%" stopColor="#c4b5fd" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#bae6fd" stopOpacity="0.95" />
            </linearGradient>

            {/* Right Fin: Rim Light Neon Edge */}
            <linearGradient id="raahiRightRim" x1="55%" y1="85%" x2="72%" y2="18%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.9" />
              <stop offset="50%" stopColor="#67e8f9" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#a7f3d0" stopOpacity="0.95" />
            </linearGradient>

            {/* Floor Ambiance Surface Reflections */}
            <radialGradient id="raahiFloorLeft" cx="28%" cy="85%" r="28%">
              <stop offset="0%" stopColor="#c084fc" stopOpacity="0.5" />
              <stop offset="55%" stopColor="#9333ea" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#9333ea" stopOpacity="0" />
            </radialGradient>

            <radialGradient id="raahiFloorRight" cx="72%" cy="85%" r="28%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.5" />
              <stop offset="55%" stopColor="#0891b2" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#0891b2" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Dynamic Floor Reflections */}
          <ellipse cx="28" cy="85" rx="14" ry="3.5" fill="url(#raahiFloorLeft)" />
          <ellipse cx="72" cy="85" rx="16" ry="3.5" fill="url(#raahiFloorRight)" />

          {/* Left Fin: Luminous Glass Petal */}
          <path
            d="M 51.75 23.21 Q 51.75 23.21, 52.91 22.37 Q 54.07 21.53, 55.22 21.21 Q 56.38 20.89, 56.78 21.05 Q 57.18 21.21, 57.46 21.57 Q 57.74 21.93, 57.70 23.09 Q 57.66 24.24, 52.75 35.29 Q 47.85 46.33, 43.70 57.78 Q 39.55 69.22, 38.84 70.69 Q 38.12 72.17, 37.48 73.05 Q 36.84 73.92, 36.00 74.68 Q 35.17 75.44, 33.89 76.12 Q 32.62 76.79, 31.62 77.07 Q 30.62 77.35, 24.52 77.39 Q 18.42 77.43, 17.94 77.19 Q 17.46 76.95, 16.95 76.52 Q 16.43 76.08, 15.99 75.24 Q 15.55 74.40, 15.47 73.48 Q 15.39 72.57, 15.51 71.93 Q 15.63 71.29, 16.87 68.62 Q 18.10 65.95, 21.05 61.00 Q 24.00 56.06, 27.15 51.48 Q 30.30 46.89, 34.17 41.95 Q 38.04 37.00, 40.79 33.93 Q 43.54 30.86, 47.65 27.03 Z"
            fill="url(#raahiLeftGrad)"
            stroke="url(#raahiLeftRim)"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />

          {/* Left Fin: Specular Highlight */}
          <path
            d="M 52.5 24.0 Q 44.0 42.0, 37.5 58.0 Q 34.0 66.0, 31.0 73.0 Q 26.0 74.0, 20.0 73.5 Q 18.5 70.0, 21.5 63.5 Q 26.5 53.0, 33.5 44.0 Q 42.5 32.5, 48.5 26.0 Z"
            fill="url(#raahiLeftSheen)"
            opacity="0.65"
          />

          {/* Right Fin: Luminous Glass Wing */}
          <path
            d="M 69.14 18.34 Q 69.14 18.34, 69.82 18.54 Q 70.49 18.74, 70.77 19.26 Q 71.05 19.78, 71.05 20.77 Q 71.05 21.77, 70.57 25.28 Q 70.10 28.79, 69.98 31.94 Q 69.86 35.09, 70.02 37.20 Q 70.18 39.31, 70.65 41.83 Q 71.13 44.34, 71.97 46.89 Q 72.81 49.44, 74.00 52.07 Q 75.20 54.70, 77.15 58.01 Q 79.11 61.32, 81.50 64.83 Q 83.89 68.34, 84.85 70.14 Q 85.81 71.93, 86.04 72.97 Q 86.28 74.00, 86.20 74.56 Q 86.12 75.12, 85.81 75.76 Q 85.49 76.40, 84.81 76.91 Q 84.13 77.43, 74.60 77.43 Q 65.07 77.43, 64.07 77.15 Q 63.08 76.87, 61.68 75.88 Q 60.29 74.88, 59.01 73.29 Q 57.74 71.69, 56.66 69.66 Q 55.58 67.62, 55.22 66.27 Q 54.86 64.91, 54.74 64.91 Q 54.63 64.91, 54.55 64.23 Q 54.47 63.56, 54.35 63.60 Q 54.23 63.64, 54.27 63.28 Q 54.31 62.92, 54.07 62.52 Q 53.83 62.12, 53.91 61.96 Q 53.99 61.80, 53.75 60.65 Q 53.51 59.49, 53.43 59.65 Q 53.35 59.81, 53.31 59.65 Q 53.27 59.49, 53.19 58.33 Q 53.11 57.18, 53.03 57.34 Q 52.95 57.50, 52.91 57.30 Q 52.87 57.10, 52.79 53.15 Q 52.71 49.20, 52.95 46.53 Q 53.19 43.86, 54.27 39.87 Q 55.34 35.89, 56.82 32.89 Q 58.29 29.90, 60.57 26.63 Q 62.84 23.37, 64.67 21.49 Q 66.51 19.62, 67.82 18.98 Z"
            fill="url(#raahiRightGrad)"
            stroke="url(#raahiRightRim)"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />

          {/* Right Fin: Specular Highlight */}
          <path
            d="M 69.5 21.0 Q 69.0 32.0, 70.0 42.0 Q 72.0 51.0, 77.0 61.0 Q 82.0 68.0, 83.5 72.0 Q 80.0 73.0, 74.0 73.0 Q 66.0 71.0, 62.0 66.0 Q 57.5 58.0, 56.5 48.0 Q 57.5 35.0, 64.0 25.0 Z"
            fill="url(#raahiRightSheen)"
            opacity="0.65"
          />
        </svg>
      </div>

      {showText && (
        <div className="raahi-logo-text">
          <h1 className="raahi-logo-title">RAAHI</h1>
          <p className="raahi-logo-subtitle">Safer Roads. Brighter Journeys.</p>
        </div>
      )}
    </div>
  );
}
