/**
 * the secure store and the random source of the device the root layout opens its app storage on
 * (openAppStorage, ADR-0020), in memory, for the route tests. with the shared mmkv instances of
 * shared-mmkv.ts, the first load of the layout is a first launch on a working device: a key drawn
 * from the fake random source (src/platform/__fixtures__/expo-crypto-device.ts) is stored in the
 * fake secure store (src/platform/__fixtures__/app-storage-device.ts, whose mmkv files these tests
 * do not use), and the encrypted instance is created and used, under APP_STORAGE_INSTANCE_ID. the
 * session storage and the owed purges use the same secure store. use them from jest.mock factories:
 * `jest.mock('expo-secure-store', () => jest.requireActual<typeof AppDevice>('../mobile/app-device').fakeSecureStoreModule())`
 * `jest.mock('expo-crypto', () => jest.requireActual<typeof AppDevice>('../mobile/app-device').fakeCryptoModule())`
 */
export { fakeSecureStoreModule } from '@platform/__fixtures__/app-storage-device';
export { fakeExpoCryptoModule as fakeCryptoModule } from '@platform/__fixtures__/expo-crypto-device';
