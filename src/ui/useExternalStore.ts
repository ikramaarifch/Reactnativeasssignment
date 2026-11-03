import { useSyncExternalStore } from 'react';
import { EngineState, UploadEngine } from '../core/UploadEngine';
import { ReviewController } from '../review/ReviewController';
import { ReviewState } from '../review/types';
import { FaultConfig, FaultController } from '../transport/FaultyTransport';

/** Thin, read-only bindings: the UI observes engine state, it never contains upload logic. */
export const useEngineState = (engine: UploadEngine): EngineState =>
  useSyncExternalStore(engine.subscribe, engine.getState);

export const useFaultConfig = (faults: FaultController): FaultConfig =>
  useSyncExternalStore(faults.subscribe, faults.get);

export const useReviewState = (controller: ReviewController): ReviewState =>
  useSyncExternalStore(controller.subscribe, controller.getState);
