// ── Motion sense — dynamic world-point sources ─────────────────

/** A model-free moving point set (for example an event mosquito swarm) that
 * the existing motion trail system can consume without mesh traversal. */
export interface MotionPointSource {
  readonly id: string;
  readonly maxPoints: number;
  readonly particleSizeScale?: number;
  /** Keep this source's motion trail active independently of the global sense. */
  readonly alwaysEnabled?: boolean;
  getWorldPositions(): Float32Array;
  isActive(): boolean;
}

export const MOTION_POINT_SOURCE_REGISTER = "motion:point-source-register";
export const MOTION_POINT_SOURCE_UNREGISTER = "motion:point-source-unregister";
