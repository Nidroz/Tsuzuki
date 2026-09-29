// base branch policy for pull requests (CONTRIBUTING.md section 2): work branches start from dev and
// target dev; only dev (release), hotfix branches and the release-please branch target main

const POLICY = 'see CONTRIBUTING.md section 2';

export const PROTECTED_BASE = 'main';

// heads allowed to target main, and only from this repository (a fork branch named dev is rejected).
// release-please names its branch after the target branch, optionally followed by the component
export const MAIN_HEADS = {
  release: 'dev',
  hotfixPrefix: 'hotfix/',
  releasePlease: 'release-please--branches--main',
  releasePleaseComponentPrefix: 'release-please--branches--main--components--',
};

const isMissing = (value) => typeof value !== 'string' || value.trim() === '';

// a prefix alone is not a branch: something must follow it
const hasPrefixAndSuffix = (headRef, prefix) =>
  headRef.startsWith(prefix) && headRef.length > prefix.length;

const isAllowedMainHead = (headRef) =>
  headRef === MAIN_HEADS.release ||
  hasPrefixAndSuffix(headRef, MAIN_HEADS.hotfixPrefix) ||
  headRef === MAIN_HEADS.releasePlease ||
  hasPrefixAndSuffix(headRef, MAIN_HEADS.releasePleaseComponentPrefix);

// returns null when the pull request may target its base branch, else the violation message.
// fails closed: any missing input is a violation
export const baseBranchViolation = ({ baseRef, headRef, headRepo, repository }) => {
  const inputs = { baseRef, headRef, headRepo, repository };
  const missing = Object.keys(inputs).filter((name) => isMissing(inputs[name]));
  if (missing.length > 0) {
    return `missing pull request metadata: ${missing.join(', ')} (${POLICY})`;
  }
  if (baseRef !== PROTECTED_BASE) {
    return null;
  }
  if (headRepo !== repository) {
    return `pull requests to ${PROTECTED_BASE} come from branches of ${repository} only, not from ${headRepo} (${POLICY})`;
  }
  if (isAllowedMainHead(headRef)) {
    return null;
  }
  return `${headRef} cannot target ${PROTECTED_BASE}: work branches target ${MAIN_HEADS.release}; only ${MAIN_HEADS.release}, ${MAIN_HEADS.hotfixPrefix}*, ${MAIN_HEADS.releasePlease} and ${MAIN_HEADS.releasePleaseComponentPrefix}* target ${PROTECTED_BASE} (${POLICY})`;
};
