/**
 * Views Module
 *
 * Exports ViewMaterializer and WebSocket transport for Wheelhaus control room.
 */

export {
  ViewMaterializer,
  getViewMaterializer,
  resetViewMaterializer,
  type ActiveSessionView,
  type DecisionStreamItem,
  type TaskGraphNode,
  type ContextHealthMetrics,
  type ViewDelta,
  type MaterializedViews,
  type InitialDataLoader,
} from './view-materializer.js';

export {
  WheelhausWebSocket,
  type WebSocketClient,
  type WheelhausMessage,
  type WheelhausResponse,
} from './websocket-transport.js';
