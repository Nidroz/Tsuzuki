import { describe, expect, it, jest } from '@jest/globals';
import { AccessibilityInfo, Platform } from 'react-native';

import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { Input } from './Input';

const LABEL = 'Email';
const ERROR = 'Enter a valid email';
const OTHER_ERROR = 'Email is required';

// the react native jest preset already mocks announceForAccessibility: spyOn hands back that shared
// mock, whose calls survive restoreMocks, so they are cleared here
const spyOnAnnounce = () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  return announce;
};

// voiceover has no polite live region: ios announces the error itself, android leaves it to the
// live region the field mounts
describe('Input announcing its error', () => {
  describe('on ios', () => {
    it('announces the error when it appears and when it changes', async () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      const announce = spyOnAnnounce();
      const { rerender } = await renderWithTheme(
        <Input label={LABEL} value="" onChangeText={jest.fn()} />,
      );

      expect(announce).not.toHaveBeenCalled();

      await rerender(<Input label={LABEL} value="" onChangeText={jest.fn()} error={ERROR} />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith(ERROR);

      await rerender(<Input label={LABEL} value="x" onChangeText={jest.fn()} error={ERROR} />);

      expect(announce).toHaveBeenCalledTimes(1);

      await rerender(
        <Input label={LABEL} value="x" onChangeText={jest.fn()} error={OTHER_ERROR} />,
      );

      expect(announce).toHaveBeenCalledTimes(2);
      expect(announce).toHaveBeenLastCalledWith(OTHER_ERROR);
    });

    it('announces an error it mounts with, and the same error again once it cleared', async () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      const announce = spyOnAnnounce();
      const { rerender } = await renderWithTheme(
        <Input label={LABEL} value="" onChangeText={jest.fn()} error={ERROR} />,
      );

      expect(announce.mock.calls).toStrictEqual([[ERROR]]);

      await rerender(<Input label={LABEL} value="" onChangeText={jest.fn()} error="" />);
      expect(announce).toHaveBeenCalledTimes(1);

      await rerender(<Input label={LABEL} value="" onChangeText={jest.fn()} error={ERROR} />);
      expect(announce.mock.calls).toStrictEqual([[ERROR], [ERROR]]);
    });
  });

  describe('on android', () => {
    it('leaves the announcement to the live region', async () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      const announce = spyOnAnnounce();

      await renderWithTheme(
        <Input label={LABEL} value="" onChangeText={jest.fn()} error={ERROR} />,
      );

      expect(announce).not.toHaveBeenCalled();
    });
  });
});
