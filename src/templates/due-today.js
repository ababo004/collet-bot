function dueToday({ invoice_number, client_name, amount, due_date, sender_name, pay_link }) {
  const subject = `Invoice #${invoice_number} is due today — ${amount}`

  const text = `Dear ${client_name},

Invoice #${invoice_number} for ${amount} is due today.

Payment can be made via the link below. If you have already arranged payment, please disregard this message.

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
  .header-badge { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #1D7A45; border: 1px solid #1D7A45; padding: 3px 8px; }
  .body { padding: 32px; }
  .greeting { font-size: 16px; color: #1a1a1a; margin-bottom: 20px; }
  .message { font-size: 14px; color: #4a4a4a; line-height: 1.7; margin-bottom: 24px; }
  .amount-box { background: #f9f9f9; border: 1px solid #e0e0e0; border-left: 3px solid #C8402A; padding: 20px 24px; margin-bottom: 28px; }
  .amount-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #999; letter-spacing: 0.1em; margin-bottom: 8px; }
  .amount-value { font-family: 'IBM Plex Mono', monospace; font-size: 28px; color: #1a1a1a; font-weight: 500; }
  .amount-meta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #888; margin-top: 6px; }
  .cta { display: block; background: #C8402A; color: #ffffff; text-decoration: none; font-family: 'IBM Plex Mono', monospace; font-size: 13px; letter-spacing: 0.05em; padding: 16px 28px; text-align: center; margin-bottom: 28px; }
  .footer-text { font-size: 12px; color: #999; line-height: 1.6; }
  .divider { height: 1px; background: #e0e0e0; margin: 24px 0; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <div class="header-wordmark">COLLET</div>
    <div class="header-badge">DUE TODAY</div>
  </div>
  <div class="body">
    <p class="greeting">Dear ${client_name},</p>
    <p class="message">
      Invoice #${invoice_number} is due today. Payment can be made via the link below.
    </p>
    <div class="amount-box">
      <div class="amount-label">AMOUNT DUE</div>
      <div class="amount-value">${amount}</div>
      <div class="amount-meta">Invoice #${invoice_number} · Due ${due_date}</div>
    </div>
    ${pay_link && pay_link !== '#' ? `<a href="${pay_link}" class="cta">PAY NOW — ${amount}</a>` : ''}
    <div class="divider"></div>
    <p class="footer-text">
      If payment has already been arranged, please disregard this message.<br>
      Questions? Reply to this email.
    </p>
    <p class="footer-text" style="margin-top:16px;">Regards,<br><strong>${sender_name}</strong></p>
  </div>
</div>
</body>
</html>`

  return { subject, html, text }
}

module.exports = dueToday
