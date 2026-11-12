// case tables for layers.test.mjs on image components: routes (app/) and features (src/features/)
// render covers only through the CoverImage primitive of @ui/index, never the Image or
// ImageBackground of react-native (CONTRIBUTING.md sections 4 and 7)

import { EXISTING, PROBES } from './layers-harness.mjs';
import { IMPORTS, SYNTAX, allowed, dynamics, rejected, types } from './layers-cases.mjs';
import { jestCall } from './layers-test-code-cases.mjs';

const NATIVE_IMAGE = 'covers render only through CoverImage from @ui/index';
const NAMES = ['Image', 'ImageBackground'];

// probes are [label, code] pairs: every form a module can reach the component by
const moduleForms = (name) => [
  [
    `import { ${name} } from 'react-native'`,
    `import { ${name} } from 'react-native';\nexport const probe = ${name};\n`,
  ],
  [
    `import { ${name} as RNImage } from 'react-native'`,
    `import { ${name} as RNImage } from 'react-native';\nexport const probe = RNImage;\n`,
  ],
  [
    `import { View, ${name} } from 'react-native'`,
    `import { View, ${name} } from 'react-native';\nexport const probe = [View, ${name}];\n`,
  ],
  [`export { ${name} } from 'react-native'`, `export { ${name} } from 'react-native';\n`],
  // a module re-exporting react-native hands out the same component
  [
    `import { ${name} } from './rn'`,
    `import { ${name} } from './rn';\nexport const probe = ${name};\n`,
  ],
  [
    `RN.${name} from a namespace import`,
    `import * as RN from 'react-native';\nexport const probe = RN.${name};\n`,
  ],
  [
    `RN['${name}'] from a namespace import`,
    `import * as RN from 'react-native';\nexport const probe = RN['${name}'];\n`,
  ],
  [
    `const { ${name} } = RN`,
    `import * as RN from 'react-native';\nconst { ${name} } = RN;\nexport const probe = ${name};\n`,
  ],
  [`require('react-native').${name}`, `export const probe = require('react-native').${name};\n`],
  [
    `const { ${name} } = await import('react-native')`,
    `export const load = async () => {\n  const { ${name}: Loaded } = await import('react-native');\n  return Loaded;\n};\n`,
  ],
];
// jsx tags reached through an object
const jsxForms = (name) => [
  [
    `<RN.${name} />`,
    `import * as RN from 'react-native';\nexport const Probe = () => <RN.${name} />;\n`,
  ],
  [
    `<Animated.${name} />`,
    `import { Animated } from 'react-native';\nexport const Probe = () => <Animated.${name} />;\n`,
  ],
];
const MODULE_FORMS = NAMES.flatMap(moduleForms);
const JSX_FORMS = NAMES.flatMap(jsxForms);

// other react-native imports, names that only start like the components, and the primitive itself
const OTHER_IMPORTS = [
  [
    "import { View } from 'react-native'",
    "import { View } from 'react-native';\nexport const probe = View;\n",
  ],
  [
    'RN.View from a namespace import',
    "import * as RN from 'react-native';\nexport const probe = RN.View;\n",
  ],
  [
    "import type { ImageSourcePropType } from 'react-native'",
    "import type { ImageSourcePropType } from 'react-native';\nexport type Probe = ImageSourcePropType;\n",
  ],
  ["'Image' as a value", "export const name = 'Image';\n"],
  [
    "import { CoverImage } from '@ui/index'",
    "import { CoverImage } from '@ui/index';\nexport const probe = CoverImage;\n",
  ],
];
const OTHER_TAGS = [
  ['<RN.View />', "import * as RN from 'react-native';\nexport const Probe = () => <RN.View />;\n"],
];

// the modules of the components inside react-native: imported by default or as a namespace, they
// give the component a name no guard on Image sees
const IMAGE_MODULE = 'react-native/Libraries/Image/Image';
const IMAGE_MODULES = [
  IMAGE_MODULE,
  'react-native/Libraries/Image/ImageBackground',
  'react-native/Libraries/Image/Image.ios',
  'react-native/Libraries/Image',
  'react-native/Libraries/Animated/components/AnimatedImage',
];
// other modules of react-native, the neighbours of the banned ones included
const OTHER_DEEP_MODULE = 'react-native/Libraries/Utilities/Platform';
const OTHER_DEEP_MODULES = [
  OTHER_DEEP_MODULE,
  'react-native/Libraries/Text/Text',
  'react-native/Libraries/Animated/components/AnimatedText',
];
const defaultImport = (specifier) => [
  `import Img from '${specifier}'`,
  `import Img from '${specifier}';\nexport const probe = Img;\n`,
];
// every static form: default, namespace and side-effect imports, re-exports, a type import
const staticForms = (specifier) => [
  defaultImport(specifier),
  [
    `import * as ImageModule from '${specifier}'`,
    `import * as ImageModule from '${specifier}';\nexport const probe = ImageModule;\n`,
  ],
  [`import '${specifier}'`, `import '${specifier}';\nexport const probe = 1;\n`],
  [`export { default } from '${specifier}'`, `export { default } from '${specifier}';\n`],
  [`export * from '${specifier}'`, `export * from '${specifier}';\n`],
  ...types(specifier),
];
// the forms no-restricted-syntax checks: import() and require()
const callForms = (specifier) => [
  ...dynamics(specifier),
  [`require('${specifier}')`, `export const probe = require('${specifier}');\n`],
];
const jestForms = (specifier) => [
  jestCall('mock', specifier),
  jestCall('requireActual', specifier),
];
const TEST_FILES = [PROBES.featuresTest, PROBES.featuresTestComponent];

// every form on a feature and a route; a sample on the other route and feature files, test code
// included
const FORM_FILES = [PROBES.features, EXISTING.index];
const SAMPLE_FILES = [PROBES.layoutTs, PROBES.nestedRoute, PROBES.featuresTest];
const COMPONENT_FILES = [
  EXISTING.index,
  PROBES.nestedLayout,
  PROBES.featuresComponent,
  PROBES.featuresTestComponent,
  PROBES.featuresFixture,
];
const SAMPLES = [MODULE_FORMS[0], MODULE_FORMS[1], MODULE_FORMS.at(-1)];
// src/ui renders images (CoverImage), src/platform is no screen layer, test/mobile sets jest up
const OTHER_MODULES = [PROBES.ui, PROBES.uiTest, PROBES.platform, PROBES.platformTest];
const OTHER_COMPONENTS = [PROBES.uiComponent, PROBES.platformComponent, PROBES.testMobileComponent];

export const REJECTED = {
  'react-native images in routes and features': [
    ...rejected(FORM_FILES, SYNTAX, NATIVE_IMAGE, MODULE_FORMS),
    ...rejected(SAMPLE_FILES, SYNTAX, NATIVE_IMAGE, SAMPLES),
    ...rejected(COMPONENT_FILES, SYNTAX, NATIVE_IMAGE, JSX_FORMS),
  ],
  'react-native image modules in routes and features': [
    ...rejected(FORM_FILES, IMPORTS, NATIVE_IMAGE, staticForms(IMAGE_MODULE)),
    ...rejected(FORM_FILES, IMPORTS, NATIVE_IMAGE, IMAGE_MODULES.slice(1).map(defaultImport)),
    ...rejected(SAMPLE_FILES, IMPORTS, NATIVE_IMAGE, [defaultImport(IMAGE_MODULE)]),
    ...rejected(FORM_FILES, SYNTAX, NATIVE_IMAGE, callForms(IMAGE_MODULE)),
    ...rejected(TEST_FILES, SYNTAX, NATIVE_IMAGE, jestForms(IMAGE_MODULE)),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'react-native images in routes and features': [
    ...allowed(OTHER_MODULES, MODULE_FORMS),
    ...allowed(OTHER_COMPONENTS, JSX_FORMS),
    ...allowed([...FORM_FILES, ...SAMPLE_FILES], OTHER_IMPORTS),
    ...allowed(COMPONENT_FILES, OTHER_TAGS),
  ],
  'react-native image modules in routes and features': [
    ...allowed(OTHER_MODULES, [
      ...staticForms(IMAGE_MODULE),
      ...IMAGE_MODULES.slice(1).map(defaultImport),
      ...callForms(IMAGE_MODULE),
    ]),
    ...allowed([PROBES.uiTest, PROBES.platformTest], jestForms(IMAGE_MODULE)),
    ...allowed(FORM_FILES, [
      ...OTHER_DEEP_MODULES.map(defaultImport),
      ...callForms(OTHER_DEEP_MODULE),
    ]),
    ...allowed(TEST_FILES, jestForms(OTHER_DEEP_MODULE)),
  ],
};
