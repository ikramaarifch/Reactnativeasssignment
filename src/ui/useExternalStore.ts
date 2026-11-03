import { useSyncExternalStore } from 'react';
import { EngineState, UploadEngine } from '../core/UploadEngine';
import { FaultConfig, FaultController } from '../transport/FaultyTransport';

/** Thin, read-only bindings: the UI observes engine state, it never contains upload logic. */
export const useEngineState = (engine: UploadEngine): EngineState =>
  useSyncExternalStore(engine.subscribe, engine.getState);

export const useFaultConfig = (faults: FaultController): FaultConfig =>
  useSyncExternalStore(faults.subscribe, faults.get);
