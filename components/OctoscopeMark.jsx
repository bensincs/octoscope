"use client";
// Octoscope brand mark: a friendly inspector robot — a cat-eared android head
// with a sensor antenna and glowing scanner eyes that keep watch over your
// GitHub repos, issues and projects. The head uses currentColor so it adapts to
// the theme; the antenna, eyes and grille use a fixed cyan→blue→purple gradient
// so they read as a HUD in both light and dark modes.
//
// Pass sizing via className (e.g. "h-7 w-7"). `title` sets the accessible name.
import { useId } from "react";

export default function OctoscopeMark({ className = "h-7 w-7", title = "Octoscope" }) {
  // SSR-safe, collision-free gradient id (stable across server/client render).
  const id = `octoscope-bot-${useId()}`;
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5ad7ff" />
          <stop offset="55%" stopColor="#1f6feb" />
          <stop offset="100%" stopColor="#8957e5" />
        </linearGradient>
      </defs>

      {/* Cat ears + head */}
      <g fill="currentColor">
        <path d="M5.7 5.2 4.4 2.5 7.2 4.2 Z" />
        <path d="M10.3 5.2 11.6 2.5 8.8 4.2 Z" />
        <rect x="3.1" y="4.4" width="9.8" height="8.4" rx="2.6" />
      </g>

      {/* Sensor antenna */}
      <line x1="8" y1="4.4" x2="8" y2="2.3" stroke={`url(#${id})`} strokeWidth="0.6" strokeLinecap="round" />
      <circle cx="8" cy="1.9" r="0.95" fill={`url(#${id})`} />

      {/* Side bolts */}
      <circle cx="3.1" cy="8.6" r="0.7" fill={`url(#${id})`} />
      <circle cx="12.9" cy="8.6" r="0.7" fill={`url(#${id})`} />

      {/* Scanner eyes with bright catch-light */}
      <rect x="4.9" y="7" width="2.3" height="1.9" rx="0.85" fill={`url(#${id})`} />
      <rect x="8.8" y="7" width="2.3" height="1.9" rx="0.85" fill={`url(#${id})`} />
      <circle cx="5.7" cy="7.7" r="0.38" fill="#d6f5ff" fillOpacity="0.95" />
      <circle cx="9.6" cy="7.7" r="0.38" fill="#d6f5ff" fillOpacity="0.95" />

      {/* Grille mouth */}
      <g stroke={`url(#${id})`} strokeWidth="0.62" strokeLinecap="round" strokeOpacity="0.85">
        <line x1="6.7" y1="10.2" x2="6.7" y2="11.2" />
        <line x1="8" y1="10.1" x2="8" y2="11.3" />
        <line x1="9.3" y1="10.2" x2="9.3" y2="11.2" />
      </g>
    </svg>
  );
}
