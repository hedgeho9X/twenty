import type { FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import type { WorkspaceEventActor } from './workspace-event-actor.type';

export type WorkspaceEventBatch<WorkspaceEvent> = {
  name: string;
  workspaceId: string;
  objectMetadata: FlatObjectMetadata;
  events: WorkspaceEvent[];
  actor?: WorkspaceEventActor;
};
