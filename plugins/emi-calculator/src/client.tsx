import { useId, useMemo, useState } from 'react';
import { usePluginConfig, type PageProps } from '@nextpluggable/plugin';
import { calculateEmi, formatMoney, yearlySchedule } from './emi';
import './style.css';

interface Config {
  heading: string;
  intro?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  currency: string;
  grouping: 'indian' | 'international';
  defaultAmount: number;
  maxAmount: number;
  defaultRate: number;
  defaultYears: number;
  showSchedule: boolean;
  accent: string;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function Field(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  prefix?: string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="npemi-field">
      <div className="npemi-field-head">
        <label htmlFor={id}>{props.label}</label>
        <span className="npemi-input">
          {props.prefix ? <span aria-hidden="true">{props.prefix}</span> : null}
          <input
            id={id}
            type="number"
            inputMode="decimal"
            value={props.value}
            min={props.min}
            max={props.max}
            step={props.step}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) props.onChange(clamp(v, 0, props.max));
            }}
          />
          {props.suffix ? <span aria-hidden="true">{props.suffix}</span> : null}
        </span>
      </div>
      <input
        type="range"
        aria-label={props.label}
        value={clamp(props.value, props.min, props.max)}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function CalculatorPage(_props: PageProps) {
  const cfg = usePluginConfig<Config>();
  const maxAmount = Math.max(cfg.maxAmount || 0, cfg.defaultAmount || 0, 10_000);
  const [amount, setAmount] = useState(cfg.defaultAmount);
  const [rate, setRate] = useState(cfg.defaultRate);
  const [years, setYears] = useState(cfg.defaultYears);

  const months = Math.round(years * 12);
  const result = useMemo(() => calculateEmi(amount, rate, months), [amount, rate, months]);
  const schedule = useMemo(
    () => (cfg.showSchedule ? yearlySchedule(amount, rate, months) : []),
    [cfg.showSchedule, amount, rate, months],
  );
  const money = (v: number) => formatMoney(v, cfg.currency, cfg.grouping);
  const interestShare = result.totalPayment > 0 ? (result.totalInterest / result.totalPayment) * 100 : 0;

  return (
    <section className="npemi" style={{ ['--npemi-accent' as string]: cfg.accent }}>
      <header className="npemi-header">
        <h1>{cfg.heading}</h1>
        {cfg.intro ? <p>{cfg.intro}</p> : null}
      </header>

      <div className="npemi-grid">
        <form className="npemi-card" onSubmit={(e) => e.preventDefault()}>
          <Field
            label="Loan amount"
            prefix={cfg.currency}
            value={amount}
            min={Math.min(10_000, maxAmount)}
            max={maxAmount}
            step={maxAmount > 1_000_000 ? 10_000 : 1_000}
            onChange={setAmount}
          />
          <Field label="Interest rate" suffix="% a year" value={rate} min={0} max={30} step={0.05} onChange={setRate} />
          <Field label="Tenure" suffix="years" value={years} min={1} max={40} step={1} onChange={setYears} />
        </form>

        <div className="npemi-card npemi-result" aria-live="polite">
          <p className="npemi-label">Monthly EMI</p>
          <p className="npemi-emi" data-testid="emi">
            {money(result.emi)}
          </p>
          <div
            className="npemi-bar"
            role="img"
            aria-label={`Interest is ${interestShare.toFixed(0)}% of the total you pay`}
          >
            <span style={{ width: `${(100 - interestShare).toFixed(2)}%` }} />
          </div>
          <dl className="npemi-totals">
            <div>
              <dt>
                <i className="npemi-dot npemi-dot-principal" />
                Principal
              </dt>
              <dd>{money(amount)}</dd>
            </div>
            <div>
              <dt>
                <i className="npemi-dot npemi-dot-interest" />
                Total interest
              </dt>
              <dd data-testid="interest">{money(result.totalInterest)}</dd>
            </div>
            <div className="npemi-total">
              <dt>Total you pay</dt>
              <dd>{money(result.totalPayment)}</dd>
            </div>
          </dl>
          {cfg.ctaLabel && cfg.ctaUrl ? (
            <a className="npemi-cta" href={cfg.ctaUrl}>
              {cfg.ctaLabel}
            </a>
          ) : null}
        </div>
      </div>

      {cfg.showSchedule && schedule.length > 0 ? (
        <div className="npemi-card npemi-schedule">
          <h2>Yearly repayment schedule</h2>
          <div className="npemi-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Principal paid</th>
                  <th scope="col">Interest paid</th>
                  <th scope="col">Balance</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((row) => (
                  <tr key={row.year}>
                    <th scope="row">{row.year}</th>
                    <td>{money(row.principal)}</td>
                    <td>{money(row.interest)}</td>
                    <td>{money(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
