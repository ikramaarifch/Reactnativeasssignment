import { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { rnAppState } from './src/app/rnAppState';
import { getServices } from './src/app/services';
import { startRetryTriggers } from './src/app/triggers';
import { startBackground } from './src/background/startBackground';
import { AppShell } from './src/ui/AppShell';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const services = getServices();

  // Load the queue from disk and resume anything unfinished.
  useEffect(() => {
    services.engine.start();
    // Retry immediately when the network returns or the app comes to the front.
    const stopTriggers = startRetryTriggers(services.engine, services.connectivity, rnAppState);
    // Keep a foreground service (with a progress notification) alive while uploads are pending.
    const stopBackground = startBackground(
      services.background,
      services.engine,
      services.connectivity,
      rnAppState,
    );
    return () => {
      stopBackground();
      stopTriggers();
      services.engine.stop();
    };
  }, [services]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppShell services={services} />
    </SafeAreaProvider>
  );
}

export default App;
