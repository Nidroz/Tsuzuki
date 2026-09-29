// case tables for layers.test.mjs on network access: routes, features and UI components have no
// direct network access, and only the jikan adapter reaches the catalog provider (CONTRIBUTING.md
// section 4)

import { EXISTING, PROBES } from './layers-harness.mjs';
import { IMPORTS, MESSAGES, SYNTAX, allowed, dynamics, rejected, values } from './layers-cases.mjs';

const GLOBALS = 'no-restricted-globals';
const PROPERTIES = 'no-restricted-properties';

// assembled at runtime: a literal would trip the jikan guard on this file itself
const JIKAN_URL = `https://api.${['jikan', 'moe'].join('.')}/v4`;

// probes are [label, code] pairs
const NETWORK_CALLS = {
  fetch: ['fetch()', "export const load = () => fetch('https://example.com');\n"],
  globalFetch: ['globalThis.fetch()', "export const load = () => globalThis.fetch('/x');\n"],
  xhr: ['new XMLHttpRequest()', 'export const request = new XMLHttpRequest();\n'],
  webSocket: ['new WebSocket()', "export const socket = new WebSocket('wss://example.com');\n"],
  eventSource: [
    'new EventSource()',
    "export const source = new EventSource('https://example.com');\n",
  ],
  globalEventSource: [
    'new globalThis.EventSource()',
    "export const source = new globalThis.EventSource('/x');\n",
  ],
  windowEventSource: [
    'new window.EventSource()',
    "export const source = new window.EventSource('/x');\n",
  ],
};
const EVENT_SOURCE_CALLS = [
  NETWORK_CALLS.eventSource,
  NETWORK_CALLS.globalEventSource,
  NETWORK_CALLS.windowEventSource,
];

const JIKAN_PROBES = [
  ['jikan url string', `export const url = '${JIKAN_URL}';\n`],
  ['jikan url template', `export const url = (id: number) => \`${JIKAN_URL}/\${String(id)}\`;\n`],
];

const SCREEN_FILES = [EXISTING.index, PROBES.features, PROBES.ui];

export const REJECTED = {
  network: [
    ...rejected(SCREEN_FILES, IMPORTS, MESSAGES.network, values('expo/fetch')),
    ...rejected(SCREEN_FILES, SYNTAX, MESSAGES.network, dynamics('expo/fetch')),
    ...rejected(
      SCREEN_FILES,
      IMPORTS,
      MESSAGES.expoInternals,
      values('expo/src/winter/fetch', 'expo/build/winter/fetch'),
    ),
    ...rejected(SCREEN_FILES, GLOBALS, MESSAGES.network, [
      NETWORK_CALLS.fetch,
      NETWORK_CALLS.xhr,
      NETWORK_CALLS.webSocket,
      NETWORK_CALLS.eventSource,
    ]),
    ...rejected(SCREEN_FILES, PROPERTIES, MESSAGES.network, [
      NETWORK_CALLS.globalFetch,
      NETWORK_CALLS.globalEventSource,
      NETWORK_CALLS.windowEventSource,
    ]),
  ],

  'jikan guard': [
    ...rejected(
      [
        PROBES.core,
        PROBES.supabase,
        PROBES.features,
        PROBES.ui,
        PROBES.platform,
        EXISTING.index,
        PROBES.srcRoot,
        PROBES.srcOther,
      ],
      SYNTAX,
      MESSAGES.jikan,
      JIKAN_PROBES,
    ),
    ...rejected(PROBES.features, SYNTAX, MESSAGES.jikan, [
      ['uppercase jikan url', `export const url = '${JIKAN_URL.toUpperCase()}';\n`],
    ]),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  network: [
    ...allowed(PROBES.core, Object.values(NETWORK_CALLS)),
    ...allowed(PROBES.platform, [...Object.values(NETWORK_CALLS), ...values('expo/fetch')]),
    ...allowed(PROBES.supabase, EVENT_SOURCE_CALLS),
  ],
  'jikan guard': allowed(PROBES.jikan, JIKAN_PROBES),
};
