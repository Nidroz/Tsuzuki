// the delete-account edge function, platform free (web Request and Response only) so the app
// tooling lints, typechecks and tests it; the deno entry index.ts only wires the ports.
// security model (docs/adr/0018-sign-out-purge-and-account-deletion.md):
// - the user id comes only from the user the auth server returns for the bearer token. the body
//   and the query are never read, so a request cannot name another user
// - every body is a fixed json from one table: no error text, id, token or key leaves the function
// - no cors header: the caller is the mobile app, and a web page's preflight gets no cors answer
// - no logging: the platform logs the status of each invocation, nothing personal

export type VerifiedUser =
  | { readonly status: 'verified'; readonly userId: string }
  | { readonly status: 'refused' } // an auth 4xx, or no user
  | { readonly status: 'unavailable' }; // the auth server unreachable, or a 5xx

export type DeletionOutcome = 'deleted' | 'not-found' | 'failed';

export interface DeleteAccountPorts {
  // a real check of the token by the auth server, never a local decode
  verifyUser(token: string): Promise<VerifiedUser>;
  // a hard delete: the foreign keys cascade to every row of the user
  deleteUser(userId: string): Promise<DeletionOutcome>;
}

export interface DeleteAccountEnv {
  readonly url: string;
  readonly serviceRoleKey: string;
}

// the parts of a supabase auth error the ports read (AuthError of @supabase/auth-js)
export interface AuthFailure {
  readonly status?: number | undefined;
  readonly code?: string | undefined;
}

// the answer of auth.getUser(token)
export interface AuthUserResult {
  readonly data: { readonly user: { readonly id: string } | null };
  readonly error: AuthFailure | null;
}

// the answer of auth.admin.deleteUser(userId)
export interface AuthDeletionResult {
  readonly error: AuthFailure | null;
}

// both provided by the platform to every function: no secret to set
const URL_ENV = 'SUPABASE_URL';
const SERVICE_ROLE_KEY_ENV = 'SUPABASE_SERVICE_ROLE_KEY';

const ALLOWED_METHOD = 'POST';
const BEARER_PREFIX = 'Bearer ';
// a jwt: three base64url segments. the bound keeps an oversized header away from the auth server
const TOKEN_PATTERN = /^[\w-]+\.[\w-]+\.[\w-]+$/;
const MAX_TOKEN_LENGTH = 8192;
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_SERVICE_UNAVAILABLE = 503;
// the auth error code of an unknown user id
const USER_NOT_FOUND_CODE = 'user_not_found';

const RESPONSES = {
  deleted: { status: HTTP_OK, body: { deleted: true } },
  'method-not-allowed': {
    status: HTTP_METHOD_NOT_ALLOWED,
    body: { error: 'method-not-allowed' },
  },
  'server-misconfigured': {
    status: HTTP_INTERNAL_SERVER_ERROR,
    body: { error: 'server-misconfigured' },
  },
  unauthorized: { status: HTTP_UNAUTHORIZED, body: { error: 'unauthorized' } },
  unavailable: { status: HTTP_SERVICE_UNAVAILABLE, body: { error: 'unavailable' } },
  'deletion-failed': { status: HTTP_INTERNAL_SERVER_ERROR, body: { error: 'deletion-failed' } },
} as const;

type Outcome = keyof typeof RESPONSES;

const FIXED_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } as const;

const UNAVAILABLE: VerifiedUser = { status: 'unavailable' };
const REFUSED: VerifiedUser = { status: 'refused' };

const respond = (outcome: Outcome): Response => {
  const { status, body } = RESPONSES[outcome];
  const headers =
    outcome === 'method-not-allowed' ? { ...FIXED_HEADERS, Allow: ALLOWED_METHOD } : FIXED_HEADERS;
  return new Response(JSON.stringify(body), { status, headers });
};

// exactly "Bearer <token>": any other scheme, spacing or token shape is refused before a port runs
const readBearerToken = (request: Request): string | null => {
  const header = request.headers.get('Authorization');
  if (header === null || !header.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = header.slice(BEARER_PREFIX.length);
  return token.length <= MAX_TOKEN_LENGTH && TOKEN_PATTERN.test(token) ? token : null;
};

// a port that throws gets its fixed answer and is never logged: its message may hold personal data
const verify = async (ports: DeleteAccountPorts, token: string): Promise<VerifiedUser> => {
  try {
    return await ports.verifyUser(token);
  } catch {
    return UNAVAILABLE;
  }
};

const remove = async (ports: DeleteAccountPorts, userId: string): Promise<DeletionOutcome> => {
  try {
    return await ports.deleteUser(userId);
  } catch {
    return 'failed';
  }
};

// null ports: the env is missing
export const createDeleteAccountHandler =
  (ports: DeleteAccountPorts | null) =>
  async (request: Request): Promise<Response> => {
    if (request.method !== ALLOWED_METHOD) {
      return respond('method-not-allowed');
    }
    if (ports === null) {
      return respond('server-misconfigured');
    }
    const token = readBearerToken(request);
    if (token === null) {
      return respond('unauthorized');
    }
    const verified = await verify(ports, token);
    if (verified.status === 'refused') {
      return respond('unauthorized');
    }
    if (verified.status !== 'verified') {
      return respond('unavailable');
    }
    if (!UUID_PATTERN.test(verified.userId)) {
      return respond('deletion-failed');
    }
    // only an explicit success answers deleted; "not found" means already gone, so a retry is safe
    const outcome = await remove(ports, verified.userId);
    return respond(
      outcome === 'deleted' || outcome === 'not-found' ? 'deleted' : 'deletion-failed',
    );
  };

const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '';

export const readDeleteAccountEnv = (
  get: (name: string) => string | undefined,
): DeleteAccountEnv | null => {
  const url = get(URL_ENV);
  const serviceRoleKey = get(SERVICE_ROLE_KEY_ENV);
  return present(url) && present(serviceRoleKey) ? { url, serviceRoleKey } : null;
};

// a client error refuses the token (bad, expired or revoked, its user or session gone); no answer,
// a server error, a timeout or a rate limit leaves the token unjudged: the auth server is unavailable
const refusesToken = (status: number | undefined): boolean =>
  status !== undefined &&
  status >= HTTP_CLIENT_ERROR_MIN &&
  status < HTTP_SERVER_ERROR_MIN &&
  status !== HTTP_REQUEST_TIMEOUT &&
  status !== HTTP_TOO_MANY_REQUESTS;

export const toVerifiedUser = ({ data, error }: AuthUserResult): VerifiedUser => {
  if (error !== null) {
    return refusesToken(error.status) ? REFUSED : UNAVAILABLE;
  }
  return data.user === null ? REFUSED : { status: 'verified', userId: data.user.id };
};

export const toDeletionOutcome = ({ error }: AuthDeletionResult): DeletionOutcome => {
  if (error === null) {
    return 'deleted';
  }
  return error.status === HTTP_NOT_FOUND || error.code === USER_NOT_FOUND_CODE
    ? 'not-found'
    : 'failed';
};
