import Link from "next/link";
import type { ReactNode } from "react";
import { fmtDateLong } from "@/lib/format";
import { invoiceCode, PAYMENT_METHOD_LABEL, taxLineLabel } from "@/lib/service";
import { documentMoney, paymentReceiptCode, paymentSettlement } from "@/lib/service-documents";
import type { InvoiceDetail } from "@/server/service-data";
import { SVC_FONT_VARS } from "@/lib/service-fonts";
import styles from "./service-document.module.css";

type ServicePayment = InvoiceDetail["payments"][number];

function TotalsRow({ label, cents, variant = "" }: { label: string; cents: number; variant?: "" | "total" | "balance" }) {
  return <div className={`${styles.row} ${variant ? styles[variant] : ""}`}><span>{label}</span><strong>{documentMoney(cents)}</strong></div>;
}

export default function ServiceDocument({
  detail, payment, actions, backHref,
}: {
  detail: InvoiceDetail;
  payment?: ServicePayment;
  actions: ReactNode;
  backHref?: string;
}) {
  const { invoice, items, customer, settings } = detail;
  const code = invoiceCode(settings.invoicePrefix, invoice.invoiceNumber, invoice.issueDate);
  const isReceipt = !!payment;
  const receiptCode = payment ? paymentReceiptCode(payment.id, payment.receivedAt) : null;
  const settlement = payment ? paymentSettlement(invoice.totalCents, detail.payments, payment.id) : null;
  // The DB stores the invoice's rate and tax amount; changing today's setting does not rewrite its history.
  // No tax row at all when VAT was not charged (same as the quote); it only appears for invoices that carry VAT.
  const taxLabel = taxLineLabel(settings.taxLabel, invoice.taxRateBps);

  // One-word status mark, derived from existing data. Sits in the header, in flow, so it can never cover content.
  const settled = invoice.balanceCents <= 0 && invoice.totalCents > 0;
  const stamp: { text: string; tone: "alert" | "ok" | "partial" } | null =
    invoice.voidedAt ? { text: "VOID", tone: "alert" }
    : invoice.status === "draft" ? { text: "DRAFT", tone: "alert" }
    : isReceipt ? null
    : settled ? { text: "PAID", tone: "ok" }
    : invoice.amountPaidCents > 0 ? { text: "PARTIALLY PAID", tone: "partial" }
    : null;

  return (
    <main className={`${styles.studio} ${SVC_FONT_VARS}`}>
      <div className={styles.inner}>
        <div className={styles.toolbar} data-print-hide>
          <div>
            {backHref ? <Link className={styles.back} href={backHref}>← Back to invoice</Link> : null}
            <h1 className={styles.toolbarTitle}>{isReceipt ? "Payment receipt" : "Invoice document"}</h1>
          </div>
          <div className={styles.actions}>{actions}</div>
        </div>

        <article className={styles.paper} aria-label={isReceipt ? "Payment receipt" : "Invoice"} data-print-surface>
          <div className={styles.sheet}>
            <header className={styles.top}>
              <div className={styles.identity}>
                <span className={styles.monogram} aria-hidden="true">H</span>
                <div>
                  <div className={styles.company}>{settings.businessName}</div>
                  <div className={styles.companySub}>Home piano service · Davao City</div>
                </div>
              </div>
              <div className={styles.title}>
                <div className={styles.kind}>{isReceipt ? "PAYMENT RECEIPT" : "INVOICE"}</div>
                <div className={styles.code}>{receiptCode ?? code}</div>
                <div className={styles.small}>{isReceipt ? `For ${code}` : detail.job ? `Service · ${detail.job.title}` : "Home service"}</div>
                {stamp ? <span className={`${styles.stamp} ${styles[stamp.tone]}`}>{stamp.text}</span> : null}
              </div>
            </header>

            {payment && settlement ? <>
              <h2 className={styles.intro}>Thank you. Payment received.</h2>
              <p className={styles.introSub}>An acknowledgement of this payment, not a new invoice or an official tax receipt.</p>
              <div className={styles.hero}>
                <div>
                  <div className={styles.heroLabel}>Amount received</div>
                  <div className={styles.heroSub}>{settlement.balanceCents > 0 ? "Partial payment" : "Paid in full"} · {fmtDateLong(payment.receivedAt)}</div>
                </div>
                <div className={styles.heroAmount}>{documentMoney(payment.amountCents)}</div>
              </div>
              <div className={styles.receiptInfo}>
                <div><p className={styles.label}>Received from</p><p className={styles.value}>{customer.name}</p>{customer.company ? <p className={styles.subvalue}>{customer.company}</p> : null}</div>
                <div><p className={styles.label}>For</p><p className={styles.value}>{detail.job?.title ?? "Home service"}</p><p className={styles.subvalue}>Invoice {code}</p></div>
                <div><p className={styles.label}>Payment method</p><p className={styles.value}>{PAYMENT_METHOD_LABEL[payment.method] ?? payment.method}</p>{payment.reference ? <p className={styles.subvalue}>Reference: {payment.reference}</p> : null}</div>
                <div><p className={styles.label}>Received on</p><p className={styles.value}>{fmtDateLong(payment.receivedAt)}</p><p className={styles.subvalue}>Payment ID: {payment.id}</p></div>
              </div>
              <div className={`${styles.totals} ${styles.settlement}`}>
                <TotalsRow label="Invoice total" cents={invoice.totalCents} />
                <TotalsRow label="Previous payments" cents={settlement.previousCents} />
                <TotalsRow label="This payment" cents={-payment.amountCents} />
                <TotalsRow label="Balance after payment" cents={settlement.balanceCents} variant="balance" />
              </div>
              <p className={styles.receiptNote}>This receipt confirms the individual payment above. Refer to the linked invoice for itemized services and the VAT breakdown. Later payments receive separate receipts. The balance reflects currently recorded payments and invoice amounts.</p>
            </> : <>
              <h2 className={styles.intro}>Thoughtful care for the piano you love.</h2>
              <p className={styles.introSub}>A clear record of the work completed and the amount due.</p>
              <div className={styles.info}>
                <div><p className={styles.label}>Billed to</p><p className={styles.value}>{customer.name}</p>{customer.company ? <p className={styles.subvalue}>{customer.company}</p> : null}</div>
                <div><p className={styles.label}>Service</p><p className={styles.value}>{detail.job?.title ?? "Home service"}</p>{invoice.jobCode ? <p className={styles.subvalue}>Job {invoice.jobCode}</p> : null}</div>
                <div><p className={styles.label}>Dates</p><p className={styles.value}>Issued {fmtDateLong(invoice.issueDate)}</p>{invoice.dueDate ? <p className={styles.subvalue}>Due {fmtDateLong(invoice.dueDate)}</p> : null}</div>
              </div>
              <table className={styles.table}>
                <colgroup><col className={styles.colDesc} /><col className={styles.colQty} /><col className={styles.colRate} /><col className={styles.colAmount} /></colgroup>
                <thead><tr><th scope="col">Description</th><th scope="col" className={styles.number}>Qty</th><th scope="col" className={styles.number}>Rate</th><th scope="col" className={styles.number}>Amount</th></tr></thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id}>
                      <td className={styles.desc}>
                        <span className={styles.itemName}>{item.description}</span>
                        {item.details ? <span className={styles.itemDetails}>{item.details}</span> : null}
                        {!item.taxable && invoice.taxRateBps > 0 ? <span className={styles.exempt}>VAT exempt</span> : null}
                      </td>
                      <td className={styles.number} data-label="Qty">{item.qty}</td>
                      <td className={styles.number} data-label="Rate">{documentMoney(item.unitPriceCents)}</td>
                      <td className={`${styles.number} ${styles.amount}`} data-label="Amount">{documentMoney(item.qty * item.unitPriceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.totals}>
                <TotalsRow label="Subtotal" cents={invoice.subtotalCents} />
                {invoice.discountCents ? <TotalsRow label="Discount" cents={-invoice.discountCents} /> : null}
                {invoice.taxRateBps > 0 || invoice.taxCents !== 0 ? <TotalsRow label={taxLabel} cents={invoice.taxCents} /> : null}
                <TotalsRow label="Invoice total" cents={invoice.totalCents} variant="total" />
                <TotalsRow label="Payments received" cents={-invoice.amountPaidCents} />
                <TotalsRow label="Balance due" cents={invoice.balanceCents} variant="balance" />
              </div>
              {invoice.amountPaidCents > 0 ? <div className={styles.callout}><strong>Payment on record</strong><p>{documentMoney(invoice.amountPaidCents)} received. A separate receipt is available for each recorded payment. Please refer to {code} for future payments.</p></div> : null}
              {invoice.terms || invoice.notes ? <div className={styles.callout}><strong>Notes &amp; terms</strong><p>{invoice.terms}{invoice.terms && invoice.notes ? " · " : ""}{invoice.notes}</p></div> : null}
            </>}

            <footer className={styles.footer}>
              <p>Thank you for trusting us with your piano.<br />Please keep this document for your records.</p>
              <span className={styles.thanks}>With care, {settings.businessName}</span>
            </footer>
          </div>
        </article>
        <p className={styles.note} data-print-hide>Customer copy · {isReceipt ? "Payment acknowledgement only, not an official tax receipt." : "Verify registered business details and tax wording before issuing as an official document."}</p>
      </div>
    </main>
  );
}
