/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { configureFirebase } from './src/config/firebase';

// Before any Firebase call, and outside App.tsx so component tests don't load native modules.
configureFirebase();

AppRegistry.registerComponent(appName, () => App);
