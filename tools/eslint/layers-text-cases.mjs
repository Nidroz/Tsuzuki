// case tables for layers.test.mjs on hard-coded user-facing text: routes (app/) and features
// (src/features/) show text through t('key') from @core/i18n, never as a literal in JSX, a text prop,
// navigation options or an alert (CONTRIBUTING.md section 5)

import { EXISTING, PROBES } from './layers-harness.mjs';
import { MESSAGES, SYNTAX, allowed, rejected } from './layers-cases.mjs';

// local declarations keep the probes free of imports that other layer rules would report
const DECLARATIONS = [
  'declare const Text: (props: object) => null;',
  'declare const Button: (props: object) => null;',
  'declare const Pagination: (props: object) => null;',
  'declare const Stack: ((props: object) => null) & { Screen: (props: object) => null };',
  'declare const Alert: { alert: (...args: unknown[]) => void; prompt: (...args: unknown[]) => void };',
  'declare const t: (key: string, options?: object) => string;',
  'declare const ok: boolean;',
  'declare const busy: boolean;',
  'declare const n: number;',
  'declare const onPress: () => void;',
].join('\n');

// probes are [label, code] pairs
const jsx = (code) => [code, `${DECLARATIONS}\nexport const Probe = () => ${code};\n`];
const statement = (code) => [code, `${DECLARATIONS}\n${code}\n`];

// text in JSX children: any string with a letter, in any script
const CHILDREN = [
  jsx('<Text>Hello</Text>'),
  jsx('<Text>Élan</Text>'),
  jsx('<Text>続き</Text>'),
  jsx('<>Hello</>'),
  jsx("<Text>{'Hello'}</Text>"),
  jsx('<Text>{`Hi ${String(n)}`}</Text>'),
  jsx("<Text>{ok ? 'Yes' : t('no')}</Text>"),
  jsx("<Text>{busy && 'Loading'}</Text>"),
  jsx("<Text>{'Page ' + String(n)}</Text>"),
];

// every text prop of the src/ui primitives, and the name patterns (a text word, or a name ending in
// one) that cover the props of other components
const PRIMITIVE_TEXT_PROPS = [
  ['Button', 'label'],
  ['Button', 'loadingLabel'],
  ['Button', 'accessibilityHint'],
  ['Card', 'accessibilityLabel'],
  ['Chip', 'label'],
  ['EmptyState', 'title'],
  ['EmptyState', 'message'],
  ['ErrorState', 'title'],
  ['ErrorState', 'message'],
  ['IconButton', 'accessibilityLabel'],
  ['IconButton', 'accessibilityHint'],
  ['Input', 'label'],
  ['Input', 'placeholder'],
  ['Input', 'error'],
  ['Spinner', 'accessibilityLabel'],
  ['Text', 'accessibilityLabel'],
];
const OTHER_TEXT_PROPS = [
  'description',
  'text',
  'hint',
  'submitLabel',
  'headerTitle',
  'emptyText',
  'errorMessage',
  'searchPlaceholder',
  'itemDescription',
];
const TEXT_PROPS = [
  ...PRIMITIVE_TEXT_PROPS.map(([component, prop]) => [
    `${prop}="Save" on ${component}`,
    jsx(`<Button ${prop}="Save" />`)[1],
  ]),
  ...OTHER_TEXT_PROPS.map((prop) => jsx(`<Button ${prop}="Save" />`)),
  jsx("<Button label={'Save'} />"),
  jsx('<Button label={`Save ${String(n)}`} />'),
  jsx("<Button label={ok ? 'Yes' : 'No'} />"),
  jsx("<Button label={ok ? t('yes') : 'No'} />"),
  jsx("<Button label={ok && 'Yes'} />"),
  jsx("<Button label={ok || 'Yes'} />"),
  jsx("<Button label={t('a') ?? 'Yes'} />"),
  jsx("<Button label={ok ? t('a') : busy ? 'Busy' : t('b')} />"),
  jsx("<Button label={ok ? (busy ? t('a') : 'Wait') : t('b')} />"),
  jsx("<Button label={'Save ' + String(n)} />"),
  jsx("<Button label={'Save' as string} />"),
  jsx("<Button label={() => 'Save'} />"),
];

// the same keys in an object literal spread as props, directly or behind a condition
const SPREAD_PROPS = [
  jsx("<Button {...{ label: 'Save' }} />"),
  jsx("<Button {...{ 'accessibilityLabel': 'Save' }} />"),
  jsx("<Button {...{ ['title']: 'Save' }} />"),
  jsx("<Button {...(ok && { label: 'Save' })} />"),
  jsx("<Button {...(ok ? { label: 'Save' } : {})} />"),
  jsx("<Button {...{ label: ok ? 'Yes' : t('no') }} />"),
];
// the text keys of objects given as props: EmptyState action, ErrorState retry, accessibility actions
const OBJECT_PROPS = [
  jsx("<Button action={{ label: 'Retry', onPress }} />"),
  jsx("<Button retry={{ label: 'Try again', onPress }} />"),
  jsx("<Button accessibilityActions={[{ name: 'activate', label: 'Open' }]} />"),
];
// every value of the Pagination labels, label functions included
const LABELS = [
  jsx("<Pagination labels={{ next: 'Next' }} />"),
  jsx("<Pagination labels={{ next: t('next'), ellipsis: 'More' }} />"),
  jsx("<Pagination labels={{ page: (page: number) => 'Page' }} />"),
  jsx('<Pagination labels={{ page: (page: number) => `Page ${String(page)}` }} />'),
  jsx("<Pagination labels={{ page: () => (ok ? 'Current' : t('page')) }} />"),
  jsx("<Pagination {...{ labels: { next: 'Next' } }} />"),
];
// navigation options, anywhere in the file or in JSX
const MODULE_NAVIGATION_OPTIONS = [
  statement("export const options = { title: 'Home' };"),
  statement('export const options = { headerTitle: `Home ${String(n)}` };'),
  statement("export const options = { headerBackTitle: 'Back' };"),
  statement("export const options = { tabBarLabel: 'Library' };"),
  statement("export const options = { tabBarAccessibilityLabel: 'Library' };"),
  statement("export const options = { drawerLabel: 'Library' };"),
  statement("export const options = { title: ok ? 'Home' : t('home') };"),
];
const NAVIGATION_OPTIONS = [
  ...MODULE_NAVIGATION_OPTIONS,
  jsx('<Stack.Screen name="index" options={{ title: \'Home\' }} />'),
  jsx("<Stack screenOptions={{ headerTitle: 'Tsuzuki' }} />"),
  jsx("<Stack.Screen options={() => ({ headerBackTitle: 'Back' })} />"),
];
const ALERTS = [
  statement("Alert.alert('Oops');"),
  statement("Alert.alert(t('error.title'), `Failed ${String(n)} times`);"),
  statement("Alert.alert(t('a'), t('b'), [{ text: 'OK', onPress }]);"),
  statement("Alert.prompt('Name');"),
  statement("Alert.alert(ok ? 'Oops' : t('a'));"),
];
const MODULE_TEXT = [...MODULE_NAVIGATION_OPTIONS, ...ALERTS];
// one probe of each kind
const SAMPLE_TEXT = [
  CHILDREN[0],
  TEXT_PROPS[0],
  SPREAD_PROPS[0],
  OBJECT_PROPS[0],
  LABELS[0],
  NAVIGATION_OPTIONS[0],
  ALERTS[0],
];
const COMPONENT_TEXT = [
  ...CHILDREN,
  ...TEXT_PROPS,
  ...SPREAD_PROPS,
  ...OBJECT_PROPS,
  ...LABELS,
  ...NAVIGATION_OPTIONS,
  ...ALERTS,
];

// translated text, and literals that are not text: keys, ids, roles, tokens, modes, routes, icons
const TRANSLATED = [
  jsx("<Text>{t('home.title')}</Text>"),
  jsx("<Text>{ok ? t('a') : t('b')}</Text>"),
  jsx("<Button label={t('a.b')} />"),
  jsx("<Button label={ok ? t('a') : t('b')} />"),
  jsx("<Button label={busy ? t('a') : ok ? t('b') : t('c')} />"),
  jsx("<Button label={n === 1 ? t('one') : t('many')} />"),
  jsx("<Button label={t('count', { unit: 'page' })} />"),
  jsx("<Button action={{ label: t('retry'), onPress }} />"),
  jsx("<Button {...{ label: t('save') }} />"),
  jsx("<Pagination labels={{ next: t('next'), page: (page: number) => t('page', { page }) }} />"),
  jsx('<Stack.Screen name="index" options={{ title: t(\'home.title\') }} />'),
  statement("export const options = { title: t('home.title') };"),
  statement("Alert.alert(t('a'), t('b'), [{ text: t('ok'), onPress }]);"),
];
const NOT_TEXT = [
  jsx('<Button testID="home-screen" />'),
  jsx('<Button accessibilityRole="button" />'),
  jsx('<Text variant="title" />'),
  jsx('<Button padding="lg" />'),
  jsx('<Button style="auto" />'),
  jsx('<Button keyboardType="numeric" returnKeyType="search" autoCapitalize="none" />'),
  jsx('<Button textContentType="emailAddress" />'),
  jsx('<Button href="/media/1" />'),
  jsx('<Stack.Screen name="settings" />'),
  jsx('<Button icon="search" />'),
  jsx("<Stack screenOptions={{ headerShown: false, headerTitleAlign: 'center' }} />"),
  statement("export const options = { animation: 'fade', presentation: 'modal' };"),
];
const NO_LETTER = [
  jsx('<Text>·</Text>'),
  jsx("<Text>{'/'}</Text>"),
  jsx('<Text>{n} – {n}</Text>'),
  jsx('<Text>{`${String(n)} / ${String(n)}`}</Text>'),
  jsx('<Button label="42" />'),
  jsx("<Button label={ok ? '✓' : '·'} />"),
  statement("export const options = { title: '' };"),
];
// out of reach of a syntax check: a string stored first, then passed by name
const STORED_TEXT = [
  statement("const LABEL = 'Save';\nexport const Probe = () => <Button label={LABEL} />;"),
  statement("const TITLE = 'Home';\nexport const options = { title: TITLE };"),
];

// the production files of the screen layers; the text rule reads JSX, so most probes are components
const SCREEN_COMPONENTS = [
  EXISTING.layout,
  EXISTING.index,
  PROBES.nestedLayout,
  PROBES.nestedRoute,
  PROBES.notFound,
  PROBES.featuresComponent,
];
const SCREEN_MODULES = [PROBES.layoutTs, PROBES.features];
// src/ui renders the text it is given, src/core and src/platform are not screen layers, and tests
// and fixtures hold literal data and assertions
const OUT_OF_SCOPE_COMPONENTS = [PROBES.uiComponent, PROBES.featuresTestComponent];
const OTHER_OUT_OF_SCOPE_COMPONENTS = [
  PROBES.uiTestComponent,
  PROBES.hooksComponent,
  PROBES.platformComponent,
  PROBES.featuresFixture,
  PROBES.testMobileComponent,
];
const OUT_OF_SCOPE_MODULES = [PROBES.ui, PROBES.core, PROBES.platform, PROBES.featuresTest];

export const REJECTED = {
  'no hard-coded text in routes and features': [
    ...rejected(SCREEN_COMPONENTS, SYNTAX, MESSAGES.literalText, COMPONENT_TEXT),
    ...rejected(SCREEN_MODULES, SYNTAX, MESSAGES.literalText, MODULE_TEXT),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'no hard-coded text in routes and features': [
    ...allowed(SCREEN_COMPONENTS, [...TRANSLATED, ...NOT_TEXT, ...NO_LETTER]),
    ...allowed(OUT_OF_SCOPE_COMPONENTS, COMPONENT_TEXT),
    ...allowed(OTHER_OUT_OF_SCOPE_COMPONENTS, SAMPLE_TEXT),
    ...allowed(OUT_OF_SCOPE_MODULES, MODULE_TEXT),
  ],
  // documents a limit, not a rule: a syntax check sees the literal only where it is written
  'no hard-coded text: stored strings (currently allowed)': allowed(
    [EXISTING.index, PROBES.featuresComponent],
    STORED_TEXT,
  ),
};
