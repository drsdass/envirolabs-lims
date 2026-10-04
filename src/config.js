export const METHODS = {
  BPS: {
    code: 'BPS', letter: 'B', name: 'Bisphenol S in consumer products', short: 'BPS', sop: 'EL-SOP-101', rev: 3, technique: 'LC-MS/MS', instrument: 'LCMS1',
    acqMethod: 'BPS_09092025_SHORT.m', calLevels: [0.5, 1, 5, 10, 15, 20, 25], ldrLevels: [100], price: 175, units: 'ng/g', ccvLimits: [70, 130], calAccuracy: [70, 130], calLowAccuracy: [50, 150],
    analytes: [{ name: 'Bisphenol S', cas: '80-09-1', mrl: 0.5, spike: 3, rec: [50, 150], rpd: 30 }],
    surrogates: [{ name: 'd8-BPS', nominal: 20, rec: [50, 150] }], istd: ['13C12 BPS'], matrices: ['Fabrics', 'Paper', 'Waterproof Fabrics'], color: 'bps', confirm: ['MRL'],
  },
  PFAS: {
    code: 'PFAS', letter: 'P', name: 'PFAS in consumer products', short: 'PFAS', sop: 'EL-SOP-102', rev: 4, technique: 'LC-MS/MS', instrument: 'LCMS1',
    acqMethod: 'PFAS_SHORT.m', calLevels: [0.25, 0.5, 1, 2, 5, 10, 20], ldrLevels: [200], price: 225, units: 'ng/g', ccvLimits: [70, 130], calAccuracy: [70, 130], calLowAccuracy: [50, 150],
    analytes: [
      { name: 'PFOA', cas: '335-67-1', mrl: 0.25, spike: 2, rec: [50, 150], rpd: 30 },
      { name: 'PFNA', cas: '375-95-1', mrl: 0.25, spike: 2, rec: [50, 150], rpd: 30 },
      { name: 'PFOS', cas: '1763-23-1', mrl: 0.25, spike: 2, rec: [50, 150], rpd: 30 },
      { name: 'FOSAA', cas: '2806-24-8', mrl: 0.25, spike: 1, rec: [50, 150], rpd: 30 },
      { name: 'N-MeFOSAA', cas: '2355-31-9', mrl: 0.25, spike: 1, rec: [50, 150], rpd: 30 },
      { name: 'N-EtFOSAA', cas: '2991-50-6', mrl: 0.25, spike: 1, rec: [50, 150], rpd: 30 },
      { name: 'SAmPAP', cas: '1940-61-0', mrl: 0.25, spike: 1, rec: [50, 150], rpd: 30 },
      { name: 'PFOSA', cas: '754-91-6', mrl: 0.25, spike: 1, rec: [50, 150], rpd: 30 },
      { name: 'N-MeFOSA', cas: '31506-32-8', mrl: 0.25, spike: 1, rec: [50, 150], rpd: 30 },
      { name: 'N-MeFOSE', cas: '24448-09-7', mrl: 0.25, spike: 1, rec: [50, 150], rpd: 30 },
      { name: 'N-EtFOSA', cas: '4151-50-2', mrl: 0.25, spike: 1, rec: [50, 150], rpd: 30 },
      { name: 'N-EtFOSE', cas: '1691-99-2', mrl: 0.25, spike: 1, rec: [50, 150], rpd: 30 },
      { name: 'diSAmPAP', cas: '2965-52-0', mrl: 0.25, spike: 1, rec: [50, 150], rpd: 30 },
    ],
    surrogates: [{ name: '13C8 PFOA', nominal: 10, rec: [50, 150] }, { name: '13C8 PFOS', nominal: 10, rec: [50, 150] }],
    istd: ['13C9 PFNA'], matrices: ['Fabrics', 'Paper', 'Waterproof Fabrics', 'Cosmetics'], color: 'pfas', confirm: ['MRL'],
  },
  OTA: {
    code: 'OTA', letter: 'A', name: 'Ochratoxin A in food products', short: 'OTA', sop: 'EL-SOP-103', rev: 1, technique: 'LC-MS/MS', instrument: 'LCMS1',
    acqMethod: 'OTA.m', calLevels: [1, 2, 5, 10, 20, 50], ldrLevels: [], price: 195, units: 'ng/g', ccvLimits: [70, 130], calAccuracy: [70, 130], calLowAccuracy: [50, 150],
    analytes: [{ name: 'Ochratoxin A', cas: '303-47-9', mrl: 1, spike: 5, rec: [50, 150], rpd: 30 }],
    surrogates: [{ name: '13C20 OTA', nominal: 10, rec: [50, 150] }], istd: [], matrices: ['Coffee', 'Cocoa Powder', 'Cereal'], color: 'ota', confirm: ['MRL', 'Spike level'],
  },
  PEP: {
    code: 'PEP', letter: 'Q', name: 'Peptide purity and identity', short: 'Peptide', sop: 'EL-SOP-301', rev: 1, technique: 'LC-MS/MS', instrument: 'LCMS1',
    acqMethod: 'PEPTIDE_PURITY.m', calLevels: [], ldrLevels: [], price: 250, units: '%', ccvLimits: [70, 130], calAccuracy: [70, 130], calLowAccuracy: [50, 150], manual: true,
    analytes: [
      { name: 'Purity (area %)', cas: '', mrl: 0, spike: 0, rec: [0, 0], rpd: 2, spec: '≥ 98.0', specMin: 98 },
      { name: 'Identity (observed vs theoretical mass)', cas: '', mrl: 0, spike: 0, rec: [0, 0], rpd: 0, spec: 'Conforms', text: true },
    ],
    surrogates: [], istd: [], matrices: ['Lyophilized peptide'], color: 'pep', confirm: ['Spec limits', 'Acquisition method'],
  },
};
export const TEST_ORDER = ['BPS', 'PFAS', 'OTA', 'PEP'];
export const QUALIFIERS = {
  ND: 'Not detected at or above the Method Reporting Limit (MRL).',
  MS1: 'The MS and/or MSD recoveries are outside the acceptance limits due to the source sample concentration being greater than 4 times the spike concentration. The surrogate recoveries are within acceptance criteria.',
  MS2: 'The MS and/or MSD recoveries are outside the acceptance limits due to possible matrix effects.',
  IS1: 'The internal standard recoveries are outside the acceptance limits due to possible matrix effects causing higher results than normal.',
  RPD1: 'The RPD recovery is outside the acceptance limits likely as a result of matrix effects and/or non-homogeneous sample composition.',
  LR: 'Result is above the highest calibration standard but within the linear range verified in this run.',
  E: 'Result exceeds the verified linear range. Estimated value; the sample must be diluted and re-analyzed before release.',
};
