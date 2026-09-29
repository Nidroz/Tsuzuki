// base branch policy for pull requests (CONTRIBUTING.md section 2): work branches start from dev and
// target dev; only dev (release), hotfix branches and the release-please branch target main

const POLICY = 'see CONTRIBUTING.md section 2';

export const PROTECTED_BASE = 'main';

// heads allowed to target main, and only from this repository (a fork branch named dev is rejected)
export const MAIN_HEADS = {
  release: 'dev',
  hotfixPrefix: 'hotfix/',
  releasePleasePrefix: 'release-please--branches--main',
};

const isMissing = (value) => typeof value !== 'string' || value.trim() === '';

const isAllowedMainHead = (headRef) =>
  headRef === MAIN_HEADS.release ||
  (headRef.startsWith(MAIN_HEADS.hotfixPrefix) &&
    headRef.length > MAIN_HEADS.hotfixPrefix.length) ||
  headRef.startsWith(MAIN_HEADS.releasePleasePrefix);

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
  return `${headRef} cannot target ${PROTECTED_BASE}: work branches target ${MAIN_HEADS.release}; only ${MAIN_HEADS.release}, ${MAIN_HEADS.hotfixPrefix}* and release-please branches target ${PROTECTED_BASE} (${POLICY})`;
};
