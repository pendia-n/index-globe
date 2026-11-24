export const seatLimit = 5

const usStates = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  AS: 'American Samoa', GU: 'Guam', MP: 'Northern Mariana Islands', PR: 'Puerto Rico', VI: 'US Virgin Islands',
}
const canadaRegions = {
  FED: 'Federal', AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut',
  ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon',
}

export const registries = {
  SG: { name: 'Singapore', regions: [], label: 'Unique Entity Number (UEN)', pattern: /^[A-Z0-9]{9,10}$/, hint: 'Enter the 9- or 10-character number shown on Bizfile.' },
  HK: { name: 'Hong Kong SAR', regions: [], label: 'Business Registration Number (BRN)', pattern: /^\d{8}$/, hint: 'Enter the eight digits shown on the Companies Registry record.' },
  CN: { name: 'Mainland China', regions: [], label: 'Unified Social Credit Code', pattern: /^[0-9A-HJ-NPQRTUWXY]{18}$/, hint: 'Enter the 18-character code on the business licence.' },
  US: { name: 'United States', regions: Object.entries(usStates), label: 'State-issued entity or file number', pattern: /^[A-Z0-9][A-Z0-9 ./-]{0,79}$/, hint: 'Use the number from the state or territory of formation. Your EIN is a separate federal tax ID.' },
  GB: { name: 'United Kingdom', regions: [], label: 'Companies House company number', pattern: /^(?:\d{8}|[A-Z]{2}[A-Z0-9]{6})$/, hint: 'Enter all eight characters, including any letters or leading zeroes.' },
  CA: { name: 'Canada', regions: Object.entries(canadaRegions), label: 'Corporation or registry number', pattern: /^[A-Z0-9][A-Z0-9 ./-]{0,79}$/, hint: 'Choose the issuing registry and use its company number.' },
  JP: { name: 'Japan', regions: [], label: 'Corporate Number', pattern: /^\d{13}$/, hint: 'Enter all 13 digits.' },
  AU: { name: 'Australia', regions: [], label: 'Australian Company Number (ACN)', pattern: /^\d{9}$/, hint: 'Enter the nine-digit ASIC company number.' },
}

export function findRegistry(country: string) {
  return Object.hasOwn(registries, country) ? registries[country as keyof typeof registries] : undefined
}

export function registryNumber(country: string, value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, ' ')
  return country === 'CA' || country === 'US' ? normalized : normalized.replace(/ /g, '')
}

// ISO 3166-1 alpha-2 company registration jurisdictions.
const jurisdictionCodes = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '))
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
export function jurisdictionName(code: string) { return findRegistry(code)?.name ?? regionNames.of(code) ?? code }
export function supportsJurisdiction(code: string) { return jurisdictionCodes.has(code) }
export const jurisdictions = [...jurisdictionCodes].map(code => ({ code, name: jurisdictionName(code) }))
  .sort((a,b) => a.name.localeCompare(b.name,'en'))
