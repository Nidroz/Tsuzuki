// deno entry of the delete-account edge function: wiring only. the logic, the mapping of the auth
// answers included, lives in handler.ts, linted and tested with the app tooling. this file uses the
// Deno global and an npm: specifier, so it is left out of tsc and eslint, and formatted by prettier
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

import {
  createDeleteAccountHandler,
  readDeleteAccountEnv,
  toDeletionOutcome,
  toVerifiedUser,
  type DeleteAccountPorts,
} from './handler.ts';

const createPorts = (): DeleteAccountPorts | null => {
  const env = readDeleteAccountEnv((name) => Deno.env.get(name));
  if (env === null) {
    return null;
  }
  // the service role key stays in this admin client, which keeps no session
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    verifyUser: async (token) => toVerifiedUser(await admin.auth.getUser(token)),
    deleteUser: async (userId) => toDeletionOutcome(await admin.auth.admin.deleteUser(userId)),
  };
};

Deno.serve(createDeleteAccountHandler(createPorts()));
