function followUp({ invoice_number, client_name, amount, due_date, sender_name, pay_link }) {
  const subject = `Following up — Invoice #${invoice_number}`

  const text = `Dear ${client_name},

We wanted to follow up on Invoice #${invoice_number} for ${amount}, which was due on ${due_date}.

If payment has already been arranged, please disregard this message. Otherwise, we would appreciate payment at your earliest convenience.

${pay_link && pay_link !== '#' ? `Pay now: ${pay_link}` : ''}

Regards,
${sender_name}`

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: 'IBM Plex Sans', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
  .wrapper { max-width: 560px; margin: 40px auto; background: #ffffff; border: 1px solid #e0e0e0; }
  .header { background: #0C0C0C; padding: 24px 32px; display: flex; justify-content: space-between; align-items: center; }
  .header-wordmark { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #888580; letter-spacing: 0.15em; }
  .header-badge { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #B87D2A; border: 1px solid #B87D2A; padding: 3px 8px; }
  .body { padding: 32px; }
  .greeting { font-size: 16px; color: #1a1a1a; margin-bottom: 20px; }
  .message { font-size: 14px; color: #4a4a4a; line-height: 1.7; margin-bottom: 24px; }
  .invoice-box { border: 1px solid #e0e0e0; padding: 20px 24px; margin-bottom: 28px; }
  .invoice-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; }
  .invoice-row:last-child { border-bottom: none; }
  .invoice-label { color: #888; font-family: 'IBM Plex Mono', monospace; font-size: 11px; }
  .invoice-value { color: #1a1a1a; font-family: 'IBM Plex Mono', monospace; font-size: 11px; }
  .cta { display: block; background: #C8402A; color: #ffffff; text-decoration: none; font-family: 'IBM Plex Mono', monospace; font-size: 13px; letter-spacing: 0.05em; padding: 14px 28px; text-align: center; margin-bottom: 28px; }
  .footer-text { font-size: 12px; color: #999; line-height: 1.6; }
  .divider { height: 1px; background: #e0e0e0; margin: 24px 0; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <div class="header-wordmark">COLLET</div>
    <div class="header-badge">FOLLOW-UP</div>
  </div>
  <div class="body">
    <p class="greeting">Dear ${client_name},</p>
    <p class="message">
      We wanted to follow up on Invoice #${invoice_number} for <strong>${amount}</strong>, 
      which was due on <strong>${due_date}</strong>.
      <br><br>
      If payment has already been arranged, please disregard this message.
    </p>
    <div class="invoice-box">
      <div class="invoice-row">
        <span class="invoice-label">INVOICE</span>
        <span class="invoice-value">#${invoice_number}</span>
      </div>
      <div class="invoice-row">
        <span class="invoice-label">DUE DATE</span>
        <span class="invoice-value">${due_date}</span>
      </div>
      <div class="invoice-row">
        <span class="invoice-label">OUTSTANDING</span>
        <span class="invoice-value">${amount}</span>
      </div>
    </div>
    ${pay_link && pay_link !== '#' ? `<a href="${pay_link}" class="cta">PAY NOW — ${amount}</a>` : ''}
    <div class="divider"></div>
    <p class="footer-text">
      Questions about this invoice? Reply to this email and we'll assist you promptly.
    </p>
    <p class="footer-text" style="margin-top:16px;">Regards,<br><strong>${sender_name}</strong></p>
  </div>
</div>
</body>
</html>`

  return { subject, html, text }
}

module.exports = followUp
