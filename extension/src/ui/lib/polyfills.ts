// Some react-native-web internals expect `global` to exist (ex: Animated spring).
// In MV3 extension pages we rely on the browser runtime, so polyfill it.
const globalRef = globalThis as unknown as { global?: unknown };
if (!globalRef.global) {
  globalRef.global = globalThis;
}
