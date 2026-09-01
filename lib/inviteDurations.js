// Invite lifetimes, kept free of server-only code.
//
// lib/invites.js imports node:crypto for token generation and hashing, so a
// client component importing it would pull a Node builtin into the browser
// bundle. Anything the UI needs lives here instead.
export const INVITE_DURATIONS = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
];

export const DEFAULT_INVITE_HOURS = 24;
