// case tables for layers.test.mjs on network access: routes, features and UI components have no
// direct network access, and only the jikan adapter names the hosts of the catalog provider
// instances (CONTRIBUTING.md section 4)

import { EXISTING, PROBES } from './layers-harness.mjs';
import { IMPORTS, MESSAGES, SYNTAX, allowed, dynamics, rejected, values } from './layers-cases.mjs';

const GLOBALS = 'no-restricted-globals';
const PROPERTIES = 'no-restricted-properties';

// assembled at runtime: a literal would trip the catalog host guard on this file itself
const JIKAN_URL = `https://api.${['jikan', 'moe'].join('.')}/v4`;
const TENRAI_URL = `https://api.${['tenrai', 'org'].join('.')}/v1`;

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

// a url on the host, as a string and as a template
const hostProbes = (host, url) => [
  [`${host} url string`, `export const url = '${url}';\n`],
  [`${host} url template`, `export const url = (id: number) => \`${url}/\${String(id)}\`;\n`],
];
const JIKAN_PROBES = hostProbes('jikan', JIKAN_URL);
const TENRAI_PROBES = hostProbes('tenrai', TENRAI_URL);

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

  'catalog host guard': [
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
      MESSAGES.catalogHost,
      JIKAN_PROBES,
    ),
    // the default instance, in a feature, a core root file and a core test
    ...rejected(
      [PROBES.features, PROBES.core, PROBES.coreTest],
      SYNTAX,
      MESSAGES.catalogHost,
      TENRAI_PROBES,
    ),
    ...rejected(PROBES.features, SYNTAX, MESSAGES.catalogHost, [
      ['uppercase jikan url', `export const url = '${JIKAN_URL.toUpperCase()}';\n`],
      ['uppercase tenrai url', `export const url = '${TENRAI_URL.toUpperCase()}';\n`],
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
  'catalog host guard': allowed(PROBES.jikan, [...JIKAN_PROBES, ...TENRAI_PROBES]),
};
