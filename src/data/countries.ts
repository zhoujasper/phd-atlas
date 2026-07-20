/**
 * ISO 3166-1 alpha-2 countries / regions for PhD application school location.
 * Stored value is the English short name (human-readable in exports); codes are
 * used for flags, localization via Intl.DisplayNames, and fuzzy matching.
 */

export type ContinentId =
  | 'north_america'
  | 'south_america'
  | 'europe'
  | 'asia'
  | 'africa'
  | 'oceania'
  | 'antarctica'

export type CountryEntry = {
  code: string
  name: string
  continent: ContinentId
  /** Alternate strings found in legacy data / user typing. */
  aliases?: readonly string[]
}

export const CONTINENT_ORDER: readonly ContinentId[] = [
  'north_america',
  'europe',
  'asia',
  'oceania',
  'south_america',
  'africa',
  'antarctica',
]

/** Full list used by the country picker (UN members + common academic regions). */
export const COUNTRIES: readonly CountryEntry[] = [
  // North America & Caribbean
  { code: 'US', name: 'United States', continent: 'north_america', aliases: ['USA', 'United States of America', 'America', 'U.S.', 'U.S.A.'] },
  { code: 'CA', name: 'Canada', continent: 'north_america' },
  { code: 'MX', name: 'Mexico', continent: 'north_america' },
  { code: 'GT', name: 'Guatemala', continent: 'north_america' },
  { code: 'BZ', name: 'Belize', continent: 'north_america' },
  { code: 'SV', name: 'El Salvador', continent: 'north_america' },
  { code: 'HN', name: 'Honduras', continent: 'north_america' },
  { code: 'NI', name: 'Nicaragua', continent: 'north_america' },
  { code: 'CR', name: 'Costa Rica', continent: 'north_america' },
  { code: 'PA', name: 'Panama', continent: 'north_america' },
  { code: 'CU', name: 'Cuba', continent: 'north_america' },
  { code: 'JM', name: 'Jamaica', continent: 'north_america' },
  { code: 'HT', name: 'Haiti', continent: 'north_america' },
  { code: 'DO', name: 'Dominican Republic', continent: 'north_america' },
  { code: 'BS', name: 'Bahamas', continent: 'north_america' },
  { code: 'BB', name: 'Barbados', continent: 'north_america' },
  { code: 'TT', name: 'Trinidad and Tobago', continent: 'north_america' },
  { code: 'AG', name: 'Antigua and Barbuda', continent: 'north_america' },
  { code: 'DM', name: 'Dominica', continent: 'north_america' },
  { code: 'GD', name: 'Grenada', continent: 'north_america' },
  { code: 'KN', name: 'Saint Kitts and Nevis', continent: 'north_america' },
  { code: 'LC', name: 'Saint Lucia', continent: 'north_america' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines', continent: 'north_america' },
  { code: 'PR', name: 'Puerto Rico', continent: 'north_america' },
  { code: 'BM', name: 'Bermuda', continent: 'north_america' },
  { code: 'GL', name: 'Greenland', continent: 'north_america' },
  { code: 'KY', name: 'Cayman Islands', continent: 'north_america' },
  { code: 'VI', name: 'U.S. Virgin Islands', continent: 'north_america', aliases: ['US Virgin Islands'] },

  // South America
  { code: 'BR', name: 'Brazil', continent: 'south_america' },
  { code: 'AR', name: 'Argentina', continent: 'south_america' },
  { code: 'CL', name: 'Chile', continent: 'south_america' },
  { code: 'CO', name: 'Colombia', continent: 'south_america' },
  { code: 'PE', name: 'Peru', continent: 'south_america' },
  { code: 'VE', name: 'Venezuela', continent: 'south_america' },
  { code: 'EC', name: 'Ecuador', continent: 'south_america' },
  { code: 'BO', name: 'Bolivia', continent: 'south_america' },
  { code: 'PY', name: 'Paraguay', continent: 'south_america' },
  { code: 'UY', name: 'Uruguay', continent: 'south_america' },
  { code: 'GY', name: 'Guyana', continent: 'south_america' },
  { code: 'SR', name: 'Suriname', continent: 'south_america' },
  { code: 'GF', name: 'French Guiana', continent: 'south_america' },
  { code: 'FK', name: 'Falkland Islands', continent: 'south_america' },

  // Europe
  { code: 'GB', name: 'United Kingdom', continent: 'europe', aliases: ['UK', 'Britain', 'Great Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'] },
  { code: 'IE', name: 'Ireland', continent: 'europe' },
  { code: 'FR', name: 'France', continent: 'europe' },
  { code: 'DE', name: 'Germany', continent: 'europe', aliases: ['Deutschland'] },
  { code: 'CH', name: 'Switzerland', continent: 'europe', aliases: ['Swiss'] },
  { code: 'NL', name: 'Netherlands', continent: 'europe', aliases: ['Holland', 'The Netherlands'] },
  { code: 'BE', name: 'Belgium', continent: 'europe' },
  { code: 'LU', name: 'Luxembourg', continent: 'europe' },
  { code: 'AT', name: 'Austria', continent: 'europe' },
  { code: 'IT', name: 'Italy', continent: 'europe' },
  { code: 'ES', name: 'Spain', continent: 'europe' },
  { code: 'PT', name: 'Portugal', continent: 'europe' },
  { code: 'SE', name: 'Sweden', continent: 'europe' },
  { code: 'NO', name: 'Norway', continent: 'europe' },
  { code: 'DK', name: 'Denmark', continent: 'europe' },
  { code: 'FI', name: 'Finland', continent: 'europe' },
  { code: 'IS', name: 'Iceland', continent: 'europe' },
  { code: 'PL', name: 'Poland', continent: 'europe' },
  { code: 'CZ', name: 'Czechia', continent: 'europe', aliases: ['Czech Republic'] },
  { code: 'SK', name: 'Slovakia', continent: 'europe' },
  { code: 'HU', name: 'Hungary', continent: 'europe' },
  { code: 'RO', name: 'Romania', continent: 'europe' },
  { code: 'BG', name: 'Bulgaria', continent: 'europe' },
  { code: 'GR', name: 'Greece', continent: 'europe' },
  { code: 'HR', name: 'Croatia', continent: 'europe' },
  { code: 'SI', name: 'Slovenia', continent: 'europe' },
  { code: 'RS', name: 'Serbia', continent: 'europe' },
  { code: 'BA', name: 'Bosnia and Herzegovina', continent: 'europe' },
  { code: 'ME', name: 'Montenegro', continent: 'europe' },
  { code: 'MK', name: 'North Macedonia', continent: 'europe', aliases: ['Macedonia'] },
  { code: 'AL', name: 'Albania', continent: 'europe' },
  { code: 'XK', name: 'Kosovo', continent: 'europe' },
  { code: 'EE', name: 'Estonia', continent: 'europe' },
  { code: 'LV', name: 'Latvia', continent: 'europe' },
  { code: 'LT', name: 'Lithuania', continent: 'europe' },
  { code: 'UA', name: 'Ukraine', continent: 'europe' },
  { code: 'BY', name: 'Belarus', continent: 'europe' },
  { code: 'MD', name: 'Moldova', continent: 'europe' },
  { code: 'RU', name: 'Russia', continent: 'europe', aliases: ['Russian Federation'] },
  { code: 'TR', name: 'Turkey', continent: 'europe', aliases: ['Türkiye', 'Turkiye'] },
  { code: 'CY', name: 'Cyprus', continent: 'europe' },
  { code: 'MT', name: 'Malta', continent: 'europe' },
  { code: 'MC', name: 'Monaco', continent: 'europe' },
  { code: 'LI', name: 'Liechtenstein', continent: 'europe' },
  { code: 'AD', name: 'Andorra', continent: 'europe' },
  { code: 'SM', name: 'San Marino', continent: 'europe' },
  { code: 'VA', name: 'Vatican City', continent: 'europe', aliases: ['Holy See'] },
  { code: 'FO', name: 'Faroe Islands', continent: 'europe' },
  { code: 'GI', name: 'Gibraltar', continent: 'europe' },
  { code: 'JE', name: 'Jersey', continent: 'europe' },
  { code: 'GG', name: 'Guernsey', continent: 'europe' },
  { code: 'IM', name: 'Isle of Man', continent: 'europe' },

  // Asia
  { code: 'CN', name: 'China', continent: 'asia', aliases: ['PRC', "People's Republic of China", 'Mainland China'] },
  { code: 'HK', name: 'Hong Kong', continent: 'asia', aliases: ['Hong Kong SAR', 'HK SAR'] },
  { code: 'MO', name: 'Macao', continent: 'asia', aliases: ['Macau', 'Macao SAR', 'Macau SAR'] },
  { code: 'TW', name: 'Taiwan', continent: 'asia', aliases: ['Chinese Taipei', 'Taiwan, Province of China'] },
  { code: 'JP', name: 'Japan', continent: 'asia' },
  { code: 'KR', name: 'South Korea', continent: 'asia', aliases: ['Korea', 'Republic of Korea', 'Korea, Republic of', 'ROK'] },
  { code: 'KP', name: 'North Korea', continent: 'asia', aliases: ["Korea, Democratic People's Republic of", 'DPRK'] },
  { code: 'MN', name: 'Mongolia', continent: 'asia' },
  { code: 'IN', name: 'India', continent: 'asia' },
  { code: 'PK', name: 'Pakistan', continent: 'asia' },
  { code: 'BD', name: 'Bangladesh', continent: 'asia' },
  { code: 'LK', name: 'Sri Lanka', continent: 'asia' },
  { code: 'NP', name: 'Nepal', continent: 'asia' },
  { code: 'BT', name: 'Bhutan', continent: 'asia' },
  { code: 'MV', name: 'Maldives', continent: 'asia' },
  { code: 'AF', name: 'Afghanistan', continent: 'asia' },
  { code: 'SG', name: 'Singapore', continent: 'asia' },
  { code: 'MY', name: 'Malaysia', continent: 'asia' },
  { code: 'ID', name: 'Indonesia', continent: 'asia' },
  { code: 'TH', name: 'Thailand', continent: 'asia' },
  { code: 'VN', name: 'Vietnam', continent: 'asia', aliases: ['Viet Nam'] },
  { code: 'PH', name: 'Philippines', continent: 'asia' },
  { code: 'MM', name: 'Myanmar', continent: 'asia', aliases: ['Burma'] },
  { code: 'KH', name: 'Cambodia', continent: 'asia' },
  { code: 'LA', name: 'Laos', continent: 'asia', aliases: ['Lao PDR', "Lao People's Democratic Republic"] },
  { code: 'BN', name: 'Brunei', continent: 'asia', aliases: ['Brunei Darussalam'] },
  { code: 'TL', name: 'Timor-Leste', continent: 'asia', aliases: ['East Timor'] },
  { code: 'SA', name: 'Saudi Arabia', continent: 'asia' },
  { code: 'AE', name: 'United Arab Emirates', continent: 'asia', aliases: ['UAE', 'Emirates'] },
  { code: 'QA', name: 'Qatar', continent: 'asia' },
  { code: 'KW', name: 'Kuwait', continent: 'asia' },
  { code: 'BH', name: 'Bahrain', continent: 'asia' },
  { code: 'OM', name: 'Oman', continent: 'asia' },
  { code: 'YE', name: 'Yemen', continent: 'asia' },
  { code: 'IQ', name: 'Iraq', continent: 'asia' },
  { code: 'IR', name: 'Iran', continent: 'asia', aliases: ['Islamic Republic of Iran'] },
  { code: 'IL', name: 'Israel', continent: 'asia' },
  { code: 'PS', name: 'Palestine', continent: 'asia', aliases: ['State of Palestine'] },
  { code: 'JO', name: 'Jordan', continent: 'asia' },
  { code: 'LB', name: 'Lebanon', continent: 'asia' },
  { code: 'SY', name: 'Syria', continent: 'asia', aliases: ['Syrian Arab Republic'] },
  { code: 'GE', name: 'Georgia', continent: 'asia' },
  { code: 'AM', name: 'Armenia', continent: 'asia' },
  { code: 'AZ', name: 'Azerbaijan', continent: 'asia' },
  { code: 'KZ', name: 'Kazakhstan', continent: 'asia' },
  { code: 'UZ', name: 'Uzbekistan', continent: 'asia' },
  { code: 'TM', name: 'Turkmenistan', continent: 'asia' },
  { code: 'KG', name: 'Kyrgyzstan', continent: 'asia' },
  { code: 'TJ', name: 'Tajikistan', continent: 'asia' },

  // Oceania
  { code: 'AU', name: 'Australia', continent: 'oceania' },
  { code: 'NZ', name: 'New Zealand', continent: 'oceania' },
  { code: 'PG', name: 'Papua New Guinea', continent: 'oceania' },
  { code: 'FJ', name: 'Fiji', continent: 'oceania' },
  { code: 'SB', name: 'Solomon Islands', continent: 'oceania' },
  { code: 'VU', name: 'Vanuatu', continent: 'oceania' },
  { code: 'NC', name: 'New Caledonia', continent: 'oceania' },
  { code: 'PF', name: 'French Polynesia', continent: 'oceania' },
  { code: 'WS', name: 'Samoa', continent: 'oceania' },
  { code: 'TO', name: 'Tonga', continent: 'oceania' },
  { code: 'KI', name: 'Kiribati', continent: 'oceania' },
  { code: 'TV', name: 'Tuvalu', continent: 'oceania' },
  { code: 'NR', name: 'Nauru', continent: 'oceania' },
  { code: 'PW', name: 'Palau', continent: 'oceania' },
  { code: 'MH', name: 'Marshall Islands', continent: 'oceania' },
  { code: 'FM', name: 'Micronesia', continent: 'oceania', aliases: ['Federated States of Micronesia'] },
  { code: 'GU', name: 'Guam', continent: 'oceania' },
  { code: 'MP', name: 'Northern Mariana Islands', continent: 'oceania' },
  { code: 'AS', name: 'American Samoa', continent: 'oceania' },
  { code: 'CK', name: 'Cook Islands', continent: 'oceania' },
  { code: 'NU', name: 'Niue', continent: 'oceania' },

  // Africa
  { code: 'ZA', name: 'South Africa', continent: 'africa' },
  { code: 'EG', name: 'Egypt', continent: 'africa' },
  { code: 'NG', name: 'Nigeria', continent: 'africa' },
  { code: 'KE', name: 'Kenya', continent: 'africa' },
  { code: 'GH', name: 'Ghana', continent: 'africa' },
  { code: 'ET', name: 'Ethiopia', continent: 'africa' },
  { code: 'TZ', name: 'Tanzania', continent: 'africa' },
  { code: 'UG', name: 'Uganda', continent: 'africa' },
  { code: 'RW', name: 'Rwanda', continent: 'africa' },
  { code: 'MA', name: 'Morocco', continent: 'africa' },
  { code: 'TN', name: 'Tunisia', continent: 'africa' },
  { code: 'DZ', name: 'Algeria', continent: 'africa' },
  { code: 'LY', name: 'Libya', continent: 'africa' },
  { code: 'SD', name: 'Sudan', continent: 'africa' },
  { code: 'SS', name: 'South Sudan', continent: 'africa' },
  { code: 'SN', name: 'Senegal', continent: 'africa' },
  { code: 'CI', name: "Côte d'Ivoire", continent: 'africa', aliases: ['Ivory Coast', "Cote d'Ivoire"] },
  { code: 'CM', name: 'Cameroon', continent: 'africa' },
  { code: 'AO', name: 'Angola', continent: 'africa' },
  { code: 'MZ', name: 'Mozambique', continent: 'africa' },
  { code: 'ZW', name: 'Zimbabwe', continent: 'africa' },
  { code: 'ZM', name: 'Zambia', continent: 'africa' },
  { code: 'BW', name: 'Botswana', continent: 'africa' },
  { code: 'NA', name: 'Namibia', continent: 'africa' },
  { code: 'MW', name: 'Malawi', continent: 'africa' },
  { code: 'MG', name: 'Madagascar', continent: 'africa' },
  { code: 'MU', name: 'Mauritius', continent: 'africa' },
  { code: 'SC', name: 'Seychelles', continent: 'africa' },
  { code: 'RE', name: 'Réunion', continent: 'africa', aliases: ['Reunion'] },
  { code: 'CV', name: 'Cabo Verde', continent: 'africa', aliases: ['Cape Verde'] },
  { code: 'GM', name: 'Gambia', continent: 'africa' },
  { code: 'GN', name: 'Guinea', continent: 'africa' },
  { code: 'GW', name: 'Guinea-Bissau', continent: 'africa' },
  { code: 'SL', name: 'Sierra Leone', continent: 'africa' },
  { code: 'LR', name: 'Liberia', continent: 'africa' },
  { code: 'ML', name: 'Mali', continent: 'africa' },
  { code: 'BF', name: 'Burkina Faso', continent: 'africa' },
  { code: 'NE', name: 'Niger', continent: 'africa' },
  { code: 'TD', name: 'Chad', continent: 'africa' },
  { code: 'CF', name: 'Central African Republic', continent: 'africa' },
  { code: 'CG', name: 'Congo', continent: 'africa', aliases: ['Republic of the Congo'] },
  { code: 'CD', name: 'DR Congo', continent: 'africa', aliases: ['Democratic Republic of the Congo', 'Congo-Kinshasa', 'DRC'] },
  { code: 'GA', name: 'Gabon', continent: 'africa' },
  { code: 'GQ', name: 'Equatorial Guinea', continent: 'africa' },
  { code: 'ST', name: 'São Tomé and Príncipe', continent: 'africa', aliases: ['Sao Tome and Principe'] },
  { code: 'BJ', name: 'Benin', continent: 'africa' },
  { code: 'TG', name: 'Togo', continent: 'africa' },
  { code: 'MR', name: 'Mauritania', continent: 'africa' },
  { code: 'DJ', name: 'Djibouti', continent: 'africa' },
  { code: 'ER', name: 'Eritrea', continent: 'africa' },
  { code: 'SO', name: 'Somalia', continent: 'africa' },
  { code: 'BI', name: 'Burundi', continent: 'africa' },
  { code: 'LS', name: 'Lesotho', continent: 'africa' },
  { code: 'SZ', name: 'Eswatini', continent: 'africa', aliases: ['Swaziland'] },
  { code: 'KM', name: 'Comoros', continent: 'africa' },

  // Antarctica
  { code: 'AQ', name: 'Antarctica', continent: 'antarctica' },
]

const byCode = new Map(COUNTRIES.map((entry) => [entry.code.toUpperCase(), entry]))

const byNormalizedName = new Map<string, CountryEntry>()
for (const entry of COUNTRIES) {
  byNormalizedName.set(normalizeCountryKey(entry.name), entry)
  byNormalizedName.set(normalizeCountryKey(entry.code), entry)
  for (const alias of entry.aliases ?? []) {
    byNormalizedName.set(normalizeCountryKey(alias), entry)
  }
}

export function normalizeCountryKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function resolveCountry(value: string | null | undefined): CountryEntry | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  if (raw.length === 2) {
    const byIso = byCode.get(raw.toUpperCase())
    if (byIso) return byIso
  }
  return byNormalizedName.get(normalizeCountryKey(raw)) ?? null
}

const displayNameCache = new Map<string, Intl.DisplayNames>()

function regionDisplayNames(lang: string): Intl.DisplayNames | null {
  const locale = lang || 'en'
  const cached = displayNameCache.get(locale)
  if (cached) return cached
  try {
    const dn = new Intl.DisplayNames([locale], { type: 'region' })
    displayNameCache.set(locale, dn)
    return dn
  } catch {
    return null
  }
}

/** Localized label for a stored country string (English name, code, or free text). */
export function countryDisplayName(value: string | null | undefined, lang = 'en'): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  const entry = resolveCountry(raw)
  if (!entry) return raw
  const dn = regionDisplayNames(lang)
  const localized = dn?.of(entry.code)
  return localized || entry.name
}

/** Regional-indicator flag emoji for an ISO alpha-2 code. */
export function countryFlagEmoji(code: string): string {
  const upper = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(upper)) return ''
  // Kosovo is not in the regional-indicator set consistently; skip invalid pairs.
  if (upper === 'XK') return '🏳️'
  return String.fromCodePoint(
    ...[...upper].map((char) => 0x1f1e6 - 65 + char.charCodeAt(0)),
  )
}

export function continentLabelKey(continent: ContinentId): string {
  return `dossier.continents.${continent}`
}

/**
 * Application identity for share tables and similar lists:
 * Advisor - School - Region
 */
export function formatApplicationIdentity(
  application: {
    professor?: { english?: string; chinese?: string }
    school?: { name?: string; country?: string }
  },
  lang = 'en',
  separator = ' - ',
): string {
  const advisor = (application.professor?.english ?? '').trim()
    || (application.professor?.chinese ?? '').trim()
  const school = (application.school?.name ?? '').trim()
  const region = countryDisplayName(application.school?.country, lang)
  return [advisor, school, region].filter(Boolean).join(separator)
}

export function countriesInContinent(continent: ContinentId): CountryEntry[] {
  return COUNTRIES.filter((entry) => entry.continent === continent)
}
