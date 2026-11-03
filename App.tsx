import { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getServices } from './src/app/services';
import { DevSettingsScreen } from './src/ui/DevSettingsScreen';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const services = getServices();

  // Load the queue from disk and resume anything unfinished.
  useEffect(() => {
    services.engine.start();
    return () => {
      services.engine.stop();
    };
  }, [services]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <DevSettingsScreen {...services} />
    </SafeAreaProvider>
  );
}

export default App;
