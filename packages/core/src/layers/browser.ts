import { BrowserHttpClient, BrowserKeyValueStore } from "@effect/platform-browser";

export const BrowserHttpLayer = BrowserHttpClient.layerXMLHttpRequest;
export const BrowserKeyValueStoreLayer = BrowserKeyValueStore.layerLocalStorage;
