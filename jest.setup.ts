import "@testing-library/jest-native/extend-expect";

if (!global.window) {
  // @ts-expect-error - test environment shim for react-navigation / react-native web globals
  global.window = {
    dispatchEvent: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
}

if (!global.document) {
  // @ts-expect-error - minimal DOM shim for React Native test env
  global.document = {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
}
