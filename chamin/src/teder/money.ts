export const currencies=['USD','GBP','EUR','SGD','CAD','AUD','AED','HKD','CNY','JPY','INR','NOK','SEK','DKK','NZD','CHF','BRL','ZAR'] as const
export function minorUnits(value:number,currency:string) {
 const decimals=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2
 return Math.round(value*10**decimals)
}
export function commission(gross:number) {return Number((BigInt(gross)*200n+5000n)/10000n)}
