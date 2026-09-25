/**
 * The app logger writes through `console.debug` / `console.info`.
 *
 * Location state transitions and realtime connection changes fire on every
 * status update, which is hundreds of lines per suite and drowns out real
 * failures. Suppress exactly those two levels; `console.warn` and
 * `console.error` stay visible because they carry actual problems.
 */
const originalDebug = console.debug;
const originalInfo = console.info;

beforeAll(() => {
  console.debug = () => undefined;
  console.info = () => undefined;
});

afterAll(() => {
  console.debug = originalDebug;
  console.info = originalInfo;
});
