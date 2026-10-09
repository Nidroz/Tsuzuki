import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { SessionStorage } from '../session-storage';
import type { Database } from './database.types';

interface SupabaseClientConfig {
  url: string;
  // the public anon key: the service role key never reaches the app (CONTRIBUTING §7)
  anonKey: string;
  sessionStorage: SessionStorage;
}

/** a supabase client whose auth session is stored only in `sessionStorage`. */
export const createSupabaseClient = ({
  url,
  anonKey,
  sessionStorage,
}: SupabaseClientConfig): SupabaseClient<Database> =>
  createClient<Database>(url, anonKey, {
    auth: {
      storage: sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      // mobile: the app parses its own deep links and validates them with zod
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
