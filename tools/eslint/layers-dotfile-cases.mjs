// case tables for layers.test.mjs on hidden paths: dotfiles and dot-folders under src/ get the
// zones and package bans of their layer like any other file (CONTRIBUTING.md section 4)

import { PROBES } from './layers-harness.mjs';
import {
  IMPORTS,
  MESSAGES,
  PATHS,
  SYNTAX,
  allowed,
  rejected,
  relativeFrom,
  values,
} from './layers-cases.mjs';

// shared test helpers; both exist on disk
const RENDER_ROUTER = 'test/mobile/render-router';
const FIXED_CLOCK = 'test/core/fixed-clock';
const importsFrom = (file, ...targets) =>
  values(...targets.map((target) => relativeFrom(file, target)));

// a dotfile, a dot-folder and two nested dot-folders, the deepest a globstar target covers
const CORE_DOT_FILES = [PROBES.coreDotfile, PROBES.hooksDotFolder, PROBES.hooksNestedDotFolders];
const LOCAL_REPOSITORY = 'src/core/repositories/local/x';
const SUPABASE_REPOSITORY = 'src/core/repositories/supabase/x';
const JIKAN_ADAPTER = 'src/core/catalog/jikan/x';

export const REJECTED = {
  'dotfiles and dot-folders under src/': [
    ...rejected(
      PROBES.featuresDotfile,
      PATHS,
      MESSAGES.testInfrastructure,
      importsFrom(PROBES.featuresDotfile, RENDER_ROUTER),
    ),
    ...CORE_DOT_FILES.flatMap((file) => [
      ...rejected(file, PATHS, MESSAGES.testInfrastructure, importsFrom(file, FIXED_CLOCK)),
      ...rejected(file, PATHS, MESSAGES.coreInterfaces, [
        ...importsFrom(file, LOCAL_REPOSITORY, SUPABASE_REPOSITORY, JIKAN_ADAPTER),
        ...values('@core/repositories/local/x', '@core/catalog/jikan/x'),
      ]),
    ]),
    // the zones with a plain folder target and the package bans already cover dotfiles
    ...rejected(
      PROBES.featuresDotfile,
      PATHS,
      MESSAGES.features,
      values('@core/repositories/supabase/x'),
    ),
    ...rejected(PROBES.coreDotfile, PATHS, MESSAGES.core, values('@features/search/x')),
    ...rejected(
      PROBES.featuresDotfile,
      IMPORTS,
      MESSAGES.supabase,
      values('@supabase/supabase-js'),
    ),
    ...rejected(CORE_DOT_FILES, IMPORTS, MESSAGES.reactNative, values('react-native')),
    ...rejected(PROBES.featuresDotfile, SYNTAX, MESSAGES.classNameGuard, [
      ['{ className } key', "export const props = { className: 'p-4' };\n"],
    ]),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'dotfiles and dot-folders under src/': [
    ...allowed(PROBES.featuresDotfile, values('@core/hooks/x', '@core/domain/x')),
    ...allowed(CORE_DOT_FILES, values('@core/domain/x', '@core/repositories/library-repository')),
    ...allowed(PROBES.coreDotfile, importsFrom(PROBES.coreDotfile, 'src/core/domain/x')),
    ...allowed(
      PROBES.hooksDotFolder,
      importsFrom(PROBES.hooksDotFolder, 'src/core/repositories/library-repository'),
    ),
    ...allowed(PROBES.featuresDotfile, [
      ["'className' as a value", "export const prop = 'className';\n"],
    ]),
  ],
};
