import { setupServer } from 'msw/node';

// no default handlers: each test declares the responses it needs with server.use()
export const server = setupServer();
