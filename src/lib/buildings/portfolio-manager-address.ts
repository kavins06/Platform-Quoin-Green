export type PortfolioManagerMailingAddress = {
  address1: string;
  city: string;
  state: string;
  postalCode: string;
};

export const PORTFOLIO_MANAGER_MAILING_ADDRESS_EXAMPLE =
  "Street, City, ST ZIP";
export const PORTFOLIO_MANAGER_MAILING_ADDRESS_HELPER =
  "Use Street, City, ST ZIP.";
export const PORTFOLIO_MANAGER_MAILING_ADDRESS_ERROR =
  `Enter the full mailing address like '${PORTFOLIO_MANAGER_MAILING_ADDRESS_EXAMPLE}'.`;

export function parsePortfolioManagerMailingAddress(
  address: string,
): PortfolioManagerMailingAddress | null {
  const normalized = address.replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /^(.+?),\s*([A-Za-z.'\-\s]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/,
  );

  if (!match) {
    return null;
  }

  return {
    address1: match[1].trim(),
    city: match[2].trim(),
    state: match[3].trim().toUpperCase(),
    postalCode: match[4].trim(),
  };
}

export function hasPortfolioManagerMailingAddress(address: string) {
  return parsePortfolioManagerMailingAddress(address) != null;
}
