// regression tests for tsuzuki/no-get-claims with eslint's RuleTester (ADR-0014 "getClaims"); the
// files it runs on, with the real config, are cases of the layer rule tests
// (tools/eslint/layers-get-claims-cases.mjs)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RuleTester } from 'eslint';

import { tsuzukiPlugin } from '../index.mjs';
import { noGetClaims } from './no-get-claims.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

describe('test environment', () => {
  it('registers the rule in the tsuzuki plugin', () => {
    assert.equal(tsuzukiPlugin.rules['no-get-claims'], noGetClaims);
  });
});

ruleTester.run('no-get-claims', noGetClaims, {
  valid: [
    'export const user = (auth) => auth.getUser();',
    // a comment or a string that only mentions it
    "// never getClaims\nexport const NOTE = 'getClaims would throw: use getUser';",
    // a longer name, and a test fake defining the member
    'export const fake = { count: (auth) => auth.getClaimsCount(), getClaims: () => null };',
  ],
  invalid: [
    'export const claims = (auth) => auth.getClaims();',
    'export const claims = (supabase, jwt) => supabase.auth.getClaims(jwt);',
    "export const claims = (auth) => auth['getClaims']();",
    'export const claims = (auth) => auth?.getClaims?.();',
    'export const claims = (auth) => {\n  const { getClaims } = auth;\n  return getClaims;\n};',
  ].map((code) => ({ code, errors: [{ messageId: 'getClaims' }] })),
});
