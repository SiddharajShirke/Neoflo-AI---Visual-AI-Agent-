import { defineConfig } from 'wxt';
import { extensionName, permissions } from './src/manifest';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: extensionName,
    version: '0.0.0',
    permissions
  }
});
