import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { announcementOf, heldAnnouncementKeyCount, useAnnouncement } from './announcements';
import { ErrorState } from './ErrorState';
import { InlineError } from './InlineError';
import { Notice } from './Notice';

const MESSAGE = 'Your guest titles could not be merged.';
const OTHER_MESSAGE = '2 changes could not be synced.';
const FULL_MESSAGE = `Something went wrong
${MESSAGE}`;
const KEY = 'guest-merge';
const OTHER_KEY = 'sync-issues';

// the react native jest preset already mocks announceForAccessibility: spyOn hands back that shared
// mock, whose calls survive restoreMocks, so they are cleared here
const spyOnAnnounce = () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  return announce;
};

interface HolderProps {
  message: string | null;
  announceKey?: string;
}

function Holder({ message, announceKey }: HolderProps) {
  useAnnouncement(message, announceKey === undefined ? {} : { key: announceKey });
  return null;
}

// a mounted holder, its id being its identity across renders
interface HolderSpec extends HolderProps {
  id: string;
}

function Holders({ holders }: { holders: readonly HolderSpec[] }) {
  return (
    <>
      {holders.map(({ id, ...props }) => (
        <Holder key={id} {...props} />
      ))}
    </>
  );
}

// the two views of the tests, e.g. the library and favorites tabs, showing a message under a key
const first = (message: string | null, announceKey = KEY): HolderSpec => ({
  id: 'first',
  message,
  announceKey,
});
const second = (message: string | null, announceKey = KEY): HolderSpec => ({
  id: 'second',
  message,
  announceKey,
});

// no key outlives its test: a held key would silence the next test's first announcement. the
// explicit cleanup unmounts the tree before the check, whatever the order of the afterEach hooks
afterEach(async () => {
  await cleanup();
  const held = heldAnnouncementKeyCount();
  if (held !== 0) {
    throw new Error(`${String(held)} announcement keys still held after the test unmounted`);
  }
});

describe('useAnnouncement', () => {
  describe('without a key', () => {
    it('announces on mount and when the message changes, not on a render with the same message', async () => {
      const announce = spyOnAnnounce();
      const { rerender } = await render(<Holder message={MESSAGE} />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith(MESSAGE);

      await rerender(<Holder message={MESSAGE} />);

      expect(announce).toHaveBeenCalledTimes(1);

      await rerender(<Holder message={OTHER_MESSAGE} />);

      expect(announce).toHaveBeenCalledTimes(2);
      expect(announce).toHaveBeenLastCalledWith(OTHER_MESSAGE);
    });

    it('announces every mounted holder, as before keys existed', async () => {
      const announce = spyOnAnnounce();

      await render(
        <Holders
          holders={[
            { id: 'first', message: MESSAGE },
            { id: 'second', message: MESSAGE },
          ]}
        />,
      );

      expect(announce).toHaveBeenCalledTimes(2);
    });

    it('announces nothing for null, then the message once it is given', async () => {
      const announce = spyOnAnnounce();
      const { rerender } = await render(<Holder message={null} />);

      expect(announce).not.toHaveBeenCalled();

      await rerender(<Holder message={MESSAGE} />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith(MESSAGE);
    });
  });

  describe('with a key', () => {
    it('announces a lone holder on mount and when its message changes', async () => {
      const announce = spyOnAnnounce();
      const { rerender } = await render(<Holder message={MESSAGE} announceKey={KEY} />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith(MESSAGE);

      await rerender(<Holder message={OTHER_MESSAGE} announceKey={KEY} />);

      expect(announce).toHaveBeenCalledTimes(2);
      expect(announce).toHaveBeenLastCalledWith(OTHER_MESSAGE);
    });

    it('announces once for two holders mounted together or one after the other', async () => {
      const announce = spyOnAnnounce();
      const { rerender } = await render(<Holders holders={[first(MESSAGE), second(MESSAGE)]} />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith(MESSAGE);

      await rerender(
        <Holders holders={[first(MESSAGE), second(MESSAGE), { ...first(MESSAGE), id: 'third' }]} />,
      );

      expect(announce).toHaveBeenCalledTimes(1);
    });

    it('stays silent for a holder mounting while another shows the state in other words', async () => {
      const announce = spyOnAnnounce();
      // e.g. an ErrorState's title and message in the tabs, an InlineError's message on the detail
      const { rerender } = await render(<Holders holders={[first(FULL_MESSAGE)]} />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith(FULL_MESSAGE);

      await rerender(<Holders holders={[first(FULL_MESSAGE), second(MESSAGE)]} />);

      expect(announce).toHaveBeenCalledTimes(1);

      // a holder going from null to the state in other words stays silent too
      await rerender(<Holders holders={[first(FULL_MESSAGE), second(null)]} />);
      await rerender(<Holders holders={[first(FULL_MESSAGE), second(MESSAGE)]} />);

      expect(announce).toHaveBeenCalledTimes(1);
    });

    it('announces once when two holders change their message in the same commit', async () => {
      const announce = spyOnAnnounce();
      const { rerender } = await render(<Holders holders={[first(MESSAGE), second(MESSAGE)]} />);
      announce.mockClear();

      await rerender(<Holders holders={[first(OTHER_MESSAGE), second(OTHER_MESSAGE)]} />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith(OTHER_MESSAGE);
    });

    it('announces once when two holders change their message in separate commits', async () => {
      const announce = spyOnAnnounce();
      const { rerender } = await render(<Holders holders={[first(MESSAGE), second(MESSAGE)]} />);
      announce.mockClear();

      await rerender(<Holders holders={[first(OTHER_MESSAGE), second(MESSAGE)]} />);
      await rerender(<Holders holders={[first(OTHER_MESSAGE), second(OTHER_MESSAGE)]} />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith(OTHER_MESSAGE);
    });

    it('forgets the key once its last holder unmounts, so a later mount announces again', async () => {
      const announce = spyOnAnnounce();
      const { rerender } = await render(<Holders holders={[first(MESSAGE), second(MESSAGE)]} />);

      expect(heldAnnouncementKeyCount()).toBe(1);

      // one holder left: the key is still held, a remount of the other stays silent
      await rerender(<Holders holders={[first(MESSAGE)]} />);
      await rerender(<Holders holders={[first(MESSAGE), second(MESSAGE)]} />);

      expect(announce).toHaveBeenCalledTimes(1);

      await rerender(<Holders holders={[]} />);

      expect(heldAnnouncementKeyCount()).toBe(0);

      await rerender(<Holders holders={[first(MESSAGE), second(MESSAGE)]} />);

      expect(announce).toHaveBeenCalledTimes(2);
      expect(announce).toHaveBeenLastCalledWith(MESSAGE);
    });

    it('announces nothing for null, and a message shown again after every holder cleared it', async () => {
      const announce = spyOnAnnounce();
      const { rerender } = await render(<Holders holders={[first(null), second(null)]} />);

      expect(announce).not.toHaveBeenCalled();

      // a holder showing the message after another one's null still announces it
      await rerender(<Holders holders={[first(null), second(MESSAGE)]} />);

      expect(announce).toHaveBeenCalledTimes(1);

      await rerender(<Holders holders={[first(null), second(null)]} />);
      await rerender(<Holders holders={[first(MESSAGE), second(null)]} />);

      expect(announce).toHaveBeenCalledTimes(2);
      expect(announce).toHaveBeenLastCalledWith(MESSAGE);
    });

    it('releases the keys of the components announcing through it once they unmount', async () => {
      const announce = spyOnAnnounce();
      // the errors of a failed merge in other words, and a notice under another key
      const views = (errors: boolean, notice: boolean) => (
        <>
          {errors ? (
            <ErrorState title="Something went wrong" message={MESSAGE} announceKey={KEY} />
          ) : null}
          {errors ? <InlineError message={MESSAGE} announceKey={KEY} /> : null}
          {notice ? <Notice message={OTHER_MESSAGE} announceKey={OTHER_KEY} /> : null}
        </>
      );
      const { rerender } = await renderWithTheme(views(true, true));

      expect(announce.mock.calls).toStrictEqual([[FULL_MESSAGE], [OTHER_MESSAGE]]);
      expect(heldAnnouncementKeyCount()).toBe(2);

      await rerender(views(false, true));

      expect(heldAnnouncementKeyCount()).toBe(1);

      await rerender(views(false, false));

      expect(heldAnnouncementKeyCount()).toBe(0);
      expect(announce).toHaveBeenCalledTimes(2);
    });

    it('keeps keys apart', async () => {
      const announce = spyOnAnnounce();

      await render(
        <Holders
          holders={[first(MESSAGE), second(MESSAGE, OTHER_KEY), { id: 'third', message: MESSAGE }]}
        />,
      );

      expect(announce).toHaveBeenCalledTimes(3);
      expect(heldAnnouncementKeyCount()).toBe(2);
    });
  });
});

describe('announcementOf', () => {
  it('is the title alone without a message, else the title and the message on two lines', () => {
    expect(announcementOf('Something went wrong')).toBe('Something went wrong');
    expect(announcementOf('Something went wrong', MESSAGE)).toBe(FULL_MESSAGE);
  });
});
