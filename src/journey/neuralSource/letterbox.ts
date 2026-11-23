/**
 * Type-only shim: the copied `machineFraming.ts` imports `Rect` from "./letterbox". The original letterbox
 * helper is not part of this bridge (the interactive framing always fills the host), so only the shape is declared.
 */
export interface Rect { x: number; y: number; width: number; height: number }
