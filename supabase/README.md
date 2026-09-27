# supabase

Database migrations, Edge Functions and pgTAP RLS tests; the project config is added in F-08.
Every table has RLS enabled with policies and pgTAP tests in the same PR, and an applied migration is never edited: create a new one instead.
The `service_role` key exists only in Edge Function secrets, never in the app.
