import { describe, expect, it } from '@jest/globals';

import { AUTH_CODE_MAX_LENGTH, AUTH_FLOW_ID_PARAM, parseAuthLinkParams } from './auth-link-params';

const CODE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FLOW_ID = 'Ab3_d-Ef9Gh2iJk4';

const INVALID = { kind: 'failed', reason: 'invalid' };

describe('parseAuthLinkParams', () => {
  it('gives the code and the flow id of a link', () => {
    expect(AUTH_FLOW_ID_PARAM).toBe('sb_flow_id');
    expect(parseAuthLinkParams({ sb_flow_id: FLOW_ID, code: CODE })).toStrictEqual({
      kind: 'code',
      link: { code: CODE, flowId: FLOW_ID },
    });
  });

  it('ignores unknown params', () => {
    expect(parseAuthLinkParams({ sb_flow_id: FLOW_ID, code: CODE, type: 'signup' })).toStrictEqual({
      kind: 'code',
      link: { code: CODE, flowId: FLOW_ID },
    });
  });

  it.each([
    ['the shortest flow id', 'a'.repeat(8)],
    ['the longest flow id', 'a'.repeat(64)],
  ])('accepts %s', (_label, flowId) => {
    expect(parseAuthLinkParams({ sb_flow_id: flowId, code: CODE })).toMatchObject({ kind: 'code' });
  });

  it('accepts a code of the maximum length and rejects a longer one', () => {
    const longest = 'a'.repeat(AUTH_CODE_MAX_LENGTH);

    expect(parseAuthLinkParams({ sb_flow_id: FLOW_ID, code: longest })).toMatchObject({
      kind: 'code',
    });
    expect(parseAuthLinkParams({ sb_flow_id: FLOW_ID, code: `${longest}a` })).toStrictEqual(
      INVALID,
    );
  });

  it('reads an expired token as expired, without reading the description', () => {
    expect(
      parseAuthLinkParams({
        sb_flow_id: FLOW_ID,
        error: 'access_denied',
        error_code: 'otp_expired',
        error_description: 'Email link is invalid or has expired',
      }),
    ).toStrictEqual({ kind: 'failed', reason: 'expired' });
  });

  it.each([
    ['another error code', { error: 'server_error', error_code: 'unexpected_failure' }],
    ['an error without a code', { error: 'access_denied' }],
    ['an error code without an error', { error_code: 'flow_state_not_found' }],
    ['an error next to a code', { sb_flow_id: FLOW_ID, code: CODE, error: 'access_denied' }],
    ['an expired code repeated as an array', { error: 'x', error_code: ['otp_expired'] }],
  ])('fails %s as invalid', (_label, params) => {
    expect(parseAuthLinkParams(params)).toStrictEqual(INVALID);
  });

  it.each([
    ['no params', {}],
    ['a missing flow id', { code: CODE }],
    ['a missing code', { sb_flow_id: FLOW_ID }],
    ['an empty code', { sb_flow_id: FLOW_ID, code: '' }],
    ['a code outside its characters', { sb_flow_id: FLOW_ID, code: 'abc def' }],
    ['a flow id too short', { sb_flow_id: 'a'.repeat(7), code: CODE }],
    ['a flow id too long', { sb_flow_id: 'a'.repeat(65), code: CODE }],
    ['a flow id outside its characters', { sb_flow_id: 'abc.def/ghi', code: CODE }],
    ['a repeated code', { sb_flow_id: FLOW_ID, code: [CODE, CODE] }],
    ['a repeated flow id', { sb_flow_id: [FLOW_ID], code: CODE }],
    ['an array of params', [{ sb_flow_id: FLOW_ID, code: CODE }]],
    ['a string', `sb_flow_id=${FLOW_ID}&code=${CODE}`],
    ['null', null],
    ['undefined', undefined],
  ])('reads %s as invalid', (_label, params) => {
    expect(parseAuthLinkParams(params)).toStrictEqual(INVALID);
  });
});
