// case tables for layers.test.mjs on image components: routes (app/) and features (src/features/)
// render covers only through the CoverImage primitive of @ui/index, never the Image or
// ImageBackground of react-native (CONTRIBUTING.md sections 4 and 7)

import { EXISTING, PROBES } from './layers-harness.mjs';
import { SYNTAX, allowed, rejected } from './layers-cases.mjs';

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
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'react-native images in routes and features': [
    ...allowed(OTHER_MODULES, MODULE_FORMS),
    ...allowed(OTHER_COMPONENTS, JSX_FORMS),
    ...allowed([...FORM_FILES, ...SAMPLE_FILES], OTHER_IMPORTS),
    ...allowed(COMPONENT_FILES, OTHER_TAGS),
  ],
};
