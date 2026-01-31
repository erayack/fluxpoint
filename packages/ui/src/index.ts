// Re-export Svelte components from this package.
export { default as ErrorMessage } from "./components/ErrorMessage.svelte";

// Re-export error utilities.
export { ApiClientError, getErrorMessage, isApiClientError } from "./errors.js";
