// local eslint plugin for the project rules that no published plugin covers (CONTRIBUTING.md
// section 5), and the getClaims ban (ADR-0014)

import { backlogReference } from './rules/backlog-reference.mjs';
import { fileNameCase } from './rules/file-name-case.mjs';
import { noGetClaims } from './rules/no-get-claims.mjs';

export const tsuzukiPlugin = {
  meta: { name: 'tsuzuki' },
  rules: {
    'backlog-reference': backlogReference,
    'file-name-case': fileNameCase,
    'no-get-claims': noGetClaims,
  },
};
