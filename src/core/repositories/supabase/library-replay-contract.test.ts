import { describeAccountLibraryReplayContract } from '../../../../test/core/account-library-replay-contract';
import { server } from '../../../../test/core/msw-server';
import { createAccountLibrary, seedEntries } from './__fixtures__/account-library';

// the replay contract of the account store, over the postgrest fake whose model of the database
// function follows the sql one (supabase/migrations/*_replay_library_writes.sql)
describeAccountLibraryReplayContract('supabase account', (seed) => {
  const { backend, repository } = createAccountLibrary();
  server.use(backend.handler);
  seedEntries(backend, seed);
  return repository;
});
