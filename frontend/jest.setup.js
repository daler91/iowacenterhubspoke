// jsdom does not provide TextEncoder/TextDecoder, but react-router-dom v7
// touches them at import time. Without this, any test that imports the router
// dies with "ReferenceError: TextEncoder is not defined" before a single
// assertion runs.
//
// This used to be worked around per-file by smuggling the polyfill into a
// `jest.mock('react-router-dom', ...)` factory — which only helped files that
// happened to mock the router.
const { TextDecoder, TextEncoder } = require('node:util');

globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder;
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder;
