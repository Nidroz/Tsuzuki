import { describe, expect, it } from '@jest/globals';

import { AUTH_CODE_MAX_LENGTH } from './auth-link-params';
import { OAUTH_REDIRECT_MAX_LENGTH, parseOAuthRedirect } from './oauth-redirect';

const REDIRECT_URL = 'tsuzuki://auth/oauth-callback';
const CODE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FLOW_ID = 'aaaaaaaa-flow-id';
const PARAMS = `sb_flow_id=${FLOW_ID}&code=${CODE}`;
const DECLINE = 'error=access_denied&error_description=User+denied';
const REFUSAL = 'error=access_denied&error_code=signup_disabled&error_description=Signups+disabled';

const CODE_REDIRECT = { kind: 'code', link: { code: CODE, flowId: FLOW_ID } };
const FAILED = { kind: 'failed' };
const DECLINED = { kind: 'declined' };

const parse = (url: string) => parseOAuthRedirect(url, REDIRECT_URL);

describe('parseOAuthRedirect', () => {
  it.each([
    ['the query', `${REDIRECT_URL}?${PARAMS}`],
    ['the fragment', `${REDIRECT_URL}#${PARAMS}`],
    ['both parts', `${REDIRECT_URL}?sb_flow_id=${FLOW_ID}#code=${CODE}`],
    ['escaped values', `${REDIRECT_URL}?sb_flow_id=aaaaaaaa%2Dflow%2Did&code=${CODE}`],
    ['unknown and empty params', `${REDIRECT_URL}?&state&${PARAMS}&sb=&`],
  ])('gives the code and the flow id from %s', (_label, url) => {
    expect(parse(url)).toStrictEqual(CODE_REDIRECT);
  });

  it.each([
    ['another path', `tsuzuki://auth/callback?${PARAMS}`],
    ['another scheme case', `TSUZUKI://auth/oauth-callback?${PARAMS}`],
    ['a longer path', `${REDIRECT_URL}/x?${PARAMS}`],
    ['a path that only starts the same', `${REDIRECT_URL}x?${PARAMS}`],
    ['the redirect url inside another url', `https://example.com/?r=${REDIRECT_URL}?${PARAMS}`],
    ['no params at all', REDIRECT_URL],
    ['an empty url', ''],
  ])('fails %s', (_label, url) => {
    expect(parse(url)).toStrictEqual(FAILED);
  });

  it('accepts a url of the maximum length and fails a longer one', () => {
    const base = `${REDIRECT_URL}?${PARAMS}&pad=`;
    const longest = base + 'a'.repeat(OAUTH_REDIRECT_MAX_LENGTH - base.length);

    expect(parse(longest)).toStrictEqual(CODE_REDIRECT);
    expect(parse(`${longest}a`)).toStrictEqual(FAILED);
  });

  it.each([
    ['a code repeated in the query', `${REDIRECT_URL}?${PARAMS}&code=${CODE}`],
    ['a code in the query and the fragment', `${REDIRECT_URL}?${PARAMS}#code=${CODE}`],
    ['a flow id in the query and the fragment', `${REDIRECT_URL}?${PARAMS}#sb_flow_id=${FLOW_ID}`],
    ['a repeat spelled with an escape', `${REDIRECT_URL}?${PARAMS}&co%64e=${CODE}`],
    ['an error repeated in the fragment', `${REDIRECT_URL}#error=access_denied&error=x`],
    ['an unknown param in both parts', `${REDIRECT_URL}?${PARAMS}&state=a#state=a`],
  ])('fails %s', (_label, url) => {
    expect(parse(url)).toStrictEqual(FAILED);
  });

  it.each([
    ['in the code', `${REDIRECT_URL}?sb_flow_id=${FLOW_ID}&code=%E0%A4%A`],
    ['in a key', `${REDIRECT_URL}?${PARAMS}&%ZZ=a`],
    ['in an unknown value', `${REDIRECT_URL}?${PARAMS}&state=%`],
  ])('fails a malformed escape %s', (_label, url) => {
    expect(parse(url)).toStrictEqual(FAILED);
  });

  it.each([
    ['in the query', `${REDIRECT_URL}?sb_flow_id=${FLOW_ID}&error=access_denied`],
    ['in the fragment', `${REDIRECT_URL}#error=access_denied&error_description=User+denied`],
    ['next to a code', `${REDIRECT_URL}?${PARAMS}&error=access_denied`],
    // supabase copies the error params into the fragment as well as the query
    ['in both parts', `${REDIRECT_URL}?sb_flow_id=${FLOW_ID}&${DECLINE}#${DECLINE}`],
  ])('reads a declined consent %s as declined', (_label, url) => {
    expect(parse(url)).toStrictEqual(DECLINED);
  });

  it.each([
    ['declined', '?error=access_denied#error=server_error', DECLINED],
    ['failed', '?error=server_error#error=access_denied', FAILED],
  ])('reads an error in both parts from the query, as %s', (_label, params, expected) => {
    expect(parse(`${REDIRECT_URL}${params}`)).toStrictEqual(expected);
  });

  it.each([
    [
      'access_denied with an error code in both parts',
      `?sb_flow_id=${FLOW_ID}&${REFUSAL}#${REFUSAL}`,
    ],
    ['another error', '?error=server_error&error_description=access_denied'],
    ['an error code alone', '?error_code=bad_oauth_callback'],
    ['another error next to a code', `?${PARAMS}&error=invalid_request`],
    ['an empty error', `?${PARAMS}&error=`],
  ])('fails %s', (_label, params) => {
    expect(parse(`${REDIRECT_URL}${params}`)).toStrictEqual(FAILED);
  });

  it.each([
    ['a missing code', `sb_flow_id=${FLOW_ID}`],
    ['a missing flow id', `code=${CODE}`],
    ['a code too long', `sb_flow_id=${FLOW_ID}&code=${'a'.repeat(AUTH_CODE_MAX_LENGTH + 1)}`],
    ['a code outside its characters', `sb_flow_id=${FLOW_ID}&code=abc+def`],
    ['a flow id too short', `sb_flow_id=aaaaaaa&code=${CODE}`],
  ])('fails %s', (_label, params) => {
    expect(parse(`${REDIRECT_URL}?${params}`)).toStrictEqual(FAILED);
  });
});
