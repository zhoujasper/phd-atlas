import { localeForLanguage } from '../../i18n'

export function formatFeeAmount(value: number, currency: string, lang: string): string {
  try {
    return new Intl.NumberFormat(localeForLanguage(lang), {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value)
  } catch {
    return `${value} ${currency}`
  }
}
