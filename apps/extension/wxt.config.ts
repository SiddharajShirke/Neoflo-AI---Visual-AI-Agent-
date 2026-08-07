import { defineConfig } from 'wxt';
import { extensionName, manifestControlPlane } from './src/manifest';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: extensionName,
    version: '0.0.0',
    ...manifestControlPlane
  }
});
