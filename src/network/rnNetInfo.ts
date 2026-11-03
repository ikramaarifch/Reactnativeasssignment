import NetInfo from '@react-native-community/netinfo';
import { ConnectivityMonitor, ConnectivityPort } from './ConnectivityMonitor';

const netInfoPort: ConnectivityPort = {
  subscribe: listener =>
    NetInfo.addEventListener(state => {
      // isInternetReachable is null while unknown: treat that as "connected".
      listener(state.isConnected === true && state.isInternetReachable !== false);
    }),
};

export const createConnectivityMonitor = (): ConnectivityMonitor =>
  new ConnectivityMonitor(netInfoPort);
