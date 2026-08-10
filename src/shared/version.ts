// -- Build version --------------------------------------------------------------

function extensionVersion(): string {
  return chrome.runtime.getManifest().version;
}

export { extensionVersion };
