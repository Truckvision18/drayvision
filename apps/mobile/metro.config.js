const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const repoRoot = path.resolve(__dirname, '../..');
const sharedRoot = path.resolve(repoRoot, 'packages/shared');

/**
 * Monorepo Metro config:
 * - watch packages/shared so edits hot-reload,
 * - resolve node_modules from this app only (it is installed standalone, outside npm workspaces),
 * - map NodeNext-style `./x.js` imports inside packages/shared to their `.ts` sources.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [sharedRoot],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    resolveRequest: (context, moduleName, platform) => {
      if (
        context.originModulePath.startsWith(sharedRoot) &&
        moduleName.startsWith('.') &&
        moduleName.endsWith('.js')
      ) {
        return context.resolveRequest(context, moduleName.replace(/\.js$/, '.ts'), platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
