import { describe, expect, it, jest } from '@jest/globals';

import { server } from '../../../../test/core/msw-server';
import { AuthError } from '../../errors/auth-errors';
import { OTHER_USER_ID } from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import { gotrueError, setupUserGone } from './__fixtures__/user-gone';
import { MAX_PENDING_GONE_USERS } from './user-gone-detector';

// how a user gone reaches the listeners (ADR-0018, update of 2026-11-04): one check at a time,
// every subscribed listener, a detection without a listener kept for the next one and delivered
// once, unsubscribe. what reports a user gone: auth-repository-user-gone.test.ts

const userIdOf = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

// a user gone setup whose GET /auth/v1/user answers user_not_found
const setupGone = () => {
  const setup = setupUserGone();
  server.use(setup.userHandler);
  setup.answerUser(() => gotrueError(403, 'user_not_found'));
  return setup;
};

const createListener = () => jest.fn<(userId: string) => void>();

describe('onUserGone delivery', () => {
  it('runs one check at a time: a refusal during a check starts none', async () => {
    const { repository, refusals, refuseAndCheck, userChecks, getSession } = setupGone();
    const listener = createListener();
    repository.onUserGone(listener);

    refusals.notify();
    refusals.notify();
    await refuseAndCheck();

    // the second and the third refusal came during the first check
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(userChecks).toHaveLength(1);
    expect(listener.mock.calls).toStrictEqual([[USER_ID]]);

    await refuseAndCheck();

    expect(userChecks).toHaveLength(2);
    expect(listener.mock.calls).toStrictEqual([[USER_ID], [USER_ID]]);
  });

  it('calls every subscribed listener, in subscription order', async () => {
    const { repository, refuseAndCheck } = setupGone();
    const calls: string[] = [];
    repository.onUserGone((userId) => calls.push(`first:${userId}`));
    repository.onUserGone((userId) => calls.push(`second:${userId}`));

    await refuseAndCheck();

    expect(calls).toStrictEqual([`first:${USER_ID}`, `second:${USER_ID}`]);
  });

  it('stops calling a listener once unsubscribed', async () => {
    const { repository, refuseAndCheck } = setupGone();
    const kept = createListener();
    const dropped = createListener();
    repository.onUserGone(kept);
    const unsubscribe = repository.onUserGone(dropped);

    unsubscribe();
    await refuseAndCheck();

    expect(kept.mock.calls).toStrictEqual([[USER_ID]]);
    expect(dropped).not.toHaveBeenCalled();
  });

  it('delivers a detection made without a listener to the next one, once, asynchronously', async () => {
    const { repository, refuseAndCheck } = setupGone();
    await refuseAndCheck();

    const late = createListener();
    repository.onUserGone(late);
    expect(late).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(0);
    expect(late.mock.calls).toStrictEqual([[USER_ID]]);

    const later = createListener();
    repository.onUserGone(later);
    await jest.advanceTimersByTimeAsync(0);
    expect(later).not.toHaveBeenCalled();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('keeps a detection for the next listener when the first unsubscribes before delivery', async () => {
    const { repository, refuseAndCheck } = setupGone();
    await refuseAndCheck();

    const gone = createListener();
    repository.onUserGone(gone)();
    const next = createListener();
    repository.onUserGone(next);
    await jest.advanceTimersByTimeAsync(0);

    expect(gone).not.toHaveBeenCalled();
    expect(next.mock.calls).toStrictEqual([[USER_ID]]);
  });

  it('keeps a detection made after every listener unsubscribed', async () => {
    const { repository, refuseAndCheck } = setupGone();
    repository.onUserGone(createListener())();
    await refuseAndCheck();

    const next = createListener();
    repository.onUserGone(next);
    await jest.advanceTimersByTimeAsync(0);

    expect(next.mock.calls).toStrictEqual([[USER_ID]]);
  });

  it('keeps each user once, and only the most recent ones, while nobody listens', async () => {
    const { repository, refuseAndCheck, storeSession } = setupGone();
    const userIds = Array.from({ length: MAX_PENDING_GONE_USERS + 1 }, (_, index) =>
      userIdOf(index + 1),
    );
    for (const userId of userIds) {
      storeSession(userId);
      await refuseAndCheck();
    }
    // the oldest user kept, detected again: kept once, now the most recent
    storeSession(userIds[1] ?? '');
    await refuseAndCheck();

    const next = createListener();
    repository.onUserGone(next);
    await jest.advanceTimersByTimeAsync(0);

    expect(next.mock.calls).toStrictEqual([
      ...userIds.slice(2).map((userId) => [userId]),
      [userIds[1]],
    ]);
  });

  it('reports a listener that throws as unknown and still calls the others', async () => {
    const { repository, refuseAndCheck, captureError, storeSession } = setupGone();
    storeSession(OTHER_USER_ID);
    repository.onUserGone(() => {
      throw new Error(`listener failed for ${OTHER_USER_ID}`);
    });
    const other = createListener();
    repository.onUserGone(other);

    await refuseAndCheck();

    expect(other.mock.calls).toStrictEqual([[OTHER_USER_ID]]);
    expect(captureError.mock.calls).toStrictEqual([
      [new AuthError('unknown'), { source: 'auth', tags: { operation: 'user-gone' } }],
    ]);
  });
});
