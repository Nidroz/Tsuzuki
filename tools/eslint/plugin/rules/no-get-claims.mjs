// tsuzuki/no-get-claims: auth-js GoTrueClient.getClaims is never reached in the app and its tests
// (ADR-0014 "getClaims"). the web crypto binding of src/platform/web-crypto.ts installs a
// crypto.subtle with digest only, so 'subtle' in globalThis.crypto is true and getClaims verifies
// an asymmetric jwt locally through importKey and verify, which the binding lacks: the call would
// throw instead of falling back to getUser. a plugin rule rather than a no-restricted-syntax guard:
// flat config replaces that rule's options per block, and this one is enabled once for its files
// (eslint.config.mjs).
//
// every static way of reaching the member, called or not: a member read however its name is
// spelled (auth.getClaims, auth['getClaims'], auth[`getClaims`], optional chaining included) and a
// destructured key (const { getClaims } = auth, nested or renamed). the exact name only: a string
// or a comment mentioning it, a longer name (getClaimsCount), an object literal key (a test fake)
// and the type positions stay allowed; a name computed at run time stays out of reach of any
// static check

import { memberName, oneOf, propertyKey } from '../../selectors.mjs';

const GET_CLAIMS = oneOf(['getClaims']);

export const noGetClaims = {
  meta: {
    type: 'problem',
    docs: {
      description: 'bans auth-js getClaims, which throws under the web crypto binding',
    },
    schema: [],
    messages: {
      getClaims:
        'auth-js getClaims verifies an asymmetric JWT with crypto.subtle importKey and verify, which the app\'s Web Crypto binding (src/platform/web-crypto.ts) lacks: it would throw instead of falling back to getUser. Use auth.getUser() (ADR-0014 "getClaims").',
    },
  },
  create(context) {
    const report = (node) => {
      context.report({ node, messageId: 'getClaims' });
    };
    return {
      [`MemberExpression${memberName(GET_CLAIMS)}`]: report,
      [`ObjectPattern > ${propertyKey(GET_CLAIMS)}`]: report,
    };
  },
};
