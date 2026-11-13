export interface EmiResult {
  emi: number;
  totalInterest: number;
  totalPayment: number;
}

export interface YearRow {
  year: number;
  principal: number;
  interest: number;
  balance: number;
}

/** Standard reducing-balance EMI: P·r·(1+r)^n / ((1+r)^n − 1), with r the monthly rate. */
export function calculateEmi(principal: number, annualRatePct: number, months: number): EmiResult {
  if (!(principal > 0) || !(months > 0)) return { emi: 0, totalInterest: 0, totalPayment: 0 };
  const r = annualRatePct / 12 / 100;
  const emi = r === 0 ? principal / months : (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
  const totalPayment = emi * months;
  return { emi, totalInterest: totalPayment - principal, totalPayment };
}

export function yearlySchedule(principal: number, annualRatePct: number, months: number): YearRow[] {
  const { emi } = calculateEmi(principal, annualRatePct, months);
  const r = annualRatePct / 12 / 100;
  const rows: YearRow[] = [];
  let balance = principal;
  let yearPrincipal = 0;
  let yearInterest = 0;
  for (let m = 1; m <= months; m++) {
    const interest = balance * r;
    const paid = Math.min(emi - interest, balance);
    balance -= paid;
    yearPrincipal += paid;
    yearInterest += interest;
    if (m % 12 === 0 || m === months) {
      rows.push({ year: Math.ceil(m / 12), principal: yearPrincipal, interest: yearInterest, balance: Math.max(balance, 0) });
      yearPrincipal = 0;
      yearInterest = 0;
    }
  }
  return rows;
}

/**
 * Digit grouping done by hand rather than with Intl so the server-rendered
 * text is byte-identical to what the browser produces on hydration.
 */
export function formatMoney(value: number, currency: string, grouping: 'indian' | 'international'): string {
  const n = Math.round(Math.abs(value));
  const digits = String(n);
  let out: string;
  if (grouping === 'indian' && digits.length > 3) {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    out = `${rest},${last3}`;
  } else {
    out = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  return `${value < 0 ? '-' : ''}${currency}${out}`;
}
