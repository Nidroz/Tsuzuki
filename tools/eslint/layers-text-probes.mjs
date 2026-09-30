// probe tables for layers-text-cases.mjs on hard-coded user-facing text: [label, code] pairs of
// text to reject in routes and features, and of translated text and literals that are not text to
// allow (CONTRIBUTING.md section 5)

// local declarations keep the probes free of imports that other layer rules would report
const DECLARATIONS = [
  'declare const Text: (props: object) => null;',
  'declare const Button: (props: object) => null;',
  'declare const List: (props: object) => null;',
  'declare const Pagination: (props: object) => null;',
  'declare const Stack: ((props: object) => null) & { Screen: (props: object) => null };',
  'declare const Alert: { alert: (...args: unknown[]) => void; prompt: (...args: unknown[]) => void };',
  'declare const t: (key: string, options?: object) => string;',
  'declare const track: (event: object) => void;',
  'declare const makeAction: (action: object) => object;',
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
  // the error text of a field is shown under it, a short code included
  ['error="required" on Input', jsx('<Button error="required" />')[1]],
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
// the react native aria props that hold text; aria-labelledby holds a nativeID
const ARIA_PROPS = [
  jsx('<Button aria-label="Save" />'),
  jsx('<Button aria-valuetext="Half" />'),
  jsx("<Button aria-label={ok ? 'Yes' : t('no')} />"),
  jsx("<Button {...{ 'aria-label': 'Save' }} />"),
];
// arrays hand each element on, as children or as a prop value
const ARRAYS = [
  jsx("<Text>{['Hi', t('a')]}</Text>"),
  jsx("<Text>{ok ? [t('a'), 'Hi'] : null}</Text>"),
  jsx("<Button label={['Save']} />"),
  jsx("<Button action={{ label: [t('a'), 'Retry'] }} />"),
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
// the text keys of objects given as props, however deep in objects and arrays: EmptyState action,
// ErrorState retry, accessibility actions; the nearest prop counts, inside a render callback too
const OBJECT_PROPS = [
  jsx("<Button action={{ label: 'Retry', onPress }} />"),
  jsx("<Button retry={{ label: 'Try again', onPress }} />"),
  jsx("<Button accessibilityActions={[{ name: 'activate', label: 'Open' }]} />"),
  jsx("<Button action={{ label: 'Retry' } as const} />"),
  jsx("<Button action={{ nested: { label: 'Retry' } }} />"),
  jsx("<Button action={{ label: 'Retry', onPress: () => track({ label: 'retry' }) }} />"),
  jsx("<List renderItem={() => <Button action={{ label: 'Retry' }} />} />"),
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
  // a limit: a navigation key is text wherever it is written, even in another call's data
  statement("export const open = () => track({ title: 'home_opened' });"),
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
export const MODULE_TEXT = [...MODULE_NAVIGATION_OPTIONS, ...ALERTS];
const COMPONENT_KINDS = [
  CHILDREN,
  TEXT_PROPS,
  ARIA_PROPS,
  ARRAYS,
  SPREAD_PROPS,
  OBJECT_PROPS,
  LABELS,
  NAVIGATION_OPTIONS,
  ALERTS,
];
export const COMPONENT_TEXT = COMPONENT_KINDS.flat();
// one probe of each kind
export const SAMPLE_TEXT = COMPONENT_KINDS.map(([first]) => first);
export const SAMPLE_MODULE_TEXT = [MODULE_NAVIGATION_OPTIONS[0], ALERTS[0]];

// translated text, and literals that are not text: keys, ids, roles, tokens, modes, routes, icons
const TRANSLATED = [
  jsx("<Text>{t('home.title')}</Text>"),
  jsx("<Text>{ok ? t('a') : t('b')}</Text>"),
  jsx("<Text>{[t('a'), t('b')]}</Text>"),
  jsx("<Button label={t('a.b')} />"),
  jsx("<Button label={ok ? t('a') : t('b')} />"),
  jsx("<Button label={busy ? t('a') : ok ? t('b') : t('c')} />"),
  jsx("<Button label={n === 1 ? t('one') : t('many')} />"),
  jsx("<Button label={t('count', { unit: 'page' })} />"),
  jsx("<Button aria-label={t('save')} />"),
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
  jsx('<Button aria-labelledby="title" aria-live="polite" />'),
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
// text keys in a callback or in a call's arguments inside a prop are that code's data, not text
// shown by the prop: analytics events, factories
const CALLBACK_DATA = [
  jsx("<Button onPress={() => track({ label: 'save_button' })} />"),
  jsx("<Button onPress={function press() { track({ label: 'save_button' }); }} />"),
  jsx("<Button action={{ label: t('retry'), onPress: () => track({ label: 'retry' }) }} />"),
  jsx("<Button {...{ onPress: () => track({ message: 'pressed' }) }} />"),
  jsx("<Button action={makeAction({ label: 'retry_action' })} />"),
  statement(
    "Alert.alert(t('a'), t('b'), [{ text: t('ok'), onPress: () => track({ text: 'ok' }) }]);",
  ),
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
export const NO_TEXT = [...TRANSLATED, ...NOT_TEXT, ...CALLBACK_DATA, ...NO_LETTER];
export const SAMPLE_NO_TEXT = [TRANSLATED[0], NOT_TEXT[0], CALLBACK_DATA[0], NO_LETTER[0]];
// out of reach of a syntax check: a string stored first, then passed by name
export const STORED_TEXT = [
  statement("const LABEL = 'Save';\nexport const Probe = () => <Button label={LABEL} />;"),
  statement("const TITLE = 'Home';\nexport const options = { title: TITLE };"),
];
// out of reach of the bounded selectors: a literal behind more wrappers than MAX_NESTING, a text key
// deeper than MAX_OBJECT_PATH in a prop's objects (tools/eslint/text-guards.mjs)
export const BEYOND_LIMITS = [
  jsx(
    "<Button label={ok ? (busy ? (ok ? (busy ? 'Deep' : t('a')) : t('b')) : t('c')) : t('d')} />",
  ),
  jsx("<Button action={{ a: { b: { c: { label: 'Deep' } } } }} />"),
];
