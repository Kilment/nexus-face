// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const exclusionList = require("metro-config/private/defaults/exclusionList").default;

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Tooling / CI dirs (e.g. `.local/state/workflow-logs/...`) are created and removed while Metro
// is running. The fallback watcher can throw ENOENT if a watched path disappears; ignore these trees.
config.resolver.blockList = [
  exclusionList(),
  /[/\\](\.local|\.cache)([/\\]|$)/,
];

module.exports = config;
