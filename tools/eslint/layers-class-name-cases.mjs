// case tables for layers.test.mjs on styling: className props are used only inside src/ui, the
// only layer allowed to use NativeWind (CONTRIBUTING.md section 4)

import { EXISTING, PROBES } from './layers-harness.mjs';
import { MESSAGES, SYNTAX, allowed, rejected } from './layers-cases.mjs';

// a local component keeps the probes free of imports that other layer rules would report
const BOX = 'declare const Box: (props: object) => null;\n';

// probes are [label, code] pairs
const JSX_PROPS = [
  ['JSX className', `${BOX}export const Probe = () => <Box className="p-4" />;\n`],
  [
    'JSX contentContainerClassName',
    `${BOX}export const Probe = () => <Box contentContainerClassName="p-4" />;\n`,
  ],
];
const OBJECT_KEY = ['{ className } key', "export const props = { className: 'p-4' };\n"];
const OBJECT_KEYS = [
  OBJECT_KEY,
  [
    '{ contentContainerClassName } key',
    "export const props = { contentContainerClassName: 'p-4' };\n",
  ],
  ["{ 'className' } string key", "export const props = { 'className': 'p-4' };\n"],
];
// a computed key written as a literal names the prop as surely as a plain key
const COMPUTED_JSX_PROPS = [
  [
    'JSX spread { [`className`] } key',
    `${BOX}export const Probe = () => <Box {...{ [\`className\`]: 'p-4' }} />;\n`,
  ],
];
const COMPUTED_KEYS = [
  [
    '{ [`contentContainerClassName`] } template key',
    "export const props = { [`contentContainerClassName`]: 'p-4' };\n",
  ],
  ["{ ['className'] } string key", "export const props = { ['className']: 'p-4' };\n"],
];
// the word as data is not a styling prop
const CLASS_NAME_VALUES = [
  ["'className' as a value", "export const prop = 'className';\n"],
  ["'className' as a property value", "export const label = { name: 'className' };\n"],
  ['`className` as a template value', 'export const prop = `className`;\n'],
];
// node-only tooling and root tool configs: NativeWind never runs there, yet they get the guard too
const TOOLING_MODULES = [PROBES.tools, PROBES.toolsTest, PROBES.rootConfig];

const COMPONENTS_OUTSIDE_UI = [
  PROBES.featuresComponent,
  PROBES.hooksComponent,
  PROBES.platformComponent,
  PROBES.testMobileComponent,
  EXISTING.index,
  PROBES.nestedLayout,
];
const MODULES_OUTSIDE_UI = [
  PROBES.features,
  PROBES.hooks,
  PROBES.platform,
  PROBES.layoutTs,
  PROBES.coreTestSource,
];

export const REJECTED = {
  'className outside src/ui': [
    ...rejected(COMPONENTS_OUTSIDE_UI, SYNTAX, MESSAGES.classNameGuard, JSX_PROPS),
    ...rejected(MODULES_OUTSIDE_UI, SYNTAX, MESSAGES.classNameGuard, [OBJECT_KEY]),
    ...rejected(PROBES.features, SYNTAX, MESSAGES.classNameGuard, OBJECT_KEYS.slice(1)),
    ...rejected(PROBES.featuresComponent, SYNTAX, MESSAGES.classNameGuard, COMPUTED_JSX_PROPS),
    ...rejected(PROBES.features, SYNTAX, MESSAGES.classNameGuard, COMPUTED_KEYS),
    ...rejected(TOOLING_MODULES, SYNTAX, MESSAGES.classNameGuard, [OBJECT_KEY]),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'className outside src/ui': [
    ...allowed(PROBES.uiComponent, JSX_PROPS),
    ...allowed(PROBES.uiComponent, COMPUTED_JSX_PROPS),
    ...allowed(PROBES.ui, [...OBJECT_KEYS, ...COMPUTED_KEYS]),
    ...allowed(
      [
        PROBES.features,
        PROBES.hooks,
        PROBES.platform,
        PROBES.featuresComponent,
        EXISTING.index,
        ...TOOLING_MODULES,
      ],
      CLASS_NAME_VALUES,
    ),
  ],
};
