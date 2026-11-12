import { CLASS_KINDS, classRanks, NUM_CLASSES } from '../eval/handClass';

/**
 * Preflop hand ordering used by human-style opponents.
 *
 * Built from simulated all-in equity of each starting hand class (grid order, see handClass.ts)
 * against one random hand and against three random hands, plus a bonus for pairs and suited
 * connectors, which live players value for their chance to make big hands in multiway pots.
 */

/** Equity against one random hand (30,000 samples per class). */
export const EQUITY_HEADS_UP: readonly number[] = [
  0.851, 0.669, 0.661, 0.655, 0.647, 0.628, 0.620, 0.615, 0.596, 0.599, 0.590, 0.583, 0.577,
  0.656, 0.827, 0.638, 0.624, 0.615, 0.603, 0.581, 0.576, 0.570, 0.558, 0.547, 0.536, 0.536,
  0.643, 0.617, 0.800, 0.602, 0.597, 0.577, 0.558, 0.542, 0.537, 0.531, 0.520, 0.509, 0.506,
  0.635, 0.607, 0.580, 0.772, 0.581, 0.558, 0.542, 0.529, 0.505, 0.498, 0.493, 0.483, 0.474,
  0.624, 0.596, 0.568, 0.558, 0.750, 0.533, 0.523, 0.506, 0.490, 0.473, 0.467, 0.458, 0.451,
  0.605, 0.586, 0.556, 0.535, 0.516, 0.722, 0.505, 0.490, 0.472, 0.458, 0.444, 0.428, 0.423,
  0.602, 0.563, 0.539, 0.513, 0.492, 0.482, 0.691, 0.481, 0.463, 0.442, 0.429, 0.406, 0.401,
  0.595, 0.552, 0.516, 0.498, 0.480, 0.465, 0.454, 0.667, 0.455, 0.439, 0.419, 0.399, 0.380,
  0.575, 0.548, 0.513, 0.473, 0.457, 0.442, 0.432, 0.421, 0.632, 0.431, 0.414, 0.395, 0.374,
  0.579, 0.533, 0.499, 0.469, 0.443, 0.426, 0.415, 0.407, 0.403, 0.605, 0.417, 0.399, 0.382,
  0.568, 0.529, 0.486, 0.463, 0.431, 0.409, 0.393, 0.385, 0.382, 0.380, 0.573, 0.384, 0.373,
  0.557, 0.517, 0.482, 0.455, 0.429, 0.394, 0.378, 0.368, 0.360, 0.365, 0.350, 0.533, 0.357,
  0.550, 0.502, 0.476, 0.444, 0.417, 0.389, 0.369, 0.346, 0.340, 0.340, 0.336, 0.323, 0.504,
];

/** Equity against three random hands (20,000 samples per class). */
export const EQUITY_FOUR_WAY: readonly number[] = [
  0.644, 0.409, 0.398, 0.387, 0.375, 0.346, 0.343, 0.322, 0.311, 0.314, 0.302, 0.303, 0.296,
  0.388, 0.583, 0.380, 0.370, 0.355, 0.334, 0.308, 0.294, 0.284, 0.289, 0.275, 0.268, 0.263,
  0.365, 0.346, 0.537, 0.357, 0.348, 0.320, 0.301, 0.277, 0.267, 0.261, 0.254, 0.250, 0.239,
  0.361, 0.340, 0.322, 0.490, 0.339, 0.314, 0.295, 0.270, 0.255, 0.246, 0.244, 0.235, 0.225,
  0.343, 0.323, 0.311, 0.309, 0.451, 0.312, 0.292, 0.270, 0.247, 0.232, 0.231, 0.219, 0.217,
  0.313, 0.294, 0.283, 0.282, 0.282, 0.408, 0.286, 0.262, 0.246, 0.230, 0.215, 0.208, 0.206,
  0.294, 0.274, 0.260, 0.255, 0.249, 0.252, 0.384, 0.270, 0.248, 0.234, 0.211, 0.196, 0.195,
  0.283, 0.263, 0.238, 0.231, 0.231, 0.235, 0.229, 0.343, 0.251, 0.230, 0.214, 0.200, 0.188,
  0.272, 0.251, 0.231, 0.217, 0.213, 0.210, 0.213, 0.215, 0.320, 0.238, 0.222, 0.205, 0.179,
  0.278, 0.244, 0.228, 0.209, 0.196, 0.197, 0.190, 0.193, 0.199, 0.290, 0.223, 0.212, 0.195,
  0.269, 0.242, 0.215, 0.201, 0.188, 0.172, 0.169, 0.180, 0.185, 0.189, 0.262, 0.206, 0.188,
  0.262, 0.226, 0.209, 0.197, 0.181, 0.166, 0.154, 0.160, 0.168, 0.170, 0.164, 0.235, 0.182,
  0.252, 0.219, 0.202, 0.185, 0.170, 0.162, 0.155, 0.146, 0.146, 0.152, 0.149, 0.137, 0.217,
];

function playabilityBonus(k: number): number {
  const kind = CLASS_KINDS[k]!;
  if (kind === 'pair') return 0.1;
  const { hi, lo } = classRanks(k);
  const gap = hi - lo - 1;
  if (kind === 'suited') {
    let bonus = 0.02;
    if (gap === 0) bonus += lo >= 2 ? 0.05 : 0.035;
    else if (gap === 1) bonus += 0.025;
    else if (gap === 2) bonus += 0.01;
    return bonus;
  }
  return gap === 0 && lo >= 6 ? 0.01 : 0;
}

/** Playability score per class; higher is better. */
export const CLASS_SCORE = new Float32Array(NUM_CLASSES);
/** Classes from best to worst. */
export const CLASS_ORDER: number[] = [];
/**
 * Position of each class in the ordering, as the share of all 1326 combos ranked above the
 * middle of the class. AA is about 0.002, the worst hands are close to 1.
 */
export const CLASS_PERCENTILE = new Float32Array(NUM_CLASSES);

for (let k = 0; k < NUM_CLASSES; k++) {
  CLASS_SCORE[k] = EQUITY_HEADS_UP[k]! + 1.5 * EQUITY_FOUR_WAY[k]! + playabilityBonus(k);
  CLASS_ORDER.push(k);
}
CLASS_ORDER.sort((a, b) => CLASS_SCORE[b]! - CLASS_SCORE[a]!);
{
  let above = 0;
  for (const k of CLASS_ORDER) {
    const combos = CLASS_KINDS[k] === 'pair' ? 6 : CLASS_KINDS[k] === 'suited' ? 4 : 12;
    CLASS_PERCENTILE[k] = (above + combos / 2) / 1326;
    above += combos;
  }
}
