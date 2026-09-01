// Lint config aimed at one specific failure: a reference that does not exist.
//
// Three times in this project an edit landed a component that used an
// identifier it never imported. The build stayed green, because an undefined
// reference in a client component is a runtime error, not a compile error, and
// it surfaced only as a blank page with a console exception. no-undef catches
// that class before it ships.
const browser = {
  window: "readonly", document: "readonly", navigator: "readonly",
  location: "readonly", history: "readonly", console: "readonly",
  fetch: "readonly", Response: "readonly", Request: "readonly",
  Headers: "readonly", FormData: "readonly", Blob: "readonly", File: "readonly",
  URL: "readonly", URLSearchParams: "readonly", AbortController: "readonly",
  setTimeout: "readonly", clearTimeout: "readonly",
  setInterval: "readonly", clearInterval: "readonly",
  queueMicrotask: "readonly", structuredClone: "readonly",
  localStorage: "readonly", sessionStorage: "readonly", indexedDB: "readonly",
  IDBKeyRange: "readonly", crypto: "readonly", atob: "readonly", btoa: "readonly",
  TextEncoder: "readonly", TextDecoder: "readonly",
  Event: "readonly", CustomEvent: "readonly", EventTarget: "readonly",
  KeyboardEvent: "readonly", MouseEvent: "readonly",
  Element: "readonly", HTMLElement: "readonly", Node: "readonly",
  IntersectionObserver: "readonly", ResizeObserver: "readonly", MutationObserver: "readonly",
  requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
  alert: "readonly", confirm: "readonly", prompt: "readonly",
  matchMedia: "readonly", getComputedStyle: "readonly",
  performance: "readonly", clearImmediate: "readonly",
  ReadableStream: "readonly", WritableStream: "readonly",
  TransformStream: "readonly", MessageChannel: "readonly",
  BroadcastChannel: "readonly", WebSocket: "readonly", Image: "readonly",
};

const node = {
  process: "readonly", Buffer: "readonly", global: "readonly",
  __dirname: "readonly", __filename: "readonly",
  require: "readonly", module: "writable", exports: "writable",
  setImmediate: "readonly", AbortSignal: "readonly",
};

const vitest = {
  describe: "readonly", it: "readonly", test: "readonly", expect: "readonly",
  vi: "readonly", beforeEach: "readonly", afterEach: "readonly",
  beforeAll: "readonly", afterAll: "readonly",
};

export default [
  {
    ignores: [
      "node_modules/**", ".next/**", "out/**", "build/**",
      "drizzle/**", "next-env.d.ts",
    ],
  },
  {
    files: ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...browser, ...node, ...vitest },
    },
    // The stubbed rules never report, so their disable comments always look
    // unused. That is an artifact of not installing the plugins, not a finding.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    // These rules live in the Next and react-hooks plugins, which are not
    // installed. Registering the names as no-ops keeps the existing
    // eslint-disable comments resolvable instead of erroring on every file.
    plugins: {
      "@next/next": { rules: { "no-img-element": { create: () => ({}) } } },
      "react-hooks": { rules: { "exhaustive-deps": { create: () => ({}) } } },
    },
    rules: {
      "no-undef": "error",
      // Catches an import that was added but never wired up, and a component
      // defined but never rendered - the exact shape of the invite bug.
      "no-unused-vars": ["error", {
        args: "none",
        varsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
      "no-self-compare": "error",
      "no-unsafe-negation": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },
];
