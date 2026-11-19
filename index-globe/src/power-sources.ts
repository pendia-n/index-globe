export const powerSources = {
  solar: { label: "Solar", category: "Renewable" },
  wind: { label: "Wind", category: "Renewable" },
  hydro: { label: "Hydropower", category: "Renewable" },
  geothermal: { label: "Geothermal", category: "Renewable" },
  biomass: { label: "Biomass", category: "Renewable classification subject to scheme" },
  nuclear: { label: "Nuclear", category: "Low-carbon generation" },
  gas: { label: "Gas-fired electricity", category: "Fossil generation" },
  other: { label: "Other electricity", category: "Source details require review" },
} as const;

export type PowerSource = keyof typeof powerSources;

export function isPowerSource(value: string): value is PowerSource {
  return Object.hasOwn(powerSources, value);
}
