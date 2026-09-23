"""
RAAHI Edge Rule-Based Traffic State Classifier (Phase 8C)
=========================================================
Classifies camera-relative traffic into discrete operating regimes:
FREE, MODERATE, HEAVY, CONGESTED using multi-factor local heuristics.

STRICT PRINCIPLES:
1. Purely rule-based logic; NO ML classifier is trained.
2. All thresholds are configurable and documented as demo/initial parameters.
3. Does NOT claim universal road standards.
"""

from dataclasses import dataclass


@dataclass
class CongestionConfig:
    """
    Configurable thresholds for rule-based traffic-state classification.
    """
    free_occupancy_max: float = 0.10
    moderate_occupancy_max: float = 0.25
    heavy_occupancy_max: float = 0.40
    congested_occupancy_min: float = 0.40
    stalled_flow_vpm_max: float = 3.0
    congested_roi_count_min: int = 6


class CongestionClassifier:
    """
    Evaluates multi-factor local metrics (occupancy ratio, vehicles in ROI,
    active vehicle count, and flow rate) to determine the traffic state.
    """
    def __init__(self, config: CongestionConfig = None):
        self.config = config if config is not None else CongestionConfig()

    def classify(
        self,
        occupancy_ratio: float,
        vehicles_in_roi: int,
        active_count: int,
        flow_vpm: float = 0.0
    ) -> str:
        """
        Classifies current traffic state into one of four states:
        - CONGESTED: Heavy occupancy with stagnant/stalled flow or excessive vehicles.
        - HEAVY: Significant occupancy or vehicle presence, but traffic is still moving.
        - MODERATE: Notable presence of vehicles in ROI with steady flow.
        - FREE: Low occupancy, clear roadway, unobstructed traffic.
        """
        cfg = self.config

        # Rule 1: CONGESTED
        # High occupancy (>= 0.35) combined with low/stalled flow (<= 3 VPM),
        # OR extreme occupancy (>= 0.45), OR >= 6 vehicles crammed in ROI
        if (occupancy_ratio >= 0.35 and flow_vpm <= cfg.stalled_flow_vpm_max) or \
           (occupancy_ratio >= 0.45) or \
           (vehicles_in_roi >= cfg.congested_roi_count_min and occupancy_ratio >= 0.30):
            return "CONGESTED"

        # Rule 2: HEAVY
        # Occupancy >= 0.25, OR >= 4 vehicles in ROI, OR >= 7 active vehicles
        if occupancy_ratio >= cfg.moderate_occupancy_max or \
           vehicles_in_roi >= 4 or \
           active_count >= 7:
            return "HEAVY"

        # Rule 3: MODERATE
        # Occupancy >= 0.10, OR >= 2 vehicles in ROI, OR >= 3 active vehicles
        if occupancy_ratio >= cfg.free_occupancy_max or \
           vehicles_in_roi >= 2 or \
           active_count >= 3:
            return "MODERATE"

        # Rule 4: FREE
        # Low occupancy (< 0.10) and sparse/zero vehicles
        return "FREE"
