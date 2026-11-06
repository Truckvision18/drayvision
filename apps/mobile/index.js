/**
 * @format
 */
import { z } from 'zod';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

// Hermes has no runtime code generation (`new Function`); keep zod on its interpreted path.
z.config({ jitless: true });

AppRegistry.registerComponent(appName, () => App);
