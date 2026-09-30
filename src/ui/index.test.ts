import { describe, expect, it } from '@jest/globals';

import * as ui from './index';

// the public api of the design system: routes and features import from src/ui/index only
describe('src/ui public api', () => {
  it('exports the primitives, the pagination helpers and the theme provider', () => {
    expect(Object.keys(ui).sort()).toStrictEqual(
      [
        'Box',
        'Button',
        'Card',
        'Chip',
        'DEFAULT_SIBLINGS',
        'EmptyState',
        'ErrorState',
        'IconButton',
        'Input',
        'Pagination',
        'Row',
        'Screen',
        'Spacer',
        'Spinner',
        'Stack',
        'Text',
        'ThemeProvider',
        'clampPage',
        'pageWindow',
        'parsePageInput',
      ].sort(),
    );
  });

  it('does not expose internals such as the theme context or the class tables', () => {
    expect(ui).not.toHaveProperty('useThemeColors');
    expect(ui).not.toHaveProperty('palettes');
    expect(ui).not.toHaveProperty('PADDING');
  });
});
