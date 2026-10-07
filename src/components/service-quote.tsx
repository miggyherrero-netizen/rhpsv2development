import Link from "next/link";
import { fmtDateLong } from "@/lib/format";
import { computeTotals, jobCode, taxLineLabel } from "@/lib/service";
import { documentMoney } from "@/lib/service-documents";
import { QUOTE_STATUS_LABEL, quoteCode, quoteLines, quoteStatus } from "@/lib/service-flow";
import { jobHeading } from "@/lib/service-reports";
import type { JobDetail, ServiceSettings } from "@/server/service-data";
import QuoteActions from "@/components/service-quote-actions";
import { SVC_FONT_VARS } from "@/lib/service-fonts";
import styles from "./service-document.module.css";

/** A quote is the job's own line items on white paper: Quote → Accepted → Convert to invoice. */
export default function ServiceQuote({ detail, settings }: { detail: JobDetail; settings: ServiceSettings }) {
  const { job, customer, location, piano, events } = detail;
  const code = quoteCode(jobCode(settings.jobPrefix, job.jobNumber, job.createdAt));
  const status = quoteStatus(job.status, events);
  const lines = quoteLines(detail.items, job.travelFeeCents);
  const totals = computeTotals(lines, { taxRateBps: settings.taxRateBps, vatEnabled: settings.vatEnabled });
  const vatOn = settings.vatEnabled && settings.taxRateBps > 0;
  const accepted = events.find((e) => e.type === "quote_accepted");
  const liveInvoice = detail.invoices.find((i) => !i.voidedAt) ?? null;
  const heading = jobHeading(job.title, job.serviceType).heading;
  const pianoLabel = piano ? [piano.brand, piano.model].filter(Boolean).join(" ") || piano.type : null;

  return (
    <main className={`${styles.studio} ${SVC_FONT_VARS}`}>
      <div className={styles.inner}>
        <div className={styles.toolbar} data-print-hide>
          <div>
            <Link className={styles.back} href={`/service/jobs/${job.id}`}>← Back to job</Link>
            <h1 className={styles.toolbarTitle}>Quote · {QUOTE_STATUS_LABEL[status]}</h1>
          </div>
          <div className={styles.actions}>
            <QuoteActions jobId={job.id} status={status} hasLines={lines.length > 0} invoiceId={liveInvoice?.id ?? null} />
          </div>
        </div>

        <article className={styles.paper} aria-label="Quote" data-print-surface>
          <div className={styles.sheet}>
            <header className={styles.top}>
              <div className={styles.identity}>
                <span className={styles.monogram} aria-hidden="true">H</span>
                <div><div className={styles.company}>{settings.businessName}</div><div className={styles.companySub}>Home piano service · Davao City</div></div>
              </div>
              <div className={styles.title}>
                <div className={styles.kind}>QUOTE</div>
                <div className={styles.code}>{code}</div>
                <div className={styles.small}>{heading}</div>
                {status === "draft" ? <span className={`${styles.stamp} ${styles.alert}`}>DRAFT</span> : null}
              </div>
            </header>

            <h2 className={styles.intro}>A clear estimate for the work ahead.</h2>
            <p className={styles.introSub}>This is a quotation, not an invoice. Nothing is due until you accept it and the work is done.</p>

            <div className={styles.info}>
              <div><p className={styles.label}>Prepared for</p><p className={styles.value}>{customer.name}</p>{customer.company ? <p className={styles.subvalue}>{customer.company}</p> : null}{customer.phone ? <p className={styles.subvalue}>{customer.phone}</p> : null}</div>
              <div><p className={styles.label}>Service</p><p className={styles.value}>{heading}</p>{pianoLabel ? <p className={styles.subvalue}>{pianoLabel}</p> : null}{location ? <p className={styles.subvalue}>{location.addressLine}</p> : null}</div>
              <div><p className={styles.label}>Dates</p><p className={styles.value}>Prepared {fmtDateLong(job.createdAt)}</p>{job.scheduledStart ? <p className={styles.subvalue}>Visit {fmtDateLong(job.scheduledStart)}</p> : null}</div>
            </div>

            {lines.length === 0 ? (
              <p className={styles.receiptNote}>No line items yet — add services and parts on the job to build the quote.</p>
            ) : (
              <>
                <table className={styles.table}>
                  <colgroup><col className={styles.colDesc} /><col className={styles.colQty} /><col className={styles.colRate} /><col className={styles.colAmount} /></colgroup>
                  <thead><tr><th scope="col">Description</th><th scope="col" className={styles.number}>Qty</th><th scope="col" className={styles.number}>Rate</th><th scope="col" className={styles.number}>Amount</th></tr></thead>
                  <tbody>
                    {lines.map((item, i) => (
                      <tr key={item.id ?? `l${i}`}>
                        <td className={styles.desc}><span className={styles.itemName}>{item.description}</span>{item.details ? <span className={styles.itemDetails}>{item.details}</span> : null}{vatOn && !item.taxable ? <span className={styles.exempt}>VAT exempt</span> : null}</td>
                        <td className={styles.number} data-label="Qty">{item.qty}</td>
                        <td className={styles.number} data-label="Rate">{documentMoney(item.unitPriceCents)}</td>
                        <td className={`${styles.number} ${styles.amount}`} data-label="Amount">{documentMoney(item.qty * item.unitPriceCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className={styles.totals}>
                  <div className={styles.row}><span>Subtotal</span><strong>{documentMoney(totals.subtotalCents)}</strong></div>
                  {vatOn ? <div className={styles.row}><span>{taxLineLabel(settings.taxLabel, settings.taxRateBps)}</span><strong>{documentMoney(totals.taxCents)}</strong></div> : null}
                  <div className={`${styles.row} ${styles.total}`}><span>Quote total</span><strong>{documentMoney(totals.totalCents)}</strong></div>
                </div>
              </>
            )}

            {accepted ? <div className={styles.callout}><strong>Accepted</strong><p>This quote was accepted on {fmtDateLong(accepted.at)}.</p></div> : null}
            {job.notes ? <div className={styles.callout}><strong>Notes</strong><p>{job.notes}</p></div> : null}

            <footer className={styles.footer}><p>Thank you for considering us for your piano.<br />Prices are an estimate until the work is complete.</p><span className={styles.thanks}>With care, {settings.businessName}</span></footer>
          </div>
        </article>
        <p className={styles.note} data-print-hide>Customer copy · a quotation, not a tax document.</p>
      </div>
    </main>
  );
}
