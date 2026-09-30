// case tables for layers.test.mjs on direct styling: routes (app/) and features (src/features/)
// never use StyleSheet or style props, they compose src/ui components, which own the styling

import { EXISTING, PROBES } from './layers-harness.mjs';
import { MESSAGES, SYNTAX, allowed, rejected } from './layers-cases.mjs';

// local declarations keep the probes free of imports that other layer rules would report
const BOX = 'declare const Box: (props: object) => null;\n';
const STYLE_SHEET = 'declare const StyleSheet: { create: (styles: object) => object };\n';

// probes are [label, code] pairs
const STYLE_SHEET_IMPORTS = [
  [
    "import { StyleSheet } from 'react-native'",
    "import { StyleSheet } from 'react-native';\nexport const probe = StyleSheet;\n",
  ],
  [
    "import { StyleSheet as S } from 'react-native'",
    "import { StyleSheet as S } from 'react-native';\nexport const probe = S;\n",
  ],
  [
    "import { View, StyleSheet } from 'react-native'",
    "import { View, StyleSheet } from 'react-native';\nexport const probe = [View, StyleSheet];\n",
  ],
];
const STYLE_SHEET_MEMBERS = [
  [
    'RN.StyleSheet from a namespace import',
    "import * as RN from 'react-native';\nexport const styles = RN.StyleSheet.create({ box: { flex: 1 } });\n",
  ],
  [
    'StyleSheet.create() after an import',
    "import { StyleSheet } from 'react-native';\nexport const styles = StyleSheet.create({ box: { flex: 1 } });\n",
  ],
  // however StyleSheet got there, the call itself is direct styling
  [
    'StyleSheet.create() without an import',
    `${STYLE_SHEET}export const styles = StyleSheet.create({ box: { flex: 1 } });\n`,
  ],
];
const STYLE_SHEET_MODULES = [...STYLE_SHEET_IMPORTS, ...STYLE_SHEET_MEMBERS];

const STYLE_PROPS = [
  ['JSX style={{ flex: 1 }}', `${BOX}export const Probe = () => <Box style={{ flex: 1 }} />;\n`],
  [
    'JSX style={styles.x}',
    `${BOX}declare const styles: { x: object };\nexport const Probe = () => <Box style={styles.x} />;\n`,
  ],
  [
    'JSX style={[a, b]}',
    `${BOX}declare const a: object;\ndeclare const b: object;\nexport const Probe = () => <Box style={[a, b]} />;\n`,
  ],
  [
    'JSX contentContainerStyle={{ padding: 4 }}',
    `${BOX}export const Probe = () => <Box contentContainerStyle={{ padding: 4 }} />;\n`,
  ],
  [
    'JSX columnWrapperStyle={x}',
    `${BOX}declare const x: object;\nexport const Probe = () => <Box columnWrapperStyle={x} />;\n`,
  ],
];

// an object literal spread as props is a style prop too, however its key is spelled statically
const SPREAD_STYLE_PROPS = [
  [
    '<Box {...{ style: x }} />',
    `${BOX}declare const x: object;\nexport const Probe = () => <Box {...{ style: x }} />;\n`,
  ],
  [
    '<Box {...{ contentContainerStyle: y }} />',
    `${BOX}declare const y: object;\nexport const Probe = () => <Box {...{ contentContainerStyle: y }} />;\n`,
  ],
  [
    "<Box {...{ 'style': x }} />",
    `${BOX}declare const x: object;\nexport const Probe = () => <Box {...{ 'style': x }} />;\n`,
  ],
  [
    "<Box {...{ ['style']: x }} />",
    `${BOX}declare const x: object;\nexport const Probe = () => <Box {...{ ['style']: x }} />;\n`,
  ],
  [
    '<Box {...{ style }} /> shorthand',
    `${BOX}declare const style: object;\nexport const Probe = () => <Box {...{ style }} />;\n`,
  ],
  [
    "<Box {...{ testID: 'x', style: x }} /> among other props",
    `${BOX}declare const x: object;\nexport const Probe = () => <Box {...{ testID: 'x', style: x }} />;\n`,
  ],
];
// spread props without a style key
const SPREAD_PROPS = [
  [
    "<Box {...{ testID: 'x' }} />",
    `${BOX}export const Probe = () => <Box {...{ testID: 'x' }} />;\n`,
  ],
  [
    '<Box {...props} />',
    `${BOX}declare const props: object;\nexport const Probe = () => <Box {...props} />;\n`,
  ],
];

// a string literal is a mode, not a style (expo-status-bar: <StatusBar style="auto" />)
const STRING_STYLE_PROPS = [
  [
    '<StatusBar style="auto" /> from expo-status-bar',
    'import { StatusBar } from \'expo-status-bar\';\nexport const Probe = () => <StatusBar style="auto" />;\n',
  ],
  ['JSX style="auto"', `${BOX}export const Probe = () => <Box style="auto" />;\n`],
];
// the words as data, plain object keys (navigation screen options) and other react-native imports
const STYLE_WORDS = [
  ["'StyleSheet' as a value", "export const name = 'StyleSheet';\n"],
  ["'style' as a property value", "export const label = { name: 'style' };\n"],
  [
    '{ style, tabBarStyle } keys in a plain object',
    "export const options = { style: { display: 'none' }, tabBarStyle: { display: 'none' } };\n",
  ],
  [
    "import { View } from 'react-native'",
    "import { View } from 'react-native';\nexport const probe = View;\n",
  ],
];

const ROUTE_AND_FEATURE_MODULES = [
  PROBES.layoutTs,
  EXISTING.index,
  PROBES.nestedLayout,
  PROBES.features,
  PROBES.featuresTest,
  PROBES.featuresComponent,
];
const ROUTE_AND_FEATURE_COMPONENTS = [
  EXISTING.layout,
  EXISTING.index,
  PROBES.nestedLayout,
  PROBES.nestedRoute,
  PROBES.notFound,
  PROBES.featuresComponent,
  PROBES.featuresTestComponent,
];
// src/ui owns the styling; src/platform is not a screen layer either
const STYLING_MODULES = [PROBES.ui, PROBES.uiComponent, PROBES.platform, PROBES.platformComponent];
const STYLING_COMPONENTS = [PROBES.uiComponent, PROBES.uiTestComponent, PROBES.platformComponent];

export const REJECTED = {
  'direct styling in routes and features': [
    ...rejected(ROUTE_AND_FEATURE_MODULES, SYNTAX, MESSAGES.styleGuard, STYLE_SHEET_MODULES),
    ...rejected(ROUTE_AND_FEATURE_COMPONENTS, SYNTAX, MESSAGES.styleGuard, STYLE_PROPS),
    ...rejected(ROUTE_AND_FEATURE_COMPONENTS, SYNTAX, MESSAGES.styleGuard, SPREAD_STYLE_PROPS),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'direct styling in routes and features': [
    ...allowed(STYLING_MODULES, STYLE_SHEET_MODULES),
    ...allowed(STYLING_COMPONENTS, STYLE_PROPS),
    ...allowed(STYLING_COMPONENTS, SPREAD_STYLE_PROPS),
    ...allowed(ROUTE_AND_FEATURE_COMPONENTS, SPREAD_PROPS),
    ...allowed(ROUTE_AND_FEATURE_COMPONENTS, STRING_STYLE_PROPS),
    ...allowed([...ROUTE_AND_FEATURE_MODULES, PROBES.featuresTestComponent], STYLE_WORDS),
  ],
};
