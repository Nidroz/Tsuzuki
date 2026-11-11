import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  deletionProblemsOf,
  deletionTextMatch,
  deletionTextsOf,
  linkReachesDeletion,
  readDeletionTexts,
} from './deletion-guard.mjs';
import {
  APP_ID,
  CI_VARIABLES,
  MANUAL_VARIABLES,
  METRO_URL,
  analyzeFlow,
  substituteVariables,
} from './maestro-flows.mjs';
import { linksOf, textSelectorsOf } from './step-selectors.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const TEXTS = readDeletionTexts(path.join(ROOT, 'src', 'core', 'i18n'));

// inline flows: absolute paths under a fixed fake root
const FAKE_ROOT = path.resolve('/fixture');
const HEADER = `appId: ${APP_ID}\n---\n`;
const LAUNCH = `- openLink: tsuzuki://expo-development-client/?url=\${encodeURIComponent(METRO_URL || 'http://127.0.0.1:8081')}&disableOnboarding=1\n`;
const FIXTURES = {
  'flows/clean.yaml': `${HEADER}${LAUNCH}- runFlow:\n    file: ../subflows/open-title.yaml\n    env:\n      MEDIA_PATH: mal/anime/5114\n- tapOn:\n    id: tab-settings\n- assertVisible: Development Build\n- inputText: Delete my account\n`,
  'flows/link.yaml': `${HEADER}- openLink: tsuzuki://account/delete\n- openLink:\n    link: TSUZUKI:///Account/Delete?from=e2e\n`,
  'flows/via-subflow.yaml': `${HEADER}- runFlow:\n    file: ../subflows/open-title.yaml\n    env:\n      MEDIA_PATH: ../account/delete\n- runFlow: ../subflows/nested.yaml\n`,
  'flows/text-en.yaml': `${HEADER}- tapOn: Delete my account\n- assertVisible:\n    text: 'Delete.*account'\n`,
  'flows/text-fr.yaml': `${HEADER}- tapOn:\n    text: Supprimer mon compte\n- runFlow:\n    file: ../subflows/tap.yaml\n    env:\n      LABEL: Supprimer le compte\n`,
  'flows-manual/delete.yaml': `${HEADER}- tapOn:\n    id: delete-account-confirm-confirm\n- runFlow: ../subflows/manual-only.yaml\n`,
  'subflows/open-title.yaml': `${HEADER}- openLink: tsuzuki://media/\${MEDIA_PATH}\n`,
  'subflows/nested.yaml': `${HEADER}- runFlow: open-deletion.yaml\n`,
  'subflows/open-deletion.yaml': `${HEADER}- openLink: tsuzuki://account/delete\n`,
  'subflows/tap.yaml': `${HEADER}- tapOn: \${LABEL}\n`,
  'subflows/manual-only.yaml': `${HEADER}- openLink: tsuzuki://account/delete\n- tapOn: Supprimer mon compte\n`,
};
const load = (file) => FIXTURES[path.relative(FAKE_ROOT, file).split(path.sep).join('/')] ?? null;
const analysisOf = (flow, variables) =>
  analyzeFlow(path.join(FAKE_ROOT, flow), { external: [METRO_URL, ...variables], load });
// the guard over the ci flows `flows`, as the repository test runs it
const ciProblems = (...flows) =>
  flows.flatMap((flow) => {
    const analysis = analysisOf(flow, CI_VARIABLES);
    assert.deepEqual(analysis.problems, [], flow);
    return deletionProblemsOf(analysis, TEXTS, FAKE_ROOT);
  });

describe('the deletion texts', () => {
  it('come from the en and fr catalogs, without the texts other keys share', () => {
    for (const text of [
      'Delete account',
      'Delete my account',
      'Supprimer le compte',
      'Supprimer mon compte',
      'Delete your account?',
    ]) {
      assert.ok(TEXTS.includes(text), text);
    }
    for (const text of ['Cancel', 'Annuler', 'Sign in', 'Se connecter', 'Loading your account']) {
      assert.equal(TEXTS.includes(text), false, text);
    }
  });

  it('keep a control text another key shares, and drop any other shared one ignoring case', () => {
    const catalog = {
      common: { cancel: 'cancel', remove: 'Delete account' },
      settings: {
        account: { deleteAccount: 'Delete account', signIn: 'Sign in' },
        deleteAccount: {
          delete: 'Delete account',
          heading: 'Delete your account',
          confirm: { cancel: 'Cancel', confirm: 'Delete my account' },
        },
      },
    };
    assert.deepEqual(deletionTextsOf([catalog]), [
      'Delete account',
      'Delete my account',
      'Delete your account',
    ]);
  });
});

describe('the deletion link check', () => {
  it('catches any form of a link to the route', () => {
    for (const link of [
      'tsuzuki://account/delete',
      'TSUZUKI://Account/Delete',
      'exp+tsuzuki://account/delete',
      `${APP_ID}://account/delete`,
      'tsuzuki:///account/delete',
      'tsuzuki:account/delete',
      '/account/delete',
      'tsuzuki://account/delete?from=e2e',
      'tsuzuki://account/delete#confirm',
      'tsuzuki://account//delete/',
      'tsuzuki://account/./(group)/delete',
      'tsuzuki://media/../account/delete',
      'tsuzuki://account/x/../delete',
      'tsuzuki://account%2Fdelete',
      'tsuzuki://account%252Fdelete',
      'tsuzuki://acc\tount/delete',
      'exp://127.0.0.1:8081/--/account/delete',
      'https://example.com/account/delete',
      'tsuzuki://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081%2Faccount%2Fdelete',
    ]) {
      assert.equal(linkReachesDeletion(link), true, link);
    }
  });

  it('lets the other links through', () => {
    for (const link of [
      'tsuzuki://expo-development-client/?url=http://127.0.0.1:8081&disableOnboarding=1',
      'tsuzuki://media/mal/anime/5114',
      'tsuzuki://account',
      'tsuzuki://account/deleted',
      'tsuzuki://settings?next=account',
      'tsuzuki://auth/sign-in',
    ]) {
      assert.equal(linkReachesDeletion(link), false, link);
    }
  });
});

describe('the deletion text check', () => {
  it('matches a deletion text as a literal ignoring case, or as a regex of the whole text', () => {
    assert.equal(deletionTextMatch('delete MY account', TEXTS), 'Delete my account');
    // as a regex, ` ?` is an optional space: the literal still matches
    const title = 'Supprimer votre compte ?';
    assert.equal(deletionTextMatch(title, [title]), title);
    assert.equal(deletionTextMatch('Delete m.* account', TEXTS), 'Delete my account');
    assert.equal(deletionTextMatch('(?i)SUPPRIMER MON.*', TEXTS), 'Supprimer mon compte');
    assert.notEqual(deletionTextMatch('.*', TEXTS), null);
    for (const selector of ['Delete', 'Frieren', 'Development Build', '.*e2e-.*', '.*, 8 / 10']) {
      assert.equal(deletionTextMatch(selector, TEXTS), null, selector);
    }
  });

  it('throws for a selector it cannot read as a regex', () => {
    assert.throws(() => deletionTextMatch('Delete (account', TEXTS), /cannot be checked/);
  });
});

describe('the step readers', () => {
  it('read the text selectors and links where maestro takes them, not the typed text', () => {
    const steps = [
      { tapOn: { below: 'A', containsDescendants: ['B', { text: 'C' }], label: 'L' } },
      { inputText: { text: 'D', label: 'L' } },
      { extendedWaitUntil: { visible: 'E', timeout: 1 } },
      { scrollUntilVisible: { element: 'F', direction: 'DOWN' } },
      { openLink: 'a' },
      { openLink: { link: 'b', autoVerify: true } },
      { retry: { commands: [{ openLink: 'c' }] } },
    ];
    assert.deepEqual(textSelectorsOf(steps), ['A', 'B', 'C', 'E', 'F']);
    assert.deepEqual(linksOf(steps), ['a', 'b', 'c']);
  });

  it('substitute the known values, and the string literals of any other expression', () => {
    const scope = new Map([
      ['A', 'a'],
      [METRO_URL, null],
    ]);
    const text = "s://${encodeURIComponent(METRO_URL || 'h')}/${A}/${'x' + \"y\"}/${METRO_URL}";
    assert.equal(substituteVariables(text, scope), 's://h/a/xy/');
  });
});

describe('the deletion guard on fixture flows', () => {
  it('rejects a link to the deletion route in a ci flow', () => {
    assert.deepEqual(ciProblems('flows/link.yaml'), [
      'flows/link.yaml: opens the deletion route with tsuzuki://account/delete',
      'flows/link.yaml: opens the deletion route with TSUZUKI:///Account/Delete?from=e2e',
    ]);
  });

  it('rejects a link to the deletion route in a subflow a ci flow reaches', () => {
    assert.deepEqual(ciProblems('flows/via-subflow.yaml'), [
      'subflows/open-title.yaml: opens the deletion route with tsuzuki://media/../account/delete',
      'subflows/open-deletion.yaml: opens the deletion route with tsuzuki://account/delete',
    ]);
  });

  it('rejects a deletion text selector, in english and in french', () => {
    assert.deepEqual(ciProblems('flows/text-en.yaml'), [
      'flows/text-en.yaml: selects the deletion text "Delete my account" with Delete my account',
      'flows/text-en.yaml: selects the deletion text "Delete account" with Delete.*account',
    ]);
    assert.deepEqual(ciProblems('flows/text-fr.yaml'), [
      'flows/text-fr.yaml: selects the deletion text "Supprimer mon compte" with Supprimer mon compte',
      'subflows/tap.yaml: selects the deletion text "Supprimer le compte" with Supprimer le compte',
    ]);
  });

  it('allows the deletion in the manual flows and in the subflows only they reach', () => {
    const manual = deletionProblemsOf(
      analysisOf('flows-manual/delete.yaml', MANUAL_VARIABLES),
      TEXTS,
    );
    // the fixture would fail the guard if a ci flow reached it
    assert.equal(manual.length, 3);
    assert.deepEqual(ciProblems('flows/clean.yaml'), []);
  });
});
