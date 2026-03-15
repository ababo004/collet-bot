function finalNotice({ invoice_number, client_name, amount, due_date, days_overdue, sender_name, pay_link }) {
  const subject = `Final notice — Invoice #${invoice_number} (${amount})`

  const text = `Dear ${client_name},

This is a formal final notice that Invoice #${invoice_number} for ${amount} is now ${days_overdue} days overdue.

Immediate payment is required. If payment is not received within 5 business days, we may need to pursue further action per our contract terms.

${pay_link && pay_link !== '#' ? `Pay now immediately: ${pay_link}` : ''}

Regards,
${sender_name}`

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: 'IBM Plex Sans', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
  .wrapper { max-width: 560px; margin: 40px auto; background: #ffffff; border: 1px solid #e0e0e0; border-top: 3px solid #C8402A; }
  .header { background: #0C0C0C; padding: 24px 32px; display: flex; justify-content: space-between; align-items: center; }
  .header-wordmark { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #888580; letter-spacing: 0.15em; }
  .header-badge { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #C8402A; border: 1px solid #C8402A; padding: 3px 8px; }
  .body { padding: 32px; }
  .greeting { font-size: 16px; color: #1a1a1a; margin-bottom: 20px; }
  .message { font-size: 14px; color: #4a4a4a; line-height: 1.7; margin-bottom: 24px; }
  .critical-banner { background: #fdf2f2; border: 1px solid #f0a0a0; border-left: 3px solid #C8402A; padding: 16px 20px; margin-bottom: 24px; }
  .critical-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #C8402A; letter-spacing: 0.1em; margin-bottom: 6px; }
  .critical-text { font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: #7a1a1a; font-weight: 500; }
  .invoice-box { border: 1px solid #e0e0e0; padding: 20px 24px; margin-bottom: 28px; }
  .invoice-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
  .invoice-row:last-child { border-bottom: none; }
  .invoice-label { color: #888; font-family: 'IBM Plex Mono', monospace; font-size: 11px; }
  .invoice-value { color: #1a1a1a; font-family: 'IBM Plex Mono', monospace; font-size: 11px; }
  .invoice-value.critical { color: #C8402A; font-weight: 600; }
  .cta { display: block; background: #C8402A; color: #ffffff; text-decoration: none; font-family: 'IBM Plex Mono', monospace; font-size: 13px; letter-spacing: 0.05em; padding: 16px 28px; text-align: center; margin-bottom: 28px; border: 2px solid #C8402A; }
  .cta:hover { background: #a03020; }
  .warning-text { font-size: 13px; color: #4a4a4a; line-height: 1.7; padding: 16px; border: 1px solid #e0e0e0; background: #f9f9f9; margin-bottom: 24px; }
  .footer-text { font-size: 12px; color: #999; line-height: 1.6; }
  .divider { height: 1px; background: #e0e0e0; margin: 24px 0; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <div class="header-wordmark">COLLET</div>
    <div class="header-badge">FINAL NOTICE</div>
  </div>
  <div class="body">
    <p class="greeting">Dear ${client_name},</p>
    <div class="critical-banner">
      <div class="critical-label">FORMAL FINAL NOTICE</div>
      <div class="critical-text">Invoice #${invoice_number} — ${days_overdue} days overdue — ${amount}</div>
    </div>
    <p class="message">
      This is a formal final notice that Invoice #${invoice_number} for <strong>${amount}</strong> 
      is now <strong>${days_overdue} days overdue</strong>. Immediate payment is required.
    </p>
    <div class="invoice-box">
      <div class="invoice-row">
        <span class="invoice-label">INVOICE</span>
        <span class="invoice-value">#${invoice_number}</span>
      </div>
      <div class="invoice-row">
        <span class="invoice-label">ORIGINAL DUE DATE</span>
        <span class="invoice-value">${due_date}</span>
      </div>
      <div class="invoice-row">
        <span class="invoice-label">DAYS OVERDUE</span>
        <span class="invoice-value critical">${days_overdue} days</span>
      </div>
      <div class="invoice-row">
        <span class="invoice-label">AMOUNT OUTSTANDING</span>
        <span class="invoice-value critical">${amount}</span>
      </div>
    </div>
    ${pay_link && pay_link !== '#' ? `<a href="${pay_link}" class="cta">PAY NOW IMMEDIATELY — ${amount}</a>` : ''}
    <div class="warning-text">
      If payment is not received within <strong>5 business days</strong>, we may need to 
      pursue further action per our contract terms. Please contact us immediately to 
      resolve this matter.
    </div>
    <div class="divider"></div>
    <p class="footer-text">
      If payment has already been processed, please reply with confirmation and we will update our records immediately.
    </p>
    <p class="footer-text" style="margin-top:16px;">Regards,<br><strong>${sender_name}</strong></p>
  </div>
</div>
</body>
</html>`

  return { subject, html, text }
}

module.exports = finalNotice
